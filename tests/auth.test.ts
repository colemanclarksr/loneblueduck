import { afterAll, describe, expect, it } from "vitest";
import {
  hashPassword, verifyPassword, verifyLogin, createSession,
  resolveSession, destroySession, switchTenant, purgeExpiredSessions,
} from "@/lib/auth";
import { makeShop, testDb } from "./helpers";

const db = testDb();
afterAll(async () => { await db.$disconnect(); });

let n = 0;
const uniqueEmail = () => `user-${++n}-${Date.now()}@auth.test`;

async function makeUser(password: string | null, opts: { active?: boolean } = {}) {
  return db.user.create({
    data: {
      name: "Test User",
      email: uniqueEmail(),
      passwordHash: password ? await hashPassword(password) : null,
      active: opts.active ?? true,
    },
  });
}

describe("password hashing", () => {
  it("round-trips a correct password", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const stored = await hashPassword("hunter2");
    expect(await verifyPassword("hunter3", stored)).toBe(false);
  });

  it("salts, so the same password hashes differently every time", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("never stores the password itself", async () => {
    const stored = await hashPassword("plaintext-secret");
    expect(stored).not.toContain("plaintext-secret");
    expect(stored.startsWith("scrypt:")).toBe(true);
  });

  it("rejects null and malformed hashes instead of throwing", async () => {
    expect(await verifyPassword("x", null)).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "bcrypt:nope")).toBe(false);
    expect(await verifyPassword("x", "scrypt:onlysalt")).toBe(false);
  });
});

describe("verifyLogin", () => {
  it("returns the user for correct credentials", async () => {
    const shop = await makeShop(db);
    const user = await makeUser("goodpass");
    await db.membership.create({ data: { tenantId: shop.tenant.id, userId: user.id, role: "OWNER" } });

    const found = await verifyLogin(db, user.email, "goodpass");
    expect(found?.id).toBe(user.id);
  });

  it("is case- and whitespace-insensitive on the email", async () => {
    const shop = await makeShop(db);
    const user = await makeUser("goodpass");
    await db.membership.create({ data: { tenantId: shop.tenant.id, userId: user.id, role: "OWNER" } });

    expect(await verifyLogin(db, `  ${user.email.toUpperCase()}  `, "goodpass")).not.toBeNull();
  });

  it("returns null for a wrong password", async () => {
    const shop = await makeShop(db);
    const user = await makeUser("goodpass");
    await db.membership.create({ data: { tenantId: shop.tenant.id, userId: user.id, role: "OWNER" } });
    expect(await verifyLogin(db, user.email, "badpass")).toBeNull();
  });

  it("returns null for an unknown email, without throwing", async () => {
    expect(await verifyLogin(db, "nobody@nowhere.test", "whatever")).toBeNull();
  });

  it("refuses a deactivated user", async () => {
    const shop = await makeShop(db);
    const user = await makeUser("goodpass", { active: false });
    await db.membership.create({ data: { tenantId: shop.tenant.id, userId: user.id, role: "OWNER" } });
    expect(await verifyLogin(db, user.email, "goodpass")).toBeNull();
  });

  it("refuses a user who belongs to no shop", async () => {
    const user = await makeUser("goodpass");
    expect(await verifyLogin(db, user.email, "goodpass")).toBeNull();
  });

  it("refuses a user with no password set", async () => {
    const shop = await makeShop(db);
    const user = await makeUser(null);
    await db.membership.create({ data: { tenantId: shop.tenant.id, userId: user.id, role: "OWNER" } });
    expect(await verifyLogin(db, user.email, "")).toBeNull();
  });
});

