// Estimate building: line items, totals, approval.
//
// Totals are recomputed from the stored rows after every mutation and written
// back to the estimate's own columns. Nothing trusts those columns as input --
// lib/convert.ts recomputes again when the estimate becomes a repair order --
// but keeping them current means list screens never have to aggregate.

import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { computeTotals } from "@/lib/money";
import type { EstimateStatus, LineKind } from "@/lib/generated/prisma";

export class EstimateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EstimateError";
  }
}

/** An estimate stops being editable once the customer has acted on it. */
const EDITABLE: EstimateStatus[] = ["DRAFT", "SENT"];

export function isEditable(status: EstimateStatus) {
  return EDITABLE.includes(status);
}

export async function getEstimate(tenantId: string, id: string) {
  const estimate = await db.estimate.findFirst({
    where: { id, tenantId },
    include: {
      customer: true,
      vehicle: true,
      author: { select: { id: true, name: true } },
      repairOrders: { select: { id: true, number: true } },
    },
  });
  if (!estimate) return null;

  const lineItems = await db.lineItem.findMany({
    where: { tenantId, parentType: "ESTIMATE", parentId: id },
    orderBy: [{ sort: "asc" }],
  });
  return { ...estimate, lineItems };
}

export async function listEstimates(tenantId: string, status?: EstimateStatus) {
  return db.estimate.findMany({
    where: { tenantId, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      customer: true,
      vehicle: true,
      repairOrders: { select: { id: true, number: true } },
    },
  });
}

/** Recomputes from the stored rows and writes the result back. Called after
 *  every line-item change so the header can never drift from the lines. */
export async function recalculate(tenantId: string, estimateId: string) {
  const estimate = await db.estimate.findFirstOrThrow({ where: { id: estimateId, tenantId } });
  const lines = await db.lineItem.findMany({
    where: { tenantId, parentType: "ESTIMATE", parentId: estimateId },
  });

  const totals = computeTotals({
    jobs: [{ approved: true, lineItems: lines.filter((l) => l.approved) }],
    discountPct: estimate.discountPct,
    taxRate: estimate.taxRate,
  });

  return db.estimate.update({
    where: { id: estimateId },
    data: {
      subtotalCents: totals.subtotalCents,
      discountCents: totals.discountCents,
      taxCents: totals.taxCents,
      totalCents: totals.totalCents,
    },
  });
}

async function assertEditable(tenantId: string, estimateId: string) {
  const estimate = await db.estimate.findFirst({ where: { id: estimateId, tenantId } });
  if (!estimate) throw new EstimateError("That estimate no longer exists.");
  if (!isEditable(estimate.status)) {
    throw new EstimateError(
      `Estimate #${estimate.number} is ${estimate.status.toLowerCase()} and can no longer be edited.`,
    );
  }
  return estimate;
}

export async function createEstimate(
  tenantId: string,
  input: { customerId: string; vehicleId: string; authorId?: string; locationId?: string | null; complaint?: string | null; mileageIn?: number | null },
) {
  const vehicle = await db.vehicle.findFirst({
    where: { id: input.vehicleId, tenantId, customerId: input.customerId },
  });
  if (!vehicle) throw new EstimateError("Pick a vehicle that belongs to this customer.");

  const location = input.locationId
    ? await db.location.findFirst({ where: { id: input.locationId, tenantId } })
    : await db.location.findFirst({ where: { tenantId } });

  const last = await db.estimate.findFirst({
    where: { tenantId },
    orderBy: { number: "desc" },
    select: { number: true },
  });

  return db.estimate.create({
    data: {
      tenantId,
      locationId: location?.id ?? null,
      number: (last?.number ?? 1000) + 1,
      customerId: input.customerId,
      vehicleId: input.vehicleId,
      authorId: input.authorId ?? null,
      // Tax rate is captured now rather than read at print time, so changing
      // the shop's rate later cannot restate an estimate already given out.
      taxRate: location?.taxRate ?? 0,
      complaint: input.complaint ?? null,
      mileageIn: input.mileageIn ?? vehicle.mileage,
    },
  });
}

