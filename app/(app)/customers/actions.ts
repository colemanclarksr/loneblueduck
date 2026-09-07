"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/session";
import {
  createCustomer, updateCustomer, createVehicle, updateVehicle, deleteCustomer,
  ValidationError, type CustomerInput, type VehicleInput,
} from "@/lib/customers";
import type { CustomerType } from "@/lib/generated/prisma";

export type FormState = {
  error?: string;
  field?: string;
  /** What the user had typed. Sent back on failure so a rejected submit does
   *  not clear the form and make them key it all again. */
  values?: Record<string, string>;
};

/** Flattens the submission so the form can re-render with it. */
function valuesOf(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() !== "" ? v : null;
};
const num = (f: FormData, k: string) => {
  const v = str(f, k);
  if (v === null) return null;
  const n = Number.parseInt(v.replace(/[^0-9-]/g, ""), 10);
  return Number.isNaN(n) ? null : n;
};
const bool = (f: FormData, k: string) => f.get(k) === "on" || f.get(k) === "true";

function customerFrom(f: FormData): CustomerInput {
  return {
    type: (str(f, "type") ?? "RETAIL") as CustomerType,
    firstName: str(f, "firstName"),
    lastName: str(f, "lastName"),
    company: str(f, "company"),
    phone: str(f, "phone"),
    email: str(f, "email"),
    address: str(f, "address"),
    city: str(f, "city"),
    state: str(f, "state"),
    zip: str(f, "zip"),
    billingTermsDays: num(f, "billingTermsDays"),
    taxExempt: bool(f, "taxExempt"),
    taxExemptId: str(f, "taxExemptId"),
    smsOptOut: bool(f, "smsOptOut"),
    emailOptOut: bool(f, "emailOptOut"),
    notes: str(f, "notes"),
  };
}

function vehicleFrom(f: FormData): VehicleInput {
  return {
    vin: str(f, "vin"),
    plate: str(f, "plate"),
    year: num(f, "year"),
    make: str(f, "make"),
    model: str(f, "model"),
    trim: str(f, "trim"),
    engine: str(f, "engine"),
    color: str(f, "color"),
    tireSize: str(f, "tireSize"),
    mileage: num(f, "mileage"),
    warrantyNotes: str(f, "warrantyNotes"),
    notes: str(f, "notes"),
  };
}

/** Turns a validation failure into form state; anything else is a real bug and
 *  is left to surface rather than being swallowed as a friendly message. */
function asState(e: unknown, form: FormData): FormState {
  if (e instanceof ValidationError) return { error: e.message, field: e.field, values: valuesOf(form) };
  throw e;
}

export async function saveCustomer(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await assertPermission("customer:write");
  const id = str(form, "id");

  let customerId: string;
  try {
    const saved = id
      ? await updateCustomer(session.tenant.id, id, customerFrom(form))
      : await createCustomer(session.tenant.id, customerFrom(form));
    customerId = saved.id;
  } catch (e) {
    return asState(e, form);
  }

  revalidatePath("/customers");
  redirect(`/customers/${customerId}`);
}

export async function saveVehicle(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await assertPermission("customer:write");
  const id = str(form, "id");
  // Both the create and the edit form carry this, so the redirect never has to
  // re-read the vehicle to find out where to go back to.
  const customerId = str(form, "customerId");
  if (!customerId) return { error: "Missing customer.", field: "customerId" };

  try {
    if (id) {
      await updateVehicle(session.tenant.id, id, vehicleFrom(form));
    } else {
      await createVehicle(session.tenant.id, customerId, vehicleFrom(form));
    }
  } catch (e) {
    return asState(e, form);
  }

  revalidatePath(`/customers/${customerId}`);
  redirect(`/customers/${customerId}`);
}

export async function removeCustomer(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await assertPermission("customer:delete");
  const id = str(form, "id");
  if (!id) return { error: "Missing customer." };

  try {
    await deleteCustomer(session.tenant.id, id);
  } catch (e) {
    return asState(e, form);
  }

  revalidatePath("/customers");
  redirect("/customers");
}
