import { afterAll, describe, expect, it } from "vitest";
import {
  setStatus, assignTechnician, addLine, updateLine, removeLine, updateRepairOrder,
  addNote, createWalkIn, myWork, listRepairOrders, getRepairOrder, nextStatuses,
  isEditable, RepairOrderError,
} from "@/lib/repairOrders";
import { estimateToRepairOrder, repairOrderToInvoice } from "@/lib/convert";
import { makeShop, makeEstimate, testDb } from "./helpers";

const db = testDb();
afterAll(async () => { await db.$disconnect(); });

const JOB = [
  { name: "Ceramic pads", qty: 1, priceCents: 8_900, section: "Front brakes" },
  { kind: "LABOR" as const, name: "R&R front brakes", qty: 1.5, priceCents: 12_500, section: "Front brakes" },
];

/** An RO created the normal way: approved estimate, converted. */
async function makeRO(opts: { lines?: typeof JOB } = {}) {
  const shop = await makeShop(db);
  const est = await makeEstimate(db, shop, opts.lines ?? JOB);
  const ro = await estimateToRepairOrder(db, { estimateId: est.id, advisorId: shop.advisor.id });
  return { shop, est, ro };
}

describe("status transitions", () => {
  it("walks a job from open to ready-to-invoice", async () => {
    const { shop, ro } = await makeRO();

    const started = await setStatus(shop.tenant.id, ro.id, "IN_PROGRESS", { userId: shop.tech.id });
    expect(started.status).toBe("IN_PROGRESS");
    expect(started.startedAt).not.toBeNull();

    const done = await setStatus(shop.tenant.id, ro.id, "COMPLETE", { userId: shop.tech.id });
    expect(done.status).toBe("COMPLETE");
    expect(done.completedAt).not.toBeNull();
  });

  it("refuses a move the graph does not allow", async () => {
    const { shop, ro } = await makeRO();
    await setStatus(shop.tenant.id, ro.id, "COMPLETE");

    // Complete only goes back to in-progress, never to cancelled: the work
    // has already been done and someone has to bill or write it off.
    await expect(setStatus(shop.tenant.id, ro.id, "CANCELLED")).rejects.toThrow(RepairOrderError);
  });

  it("will not set INVOICED directly, because that would skip the money", async () => {
    const { shop, ro } = await makeRO();
    await setStatus(shop.tenant.id, ro.id, "COMPLETE");

    await expect(setStatus(shop.tenant.id, ro.id, "INVOICED")).rejects.toThrow(/becomes invoiced by being invoiced/);
  });

  it("leaves an invoiced repair order alone", async () => {
    const { shop, ro } = await makeRO();
    await setStatus(shop.tenant.id, ro.id, "COMPLETE");
    await repairOrderToInvoice(db, { repairOrderId: ro.id });

    expect(nextStatuses("INVOICED")).toHaveLength(0);
    await expect(setStatus(shop.tenant.id, ro.id, "IN_PROGRESS")).rejects.toThrow(RepairOrderError);
  });

  it("keeps the original start time when a job is reopened", async () => {
    const { shop, ro } = await makeRO();
    const started = await setStatus(shop.tenant.id, ro.id, "IN_PROGRESS");
    await setStatus(shop.tenant.id, ro.id, "COMPLETE");
    const reopened = await setStatus(shop.tenant.id, ro.id, "IN_PROGRESS");

    expect(reopened.startedAt?.getTime()).toBe(started.startedAt?.getTime());
    // Reopening clears the completion, or productivity reports would count a
    // job that is not actually finished.
    expect(reopened.completedAt).toBeNull();
  });

  it("records who moved it and when", async () => {
    const { shop, ro } = await makeRO();
    await setStatus(shop.tenant.id, ro.id, "IN_PROGRESS", { userId: shop.tech.id, note: "On the lift." });

    const events = await db.repairOrderEvent.findMany({ where: { repairOrderId: ro.id }, orderBy: { createdAt: "asc" } });
    const move = events.at(-1)!;
    expect(move.from).toBe("OPEN");
    expect(move.to).toBe("IN_PROGRESS");
    expect(move.userId).toBe(shop.tech.id);
    expect(move.note).toBe("On the lift.");
  });

  it("treats a no-op move as a no-op rather than an error", async () => {
    const { shop, ro } = await makeRO();
    const same = await setStatus(shop.tenant.id, ro.id, "OPEN");
    expect(same.status).toBe("OPEN");
  });
});

