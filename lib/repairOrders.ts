// Repair orders: the shop floor.
//
// An estimate is a promise and an invoice is a bill; the repair order is the
// only one of the three that changes while people are working on it. So this
// module is mostly about controlling *when* it can change:
//
//   - lines are editable while the work is OPEN or IN_PROGRESS, not after
//   - status moves along a fixed graph, never sideways
//   - INVOICED is not reachable from here at all -- only lib/convert.ts sets it,
//     because reaching it means money was committed
//
// Totals are recomputed from the stored rows after every change, exactly as in
// lib/estimates.ts, so the header can never drift from the lines.

import { db } from "@/lib/db";
import { computeTotals } from "@/lib/money";
import { validateLine, type LineInput } from "@/lib/estimates";
import type { RepairOrderStatus } from "@/lib/generated/prisma";

export class RepairOrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepairOrderError";
  }
}

/**
 * Which statuses a repair order may move to next.
 *
 * INVOICED appears as a source but never as a destination: a repair order gets
 * there by being invoiced, and once it has been, the invoice is the record.
 * Reopening it would mean the bill and the work no longer agree.
 */
const TRANSITIONS: Record<RepairOrderStatus, RepairOrderStatus[]> = {
  OPEN: ["IN_PROGRESS", "COMPLETE", "CANCELLED"],
  IN_PROGRESS: ["COMPLETE", "OPEN", "CANCELLED"],
  COMPLETE: ["IN_PROGRESS"],
  INVOICED: [],
  CANCELLED: [],
};

/** Work can still be added or corrected. */
const EDITABLE: RepairOrderStatus[] = ["OPEN", "IN_PROGRESS"];

export function isEditable(status: RepairOrderStatus) {
  return EDITABLE.includes(status);
}

export function nextStatuses(status: RepairOrderStatus): RepairOrderStatus[] {
  return TRANSITIONS[status];
}

export const STATUS_LABEL: Record<RepairOrderStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  COMPLETE: "Ready to invoice",
  INVOICED: "Invoiced",
  CANCELLED: "Cancelled",
};

// ------------------------------------------------------------------ reads

export async function getRepairOrder(tenantId: string, id: string) {
  const ro = await db.repairOrder.findFirst({
    where: { id, tenantId },
    include: {
      customer: true,
      vehicle: true,
      location: true,
      estimate: { select: { id: true, number: true } },
      advisor: { select: { id: true, name: true } },
      technician: { select: { id: true, name: true } },
      invoices: { select: { id: true, number: true, status: true } },
      events: { orderBy: { createdAt: "asc" }, include: { user: { select: { name: true } } } },
      inspections: { select: { id: true, status: true, createdAt: true } },
    },
  });
  if (!ro) return null;

  const lineItems = await db.lineItem.findMany({
    where: { tenantId, parentType: "REPAIR_ORDER", parentId: id },
    orderBy: { sort: "asc" },
  });
  const notes = await db.note.findMany({
    where: { tenantId, parentType: "REPAIR_ORDER", parentId: id },
    orderBy: { createdAt: "desc" },
    include: { author: { select: { name: true } } },
  });
  return { ...ro, lineItems, notes };
}

export async function listRepairOrders(
  tenantId: string,
  opts: { status?: RepairOrderStatus; technicianId?: string; open?: boolean } = {},
) {
  return db.repairOrder.findMany({
    where: {
      tenantId,
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.technicianId ? { technicianId: opts.technicianId } : {}),
      // "Open" for a board means anything still being worked, not billed.
      ...(opts.open ? { status: { in: ["OPEN", "IN_PROGRESS", "COMPLETE"] } } : {}),
    },
    orderBy: [{ promisedAt: "asc" }, { createdAt: "desc" }],
    take: 200,
    include: {
      customer: true,
      vehicle: true,
      technician: { select: { name: true } },
      invoices: { select: { id: true, number: true } },
    },
  });
}

/** A technician's queue: assigned to them, still workable. Deliberately not
 *  every open RO -- §5 says a technician sees their own work only. */
export async function myWork(tenantId: string, technicianId: string) {
  return db.repairOrder.findMany({
    where: { tenantId, technicianId, status: { in: ["OPEN", "IN_PROGRESS"] } },
    orderBy: [{ status: "desc" }, { promisedAt: "asc" }, { createdAt: "asc" }],
    include: { customer: true, vehicle: true },
  });
}

/** Technicians a repair order can be handed to. */
export async function technicians(tenantId: string) {
  const memberships = await db.membership.findMany({
    where: { tenantId, active: true, role: { in: ["TECHNICIAN", "SERVICE_ADVISOR", "MANAGER", "OWNER"] } },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { role: "asc" },
  });
  // A shop of three people has one person doing all three jobs, so anyone who
  // can turn a wrench is assignable -- not only the TECHNICIAN role.
  return memberships.map((m) => ({ id: m.user.id, name: m.user.name, role: m.role }));
}

