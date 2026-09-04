import { afterAll, describe, expect, it } from "vitest";
import {
  validateCustomer, validateVehicle, displayName, describeVehicle, digitsOnly,
  searchCustomers, getCustomer, getVehicle, vehicleHistory,
  createCustomer, updateCustomer, createVehicle, updateVehicle, deleteCustomer,
  ValidationError,
} from "@/lib/customers";
import { makeShop, makeEstimate, testDb } from "./helpers";
import { estimateToRepairOrder } from "@/lib/convert";

const db = testDb();
afterAll(async () => { await db.$disconnect(); });

describe("validation", () => {
  it("requires some kind of name", () => {
    expect(() => validateCustomer({ type: "RETAIL" })).toThrow(/first or last name/);
    expect(validateCustomer({ type: "RETAIL", lastName: "Whitfield" }).lastName).toBe("Whitfield");
    expect(validateCustomer({ type: "RETAIL", company: "Acme" }).company).toBe("Acme");
  });

  it("requires a company on fleet and wholesale accounts", () => {
    expect(() => validateCustomer({ type: "FLEET", firstName: "Dana" })).toThrow(/company name/);
    expect(() => validateCustomer({ type: "WHOLESALE", firstName: "Dana" })).toThrow(/company name/);
    expect(validateCustomer({ type: "FLEET", company: "City Fleet" }).company).toBe("City Fleet");
  });

  it("normalises the phone to digits so formatting cannot break lookup", () => {
    expect(validateCustomer({ type: "RETAIL", lastName: "X", phone: "(909) 555-0142" }).phoneDigits).toBe("9095550142");
    expect(validateCustomer({ type: "RETAIL", lastName: "X", phone: "909.555.0142" }).phoneDigits).toBe("9095550142");
    expect(digitsOnly("+1 (909) 555-0142")).toBe("19095550142");
  });

  it("rejects a short phone and a malformed email", () => {
    expect(() => validateCustomer({ type: "RETAIL", lastName: "X", phone: "555-0142" })).toThrow(/10 digits/);
    expect(() => validateCustomer({ type: "RETAIL", lastName: "X", email: "not-an-email" })).toThrow(/email/);
  });

  it("trims whitespace and blanks empty strings", () => {
    const c = validateCustomer({ type: "RETAIL", firstName: "  Dana  ", lastName: "Whitfield", city: "   " });
    expect(c.firstName).toBe("Dana");
    expect(c.city).toBeNull();
  });

  it("validates a VIN as 17 characters with no I, O or Q", () => {
    expect(validateVehicle({ vin: "3tmcz5an0hm062011" }).vin).toBe("3TMCZ5AN0HM062011");
    expect(() => validateVehicle({ vin: "TOOSHORT" })).toThrow(/17 characters/);
    expect(() => validateVehicle({ vin: "3TMCZ5ANOHM06201I" })).toThrow(/I, O or Q/);
  });

  it("uppercases the plate so search is case-insensitive", () => {
    expect(validateVehicle({ plate: "8xyz221" }).plate).toBe("8XYZ221");
  });

  it("rejects impossible years and mileage", () => {
    expect(() => validateVehicle({ make: "Toyota", year: 1799 })).toThrow(/model year/);
    expect(() => validateVehicle({ make: "Toyota", year: 2999 })).toThrow(/model year/);
    expect(() => validateVehicle({ make: "Toyota", mileage: -5 })).toThrow(/mileage/);
  });

  it("requires something identifying on a vehicle", () => {
    expect(() => validateVehicle({ color: "Red" })).toThrow(/plate, VIN, make or model/);
  });
});

describe("display names", () => {
  it("shows the company for a fleet and the person for retail", () => {
    expect(displayName({ type: "FLEET", firstName: "Dana", lastName: "W", company: "City Fleet" })).toBe("City Fleet");
    expect(displayName({ type: "RETAIL", firstName: "Dana", lastName: "Whitfield", company: null })).toBe("Dana Whitfield");
  });

  it("falls back rather than rendering an empty string", () => {
    expect(displayName({ type: "RETAIL", firstName: null, lastName: null, company: "Acme" })).toBe("Acme");
    expect(displayName({ type: "RETAIL", firstName: null, lastName: null, company: null })).toBe("(no name)");
    expect(describeVehicle({ year: null, make: null, model: null, trim: null })).toBe("Vehicle");
  });
});