describe("editing work in progress", () => {
  it("adds an upsell line and recomputes the total", async () => {
    const { shop, ro } = await makeRO();
    expect(ro.totalCents).toBe(29_793); // 8900 + 18750 = 27650, +7.75% tax

    const updated = await addLine(shop.tenant.id, ro.id, {
      kind: "PART", name: "CV boot kit", qty: 1, priceCents: 6_400, section: "Front axle",
    }, { userId: shop.tech.id });

    expect(updated.subtotalCents).toBe(34_050);
    expect(updated.totalCents).toBe(36_689);
  });

  it("notes on the record that work was added after approval", async () => {
    const { shop, ro } = await makeRO();
    await addLine(shop.tenant.id, ro.id, { kind: "PART", name: "CV boot kit", qty: 1, priceCents: 6_400 }, { userId: shop.tech.id });

    const events = await db.repairOrderEvent.findMany({ where: { repairOrderId: ro.id } });
    expect(events.some((e) => e.note?.includes("after the customer approved"))).toBe(true);
  });

  it("does not claim a walk-in ticket went behind the customer's back", async () => {
    const shop = await makeShop(db);
    const ro = await createWalkIn(shop.tenant.id, {
      customerId: shop.customer.id, vehicleId: shop.vehicle.id, advisorId: shop.advisor.id,
    });
    await addLine(shop.tenant.id, ro.id, { kind: "LABOR", name: "Oil change", qty: 1, priceCents: 6_995 });

    const events = await db.repairOrderEvent.findMany({ where: { repairOrderId: ro.id } });
    expect(events.some((e) => e.note?.includes("after the customer approved"))).toBe(false);
  });

  it("edits and removes lines, recomputing each time", async () => {
    const { shop, ro } = await makeRO();
    const lines = await db.lineItem.findMany({ where: { parentType: "REPAIR_ORDER", parentId: ro.id }, orderBy: { sort: "asc" } });

    const raised = await updateLine(shop.tenant.id, lines[0].id, {
      kind: "PART", name: "Ceramic pads", qty: 1, priceCents: 9_900,
    });
    expect(raised.subtotalCents).toBe(28_650);

    const trimmed = await removeLine(shop.tenant.id, lines[0].id);
    expect(trimmed.subtotalCents).toBe(18_750);
  });

  it("locks the work once it is marked ready to invoice", async () => {
    const { shop, ro } = await makeRO();
    await setStatus(shop.tenant.id, ro.id, "COMPLETE");

    expect(isEditable("COMPLETE")).toBe(false);
    await expect(
      addLine(shop.tenant.id, ro.id, { kind: "PART", name: "Wiper", qty: 1, priceCents: 1_200 }),
    ).rejects.toThrow(/Reopen it/);
  });

  it("lets a reopened job be corrected again", async () => {
    const { shop, ro } = await makeRO();
    await setStatus(shop.tenant.id, ro.id, "COMPLETE");
    await setStatus(shop.tenant.id, ro.id, "IN_PROGRESS");

    const updated = await addLine(shop.tenant.id, ro.id, { kind: "PART", name: "Wiper", qty: 1, priceCents: 1_200 });
    expect(updated.subtotalCents).toBe(28_850);
  });

  it("applies a discount to the whole ticket", async () => {
    const { shop, ro } = await makeRO();
    const updated = await updateRepairOrder(shop.tenant.id, ro.id, { discountPct: 10 });

    expect(updated.subtotalCents).toBe(27_650);
    expect(updated.discountCents).toBe(2_765);
    expect(updated.totalCents).toBe(26_814);
  });

  it("rejects a discount that is not a percentage", async () => {
    const { shop, ro } = await makeRO();
    await expect(updateRepairOrder(shop.tenant.id, ro.id, { discountPct: 150 })).rejects.toThrow(/between 0 and 100/);
  });

  it("refuses to touch another shop's repair order", async () => {
    const { ro } = await makeRO();
    const other = await makeShop(db);

    await expect(
      addLine(other.tenant.id, ro.id, { kind: "PART", name: "Wiper", qty: 1, priceCents: 1_200 }),
    ).rejects.toThrow(/no longer exists/);
  });
});

