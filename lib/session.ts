// Request-scoped session access. Everything Next.js-specific lives here so
// lib/auth.ts stays testable without a request context.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/lib/db";
import { resolveSession, type SessionContext } from "@/lib/auth";
import { can, type Permission } from "@/lib/permissions";

export const SESSION_COOKIE = "shop_session";

/** Cached per request, so a page and its layout resolve the session once. */
export const getSession = cache(async (): Promise<SessionContext | null> => {
  const jar = await cookies();
  return resolveSession(db, jar.get(SESSION_COOKIE)?.value);
});

/** For pages. Sends anyone without a valid session to the login screen. */
export async function requireSession(): Promise<SessionContext> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/**
 * For pages that a role should not reach at all. Redirects rather than throwing
 * so a technician who bookmarks /reports lands somewhere useful instead of on
 * an error page.
 */
export async function requirePermission(permission: Permission): Promise<SessionContext> {
  const session = await requireSession();
  if (!can(session.membership.role, permission)) redirect("/dashboard?denied=1");
  return session;
}

/**
 * For server actions and mutations. Throws instead of redirecting, because a
 * denied write must fail loudly rather than quietly navigate.
 */
export async function assertPermission(permission: Permission): Promise<SessionContext> {
  const session = await getSession();
  if (!session) throw new Error("Not signed in.");
  if (!can(session.membership.role, permission)) {
    throw new Error(`Your role (${session.membership.role}) cannot ${permission}.`);
  }
  return session;
}

export async function setSessionCookie(sessionId: string, expiresAt: Date) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}
