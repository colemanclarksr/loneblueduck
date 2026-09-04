"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/session";
import {
  setStatus, assignTechnician, addLine, updateLine, removeLine, updateRepairOrder,
  addNote, createWalkIn, RepairOrderError,
} from "@/lib/repairOrders";
import { repairOrderToInvoice, ConversionError } from "@/lib/convert";
import { consumeForInvoice } from "@/lib/inventory";
import { db } from "@/lib/db";
import { parseDollarsToCents } from "@/lib/money";
import type { LineKind, RepairOrderStatus } from "@/lib/generated/prisma";

export type FormState = { error?: string; values?: Record<string, string> };

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};
const valuesOf = (f: FormData) => {
  const out: Record<string, string> = {};
  for (const [k, v] of f.entries()) if (typeof v === "string") out[k] = v;
  return out;
};

function asState(e: unknown, form?: FormData): FormState {
  if (e instanceof RepairOrderError || e instanceof ConversionError) {
    return { error: e.message, values: form ? valuesOf(form) : undefined };
  }
  throw e;
}

function lineFrom(form: FormData) {
  return {
    kind: (str(form, "kind") ?? "PART") as LineKind,
    name: str(form, "name") ?? "",
    section: str(form, "section"),
    sku: str(form, "sku"),
    qty: Number.parseFloat(str(form, "qty") ?? "1"),
    priceCents: parseDollarsToCents(str(form, "price") ?? "0"),
    costCents: parseDollarsToCents(str(form, "cost") ?? "0"),
    taxable: form.get("taxable") === "on",
  };
}

// ------------------------------------------------------------------ status

export async function statusAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await assertPermission("ro:status");
  const id = str(form, "repairOrderId");
  const to = str(form, "to") as RepairOrderStatus | null;
  if (!id || !to) return { error: "Missing repair order." };

  try {
    await setStatus(session.tenant.id, id, to, { userId: session.user.id, note: str(form, "note") });
  } catch (e) {
    return asState(e);
  }

  revalidatePath(`/repair-orders/${id}`);
  revalidatePath("/repair-orders");
  revalidatePath("/my-work");
  return {};
}

export async function assignAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await assertPermission("ro:write");
  const id = str(form, "repairOrderId");
  if (!id) return { error: "Missing repair order." };

  try {
    await assignTechnician(session.tenant.id, id, str(form, "technicianId"), { userId: session.user.id });
  } catch (e) {
    return asState(e);
  }

  revalidatePath(`/repair-orders/${id}`);
  revalidatePath("/my-work");
  return {};
}

// ------------------------------------------------------------------- lines

export async function addLineAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await assertPermission("ro:write");
  const id = str(form, "repairOrderId");
  if (!id) return { error: "Missing repair order." };

  try {
    await addLine(session.tenant.id, id, lineFrom(form), { userId: session.user.id });
  } catch (e) {
    return asState(e, form);
  }

  revalidatePath(`/repair-orders/${id}`);
  return {};
}

export async function updateLineAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await assertPermission("ro:write");
  const id = str(form, "repairOrderId");
  const lineId = str(form, "lineId");
  if (!lineId) return { error: "Missing line." };

  try {
    await updateLine(session.tenant.id, lineId, lineFrom(form));
  } catch (e) {
    return asState(e, form);
  }

  revalidatePath(`/repair-orders/${id}`);
  return {};
}

export async function removeLineAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await assertPermission("ro:write");
  const id = str(form, "repairOrderId");
  const lineId = str(form, "lineId");
  if (!lineId) return { error: "Missing line." };

  try {
    await removeLine(session.tenant.id, lineId);
  } catch (e) {
    return asState(e);
  }

  revalidatePath(`/repair-orders/${id}`);
  return {};
}

export async function updateROAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await assertPermission("ro:write");
  const id = str(form, "repairOrderId");
  if (!id) return { error: "Missing repair order." };

  const discount = str(form, "discountPct");
  try {
    await updateRepairOrder(session.tenant.id, id, {
      complaint: str(form, "complaint"),
      customerNote: str(form, "customerNote"),
      internalNote: str(form, "internalNote"),
      discountPct: discount != null ? Number.parseFloat(discount) : undefined,
    });
  } catch (e) {
    return asState(e, form);
  }

  revalidatePath(`/repair-orders/${id}`);
  return {};
}

// ------------------------------------------------------------------- notes

export async function addNoteAction(_prev: FormState, form: FormData): Promise<FormState> {
  // A technician can write notes on the job they are working, which is the
  // whole point of "job:update" -- they cannot price it or bill it.
  const session = await assertPermission("job:update");
  const id = str(form, "repairOrderId");
  if (!id) return { error: "Missing repair order." };

  try {
    await addNote(session.tenant.id, id, String(form.get("body") ?? ""), session.user.id);
  } catch (e) {
    return asState(e, form);
  }

  revalidatePath(`/repair-orders/${id}`);
  return {};
}

// ---------------------------------------------------------------- creation

export async function newWalkInAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await assertPermission("ro:write");
  const customerId = str(form, "customerId");
  const vehicleId = str(form, "vehicleId");
  if (!customerId || !vehicleId) return { error: "Pick a customer and a vehicle.", values: valuesOf(form) };

  let id: string;
  try {
    const ro = await createWalkIn(session.tenant.id, {
      customerId,
      vehicleId,
      advisorId: session.user.id,
      locationId: session.membership.locationId,
      complaint: str(form, "complaint"),
      mileageIn: str(form, "mileageIn") ? Number.parseInt(str(form, "mileageIn")!.replace(/\D/g, ""), 10) : null,
    });
    id = ro.id;
  } catch (e) {
    return asState(e, form);
  }

  revalidatePath("/repair-orders");
  redirect(`/repair-orders/${id}`);
}

// ----------------------------------------------------------------- billing

export async function invoiceAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await assertPermission("invoice:finalize");
  const id = str(form, "repairOrderId");
  if (!id) return { error: "Missing repair order." };

  // Scope the lookup to the tenant before handing the id to the conversion,
  // which takes a bare id and would otherwise cross shops.
  const ro = await db.repairOrder.findFirst({ where: { id, tenantId: session.tenant.id }, select: { id: true } });
  if (!ro) return { error: "That repair order no longer exists." };

  let invoiceId: string;
  try {
    const invoice = await repairOrderToInvoice(db, { repairOrderId: ro.id, userId: session.user.id });
    invoiceId = invoice.id;
  } catch (e) {
    return asState(e);
  }

  // Deliberately after the invoice exists and outside its transaction: a stock
  // problem must never undo a bill the shop is about to hand to a customer.
  // consumeForInvoice is safe to re-run, so a retry cannot double-decrement.
  await consumeForInvoice(session.tenant.id, invoiceId, session.user.id);

  revalidatePath("/repair-orders");
  revalidatePath("/invoices");
  revalidatePath("/inventory");
  redirect(`/invoices/${invoiceId}`);
}