describe("resolveSession", () => {
  async function signedIn(role: "OWNER" | "TECHNICIAN" = "OWNER") {
    const shop = await makeShop(db);
    const user = await makeUser("pw");
    const membership = await db.membership.create({
      data: { tenantId: shop.tenant.id, userId: user.id, role },
    });
    const session = await createSession(db, { userId: user.id, tenantId: shop.tenant.id });
    return { shop, user, membership, session };
  }

  it("resolves user, tenant and role", async () => {
    const { shop, user, session } = await signedIn();
    const ctx = await resolveSession(db, session.id);
    expect(ctx?.user.id).toBe(user.id);
    expect(ctx?.tenant.id).toBe(shop.tenant.id);
    expect(ctx?.membership.role).toBe("OWNER");
  });

  it("returns null for a missing or unknown id", async () => {
    expect(await resolveSession(db, undefined)).toBeNull();
    expect(await resolveSession(db, "not-a-real-session")).toBeNull();
  });

  it("rejects an expired session and cleans it up", async () => {
    const { session } = await signedIn();
    await db.session.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    expect(await resolveSession(db, session.id)).toBeNull();
    expect(await db.session.findUnique({ where: { id: session.id } })).toBeNull();
  });

  it("reflects a role change on the very next request", async () => {
    const { membership, session } = await signedIn("OWNER");
    await db.membership.update({ where: { id: membership.id }, data: { role: "TECHNICIAN" } });
    // The cookie is unchanged; the role must still come from the database.
    expect((await resolveSession(db, session.id))?.membership.role).toBe("TECHNICIAN");
  });

  it("locks out a revoked membership immediately", async () => {
    const { membership, session } = await signedIn();
    await db.membership.update({ where: { id: membership.id }, data: { active: false } });
    expect(await resolveSession(db, session.id)).toBeNull();
  });

  it("locks out a deactivated user immediately", async () => {
    const { user, session } = await signedIn();
    await db.user.update({ where: { id: user.id }, data: { active: false } });
    expect(await resolveSession(db, session.id)).toBeNull();
  });

  it("locks out a suspended tenant", async () => {
    const { shop, session } = await signedIn();
    await db.tenant.update({ where: { id: shop.tenant.id }, data: { status: "SUSPENDED" } });
    expect(await resolveSession(db, session.id)).toBeNull();
  });

  it("stops resolving once signed out", async () => {
    const { session } = await signedIn();
    await destroySession(db, session.id);
    expect(await resolveSession(db, session.id)).toBeNull();
  });
});

describe("tenant switching", () => {
  it("switches to a shop the user belongs to", async () => {
    const a = await makeShop(db);
    const b = await makeShop(db);
    const user = await makeUser("pw");
    await db.membership.createMany({
      data: [
        { tenantId: a.tenant.id, userId: user.id, role: "OWNER" },
        { tenantId: b.tenant.id, userId: user.id, role: "BOOKKEEPER" },
      ],
    });
    const session = await createSession(db, { userId: user.id, tenantId: a.tenant.id });

    await switchTenant(db, session.id, b.tenant.id);
    const ctx = await resolveSession(db, session.id);
    expect(ctx?.tenant.id).toBe(b.tenant.id);
    // Role follows the shop, it does not carry over.
    expect(ctx?.membership.role).toBe("BOOKKEEPER");
  });

  it("refuses to switch into a shop the user does not belong to", async () => {
    const a = await makeShop(db);
    const stranger = await makeShop(db);
    const user = await makeUser("pw");
    await db.membership.create({ data: { tenantId: a.tenant.id, userId: user.id, role: "OWNER" } });
    const session = await createSession(db, { userId: user.id, tenantId: a.tenant.id });

    await expect(switchTenant(db, session.id, stranger.tenant.id)).rejects.toThrow(/Not a member/);
    expect((await resolveSession(db, session.id))?.tenant.id).toBe(a.tenant.id);
  });
});

describe("housekeeping", () => {
  it("purges only expired sessions", async () => {
    const shop = await makeShop(db);
    const user = await makeUser("pw");
    await db.membership.create({ data: { tenantId: shop.tenant.id, userId: user.id, role: "OWNER" } });
    const live = await createSession(db, { userId: user.id, tenantId: shop.tenant.id });
    const dead = await createSession(db, { userId: user.id, tenantId: shop.tenant.id });
    await db.session.update({ where: { id: dead.id }, data: { expiresAt: new Date(Date.now() - 1) } });

    await purgeExpiredSessions(db);
    expect(await db.session.findUnique({ where: { id: dead.id } })).toBeNull();
    expect(await db.session.findUnique({ where: { id: live.id } })).not.toBeNull();
  });
});
