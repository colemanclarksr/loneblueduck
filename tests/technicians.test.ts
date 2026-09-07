import { afterAll, describe, expect, it } from "vitest";
import {
  createTechnician, updateTechnician, deactivateTechnician, listTechnicians,
  clockOn, clockOff, openJobFor, jobsForOrder, setBilledHours,
  efficiencyFor, efficiencyForOrder, laborCostCentsForOrder,
  TechnicianError,
} from "@/lib/technicians";
import { estimateToRepairOrder } from "@/lib/convert";
import { makeShop, makeEstimate, testDb } from "./helpers";

const db = testDb();
afterAll(async () => { await db.$disconnect(); });

/** Clock times are passed explicitly so elapsed minutes are exact, not
 *  whatever the suite happened to take to run. */
const at = (hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 2, 3, hour, minute, 0));

async function shopWithOrder() {
  const shop = await makeShop(db);
  const estimate = await makeEstimate(db, shop, [
    { kind: "LABOR", name: "Front brakes, R&R", qty: 2.4, priceCents: 14_500 },
    { kind: "PART", name: "Pads, ceramic", qty: 1, priceCents: 8_940, costCents: 4_100 },
  ]);
  const ro = await estimateToRepairOrder(db, { estimateId: estimate.id });
  return { shop, ro };
}

describe("the roster", () => {
  it("tracks a tech who has no login", async () => {
    const { shop } = await shopWithOrder();
    const tech = await createTechnician(shop.tenant.id, {
      name: "J. Okafor",
      hourlyCostCents: 3_200,
    });

    expect(tech.userId).toBeNull();
    expect(tech.hourlyCostCents).toBe(3_200);
    expect(tech.active).toBe(true);
  });

  it("hides deactivated techs from the roster but keeps them readable", async () => {
    const { shop } = await shopWithOrder();
    const tech = await createTechnician(shop.tenant.id, { name: "R. Nunez" });

    await deactivateTechnician(shop.tenant.id, tech.id);

    expect(await listTechnicians(shop.tenant.id)).toHaveLength(0);
    expect(await listTechnicians(shop.tenant.id, { includeInactive: true })).toHaveLength(1);
  });

  it("refuses a negative hourly cost", async () => {
    const { shop } = await shopWithOrder();
    await expect(
      createTechnician(shop.tenant.id, { name: "Bad Rate", hourlyCostCents: -100 }),
    ).rejects.toThrow(TechnicianError);
  });

  it("will not deactivate a tech who is still on the clock", async () => {
    const { shop, ro } = await shopWithOrder();
    const tech = await createTechnician(shop.tenant.id, { name: "Still Working" });
    await clockOn(shop.tenant.id, { repairOrderId: ro.id, technicianId: tech.id }, at(8));

    await expect(deactivateTechnician(shop.tenant.id, tech.id)).rejects.toThrow(
      /clocked onto a job/i,
    );
  });
});

