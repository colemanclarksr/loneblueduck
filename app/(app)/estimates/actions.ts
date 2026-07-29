"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/session";
import {
  createEstimate, addLine, updateLine, removeLine, updateEstimate,
  sendForApproval, EstimateError, type LineInput,
} from "@/lib/estimates";
import { estimateToRepairOrder, ConversionError } from "@/lib/convert";
import { db } from "@/lib/db";
import { parseDollarsToCents } from "@/lib/money";
import type { LineKind } from "@/lib/generated/prisma";

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
  if (e instanceof EstimateError || e instanceof ConversionError) {
    return { error: e.message, values: form ? valuesOf(form) : undefined };
  }
  throw e;
}

export async function newEstimate(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await assertPermission("estimate:write");
  const customerId = str(form, "customerId");
  const vehicleId = str(form, "vehicleId");
  if (!customerId || !vehicleId) return { error: "Pick a customer and a vehicle.", values: valuesOf(form) };

  let id: string;
  try {
    const created = await createEstimate(session.tenant.id, {
      customerId,
      vehicleId,
      authorId: session.user.id,
      locationId: session.membership.locationId,
      complaint: str(form, "complaint"),
      mileageIn: str(form, "mileageIn") ? Number.parseInt(str(form, "mileageIn")!.replace(/\D/g, ""), 10) : null,
    });
    id = created.id;
  } catch (e) {
    return asState(e, form);
  }

  revalidatePath("/estimates");
  redirect(`/estimates/${id}`);
}

export async function addLineAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await assertPermission("estimate:write");
  const estimateId = str(form, "estimateId");
  if (!estimateId) return { error: "Missing estimate." };

  const input: LineInput = {
    kind: (str(form, "kind") ?? "PART") as LineKind,
    name: str(form, "name") ?? "",
    section: str(form, "section"),
    sku: str(form, "sku"),
    qty: Number.parseFloat(str(form, "qty") ?? "1"),
    priceCents: parseDollarsToCents(str(form, "price") ?? "0"),
    costCents: parseDollarsToCents(str(form, "cost") ?? "0"),
    taxable: form.get("taxable") === "on",
  };

  try {
    await addLine(session.tenant.id, estimateId, input);
  } catch (e) {
    return asState(e, form);
  }

  revalidatePath(`/estimates/${estimateId}`);
  return {};
}

export async function updateLineAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await assertPermission("estimate:write");
  const lineId = str(form, "lineId");
  const estimateId = str(form, "estimateId");
  if (!lineId) return { error: "Missing line." };

  try {
    await updateLine(session.tenant.id, lineId, {
      kind: (str(form, "kind") ?? "PART") as LineKind,
      name: str(form, "name") ?? "",
      section: str(form, "section"),
      sku: str(form, "sku"),
      qty: Number.parseFloat(str(form, "qty") ?? "1"),
      priceCents: parseDollarsToCents(str(form, "price") ?? "0"),
      costCents: parseDollarsToCents(str(form, "cost") ?? "0"),
      taxable: form.get("taxable") === "on",
    });
  } catch (e) {
    return asState(e, form);
  }

  revalidatePath(`/estimates/${estimateId}`);
  return {};
}

export async function removeLineAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await assertPermission("estimate:write");
  const lineId = str(form, "lineId");
  const estimateId = str(form, "estimateId");
  if (!lineId) return { error: "Missing line." };

  try {
    await removeLine(session.tenant.id, lineId);
  } catch (e) {
    return asState(e);
  }

  revalidatePath(`/estimates/${estimateId}`);
  return {};
}

export async function updateEstimateAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await assertPermission("estimate:write");
  const estimateId = str(form, "estimateId");
  if (!estimateId) return { error: "Missing estimate." };

  const discount = str(form, "discountPct");
  try {
    await updateEstimate(session.tenant.id, estimateId, {
      complaint: str(form, "complaint"),
      customerNote: str(form, "customerNote"),
      internalNote: str(form, "internalNote"),
      discountPct: discount != null ? Number.parseFloat(discount) : undefined,
    });
  } catch (e) {
    return asState(e, form);
  }

  revalidatePath(`/estimates/${estimateId}`);
  return {};
}

export async function sendAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await assertPermission("estimate:write");
  const estimateId = str(form, "estimateId");
  if (!estimateId) return { error: "Missing estimate." };

  try {
    await sendForApproval(session.tenant.id, estimateId);
  } catch (e) {
    return asState(e);
  }

  revalidatePath(`/estimates/${estimateId}`);
  return {};
}

export async function convertAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await assertPermission("ro:write");
  const estimateId = str(form, "estimateId");
  if (!estimateId) return { error: "Missing estimate." };

  let roId: string;
  try {
    // Goes through the guarded conversion; nothing here re-implements it.
    const ro = await estimateToRepairOrder(db, {
      estimateId,
      advisorId: session.user.id,
    });
    roId = ro.id;
  } catch (e) {
    return asState(e);
  }

  revalidatePath("/estimates");
  revalidatePath("/repair-orders");
  redirect(`/repair-orders/${roId}`);
}
