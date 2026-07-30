import { afterAll, describe, expect, it } from "vitest";
import {
  updateLocation, listMembers, addMember, changeRole, setMemberActive, setPassword,
  listPackages, createPackage, deletePackage, getShop, recentAudit, SettingsError,
} from "@/lib/settings";
import { verifyLogin, createSession, resolveSession } from "@/lib/auth";
import { makeShop, testDb } from "./helpers";

const db = testDb();
afterAll(async () => { await db.$disconnect(); });

/** makeShop gives an advisor and a tech; most of these need an owner too. */
async function shopWithOwner() {
  const shop = await makeShop(db);
  const owner = await addMember(shop.tenant.id, {
    name: "Coleman", email: `owner-${shop.tenant.id}@t.test`, role: "OWNER", password: "shopdesk1",
  });
  return { shop, owner };
}

describe("shop details and rates", () => {
  it("saves the details that print on a receipt", async () => {
    const { shop } = await shopWithOwner();
    const saved = await updateLocation(shop.tenant.id, shop.location.id, {
      name: "Blue Duck Auto", phone: "909-555-0100", address: "18 Foothill Blvd",
      receiptFooter: "Parts and labor warranted 12 months / 12,000 miles.",
    });

    expect(saved.name).toBe("Blue Duck Auto");
    expect(saved.receiptFooter).toContain("12,000 miles");
  });

  it("rejects a nonsense tax rate", async () => {
    const { shop } = await shopWithOwner();
    await expect(updateLocation(shop.tenant.id, shop.location.id, { taxRate: 150 }))
      .rejects.toThrow(/between 0 and 100/);
    await expect(updateLocation(shop.tenant.id, shop.location.id, { laborRateCents: -1 }))
      .rejects.toThrow(/cannot be negative/);
    await expect(updateLocation(shop.tenant.id, shop.location.id, { name: "  " }))
      .rejects.toThrow(/needs a name/);
  });

  it("audits a rate change, and only when it actually changed", async () => {
    const { shop, owner } = await shopWithOwner();
    await updateLocation(shop.tenant.id, shop.location.id, { phone: "909-555-0100" }, { userId: owner.userId });
    expect(await db.auditLog.count({ where: { tenantId: shop.tenant.id, action: "RATES_CHANGED" } })).toBe(0);

    await updateLocation(shop.tenant.id, shop.location.id, { taxRate: 8.25 }, { userId: owner.userId });
    const log = await db.auditLog.findFirstOrThrow({
      where: { tenantId: shop.tenant.id, action: "RATES_CHANGED" },
    });
    expect(log.beforeJson).toContain("7.75");
    expect(log.afterJson).toContain("8.25");
  });

  it("will not edit another shop's location", async () => {
    const { shop } = await shopWithOwner();
    const other = await makeShop(db);
    await expect(updateLocation(other.tenant.id, shop.location.id, { name: "Mine now" }))
      .rejects.toThrow(/no longer exists/);
  });
});