describe("search", () => {
  async function populated() {
    const shop = await makeShop(db);
    const dana = await createCustomer(shop.tenant.id, {
      type: "RETAIL", firstName: "Dana", lastName: "Whitfield", phone: "(909) 555-0142", email: "dana@example.test",
    });
    const fleet = await createCustomer(shop.tenant.id, {
      type: "FLEET", company: "Redlands City Fleet", phone: "9095559900", billingTermsDays: 30,
    });
    await createVehicle(shop.tenant.id, dana.id, {
      year: 2017, make: "Toyota", model: "Tacoma", plate: "8xyz221", vin: "3TMCZ5AN0HM062011",
    });
    await createVehicle(shop.tenant.id, fleet.id, { year: 2020, make: "Ford", model: "Transit", plate: "FLEET01" });
    return { shop, dana, fleet };
  }

  it("finds by last name, first name and company", async () => {
    const { shop, dana, fleet } = await populated();
    expect((await searchCustomers(shop.tenant.id, "Whitfield")).map((c) => c.id)).toContain(dana.id);
    expect((await searchCustomers(shop.tenant.id, "Dana")).map((c) => c.id)).toContain(dana.id);
    expect((await searchCustomers(shop.tenant.id, "Redlands")).map((c) => c.id)).toContain(fleet.id);
  });

  it("finds by phone whatever the formatting", async () => {
    const { shop, dana } = await populated();
    for (const q of ["9095550142", "(909) 555-0142", "555-0142", "5550142"]) {
      expect((await searchCustomers(shop.tenant.id, q)).map((c) => c.id), `query ${q}`).toContain(dana.id);
    }
  });

  it("finds by plate and VIN, case-insensitively", async () => {
    const { shop, dana } = await populated();
    expect((await searchCustomers(shop.tenant.id, "8xyz221")).map((c) => c.id)).toContain(dana.id);
    expect((await searchCustomers(shop.tenant.id, "8XYZ221")).map((c) => c.id)).toContain(dana.id);
    expect((await searchCustomers(shop.tenant.id, "3tmcz5an0hm062011")).map((c) => c.id)).toContain(dana.id);
  });

  it("lists everyone for a blank query", async () => {
    const { shop, dana, fleet } = await populated();
    // makeShop seeds a customer of its own, so this asserts that a blank query
    // returns the whole book rather than a specific count.
    const all = await searchCustomers(shop.tenant.id, "");
    expect(all.map((c) => c.id)).toEqual(expect.arrayContaining([dana.id, fleet.id, shop.customer.id]));
    expect(await searchCustomers(shop.tenant.id, "   ")).toHaveLength(all.length);
  });

  it("returns nothing for a query that matches nothing", async () => {
    const { shop } = await populated();
    expect(await searchCustomers(shop.tenant.id, "Nonexistent")).toHaveLength(0);
  });

  it("never returns another shop's customers", async () => {
    const { shop, dana } = await populated();
    const other = await makeShop(db);
    const theirs = await createCustomer(other.tenant.id, {
      type: "RETAIL", firstName: "Dana", lastName: "Whitfield", phone: "9095550142",
    });

    // Identical name and identical phone in the other shop, and still invisible.
    const byName = await searchCustomers(shop.tenant.id, "Whitfield");
    expect(byName.map((c) => c.id)).toContain(dana.id);
    expect(byName.map((c) => c.id)).not.toContain(theirs.id);

    const byPhone = await searchCustomers(shop.tenant.id, "9095550142");
    expect(byPhone.map((c) => c.id)).toContain(dana.id);
    expect(byPhone.map((c) => c.id)).not.toContain(theirs.id);

    // And the reverse direction, so this is not passing by accident.
    expect((await searchCustomers(other.tenant.id, "Whitfield")).map((c) => c.id)).not.toContain(dana.id);
  });
});

describe("tenant scoping on reads", () => {
  it("returns null for a customer id belonging to another shop", async () => {
    const a = await makeShop(db);
    const b = await makeShop(db);
    const theirs = await createCustomer(b.tenant.id, { type: "RETAIL", lastName: "Theirs" });

    expect(await getCustomer(a.tenant.id, theirs.id)).toBeNull();
    expect(await getCustomer(b.tenant.id, theirs.id)).not.toBeNull();
  });

  it("returns null for a vehicle id belonging to another shop", async () => {
    const a = await makeShop(db);
    const b = await makeShop(db);
    const theirCustomer = await createCustomer(b.tenant.id, { type: "RETAIL", lastName: "Theirs" });
    const theirVehicle = await createVehicle(b.tenant.id, theirCustomer.id, { make: "Ford", model: "F-150" });

    expect(await getVehicle(a.tenant.id, theirVehicle.id)).toBeNull();
  });

  it("never returns another shop's service history", async () => {
    const a = await makeShop(db);
    const b = await makeShop(db);
    const est = await makeEstimate(db, b, [{ name: "Brakes", priceCents: 10_000 }]);
    await estimateToRepairOrder(db, { estimateId: est.id });

    expect(await vehicleHistory(b.tenant.id, b.vehicle.id)).toHaveLength(1);
    expect(await vehicleHistory(a.tenant.id, b.vehicle.id)).toHaveLength(0);
  });
});

