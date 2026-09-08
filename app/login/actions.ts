"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { verifyLogin, createSession, SESSION_TTL_MS } from "@/lib/auth";
import { setSessionCookie } from "@/lib/session";

export type LoginState = { error?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!email || !password) return { error: "Enter your email and password." };

  const user = await verifyLogin(db, email, password);
  // One message for every failure mode, so the form never reveals which
  // addresses exist.
  if (!user) return { error: "That email and password do not match." };

  const h = await headers();
  const session = await createSession(db, {
    userId: user.id,
    // Most people belong to one shop. Anyone with more lands in their first
    // and switches from the header.
    tenantId: user.memberships[0].tenantId,
    userAgent: h.get("user-agent") ?? undefined,
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim(),
  });

  await setSessionCookie(session.id, new Date(Date.now() + SESSION_TTL_MS));
  redirect("/dashboard");
}