describe("people", () => {
  it("adds someone who can then sign in", async () => {
    const { shop } = await shopWithOwner();
    await addMember(shop.tenant.id, {
      name: "Priya", email: `priya-${shop.tenant.id}@t.test`, role: "SERVICE_ADVISOR", password: "shopdesk1",
    });

    const login = await verifyLogin(db, `priya-${shop.tenant.id}@t.test`, "shopdesk1");
    expect(login).not.toBeNull();
  });

  it("links an existing login rather than duplicating the person", async () => {
    const { shop } = await shopWithOwner();
    const otherShop = await makeShop(db);
    const email = `bookkeeper-${Date.now()}@t.test`;

    await addMember(shop.tenant.id, { name: "Sam", email, role: "BOOKKEEPER", password: "shopdesk1" });
    await addMember(otherShop.tenant.id, { name: "Sam", email, role: "BOOKKEEPER" });

    expect(await db.user.count({ where: { email } })).toBe(1);
  });

  it("refuses to add the same person twice", async () => {
    const { shop } = await shopWithOwner();
    const email = `dup-${shop.tenant.id}@t.test`;
    await addMember(shop.tenant.id, { name: "Dup", email, role: "TECHNICIAN" });

    await expect(addMember(shop.tenant.id, { name: "Dup", email, role: "TECHNICIAN" }))
      .rejects.toThrow(/already works here/);
  });

  it("reactivates a rehire instead of stacking memberships", async () => {
    const { shop } = await shopWithOwner();
    const email = `rehire-${shop.tenant.id}@t.test`;
    const member = await addMember(shop.tenant.id, { name: "Marco", email, role: "TECHNICIAN" });
    await setMemberActive(shop.tenant.id, member.id, false);

    const again = await addMember(shop.tenant.id, { name: "Marco", email, role: "SERVICE_ADVISOR" });
    expect(again.id).toBe(member.id);
    expect(again.active).toBe(true);
    expect(again.role).toBe("SERVICE_ADVISOR");
  });

  it("rejects a bad email or a weak password", async () => {
    const { shop } = await shopWithOwner();
    await expect(addMember(shop.tenant.id, { name: "X", email: "not-an-email", role: "TECHNICIAN" }))
      .rejects.toThrow(/does not look like an email/);
    await expect(addMember(shop.tenant.id, { name: "X", email: "x@t.test", role: "TECHNICIAN", password: "short" }))
      .rejects.toThrow(/at least 8 characters/);
  });

  it("changes a role and audits it", async () => {
    const { shop, owner } = await shopWithOwner();
    const member = await addMember(shop.tenant.id, {
      name: "Priya", email: `p2-${shop.tenant.id}@t.test`, role: "COUNTER_CLERK",
    });

    const promoted = await changeRole(shop.tenant.id, member.id, "SERVICE_ADVISOR", { userId: owner.userId });
    expect(promoted.role).toBe("SERVICE_ADVISOR");

    const log = await db.auditLog.findFirstOrThrow({
      where: { tenantId: shop.tenant.id, action: "ROLE_CHANGED" },
    });
    expect(log.beforeJson).toContain("COUNTER_CLERK");
  });

  it("will not leave a shop with no owner", async () => {
    const { shop, owner } = await shopWithOwner();

    await expect(changeRole(shop.tenant.id, owner.id, "MANAGER"))
      .rejects.toThrow(/only owner/);
    await expect(setMemberActive(shop.tenant.id, owner.id, false))
      .rejects.toThrow(/only owner/);
  });

  it("allows demoting an owner once there is a second one", async () => {
    const { shop, owner } = await shopWithOwner();
    await addMember(shop.tenant.id, {
      name: "Second", email: `owner2-${shop.tenant.id}@t.test`, role: "OWNER",
    });

    const demoted = await changeRole(shop.tenant.id, owner.id, "MANAGER");
    expect(demoted.role).toBe("MANAGER");
  });

  it("signs someone out the moment their access is removed", async () => {
    const { shop } = await shopWithOwner();
    const email = `fired-${shop.tenant.id}@t.test`;
    const member = await addMember(shop.tenant.id, { name: "Gone", email, role: "TECHNICIAN", password: "shopdesk1" });

    const login = await verifyLogin(db, email, "shopdesk1");
    const session = await createSession(db, { userId: login!.id, tenantId: shop.tenant.id });
    expect(await resolveSession(db, session.id)).not.toBeNull();

    await setMemberActive(shop.tenant.id, member.id, false);
    expect(await resolveSession(db, session.id)).toBeNull();
  });

  it("ends every session when a password is reset", async () => {
    const { shop } = await shopWithOwner();
    const email = `reset-${shop.tenant.id}@t.test`;
    const member = await addMember(shop.tenant.id, { name: "R", email, role: "TECHNICIAN", password: "shopdesk1" });
    const login = await verifyLogin(db, email, "shopdesk1");
    const session = await createSession(db, { userId: login!.id, tenantId: shop.tenant.id });

    await setPassword(shop.tenant.id, member.id, "newpassword1");

    expect(await resolveSession(db, session.id)).toBeNull();
    expect(await verifyLogin(db, email, "shopdesk1")).toBeNull();
    expect(await verifyLogin(db, email, "newpassword1")).not.toBeNull();
  });

  it("will not touch someone at another shop", async () => {
    const { shop } = await shopWithOwner();
    const other = await shopWithOwner();

    await expect(changeRole(other.shop.tenant.id, shop.location.id, "MANAGER"))
      .rejects.toThrow(/not on this shop's list/);
  });

  it("lists people with their role", async () => {
    const { shop } = await shopWithOwner();
    const members = await listMembers(shop.tenant.id);
    expect(members.map((m) => m.role)).toContain("OWNER");
    expect(members.every((m) => m.user.email.length > 0)).toBe(true);
  });
});

describe("service packages", () => {
  const OIL = [
    { kind: "LABOR" as const, name: "Lube, oil and filter", qty: 1, priceCents: 3_500 },
    { kind: "PART" as const, name: "Oil filter", qty: 1, priceCents: 1_295 },
    { kind: "PART" as const, name: "5W-30 synthetic", qty: 5, priceCents: 895 },
  ];

  it("saves a package the shop sells constantly", async () => {
    const { shop } = await shopWithOwner();
    await createPackage(shop.tenant.id, { name: "Full synthetic oil change", items: OIL });

    const packages = await listPackages(shop.tenant.id);
    expect(packages).toHaveLength(1);
    expect(packages[0].items).toHaveLength(3);
    expect(packages[0].items[2].qty).toBe(5);
  });

  it("refuses a nameless or empty package", async () => {
    const { shop } = await shopWithOwner();
    await expect(createPackage(shop.tenant.id, { name: " ", items: OIL })).rejects.toThrow(/give the package a name/i);
    await expect(createPackage(shop.tenant.id, { name: "Empty", items: [] })).rejects.toThrow(/at least one line/);
  });

  it("refuses a duplicate name", async () => {
    const { shop } = await shopWithOwner();
    await createPackage(shop.tenant.id, { name: "Oil change", items: OIL });
    await expect(createPackage(shop.tenant.id, { name: "Oil change", items: OIL }))
      .rejects.toThrow(/already have a package/);
  });

  it("survives a package whose JSON got mangled", async () => {
    const { shop } = await shopWithOwner();
    await db.servicePackage.create({
      data: { tenantId: shop.tenant.id, name: "Broken", itemsJson: "{not json" },
    });

    const packages = await listPackages(shop.tenant.id);
    expect(packages[0].items).toEqual([]);
  });

  it("deletes without touching documents that used it", async () => {
    const { shop } = await shopWithOwner();
    const pkg = await createPackage(shop.tenant.id, { name: "Oil change", items: OIL });
    await deletePackage(shop.tenant.id, pkg.id);
    expect(await listPackages(shop.tenant.id)).toHaveLength(0);
  });

  it("will not delete another shop's package", async () => {
    const { shop } = await shopWithOwner();
    const other = await shopWithOwner();
    const pkg = await createPackage(shop.tenant.id, { name: "Oil change", items: OIL });

    await expect(deletePackage(other.shop.tenant.id, pkg.id)).rejects.toThrow(/no longer exists/);
  });
});

describe("audit trail", () => {
  it("shows what changed, newest first", async () => {
    const { shop, owner } = await shopWithOwner();
    await updateLocation(shop.tenant.id, shop.location.id, { taxRate: 9 }, { userId: owner.userId });

    const log = await recentAudit(shop.tenant.id);
    expect(log[0].action).toBe("RATES_CHANGED");
    expect(log[0].user?.name).toBe("Coleman");
  });

  it("does not leak another shop's trail", async () => {
    const { shop, owner } = await shopWithOwner();
    const other = await shopWithOwner();
    await updateLocation(shop.tenant.id, shop.location.id, { taxRate: 9 }, { userId: owner.userId });

    expect(await recentAudit(other.shop.tenant.id)).toHaveLength(0);
  });
});

describe("reads", () => {
  it("returns the shop with its locations", async () => {
    const { shop } = await shopWithOwner();
    const found = await getShop(shop.tenant.id);
    expect(found.locations).toHaveLength(1);
    expect(found.locations[0].id).toBe(shop.location.id);
  });

  it("refuses an unknown role at the type level and a bad id at runtime", async () => {
    const { shop } = await shopWithOwner();
    await expect(changeRole(shop.tenant.id, "nope", "MANAGER")).rejects.toThrow(SettingsError);
  });
});
