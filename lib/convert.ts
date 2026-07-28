// Document conversions: estimate -> repair order -> invoice.
//
// With three tables (blueprint §10), line items are copied at each hop. A
// partial copy, a dropped line, or a total recomputed from different inputs
// would make the invoice disagree with what the customer approved -- which is
// the failure mode that loses a shop's trust permanently.
//
// So every conversion here:
//   1. runs inside a transaction
//   2. copies approved line items verbatim, field for field
//   3. recomputes totals from the COPIED rows, not the source rows
//   4. throws unless those totals equal the source totals exactly
//
// Step 4 is the point. If a copy ever goes wrong the transaction rolls back and
// nothing is written, rather than quietly producing a wrong bill.

import type { PrismaClient } from "@/lib/generated/prisma";
import { DocType } from "@/lib/generated/prisma";
import { computeTotals } from "@/lib/money";

// The subset of PrismaClient available inside $transaction.
type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

export class ConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConversionError";
  }
}

/** Next document number for a tenant. Called inside a transaction; the unique
 *  constraint on (tenantId, number) is the real guard against duplicates. */
async function nextNumber(tx: Tx, tenantId: string, doc: DocType): Promise<number> {
  const start = { ESTIMATE: 1000, REPAIR_ORDER: 1000, INVOICE: 5000 }[doc];
  if (doc === "ESTIMATE") {
    const last = await tx.estimate.findFirst({ where: { tenantId }, orderBy: { number: "desc" }, select: { number: true } });
    return (last?.number ?? start) + 1;
  }
  if (doc === "REPAIR_ORDER") {
    const last = await tx.repairOrder.findFirst({ where: { tenantId }, orderBy: { number: "desc" }, select: { number: true } });
    return (last?.number ?? start) + 1;
  }
  const last = await tx.invoice.findFirst({ where: { tenantId }, orderBy: { number: "desc" }, select: { number: true } });
  return (last?.number ?? start) + 1;
}

type LineShape = {
  kind: "PART" | "LABOR" | "FEE" | "SUBLET" | "TIRE";
  name: string;
  sku: string | null;
  inventoryItemId: string | null;
  section: string | null;
  qty: number;
  costCents: number;
  priceCents: number;
  taxable: boolean;
  approved: boolean;
  declinedAt: Date | null;
  sort: number;
};

export async function readLines(tx: Tx, tenantId: string, parentType: DocType, parentId: string) {
  return tx.lineItem.findMany({
    where: { tenantId, parentType, parentId },
    orderBy: { sort: "asc" },
  });
}

/**
 * Copies lines onto a new parent verbatim. `onlyApproved` drops declined work,
 * which is what happens when an estimate becomes a repair order -- the shop
 * only does what was approved.
 */
async function copyLines(
  tx: Tx,
  tenantId: string,
  from: { type: DocType; id: string },
  to: { type: DocType; id: string },
  onlyApproved: boolean,
): Promise<void> {
  const source = await readLines(tx, tenantId, from.type, from.id);
  const wanted = onlyApproved ? source.filter((l) => l.approved) : source;

  if (wanted.length === 0) {
    throw new ConversionError(
      `Refusing to create an empty ${to.type}: ${from.type} ${from.id} has no approved line items.`,
    );
  }

  await tx.lineItem.createMany({
    data: wanted.map((l): LineShape & { tenantId: string; parentType: DocType; parentId: string } => ({
      tenantId,
      parentType: to.type,
      parentId: to.id,
      kind: l.kind,
      name: l.name,
      sku: l.sku,
      inventoryItemId: l.inventoryItemId,
      section: l.section,
      qty: l.qty,
      costCents: l.costCents,
      priceCents: l.priceCents,
      taxable: l.taxable,
      approved: l.approved,
      declinedAt: l.declinedAt,
      sort: l.sort,
    })),
  });
}

/** Totals recomputed from whatever is actually stored under a parent. */
export async function totalsFromStored(
  tx: Tx,
  tenantId: string,
  parentType: DocType,
  parentId: string,
  discountPct: number,
  taxRate: number,
) {
  const lines = await readLines(tx, tenantId, parentType, parentId);
  return computeTotals({
    jobs: [{ approved: true, lineItems: lines.filter((l) => l.approved) }],
    discountPct,
    taxRate,
  });
}

