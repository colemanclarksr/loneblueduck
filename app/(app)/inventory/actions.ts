"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/session";
import { createItem, updateItem, deactivateItem, adjust, InventoryError } from "@/lib/inventory";
import { parseDollarsToCents } from "@/lib/money";

export type FormState = { error?: string; ok?: string; values?: Record<string, string> };

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
  if (e instanceof InventoryError) return { error: e.message, values: form ? valuesOf(form) : undefined };
  throw e;
}

function itemFrom(form: FormData) {
  return {
    sku: str(form, "sku") ?? "",
    name: str(form, "name") ?? "",
    category: str(form, "category"),
    vendor: str(form, "vendor"),
    tireSize: str(form, "tireSize"),
    costCents: parseDollarsToCents(str(form, "cost") ?? "0"),
    priceCents: parseDollarsToCents(str(form, "price") ?? "0"),
    reorderPoint: Number.parseFloat(str(form, "reorderPoint") ?? "0") || 0,
  };
}

export async function newItemAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await assertPermission("inventory:write");

  let id: string;
  try {
    const item = await createItem(
      session.tenant.id,
      { ...itemFrom(form), qtyOnHand: Number.parseFloat(str(form, "qtyOnHand") ?? "0") || 0 },
      session.user.id,
    );
    id = item.id;
  } catch (e) {
    return asState(e, form);
  }

  revalidatePath("/inventory");
  redirect(`/inventory/${id}`);
}

export async function updateItemAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await assertPermission("inventory:write");
  const id = str(form, "itemId");
  if (!id) return { error: "Missing part." };

  try {
    await updateItem(session.tenant.id, id, itemFrom(form));
  } catch (e) {
    return asState(e, form);
  }

  revalidatePath(`/inventory/${id}`);
  revalidatePath("/inventory");
  return { ok: "Saved." };
}

export async function adjustAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await assertPermission("inventory:write");
  const id = str(form, "itemId");
  if (!id) return { error: "Missing part." };

  const qty = Number.parseFloat(str(form, "qtyDelta") ?? "");
  try {
    await adjust(session.tenant.id, id, qty, str(form, "reason") ?? "", session.user.id);
  } catch (e) {
    return asState(e, form);
  }

  revalidatePath(`/inventory/${id}`);
  revalidatePath("/inventory");
  return { ok: "Count updated." };
}

export async function deactivateAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await assertPermission("inventory:write");
  const id = str(form, "itemId");
  if (!id) return { error: "Missing part." };

  try {
    await deactivateItem(session.tenant.id, id);
  } catch (e) {
    return asState(e);
  }

  revalidatePath("/inventory");
  redirect("/inventory");
}