export type LineInput = {
  kind: LineKind;
  name: string;
  section?: string | null;
  sku?: string | null;
  qty: number;
  priceCents: number;
  costCents?: number;
  taxable?: boolean;
  inventoryItemId?: string | null;
};

export function validateLine(input: LineInput) {
  const name = input.name.trim();
  if (!name) throw new EstimateError("Give the line a description.");
  if (!Number.isFinite(input.qty) || input.qty <= 0) throw new EstimateError("Quantity must be more than zero.");
  if (!Number.isFinite(input.priceCents) || input.priceCents < 0) throw new EstimateError("Price cannot be negative.");
  // 9,999 hours of labour or 9,999 of a part is a typo, not an order.
  if (input.qty > 9_999) throw new EstimateError("That quantity looks like a typo.");
  return {
    kind: input.kind,
    name,
    section: input.section?.trim() || null,
    sku: input.sku?.trim() || null,
    qty: input.qty,
    priceCents: Math.round(input.priceCents),
    costCents: Math.round(input.costCents ?? 0),
    // Labour is taxable in some states and not others, so the shop decides per
    // line rather than the software assuming.
    taxable: input.taxable ?? true,
    inventoryItemId: input.inventoryItemId ?? null,
  };
}

export async function addLine(tenantId: string, estimateId: string, input: LineInput) {
  await assertEditable(tenantId, estimateId);
  const last = await db.lineItem.findFirst({
    where: { tenantId, parentType: "ESTIMATE", parentId: estimateId },
    orderBy: { sort: "desc" },
    select: { sort: true },
  });

  await db.lineItem.create({
    data: {
      tenantId,
      parentType: "ESTIMATE",
      parentId: estimateId,
      sort: (last?.sort ?? -1) + 1,
      ...validateLine(input),
    },
  });
  return recalculate(tenantId, estimateId);
}

/** Copies a saved package onto the estimate. Items are copied, so editing the
 *  package later never rewrites an estimate already written. */
export async function addPackage(tenantId: string, estimateId: string, packageId: string) {
  await assertEditable(tenantId, estimateId);
  const pkg = await db.servicePackage.findFirst({ where: { id: packageId, tenantId } });
  if (!pkg) throw new EstimateError("That service package no longer exists.");

  const items = JSON.parse(pkg.itemsJson) as LineInput[];
  for (const item of items) {
    await addLine(tenantId, estimateId, { ...item, section: item.section ?? pkg.name });
  }
  return recalculate(tenantId, estimateId);
}

export async function updateLine(tenantId: string, lineId: string, input: LineInput) {
  const line = await db.lineItem.findFirst({ where: { id: lineId, tenantId, parentType: "ESTIMATE" } });
  if (!line) throw new EstimateError("That line no longer exists.");
  await assertEditable(tenantId, line.parentId);

  await db.lineItem.update({ where: { id: lineId }, data: validateLine(input) });
  return recalculate(tenantId, line.parentId);
}

export async function removeLine(tenantId: string, lineId: string) {
  const line = await db.lineItem.findFirst({ where: { id: lineId, tenantId, parentType: "ESTIMATE" } });
  if (!line) throw new EstimateError("That line no longer exists.");
  await assertEditable(tenantId, line.parentId);

  await db.lineItem.delete({ where: { id: lineId } });
  return recalculate(tenantId, line.parentId);
}

export async function updateEstimate(
  tenantId: string,
  estimateId: string,
  input: { complaint?: string | null; customerNote?: string | null; internalNote?: string | null; discountPct?: number; mileageIn?: number | null },
) {
  await assertEditable(tenantId, estimateId);

  if (input.discountPct != null && (input.discountPct < 0 || input.discountPct > 100)) {
    throw new EstimateError("A discount must be between 0 and 100 percent.");
  }

  await db.estimate.update({
    where: { id: estimateId },
    data: {
      complaint: input.complaint ?? undefined,
      customerNote: input.customerNote ?? undefined,
      internalNote: input.internalNote ?? undefined,
      mileageIn: input.mileageIn ?? undefined,
      discountPct: input.discountPct ?? undefined,
    },
  });
  return recalculate(tenantId, estimateId);
}

// ------------------------------------------------------------- approval