/** Throws unless the copy produced exactly the money the source said it would. */
function assertMatch(label: string, got: { subtotalCents: number; taxCents: number; totalCents: number }, want: { subtotalCents: number; taxCents: number; totalCents: number }) {
  if (got.subtotalCents !== want.subtotalCents || got.taxCents !== want.taxCents || got.totalCents !== want.totalCents) {
    throw new ConversionError(
      `${label} totals drifted during copy. ` +
        `Copied subtotal ${got.subtotalCents}/tax ${got.taxCents}/total ${got.totalCents}, ` +
        `expected ${want.subtotalCents}/${want.taxCents}/${want.totalCents}. Nothing was saved.`,
    );
  }
}

// ------------------------------------------------- estimate -> repair order

export async function estimateToRepairOrder(
  db: PrismaClient,
  opts: { estimateId: string; advisorId?: string; technicianId?: string; promisedAt?: Date },
) {
  return db.$transaction(async (tx) => {
    const est = await tx.estimate.findUniqueOrThrow({ where: { id: opts.estimateId } });

    if (est.status !== "APPROVED") {
      throw new ConversionError(
        `Estimate #${est.number} is ${est.status}. Only an APPROVED estimate becomes a repair order.`,
      );
    }
    const already = await tx.repairOrder.findFirst({ where: { estimateId: est.id } });
    if (already) {
      throw new ConversionError(`Estimate #${est.number} is already on repair order #${already.number}.`);
    }

    // What the customer actually approved, computed from the estimate's own
    // rows rather than trusting its denormalised columns.
    const approvedTotals = await totalsFromStored(tx, est.tenantId, "ESTIMATE", est.id, est.discountPct, est.taxRate);

    const ro = await tx.repairOrder.create({
      data: {
        tenantId: est.tenantId,
        locationId: est.locationId,
        number: await nextNumber(tx, est.tenantId, "REPAIR_ORDER"),
        estimateId: est.id,
        customerId: est.customerId,
        vehicleId: est.vehicleId,
        advisorId: opts.advisorId ?? null,
        technicianId: opts.technicianId ?? null,
        promisedAt: opts.promisedAt ?? null,
        mileageIn: est.mileageIn,
        complaint: est.complaint,
        customerNote: est.customerNote,
        internalNote: est.internalNote,
        discountPct: est.discountPct,
        taxRate: est.taxRate,
      },
    });

    await copyLines(tx, est.tenantId, { type: "ESTIMATE", id: est.id }, { type: "REPAIR_ORDER", id: ro.id }, true);

    const copied = await totalsFromStored(tx, est.tenantId, "REPAIR_ORDER", ro.id, ro.discountPct, ro.taxRate);
    assertMatch(`Estimate #${est.number} -> RO #${ro.number}`, copied, approvedTotals);

    const saved = await tx.repairOrder.update({
      where: { id: ro.id },
      data: {
        subtotalCents: copied.subtotalCents,
        discountCents: copied.discountCents,
        taxCents: copied.taxCents,
        totalCents: copied.totalCents,
      },
    });

    await tx.estimate.update({ where: { id: est.id }, data: { status: "CONVERTED" } });
    await tx.repairOrderEvent.create({
      data: { repairOrderId: ro.id, userId: opts.advisorId ?? null, to: "OPEN", note: `Converted from estimate #${est.number}.` },
    });

    return saved;
  });
}

// -------------------------------------------------- repair order -> invoice

