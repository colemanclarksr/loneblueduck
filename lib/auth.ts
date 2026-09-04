// Password hashing and session records. No Next.js imports here on purpose --
// this file is pure so it can be tested without a request context. The cookie
// layer lives in lib/session.ts.
//
// Blueprint §9 lists Supabase Auth / Clerk / Auth0 as options. Those need an
// external service and keys; this is a self-contained equivalent with the same
// shape (user -> session -> tenant membership), so swapping one in later means
// replacing verifyLogin and createSession, not the call sites.

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { PrismaClient } from "@/lib/generated/prisma";

const scrypt = promisify(scryptCb) as (p: string | Buffer, s: string | Buffer, k: number) => Promise<Buffer>;

const KEY_LEN = 64;
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // a long shift, not a month

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, KEY_LEN);
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;

  const derived = await scrypt(password, salt, KEY_LEN);
  const expected = Buffer.from(hash, "hex");
  // Length check first: timingSafeEqual throws on a mismatch rather than
  // returning false.
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(derived, expected);
}

export type SessionContext = {
  sessionId: string;
  user: { id: string; name: string; email: string };
  tenant: { id: string; name: string };
  membership: { role: import("@/lib/generated/prisma").Role; locationId: string | null };
};

/**
 * Checks credentials and returns the user with their memberships. Returns null
 * for both a missing user and a bad password, and does the hash comparison
 * either way, so the response does not reveal which addresses are registered.
 */
export async function verifyLogin(db: PrismaClient, email: string, password: string) {
  const user = await db.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    include: { memberships: { where: { active: true }, include: { tenant: true } } },
  });

  const ok = await verifyPassword(password, user?.passwordHash ?? "scrypt:00:00");
  if (!user || !user.active || !ok) return null;
  if (user.memberships.length === 0) return null;

  return user;
}

export async function createSession(
  db: PrismaClient,
  opts: { userId: string; tenantId: string; userAgent?: string; ip?: string },
) {
  return db.session.create({
    data: {
      userId: opts.userId,
      tenantId: opts.tenantId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      userAgent: opts.userAgent ?? null,
      ip: opts.ip ?? null,
    },
  });
}

/**
 * Resolves a session id into the acting user, tenant and role.
 *
 * The role is re-read from the database on every call rather than trusted from
 * the cookie, so revoking someone's access or demoting them takes effect on
 * their next request instead of whenever their session happens to expire.
 */
export async function resolveSession(db: PrismaClient, sessionId: string | undefined): Promise<SessionContext | null> {
  if (!sessionId) return null;

  const session = await db.session.findUnique({
    where: { id: sessionId },
    include: { user: true },
  });
  if (!session || !session.tenantId) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (!session.user.active) return null;

  const membership = await db.membership.findUnique({
    where: { tenantId_userId: { tenantId: session.tenantId, userId: session.userId } },
    include: { tenant: true },
  });
  if (!membership || !membership.active) return null;
  if (membership.tenant.status !== "ACTIVE") return null;

  return {
    sessionId: session.id,
    user: { id: session.user.id, name: session.user.name, email: session.user.email },
    tenant: { id: membership.tenant.id, name: membership.tenant.name },
    membership: { role: membership.role, locationId: membership.locationId },
  };
}

export async function destroySession(db: PrismaClient, sessionId: string) {
  await db.session.delete({ where: { id: sessionId } }).catch(() => {});
}

/** Switches the acting tenant, but only to one the user actually belongs to. */
export async function switchTenant(db: PrismaClient, sessionId: string, tenantId: string) {
  const session = await db.session.findUniqueOrThrow({ where: { id: sessionId } });
  const membership = await db.membership.findUnique({
    where: { tenantId_userId: { tenantId, userId: session.userId } },
  });
  if (!membership || !membership.active) {
    throw new Error("Not a member of that shop.");
  }
  return db.session.update({ where: { id: sessionId }, data: { tenantId } });
}

/** Housekeeping for expired rows. Safe to call on a schedule. */
export async function purgeExpiredSessions(db: PrismaClient) {
  const { count } = await db.session.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  return count;
}
