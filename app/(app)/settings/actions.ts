"use server";

import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/session";
import {
  updateLocation, addMember, changeRole, setMemberActive, setPassword,
  createPackage, deletePackage, SettingsError,
} from "@/lib/settings";
import { parseDollarsToCents } from "@/lib/money";
import type { LineInput } from "@/lib/estimates";
import type { Role } from "@/lib/generated/prisma";

export type FormState = { error?: string; ok?: string; values?: Record<string, string> };

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};
const valuesOf = (f: FormData) => {
  const out: Record<string, string> = {};
  for (const [k, v] of f.entries()) if (typeof v === "string" && k !== "password") out[k] = v;
  return out;
};

function asState(e: unknown, form?: FormData): FormState {
  if (e instanceof SettingsError) return { error: e.message, values: form ? valuesOf(form) : undefined };
  throw e;
}

export async function shopAction(_prev: FormState, form: FormData): Promise<FormState> {
  // Rates are a tax setting; §5 keeps them away from advisors and clerks.
  const session = await assertPermission("settings:tax");
  const locationId = str(form, "locationId");
  if (!locationId) return { error: "Missing location." };

  const taxRate = str(form, "taxRate");
  const laborRate = str(form, "laborRate");

  try {
    await updateLocation(
      session.tenant.id,
      locationId,
      {
        name: str(form, "name") ?? undefined,
        phone: str(form, "phone"),
        email: str(form, "email"),
        address: str(form, "address"),
        city: str(form, "city"),
        state: str(form, "state"),
        zip: str(form, "zip"),
        taxRate: taxRate != null ? Number.parseFloat(taxRate) : undefined,
        laborRateCents: laborRate != null ? parseDollarsToCents(laborRate) : undefined,
        receiptFooter: str(form, "receiptFooter"),
      },
      { userId: session.user.id },
    );
  } catch (e) {
    return asState(e, form);
  }

  revalidatePath("/settings");
  return { ok: "Saved." };
}

export async function addMemberAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await assertPermission("settings:users");
  const password = str(form, "password");

  try {
    await addMember(session.tenant.id, {
      name: str(form, "name") ?? "",
      email: str(form, "email") ?? "",
      role: (str(form, "role") ?? "TECHNICIAN") as Role,
      password: password ?? undefined,
      locationId: session.membership.locationId,
    });
  } catch (e) {
    return asState(e, form);
  }

  revalidatePath("/settings");
  return { ok: "Added." };
}

export async function roleAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await assertPermission("settings:users");
  const membershipId = str(form, "membershipId");
  if (!membershipId) return { error: "Missing person." };

  try {
    await changeRole(session.tenant.id, membershipId, (str(form, "role") ?? "TECHNICIAN") as Role, {
      userId: session.user.id,
    });
  } catch (e) {
    return asState(e);
  }

  revalidatePath("/settings");
  return { ok: "Role changed." };
}

export async function accessAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await assertPermission("settings:users");
  const membershipId = str(form, "membershipId");
  if (!membershipId) return { error: "Missing person." };

  try {
    await setMemberActive(session.tenant.id, membershipId, form.get("active") === "1", {
      userId: session.user.id,
    });
  } catch (e) {
    return asState(e);
  }

  revalidatePath("/settings");
  return { ok: "Saved." };
}

export async function passwordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await assertPermission("settings:users");
  const membershipId = str(form, "membershipId");
  if (!membershipId) return { error: "Missing person." };

  try {
    await setPassword(session.tenant.id, membershipId, String(form.get("password") ?? ""));
  } catch (e) {
    return asState(e);
  }

  revalidatePath("/settings");
  return { ok: "Password set. They will need to sign in again." };
}

export async function newPackageAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await assertPermission("settings:users");

  // The lines arrive as parallel arrays from a repeating row of inputs.
  const names = form.getAll("itemName").map(String);
  const kinds = form.getAll("itemKind").map(String);
  const qtys = form.getAll("itemQty").map(String);
  const prices = form.getAll("itemPrice").map(String);

  const items: LineInput[] = names
    .map((name, i) => ({
      kind: (kinds[i] ?? "PART") as LineInput["kind"],
      name: name.trim(),
      qty: Number.parseFloat(qtys[i] ?? "1") || 1,
      priceCents: parseDollarsToCents(prices[i] ?? "0"),
    }))
    .filter((item) => item.name !== "");

  try {
    await createPackage(session.tenant.id, { name: str(form, "name") ?? "", items });
  } catch (e) {
    return asState(e, form);
  }

  revalidatePath("/settings");
  return { ok: "Package saved." };
}

export async function deletePackageAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await assertPermission("settings:users");
  const id = str(form, "packageId");
  if (!id) return { error: "Missing package." };

  try {
    await deletePackage(session.tenant.id, id);
  } catch (e) {
    return asState(e);
  }

  revalidatePath("/settings");
  return { ok: "Deleted." };
}