// ------------------------------------------------------------------ totals

export async function recalculate(tenantId: string, repairOrderId: string) {
  const ro = await db.repairOrder.findFirstOrThrow({ where: { id: repairOrderId, tenantId } });
  const lines = await db.lineItem.findMany({
    where: { tenantId, parentType: "REPAIR_ORDER", parentId: repairOrderId },
  });

  const totals = computeTotals({
    jobs: [{ approved: true, lineItems: lines.filter((l) => l.approved) }],
    discountPct: ro.discountPct,
    taxRate: ro.taxRate,
  });

  return db.repairOrder.update({
    where: { id: repairOrderId },
    data: {
      subtotalCents: totals.subtotalCents,
      discountCents: totals.discountCents,
      taxCents: totals.taxCents,
      totalCents: totals.totalCents,
    },
  });
}

async function load(tenantId: string, repairOrderId: string) {
  const ro = await db.repairOrder.findFirst({ where: { id: repairOrderId, tenantId } });
  if (!ro) throw new RepairOrderError("That repair order no longer exists.");
  return ro;
}

async function assertEditable(tenantId: string, repairOrderId: string) {
  const ro = await load(tenantId, repairOrderId);
  if (!isEditable(ro.status)) {
    throw new RepairOrderError(
      ro.status === "COMPLETE"
        ? `RO #${ro.number} is marked ready to invoice. Reopen it before changing the work.`
        : `RO #${ro.number} is ${STATUS_LABEL[ro.status].toLowerCase()} and can no longer be changed.`,
    );
  }
  return ro;
}

// ------------------------------------------------------------------ status

export async function setStatus(
  tenantId: string,
  repairOrderId: string,
  to: RepairOrderStatus,
  opts: { userId?: string; note?: string | null } = {},
) {
  const ro = await load(tenantId, repairOrderId);
  if (ro.status === to) return ro;

  if (to === "INVOICED") {
    throw new RepairOrderError("A repair order becomes invoiced by being invoiced, not by changing its status.");
  }
  if (!TRANSITIONS[ro.status].includes(to)) {
    throw new RepairOrderError(
      `RO #${ro.number} cannot go from ${STATUS_LABEL[ro.status].toLowerCase()} to ${STATUS_LABEL[to].toLowerCase()}.`,
    );
  }

  const saved = await db.repairOrder.update({
    where: { id: ro.id },
    data: {
      status: to,
      // Set once, on first move to IN_PROGRESS: a reopened job keeps the hour
      // it was actually started, which is what productivity reporting needs.
      startedAt: to === "IN_PROGRESS" && !ro.startedAt ? new Date() : undefined,
      completedAt: to === "COMPLETE" ? new Date() : to === "IN_PROGRESS" ? null : undefined,
    },
  });

  await db.repairOrderEvent.create({
    data: {
      repairOrderId: ro.id,
      userId: opts.userId ?? null,
      from: ro.status,
      to,
      note: opts.note ?? null,
    },
  });

  return saved;
}

export async function assignTechnician(
  tenantId: string,
  repairOrderId: string,
  technicianId: string | null,
  opts: { userId?: string } = {},
) {
  const ro = await load(tenantId, repairOrderId);
  if (ro.status === "INVOICED" || ro.status === "CANCELLED") {
    throw new RepairOrderError(`RO #${ro.number} is ${STATUS_LABEL[ro.status].toLowerCase()} and cannot be reassigned.`);
  }

  if (technicianId) {
    const member = await db.membership.findFirst({ where: { tenantId, userId: technicianId, active: true } });
    if (!member) throw new RepairOrderError("That person does not work at this shop.");
  }

  const saved = await db.repairOrder.update({
    where: { id: ro.id },
    data: { technicianId },
  });

  const who = technicianId
    ? (await db.user.findUnique({ where: { id: technicianId }, select: { name: true } }))?.name ?? "someone"
    : null;
  await db.repairOrderEvent.create({
    data: {
      repairOrderId: ro.id,
      userId: opts.userId ?? null,
      to: ro.status,
      note: who ? `Assigned to ${who}.` : "Unassigned.",
    },
  });

  return saved;
}

export async function updateRepairOrder(
  tenantId: string,
  repairOrderId: string,
  input: {
    complaint?: string | null;
    customerNote?: string | null;
    internalNote?: string | null;
    discountPct?: number;
    mileageIn?: number | null;
    promisedAt?: Date | null;
  },
) {
  await assertEditable(tenantId, repairOrderId);

  if (input.discountPct != null && (input.discountPct < 0 || input.discountPct > 100)) {
    throw new RepairOrderError("A discount must be between 0 and 100 percent.");
  }

  await db.repairOrder.update({
    where: { id: repairOrderId },
    data: {
      complaint: input.complaint ?? undefined,
      customerNote: input.customerNote ?? undefined,
      internalNote: input.internalNote ?? undefined,
      mileageIn: input.mileageIn ?? undefined,
      discountPct: input.discountPct ?? undefined,
      promisedAt: input.promisedAt === undefined ? undefined : input.promisedAt,
    },
  });
  return recalculate(tenantId, repairOrderId);
}