describe("assignment and the technician queue", () => {
  it("assigns a technician and logs it", async () => {
    const { shop, ro } = await makeRO();
    const assigned = await assignTechnician(shop.tenant.id, ro.id, shop.tech.id, { userId: shop.advisor.id });

    expect(assigned.technicianId).toBe(shop.tech.id);
    const events = await db.repairOrderEvent.findMany({ where: { repairOrderId: ro.id } });
    expect(events.some((e) => e.note?.startsWith("Assigned to"))).toBe(true);
  });

  it("will not assign someone who does not work there", async () => {
    const { shop, ro } = await makeRO();
    const stranger = await makeShop(db);

    await expect(assignTechnician(shop.tenant.id, ro.id, stranger.tech.id)).rejects.toThrow(/does not work at this shop/);
  });

  it("shows a technician only their own live work", async () => {
    const { shop, ro } = await makeRO();
    // A second job in the same shop, on someone else's bench.
    const otherEst = await makeEstimate(db, shop, JOB);
    const otherRO = await estimateToRepairOrder(db, { estimateId: otherEst.id });
    await assignTechnician(shop.tenant.id, otherRO.id, shop.advisor.id);

    await assignTechnician(shop.tenant.id, ro.id, shop.tech.id);
    const queue = await myWork(shop.tenant.id, shop.tech.id);

    expect(queue.map((r) => r.id)).toEqual([ro.id]);
    expect(queue.map((r) => r.id)).not.toContain(otherRO.id);
  });

  it("drops a job off the queue once it is finished", async () => {
    const { shop, ro } = await makeRO();
    await assignTechnician(shop.tenant.id, ro.id, shop.tech.id);
    await setStatus(shop.tenant.id, ro.id, "COMPLETE");

    expect(await myWork(shop.tenant.id, shop.tech.id)).toHaveLength(0);
  });
});

describe("walk-in tickets", () => {
  it("writes a ticket with no estimate behind it", async () => {
    const shop = await makeShop(db);
    const ro = await createWalkIn(shop.tenant.id, {
      customerId: shop.customer.id,
      vehicleId: shop.vehicle.id,
      advisorId: shop.advisor.id,
      complaint: "Oil change",
    });

    expect(ro.estimateId).toBeNull();
    expect(ro.status).toBe("OPEN");
    // Captured from the location, not read at print time.
    expect(ro.taxRate).toBe(7.75);
    expect(ro.mileageIn).toBe(96_400);
  });

  it("invoices a walk-in with nothing to reconcile against", async () => {
    const shop = await makeShop(db);
    const ro = await createWalkIn(shop.tenant.id, { customerId: shop.customer.id, vehicleId: shop.vehicle.id });
    await addLine(shop.tenant.id, ro.id, { kind: "LABOR", name: "Oil change", qty: 1, priceCents: 6_995 });
    await setStatus(shop.tenant.id, ro.id, "COMPLETE");

    const invoice = await repairOrderToInvoice(db, { repairOrderId: ro.id });
    expect(invoice.subtotalCents).toBe(6_995);
    expect(invoice.totalCents).toBe(7_537);
  });

  it("refuses a vehicle that belongs to someone else", async () => {
    const shop = await makeShop(db);
    const other = await makeShop(db);

    await expect(
      createWalkIn(shop.tenant.id, { customerId: shop.customer.id, vehicleId: other.vehicle.id }),
    ).rejects.toThrow(/belongs to this customer/);
  });
});

describe("notes and reads", () => {
  it("keeps notes newest first with their author", async () => {
    const { shop, ro } = await makeRO();
    await addNote(shop.tenant.id, ro.id, "Customer wants a call before any extra work.", shop.advisor.id);

    const full = await getRepairOrder(shop.tenant.id, ro.id);
    expect(full!.notes[0].body).toContain("wants a call");
    expect(full!.notes[0].author?.name).toBe(shop.advisor.name);
  });

  it("will not save an empty note", async () => {
    const { shop, ro } = await makeRO();
    await expect(addNote(shop.tenant.id, ro.id, "   ")).rejects.toThrow(/Write something/);
  });

  it("filters the board to work that is still live", async () => {
    const { shop, ro } = await makeRO();
    await setStatus(shop.tenant.id, ro.id, "COMPLETE");
    await repairOrderToInvoice(db, { repairOrderId: ro.id });

    expect(await listRepairOrders(shop.tenant.id, { open: true })).toHaveLength(0);
    expect(await listRepairOrders(shop.tenant.id)).toHaveLength(1);
  });

  it("returns null rather than another shop's repair order", async () => {
    const { ro } = await makeRO();
    const other = await makeShop(db);
    expect(await getRepairOrder(other.tenant.id, ro.id)).toBeNull();
  });
});