/**
 * Marks the estimate sent and mints an unguessable approval token.
 *
 * The message row is written whether or not a provider is wired up, so the
 * shop has a record of what it told the customer and when. Actually
 * transmitting it is a later sprint; nothing here pretends it was delivered.
 */
export async function sendForApproval(tenantId: string, estimateId: string) {
  const estimate = await assertEditable(tenantId, estimateId);

  const lines = await db.lineItem.findMany({
    where: { tenantId, parentType: "ESTIMATE", parentId: estimateId },
  });
  if (lines.length === 0) throw new EstimateError("Add at least one line before sending this estimate.");

  const customer = await db.customer.findFirstOrThrow({ where: { id: estimate.customerId, tenantId } });
  const token = estimate.approvalToken ?? randomBytes(24).toString("base64url");

  const updated = await db.estimate.update({
    where: { id: estimateId },
    data: { status: "SENT", sentAt: new Date(), approvalToken: token },
  });

  // §7: opt-outs are checked before every send.
  const channel = !customer.smsOptOut && customer.phone ? "SMS" : !customer.emailOptOut && customer.email ? "EMAIL" : null;
  if (channel) {
    await db.message.create({
      data: {
        tenantId,
        customerId: customer.id,
        parentType: "ESTIMATE",
        parentId: estimateId,
        channel,
        template: "estimate_approval",
        toAddress: channel === "SMS" ? customer.phone! : customer.email!,
        body: `Your estimate #${estimate.number} is ready to review and approve.`,
        status: "QUEUED",
      },
    });
  }

  return { estimate: updated, token, channel };
}

/** Public lookup by token. Deliberately not tenant-scoped -- the token is the
 *  credential, and it is the only way in from outside. */
export async function getEstimateByToken(token: string) {
  if (!token) return null;
  const estimate = await db.estimate.findUnique({
    where: { approvalToken: token },
    include: { customer: true, vehicle: true, location: true },
  });
  if (!estimate) return null;

  const lineItems = await db.lineItem.findMany({
    where: { tenantId: estimate.tenantId, parentType: "ESTIMATE", parentId: estimate.id },
    orderBy: { sort: "asc" },
  });
  return { ...estimate, lineItems };
}

/**
 * Records the customer's decision. Sections they declined are kept on the
 * estimate but marked unapproved, so the shop can see what was turned down and
 * follow up later rather than losing it.
 */
export async function recordApproval(
  token: string,
  input: { declinedSections: string[]; signature?: string | null; ip?: string | null },
) {
  const estimate = await getEstimateByToken(token);
  if (!estimate) throw new EstimateError("That approval link is not valid.");
  if (estimate.status !== "SENT") {
    throw new EstimateError("This estimate has already been answered.");
  }

  const declined = new Set(input.declinedSections);
  const tenantId = estimate.tenantId;

  for (const line of estimate.lineItems) {
    const isDeclined = declined.has(line.section ?? "");
    if (line.approved !== !isDeclined) {
      await db.lineItem.update({
        where: { id: line.id },
        data: { approved: !isDeclined, declinedAt: isDeclined ? new Date() : null },
      });
    }
  }

  const anyApproved = estimate.lineItems.some((l) => !declined.has(l.section ?? ""));

  await db.estimate.update({
    where: { id: estimate.id },
    data: {
      status: anyApproved ? "APPROVED" : "DECLINED",
      approvedAt: new Date(),
      approvalSignature: input.signature ?? null,
      approvalIp: input.ip ?? null,
    },
  });

  await db.auditLog.create({
    data: {
      tenantId,
      entityType: "Estimate",
      entityId: estimate.id,
      action: anyApproved ? "CUSTOMER_APPROVED" : "CUSTOMER_DECLINED",
      afterJson: JSON.stringify({ declinedSections: [...declined], ip: input.ip ?? null }),
    },
  });

  return recalculate(tenantId, estimate.id);
}

/** Groups lines into the repairs a customer actually reads. */
export function groupBySection<T extends { section: string | null; sort: number }>(lines: T[]) {
  const groups = new Map<string, T[]>();
  for (const line of lines) {
    const key = line.section ?? "Other work";
    const list = groups.get(key) ?? [];
    list.push(line);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([section, items]) => ({
    section,
    items: items.sort((a, b) => a.sort - b.sort),
  }));
}