// ------------------------------------------------------------------- lines

/**
 * Adds work to a repair order that is already underway.
 *
 * This is the upsell path -- the tech finds a torn boot with the car on the
 * lift. It writes a status event saying so, because the customer approved an
 * estimate that did not include this, and the shop needs to be able to show
 * when the extra work appeared and who added it.
 */
export async function addLine(
  tenantId: string,
  repairOrderId: string,
  input: LineInput,
  opts: { userId?: string } = {},
) {
  const ro = await assertEditable(tenantId, repairOrderId);
  const last = await db.lineItem.findFirst({
    where: { tenantId, parentType: "REPAIR_ORDER", parentId: repairOrderId },
    orderBy: { sort: "desc" },
    select: { sort: true },
  });

  const clean = validateLine(input);
  await db.lineItem.create({
    data: {
      tenantId,
      parentType: "REPAIR_ORDER",
      parentId: repairOrderId,
      sort: (last?.sort ?? -1) + 1,
      ...clean,
    },
  });

  if (ro.estimateId) {
    await db.repairOrderEvent.create({
      data: {
        repairOrderId,
        userId: opts.userId ?? null,
        to: ro.status,
        note: `Added "${clean.name}" after the customer approved the estimate.`,
      },
    });
  }

  return recalculate(tenantId, repairOrderId);
}

export async function updateLine(tenantId: string, lineId: string, input: LineInput) {
  const line = await db.lineItem.findFirst({ where: { id: lineId, tenantId, parentType: "REPAIR_ORDER" } });
  if (!line) throw new RepairOrderError("That line no longer exists.");
  await assertEditable(tenantId, line.parentId);

  await db.lineItem.update({ where: { id: lineId }, data: validateLine(input) });
  return recalculate(tenantId, line.parentId);
}

export async function removeLine(tenantId: string, lineId: string) {
  const line = await db.lineItem.findFirst({ where: { id: lineId, tenantId, parentType: "REPAIR_ORDER" } });
  if (!line) throw new RepairOrderError("That line no longer exists.");
  await assertEditable(tenantId, line.parentId);

  await db.lineItem.delete({ where: { id: lineId } });
  return recalculate(tenantId, line.parentId);
}

// ------------------------------------------------------------------- notes

export async function addNote(tenantId: string, repairOrderId: string, body: string, authorId?: string) {
  const text = body.trim();
  if (!text) throw new RepairOrderError("Write something before saving the note.");
  await load(tenantId, repairOrderId);

  return db.note.create({
    data: { tenantId, parentType: "REPAIR_ORDER", parentId: repairOrderId, authorId: authorId ?? null, body: text },
  });
}

// -------------------------------------------------------------- walk-in RO

/**
 * A repair order written straight at the counter, with no estimate behind it.
 *
 * This is most of the volume for an oil-change or tire shop: the customer is
 * standing there, the price is known, and making them approve an estimate first
 * would be theatre. The conversion guard in lib/convert.ts is untouched by
 * this -- an RO with no estimateId simply has nothing to reconcile against.
 */
export async function createWalkIn(
  tenantId: string,
  input: {
    customerId: string;
    vehicleId: string;
    advisorId?: string;
    technicianId?: string | null;
    locationId?: string | null;
    complaint?: string | null;
    mileageIn?: number | null;
  },
) {
  const vehicle = await db.vehicle.findFirst({
    where: { id: input.vehicleId, tenantId, customerId: input.customerId },
  });
  if (!vehicle) throw new RepairOrderError("Pick a vehicle that belongs to this customer.");

  const location = input.locationId
    ? await db.location.findFirst({ where: { id: input.locationId, tenantId } })
    : await db.location.findFirst({ where: { tenantId } });

  const last = await db.repairOrder.findFirst({
    where: { tenantId },
    orderBy: { number: "desc" },
    select: { number: true },
  });

  const ro = await db.repairOrder.create({
    data: {
      tenantId,
      locationId: location?.id ?? null,
      number: (last?.number ?? 1000) + 1,
      customerId: input.customerId,
      vehicleId: input.vehicleId,
      advisorId: input.advisorId ?? null,
      technicianId: input.technicianId ?? null,
      // Captured now, like an estimate's, so a later rate change cannot restate
      // a ticket already written.
      taxRate: location?.taxRate ?? 0,
      complaint: input.complaint ?? null,
      mileageIn: input.mileageIn ?? vehicle.mileage,
    },
  });

  await db.repairOrderEvent.create({
    data: { repairOrderId: ro.id, userId: input.advisorId ?? null, to: "OPEN", note: "Written at the counter." },
  });

  return ro;
}
