"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/session";
import { startInspection, setItem, completeInspection, sendInspection, InspectionError } from "@/lib/inspections";
import type { Condition } from "@/lib/generated/prisma";

export type FormState = { error?: string; ok?: string };

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};

function asState(e: unknown): FormState {
  if (e instanceof InspectionError) return { error: e.message };
  throw e;
}

export async function startAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await assertPermission("job:update");
  const repairOrderId = str(form, "repairOrderId");
  if (!repairOrderId) return { error: "Missing repair order." };

  let id: string;
  try {
    const result = await startInspection(session.tenant.id, repairOrderId, { templateId: str(form, "templateId") });
    id = result.id;
  } catch (e) {
    return asState(e);
  }

  revalidatePath(`/repair-orders/${repairOrderId}`);
  redirect(`/repair-orders/${repairOrderId}/inspection/${id}`);
}

export async function markAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await assertPermission("job:update");
  const itemId = str(form, "itemId");
  const repairOrderId = str(form, "repairOrderId");
  if (!itemId) return { error: "Missing item." };

  try {
    await setItem(session.tenant.id, itemId, {
      condition: (str(form, "condition") ?? undefined) as Condition | undefined,
      // An empty box means "clear the note", so undefined and null differ here.
      notes: form.has("notes") ? (str(form, "notes") ?? null) : undefined,
    });
  } catch (e) {
    return asState(e);
  }

  revalidatePath(`/repair-orders/${repairOrderId}/inspection`);
  return {};
}

export async function finishAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await assertPermission("job:update");
  const resultId = str(form, "resultId");
  const repairOrderId = str(form, "repairOrderId");
  if (!resultId) return { error: "Missing inspection." };

  try {
    await completeInspection(session.tenant.id, resultId);
  } catch (e) {
    return asState(e);
  }

  revalidatePath(`/repair-orders/${repairOrderId}/inspection/${resultId}`);
  return { ok: "Marked complete." };
}

export async function sendAction(_prev: FormState, form: FormData): Promise<FormState> {
  // Sending is talking to the customer, which is the advisor's job, not the
  // technician's -- §5 gives technicians no message:send.
  const session = await assertPermission("message:send");
  const resultId = str(form, "resultId");
  const repairOrderId = str(form, "repairOrderId");
  if (!resultId) return { error: "Missing inspection." };

  let channel: string | null;
  try {
    const sent = await sendInspection(session.tenant.id, resultId);
    channel = sent.channel;
  } catch (e) {
    return asState(e);
  }

  revalidatePath(`/repair-orders/${repairOrderId}/inspection/${resultId}`);
  return {
    ok: channel
      ? `Sent by ${channel === "SMS" ? "text" : "email"}.`
      : "Saved, but this customer has opted out of texts and email — share the link by hand.",
  };
}