export async function repairOrderToInvoice(db: PrismaClient, opts: { repairOrderId: string; userId?: string }) {
  return db.$transaction(async (tx) => {
    const ro = await tx.repairOrder.findUniqueOrThrow({ where: { id: opts.repairOrderId } });

    if (ro.status !== "COMPLETE") {
      throw new ConversionError(
        `Repair order #${ro.number} is ${ro.status}. Finish the work before invoicing it.`,
      );
    }
    const already = await tx.invoice.findFirst({ where: { repairOrderId: ro.id } });
    if (already) {
      throw new ConversionError(`Repair order #${ro.number} is already on invoice #${already.number}.`);
    }

    const roTotals = await totalsFromStored(tx, ro.tenantId, "REPAIR_ORDER", ro.id, ro.discountPct, ro.taxRate);
    const customer = await tx.customer.findUniqueOrThrow({ where: { id: ro.customerId } });

    // Terms are copied, not referenced: changing a fleet account's terms later
    // must not restate invoices already issued.
    const termsDays = customer.billingTermsDays ?? null;
    const dueAt = termsDays ? new Date(Date.now() + termsDays * 86_400_000) : null;

    const invoice = await tx.invoice.create({
      data: {
        tenantId: ro.tenantId,
        locationId: ro.locationId,
        number: await nextNumber(tx, ro.tenantId, "INVOICE"),
        repairOrderId: ro.id,
        customerId: ro.customerId,
        vehicleId: ro.vehicleId,
        discountPct: ro.discountPct,
        // A tax-exempt customer is charged no tax, whatever the RO said.
        taxRate: customer.taxExempt ? 0 : ro.taxRate,
        termsDays,
        dueAt,
      },
    });

    await copyLines(tx, ro.tenantId, { type: "REPAIR_ORDER", id: ro.id }, { type: "INVOICE", id: invoice.id }, true);

    const copied = await totalsFromStored(tx, ro.tenantId, "INVOICE", invoice.id, invoice.discountPct, invoice.taxRate);

    // Tax exemption legitimately changes the total, so only reconcile the part
    // that must never move: the pre-tax subtotal.
    if (copied.subtotalCents !== roTotals.subtotalCents) {
      throw new ConversionError(
        `RO #${ro.number} -> invoice #${invoice.number} subtotal drifted during copy. ` +
          `Copied ${copied.subtotalCents}, expected ${roTotals.subtotalCents}. Nothing was saved.`,
      );
    }
    if (!customer.taxExempt) {
      assertMatch(`RO #${ro.number} -> invoice #${invoice.number}`, copied, roTotals);
    }

    const saved = await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        status: "OPEN",
        finalizedAt: new Date(),
        subtotalCents: copied.subtotalCents,
        discountCents: copied.discountCents,
        taxCents: copied.taxCents,
        totalCents: copied.totalCents,
        balanceDueCents: copied.totalCents,
      },
    });

    await tx.repairOrder.update({ where: { id: ro.id }, data: { status: "INVOICED" } });
    await tx.repairOrderEvent.create({
      data: { repairOrderId: ro.id, userId: opts.userId ?? null, from: "COMPLETE", to: "INVOICED", note: `Invoice #${invoice.number} created.` },
    });
    await tx.auditLog.create({
      data: {
        tenantId: ro.tenantId,
        userId: opts.userId ?? null,
        entityType: "Invoice",
        entityId: invoice.id,
        action: "INVOICE_FINALIZED",
        afterJson: JSON.stringify({ number: saved.number, totalCents: saved.totalCents }),
      },
    });

    return saved;
  });
}

// ------------------------------------------------------------- payments

/** Applies a payment and moves the invoice to PARTIAL or PAID. Recomputes the
 *  balance from captured payments rather than trusting the stored column. */
export async function applyPayment(
  db: PrismaClient,
  opts: {
    invoiceId: string;
    amountCents: number;
    method: "CARD" | "CASH" | "CHECK" | "ACH" | "HOUSE_ACCOUNT" | "OTHER";
    processor?: string;
    processorRef?: string;
    brand?: string;
    last4?: string;
    reference?: string;
    userId?: string;
  },
) {
  return db.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: opts.invoiceId } });

    if (invoice.status === "VOID") throw new ConversionError(`Invoice #${invoice.number} is void.`);
    if (invoice.status === "DRAFT") throw new ConversionError(`Invoice #${invoice.number} is not finalised yet.`);
    if (opts.amountCents <= 0) throw new ConversionError("Payment amount must be positive.");

    const priorAgg = await tx.payment.aggregate({
      where: { invoiceId: invoice.id, status: "CAPTURED" },
      _sum: { amountCents: true },
    });
    const prior = priorAgg._sum.amountCents ?? 0;

    if (prior + opts.amountCents > invoice.totalCents) {
      throw new ConversionError(
        `Payment of ${opts.amountCents} would overpay invoice #${invoice.number}: ` +
          `${prior} already captured against a total of ${invoice.totalCents}.`,
      );
    }

    await tx.payment.create({
      data: {
        tenantId: invoice.tenantId,
        invoiceId: invoice.id,
        amountCents: opts.amountCents,
        method: opts.method,
        status: "CAPTURED",
        processor: opts.processor ?? null,
        processorRef: opts.processorRef ?? null,
        brand: opts.brand ?? null,
        last4: opts.last4 ?? null,
        reference: opts.reference ?? null,
        capturedAt: new Date(),
      },
    });

    const paidCents = prior + opts.amountCents;
    const balanceDueCents = invoice.totalCents - paidCents;

    const saved = await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        paidCents,
        balanceDueCents,
        status: balanceDueCents === 0 ? "PAID" : "PARTIAL",
        paidAt: balanceDueCents === 0 ? new Date() : null,
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId: invoice.tenantId,
        userId: opts.userId ?? null,
        entityType: "Invoice",
        entityId: invoice.id,
        action: "PAYMENT_APPLIED",
        afterJson: JSON.stringify({ amountCents: opts.amountCents, method: opts.method, paidCents, balanceDueCents }),
      },
    });

    return saved;
  });
}
