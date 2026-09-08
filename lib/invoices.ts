// Invoices, payments and refunds.
//
// Two rules run through all of it.
//
// First, money is never inferred from a stored column. paidCents and
// balanceDueCents exist so list screens do not have to aggregate, but every
// mutation recomputes them from the payment and refund rows and writes the
// answer back. A drifted column then shows up as a wrong balance on one screen,
// not as a wrong balance everywhere forever.
//
// Second, §12: this system never stores a card number. Payments carry a
// processor reference, a brand and a last4 -- and assertNoCardData below
// actively refuses anything that looks like a PAN, because the realistic way
// card data ends up in a database is someone typing it into the wrong box.

import { db } from "@/lib/db";
import { applyPayment, ConversionError } from "@/lib/convert";
import type { InvoiceStatus, PaymentMethod } from "@/lib/generated/prisma";

export class InvoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceError";
  }
}

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  CARD: "Card",
  CASH: "Cash",
  CHECK: "Check",
  ACH: "Bank transfer",
  HOUSE_ACCOUNT: "House account",
  OTHER: "Other",
};

export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  DRAFT: "Draft",
  OPEN: "Unpaid",
  PARTIAL: "Part paid",
  PAID: "Paid",
  VOID: "Void",
};

/**
 * Refuses free-text that looks like a card number.
 *
 * A 12-or-more digit run in a reference or last4 field is either a PAN or a
 * mistake worth stopping; neither belongs in this database. Separators are
 * stripped first so "4111 1111 1111 1111" cannot walk past the check.
 */
export function assertNoCardData(label: string, value: string | null | undefined) {
  if (!value) return;
  const digits = value.replace(/[\s-]/g, "");
  if (/\d{12,}/.test(digits)) {
    throw new InvoiceError(
      `That looks like a card number. ${label} must never hold one — record the last 4 digits only.`,
    );
  }
}

function cleanLast4(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits === "") return null;
  if (digits.length !== 4) {
    throw new InvoiceError("Card last 4 must be exactly four digits.");
  }
  return digits;
}

// ------------------------------------------------------------------ reads

export async function getInvoice(tenantId: string, id: string) {
  const invoice = await db.invoice.findFirst({
    where: { id, tenantId },
    include: {
      customer: true,
      vehicle: true,
      location: true,
      repairOrder: { select: { id: true, number: true, complaint: true, customerNote: true, mileageIn: true } },
      payments: {
        orderBy: { createdAt: "asc" },
        include: { refunds: { orderBy: { createdAt: "asc" }, include: { approvedBy: { select: { name: true } } } } },
      },
    },
  });
  if (!invoice) return null;

  const lineItems = await db.lineItem.findMany({
    where: { tenantId, parentType: "INVOICE", parentId: id },
    orderBy: { sort: "asc" },
  });
  return { ...invoice, lineItems };
}