describe("the clock", () => {
  it("banks elapsed minutes on clock-off", async () => {
    const { shop, ro } = await shopWithOrder();
    const tech = await createTechnician(shop.tenant.id, { name: "J. Okafor" });

    const job = await clockOn(shop.tenant.id, { repairOrderId: ro.id, technicianId: tech.id }, at(8));
    const done = await clockOff(shop.tenant.id, job.id, at(9, 45));

    expect(done.actualMinutes).toBe(105);
    expect(done.startedAt).toBeNull();
    expect(done.stoppedAt).toEqual(at(9, 45));
  });

  it("accumulates across separate bursts on the same line", async () => {
    const { shop, ro } = await shopWithOrder();
    const tech = await createTechnician(shop.tenant.id, { name: "J. Okafor" });

    const first = await clockOn(shop.tenant.id, { repairOrderId: ro.id, technicianId: tech.id }, at(8));
    await clockOff(shop.tenant.id, first.id, at(9));

    // Pulled onto a comeback, then back to this ticket after lunch.
    const second = await clockOn(shop.tenant.id, { repairOrderId: ro.id, technicianId: tech.id }, at(13));
    const done = await clockOff(shop.tenant.id, second.id, at(13, 30));

    expect(second.id).toBe(first.id); // resumed, not a second row
    expect(done.actualMinutes).toBe(90);
    expect(await jobsForOrder(shop.tenant.id, ro.id)).toHaveLength(1);
  });

  it("keeps a tech off two tickets at once", async () => {
    const { shop, ro } = await shopWithOrder();
    const secondRo = await estimateToRepairOrder(db, {
      estimateId: (await makeEstimate(db, shop, [
        { kind: "LABOR", name: "Oil change", qty: 0.4, priceCents: 14_500 },
      ])).id,
    });
    const tech = await createTechnician(shop.tenant.id, { name: "J. Okafor" });

    await clockOn(shop.tenant.id, { repairOrderId: ro.id, technicianId: tech.id }, at(8));

    await expect(
      clockOn(shop.tenant.id, { repairOrderId: secondRo.id, technicianId: tech.id }, at(8, 5)),
    ).rejects.toThrow(/another repair order/i);
  });

  it("rejects a second clock-on to the ticket they are already on", async () => {
    const { shop, ro } = await shopWithOrder();
    const tech = await createTechnician(shop.tenant.id, { name: "J. Okafor" });
    await clockOn(shop.tenant.id, { repairOrderId: ro.id, technicianId: tech.id }, at(8));

    await expect(
      clockOn(shop.tenant.id, { repairOrderId: ro.id, technicianId: tech.id }, at(8, 5)),
    ).rejects.toThrow(/already clocked onto this repair order/i);
  });

  it("refuses to clock off a job that is not running", async () => {
    const { shop, ro } = await shopWithOrder();
    const tech = await createTechnician(shop.tenant.id, { name: "J. Okafor" });
    const job = await clockOn(shop.tenant.id, { repairOrderId: ro.id, technicianId: tech.id }, at(8));
    await clockOff(shop.tenant.id, job.id, at(9));

    await expect(clockOff(shop.tenant.id, job.id, at(10))).rejects.toThrow(/not running/i);
  });

  it("refuses a clock-off earlier than the clock-on", async () => {
    const { shop, ro } = await shopWithOrder();
    const tech = await createTechnician(shop.tenant.id, { name: "J. Okafor" });
    const job = await clockOn(shop.tenant.id, { repairOrderId: ro.id, technicianId: tech.id }, at(9));

    await expect(clockOff(shop.tenant.id, job.id, at(8))).rejects.toThrow(/before clock-on/i);
  });

  it("reports who is on the clock right now", async () => {
    const { shop, ro } = await shopWithOrder();
    const tech = await createTechnician(shop.tenant.id, { name: "J. Okafor" });

    expect(await openJobFor(shop.tenant.id, tech.id)).toBeNull();
    const job = await clockOn(shop.tenant.id, { repairOrderId: ro.id, technicianId: tech.id }, at(8));
    expect((await openJobFor(shop.tenant.id, tech.id))?.id).toBe(job.id);

    await clockOff(shop.tenant.id, job.id, at(9));
    expect(await openJobFor(shop.tenant.id, tech.id)).toBeNull();
  });
});

describe("efficiency", () => {
  it("is billed over actual", async () => {
    const { shop, ro } = await shopWithOrder();
    const tech = await createTechnician(shop.tenant.id, { name: "J. Okafor" });

    // Sold 3.0 hours, finished in 2.0.
    const job = await clockOn(
      shop.tenant.id,
      { repairOrderId: ro.id, technicianId: tech.id, billedHours: 3 },
      at(8),
    );
    await clockOff(shop.tenant.id, job.id, at(10));

    const eff = await efficiencyForOrder(shop.tenant.id, ro.id);
    expect(eff.billedHours).toBe(3);
    expect(eff.actualHours).toBe(2);
    expect(eff.ratio).toBe(1.5);
  });

  it("reports unknown rather than zero when nothing has been clocked", async () => {
    const { shop, ro } = await shopWithOrder();
    const tech = await createTechnician(shop.tenant.id, { name: "J. Okafor" });
    await createTechnicianJobWithoutTime(shop.tenant.id, ro.id, tech.id);

    const eff = await efficiencyForOrder(shop.tenant.id, ro.id);
    expect(eff.ratio).toBeNull();
  });

  it("rolls several techs up into one shop number", async () => {
    const { shop, ro } = await shopWithOrder();
    const fast = await createTechnician(shop.tenant.id, { name: "Fast" });
    const slow = await createTechnician(shop.tenant.id, { name: "Slow" });

    const a = await clockOn(shop.tenant.id, { repairOrderId: ro.id, technicianId: fast.id, billedHours: 2 }, at(8));
    await clockOff(shop.tenant.id, a.id, at(9)); // 2 billed / 1 actual

    const b = await clockOn(shop.tenant.id, { repairOrderId: ro.id, technicianId: slow.id, billedHours: 1 }, at(9));
    await clockOff(shop.tenant.id, b.id, at(11)); // 1 billed / 2 actual

    const eff = await efficiencyFor(shop.tenant.id);
    expect(eff.billedHours).toBe(3);
    expect(eff.actualHours).toBe(3);
    expect(eff.ratio).toBe(1);
  });

  it("takes billed hours from the labour line after the fact", async () => {
    const { shop, ro } = await shopWithOrder();
    const tech = await createTechnician(shop.tenant.id, { name: "J. Okafor" });
    const job = await clockOn(shop.tenant.id, { repairOrderId: ro.id, technicianId: tech.id }, at(8));
    await clockOff(shop.tenant.id, job.id, at(10));

    await setBilledHours(shop.tenant.id, job.id, 2.4);

    expect((await efficiencyForOrder(shop.tenant.id, ro.id)).ratio).toBe(1.2);
  });
});