describe("tenant scoping on writes", () => {
  it("refuses to update a customer in another shop", async () => {
    const a = await makeShop(db);
    const b = await makeShop(db);
    const theirs = await createCustomer(b.tenant.id, { type: "RETAIL", lastName: "Theirs" });

    await expect(
      updateCustomer(a.tenant.id, theirs.id, { type: "RETAIL", lastName: "Hijacked" }),
    ).rejects.toThrow(ValidationError);

    const unchanged = await getCustomer(b.tenant.id, theirs.id);
    expect(unchanged?.lastName).toBe("Theirs");
  });

  it("refuses to update a vehicle in another shop", async () => {
    const a = await makeShop(db);
    const b = await makeShop(db);
    const c = await createCustomer(b.tenant.id, { type: "RETAIL", lastName: "Theirs" });
    const v = await createVehicle(b.tenant.id, c.id, { make: "Ford", model: "F-150" });

    await expect(updateVehicle(a.tenant.id, v.id, { make: "Hijacked" })).rejects.toThrow(ValidationError);
    expect((await getVehicle(b.tenant.id, v.id))?.make).toBe("Ford");
  });

  it("refuses to attach a vehicle to a customer in another shop", async () => {
    const a = await makeShop(db);
    const b = await makeShop(db);
    const theirs = await createCustomer(b.tenant.id, { type: "RETAIL", lastName: "Theirs" });

    await expect(
      createVehicle(a.tenant.id, theirs.id, { make: "Toyota", model: "Tacoma" }),
    ).rejects.toThrow(/no longer exists/);
  });

  it("refuses to delete a customer in another shop", async () => {
    const a = await makeShop(db);
    const b = await makeShop(db);
    const theirs = await createCustomer(b.tenant.id, { type: "RETAIL", lastName: "Theirs" });

    await expect(deleteCustomer(a.tenant.id, theirs.id)).rejects.toThrow(/no longer exists/);
    expect(await getCustomer(b.tenant.id, theirs.id)).not.toBeNull();
  });
});

describe("editing", () => {
  it("saves changes and keeps the phone index in step", async () => {
    const shop = await makeShop(db);
    const c = await createCustomer(shop.tenant.id, { type: "RETAIL", lastName: "Whitfield", phone: "9095550142" });

    await updateCustomer(shop.tenant.id, c.id, { type: "RETAIL", lastName: "Whitfield-Ross", phone: "(760) 555-8899" });

    expect((await searchCustomers(shop.tenant.id, "7605558899")).map((x) => x.id)).toEqual([c.id]);
    // The old number must stop matching, or search quietly returns stale hits.
    expect(await searchCustomers(shop.tenant.id, "9095550142")).toHaveLength(0);
  });

  it("can convert a retail customer into a fleet account", async () => {
    const shop = await makeShop(db);
    const c = await createCustomer(shop.tenant.id, { type: "RETAIL", firstName: "Dana", lastName: "Whitfield" });
    const updated = await updateCustomer(shop.tenant.id, c.id, {
      type: "FLEET", firstName: "Dana", lastName: "Whitfield", company: "Whitfield Haulage", billingTermsDays: 30,
    });
    expect(updated.type).toBe("FLEET");
    expect(displayName(updated)).toBe("Whitfield Haulage");
  });
});

describe("deletion", () => {
  it("deletes a customer with no history", async () => {
    const shop = await makeShop(db);
    const c = await createCustomer(shop.tenant.id, { type: "RETAIL", lastName: "Mistyped" });
    await deleteCustomer(shop.tenant.id, c.id);
    expect(await getCustomer(shop.tenant.id, c.id)).toBeNull();
  });

  it("refuses to delete a customer who has documents", async () => {
    const shop = await makeShop(db);
    await makeEstimate(db, shop, [{ name: "Brakes", priceCents: 10_000 }]);

    await expect(deleteCustomer(shop.tenant.id, shop.customer.id)).rejects.toThrow(/cannot be deleted/);
    expect(await getCustomer(shop.tenant.id, shop.customer.id)).not.toBeNull();
  });
});
