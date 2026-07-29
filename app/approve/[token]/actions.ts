"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { recordApproval, EstimateError } from "@/lib/estimates";

export type ApprovalState = { error?: string; done?: boolean };

/**
 * Public: no session, the token is the credential.
 *
 * Nothing here trusts a tenant id, an estimate id or a price from the form --
 * only which sections were declined. Everything else is read from the record
 * the token resolves to, so a tampered form cannot change what is being agreed.
 */
export async function approve(_prev: ApprovalState, form: FormData): Promise<ApprovalState> {
  const token = String(form.get("token") ?? "");
  const decision = String(form.get("decision") ?? "approve");

  const declinedSections =
    decision === "decline"
      ? form.getAll("allSections").map(String)
      : form.getAll("declined").map(String);

  const h = await headers();

  try {
    await recordApproval(token, {
      declinedSections,
      signature: String(form.get("signature") ?? "").trim() || null,
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    });
  } catch (e) {
    if (e instanceof EstimateError) return { error: e.message };
    throw e;
  }

  revalidatePath(`/approve/${token}`);
  return { done: true };
}