describe("labour cost", () => {
  it("prices each tech's time at that tech's own rate", async () => {
    const { shop, ro } = await shopWithOrder();
    const senior = await createTechnician(shop.tenant.id, { name: "Senior", hourlyCostCents: 4_000 });
    const junior = await createTechnician(shop.tenant.id, { name: "Junior", hourlyCostCents: 2_200 });

    const a = await clockOn(shop.tenant.id, { repairOrderId: ro.id, technicianId: senior.id }, at(8));
    await clockOff(shop.tenant.id, a.id, at(9, 30)); // 1.5h @ $40 = $60.00

    const b = await clockOn(shop.tenant.id, { repairOrderId: ro.id, technicianId: junior.id }, at(9, 30));
    await clockOff(shop.tenant.id, b.id, at(10)); // 0.5h @ $22 = $11.00

    expect(await laborCostCentsForOrder(shop.tenant.id, ro.id)).toBe(7_100);
  });

  it("is zero before anyone has clocked on", async () => {
    const { shop, ro } = await shopWithOrder();
    expect(await laborCostCentsForOrder(shop.tenant.id, ro.id)).toBe(0);
  });
});

describe("tenancy", () => {
  it("will not clock a tech onto another shop's repair order", async () => {
    const mine = await shopWithOrder();
    const theirs = await shopWithOrder();
    const tech = await createTechnician(mine.shop.tenant.id, { name: "J. Okafor" });

    await expect(
      clockOn(mine.shop.tenant.id, { repairOrderId: theirs.ro.id, technicianId: tech.id }, at(8)),
    ).rejects.toThrow(/no such repair order/i);
  });

  it("will not let one shop read or edit another's tech", async () => {
    const mine = await shopWithOrder();
    const theirs = await shopWithOrder();
    const tech = await createTechnician(theirs.shop.tenant.id, { name: "Theirs" });

    expect(await listTechnicians(mine.shop.tenant.id)).toHaveLength(0);
    await expect(
      updateTechnician(mine.shop.tenant.id, tech.id, { hourlyCostCents: 1 }),
    ).rejects.toThrow(/no such technician/i);
  });

  it("keeps one shop's efficiency out of another's", async () => {
    const mine = await shopWithOrder();
    const theirs = await shopWithOrder();
    const tech = await createTechnician(theirs.shop.tenant.id, { name: "Theirs" });

    const job = await clockOn(
      theirs.shop.tenant.id,
      { repairOrderId: theirs.ro.id, technicianId: tech.id, billedHours: 4 },
      at(8),
    );
    await clockOff(theirs.shop.tenant.id, job.id, at(10));

    expect((await efficiencyFor(mine.shop.tenant.id)).ratio).toBeNull();
    expect((await efficiencyFor(theirs.shop.tenant.id)).ratio).toBe(2);
  });
});

/** A job row with no time on it, which is what exists between assigning work
 *  and the tech actually starting. */
async function createTechnicianJobWithoutTime(
  tenantId: string,
  repairOrderId: string,
  technicianId: string,
) {
  return db.technicianJob.create({
    data: { tenantId, repairOrderId, technicianId, billedHours: 2 },
  });
}
