"use server";

import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/session";
import { canRefund, MANAGER_REFUND_LIMIT_CENTS } from "@/lib/permissions";
import { takePayment, refundPayment, voidInvoice, InvoiceError } from "@/lib/invoices";
import { restoreForInvoice } from "@/lib/inventory";
import { parseDollarsToCents, formatCents } from "@/lib/money";
import type { PaymentMethod } from "@/lib/generated/prisma";

export type FormState = { error?: string; ok?: string };

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};

function asState(e: unknown): FormState {
  if (e instanceof InvoiceError) return { error: e.message };
  throw e;
}

export async function payAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await assertPermission("payment:take");
  const invoiceId = str(form, "invoiceId");
  if (!invoiceId) return { error: "Missing invoice." };

  try {
    const invoice = await takePayment(session.tenant.id, {
      invoiceId,
      amountCents: parseDollarsToCents(str(form, "amount") ?? "0"),
      method: (str(form, "method") ?? "CARD") as PaymentMethod,
      processor: str(form, "processor"),
      processorRef: str(form, "processorRef"),
      brand: str(form, "brand"),
      last4: str(form, "last4"),
      reference: str(form, "reference"),
      userId: session.user.id,
    });

    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath("/invoices");
    return {
      ok:
        invoice.balanceDueCents === 0
          ? "Paid in full."
          : `${formatCents(invoice.balanceDueCents)} still due.`,
    };
  } catch (e) {
    return asState(e);
  }
}

export async function refundAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await assertPermission("payment:refund");
  const paymentId = str(form, "paymentId");
  const invoiceId = str(form, "invoiceId");
  if (!paymentId) return { error: "Missing payment." };

  const amountCents = parseDollarsToCents(str(form, "amount") ?? "0");

  // §5: a manager approves refunds under a limit; above it an owner must.
  // Checked here rather than in lib/invoices.ts, which enforces arithmetic
  // rather than authority.
  if (!canRefund(session.membership.role, amountCents)) {
    return {
      error: `Refunds over ${formatCents(MANAGER_REFUND_LIMIT_CENTS)} need an owner. Ask them to sign in and approve it.`,
    };
  }

  try {
    await refundPayment(session.tenant.id, {
      paymentId,
      amountCents,
      reason: str(form, "reason"),
      approvedById: session.user.id,
    });
  } catch (e) {
    return asState(e);
  }

  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");
  return { ok: "Refund recorded." };
}

export async function voidAction(_prev: FormState, form: FormData): Promise<FormState> {
  // Voiding a bill is a manager's call, not a clerk's.
  const session = await assertPermission("invoice:editPaid");
  const invoiceId = str(form, "invoiceId");
  if (!invoiceId) return { error: "Missing invoice." };

  try {
    await voidInvoice(session.tenant.id, invoiceId, { userId: session.user.id, reason: str(form, "reason") });
  } catch (e) {
    return asState(e);
  }

  // The parts were never sold after all, so they go back on the shelf.
  await restoreForInvoice(session.tenant.id, invoiceId, session.user.id);

  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");
  revalidatePath("/inventory");
  return { ok: "Invoice voided." };
}