export async function listInvoices(
  tenantId: string,
  opts: { status?: InvoiceStatus; unpaid?: boolean } = {},
) {
  return db.invoice.findMany({
    where: {
      tenantId,
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.unpaid ? { status: { in: ["OPEN", "PARTIAL"] } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { customer: true, vehicle: true },
  });
}

/** What a payment has actually kept, after refunds. */
export function netCents(payment: { amountCents: number; refunds: { amountCents: number }[] }) {
  return payment.amountCents - payment.refunds.reduce((sum, r) => sum + r.amountCents, 0);
}

// ---------------------------------------------------------------- payments

/**
 * Tenant-scoped wrapper over the guarded applyPayment.
 *
 * applyPayment takes a bare invoice id, so the ownership check has to happen
 * before it is called. Overpayment, void and draft checks stay where they are.
 */
export async function takePayment(
  tenantId: string,
  input: {
    invoiceId: string;
    amountCents: number;
    method: PaymentMethod;
    processor?: string | null;
    processorRef?: string | null;
    brand?: string | null;
    last4?: string | null;
    reference?: string | null;
    userId?: string;
  },
) {
  const invoice = await db.invoice.findFirst({
    where: { id: input.invoiceId, tenantId },
    select: { id: true },
  });
  if (!invoice) throw new InvoiceError("That invoice no longer exists.");

  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
    throw new InvoiceError("Enter an amount greater than zero.");
  }

  assertNoCardData("The reference field", input.reference);
  assertNoCardData("The processor reference", input.processorRef);
  const last4 = cleanLast4(input.last4);

  try {
    return await applyPayment(db, {
      invoiceId: invoice.id,
      amountCents: Math.round(input.amountCents),
      method: input.method,
      processor: input.processor ?? undefined,
      processorRef: input.processorRef ?? undefined,
      brand: input.brand ?? undefined,
      last4: last4 ?? undefined,
      reference: input.reference ?? undefined,
      userId: input.userId,
    });
  } catch (e) {
    // The conversion layer speaks in totals; the counter needs a sentence.
    if (e instanceof ConversionError) throw new InvoiceError(e.message);
    throw e;
  }
}

// ----------------------------------------------------------------- refunds

/**
 * Refunds part or all of one payment.
 *
 * Refunds attach to a payment rather than to the invoice because that is how
 * they actually work: money goes back the way it came, to the card or the
 * cheque it arrived on. The invoice's paid and balance columns are then
 * recomputed from every payment and refund on it.
 *
 * The role limit in lib/permissions.ts is checked by the caller -- this
 * function enforces arithmetic, not authority.
 */
export async function refundPayment(
  tenantId: string,
  input: { paymentId: string; amountCents: number; reason?: string | null; approvedById?: string },
) {
  return db.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({
      where: { id: input.paymentId, tenantId },
      include: { refunds: true, invoice: true },
    });
    if (!payment) throw new InvoiceError("That payment no longer exists.");
    // REFUNDED is allowed through so the amount check below can say "already
    // refunded in full", which tells the clerk what happened. The statuses
    // rejected here are ones where no money was ever captured.
    if (!["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(payment.status)) {
      throw new InvoiceError(
        `That payment is ${payment.status.toLowerCase().replace("_", " ")}, so there is nothing to refund.`,
      );
    }

    const amount = Math.round(input.amountCents);
    if (!Number.isFinite(amount) || amount <= 0) throw new InvoiceError("Enter a refund amount greater than zero.");

    const alreadyRefunded = payment.refunds.reduce((sum, r) => sum + r.amountCents, 0);
    const refundable = payment.amountCents - alreadyRefunded;
    if (amount > refundable) {
      throw new InvoiceError(
        refundable === 0
          ? "That payment has already been refunded in full."
          : `You can refund at most ${(refundable / 100).toFixed(2)} of that payment.`,
      );
    }

    await tx.refund.create({
      data: {
        tenantId,
        paymentId: payment.id,
        amountCents: amount,
        reason: input.reason?.trim() || null,
        approvedById: input.approvedById ?? null,
      },
    });

    const nowRefunded = alreadyRefunded + amount;
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: nowRefunded === payment.amountCents ? "REFUNDED" : "PARTIALLY_REFUNDED" },
    });

    // Recompute from the rows rather than adjusting the stored column, so a
    // previous mistake cannot compound into the new balance.
    const invoice = await recomputeInvoiceMoney(tx, payment.invoiceId);

    await tx.auditLog.create({
      data: {
        tenantId,
        userId: input.approvedById ?? null,
        entityType: "Invoice",
        entityId: payment.invoiceId,
        action: "REFUND_ISSUED",
        afterJson: JSON.stringify({
          paymentId: payment.id,
          amountCents: amount,
          reason: input.reason ?? null,
          paidCents: invoice.paidCents,
          balanceDueCents: invoice.balanceDueCents,
        }),
      },
    });

    return invoice;
  });
}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/** Single source of truth for what an invoice has been paid. */
async function recomputeInvoiceMoney(tx: Tx, invoiceId: string) {
  const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const payments = await tx.payment.findMany({
    where: { invoiceId, status: { in: ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"] } },
    include: { refunds: true },
  });

  const paidCents = payments.reduce((sum, p) => sum + netCents(p), 0);
  const balanceDueCents = invoice.totalCents - paidCents;

  return tx.invoice.update({
    where: { id: invoiceId },
    data: {
      paidCents,
      balanceDueCents,
      status:
        invoice.status === "VOID"
          ? "VOID"
          : balanceDueCents <= 0 && invoice.totalCents > 0
            ? "PAID"
            : paidCents > 0
              ? "PARTIAL"
              : "OPEN",
      paidAt: balanceDueCents <= 0 && invoice.totalCents > 0 ? (invoice.paidAt ?? new Date()) : null,
    },
  });
}

// -------------------------------------------------------------------- void

/**
 * Voids an invoice.
 *
 * Refuses while money is still held against it. Voiding a paid invoice would
 * make the shop's takings and its invoices disagree, and the fix -- refund
 * first, then void -- leaves both records intact and explains itself.
 */
export async function voidInvoice(
  tenantId: string,
  invoiceId: string,
  opts: { userId?: string; reason?: string | null } = {},
) {
  return db.$transaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, tenantId }, include: { payments: { include: { refunds: true } } } });
    if (!invoice) throw new InvoiceError("That invoice no longer exists.");
    if (invoice.status === "VOID") return invoice;

    const held = invoice.payments.reduce((sum, p) => sum + netCents(p), 0);
    if (held > 0) {
      throw new InvoiceError(
        `Invoice #${invoice.number} still holds ${(held / 100).toFixed(2)} in payments. Refund them before voiding it.`,
      );
    }

    const saved = await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: "VOID", voidedAt: new Date(), balanceDueCents: 0, paidCents: 0, paidAt: null },
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        userId: opts.userId ?? null,
        entityType: "Invoice",
        entityId: invoice.id,
        action: "INVOICE_VOIDED",
        beforeJson: JSON.stringify({ status: invoice.status, totalCents: invoice.totalCents }),
        afterJson: JSON.stringify({ reason: opts.reason ?? null }),
      },
    });

    return saved;
  });
}

// ----------------------------------------------------------- receivables

/** Unpaid invoices bucketed by how late they are. Fleet accounts are the
 *  reason this exists: a shop with net-30 customers needs to see who is 60
 *  days out before it extends more credit. */
export async function arAging(tenantId: string, asOf = new Date()) {
  const open = await db.invoice.findMany({
    where: { tenantId, status: { in: ["OPEN", "PARTIAL"] } },
    include: { customer: true },
    orderBy: { createdAt: "asc" },
  });

  const buckets = { current: 0, d30: 0, d60: 0, d90: 0 };
  const rows = open.map((inv) => {
    // No terms means due on completion, so age from the invoice date.
    const due = inv.dueAt ?? inv.finalizedAt ?? inv.createdAt;
    const days = Math.floor((asOf.getTime() - due.getTime()) / 86_400_000);
    const bucket = days <= 0 ? "current" : days <= 30 ? "d30" : days <= 60 ? "d60" : "d90";
    buckets[bucket] += inv.balanceDueCents;
    return { invoice: inv, daysLate: Math.max(0, days), bucket };
  });

  return { rows, buckets, totalCents: rows.reduce((sum, r) => sum + r.invoice.balanceDueCents, 0) };
}
