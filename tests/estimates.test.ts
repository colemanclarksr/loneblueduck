import { afterAll, describe, expect, it } from "vitest";
import {
  createEstimate, addLine, updateLine, removeLine, updateEstimate,
  sendForApproval, getEstimateByToken, recordApproval, getEstimate,
  groupBySection, isEditable, validateLine, EstimateError,
} from "@/lib/estimates";
import { estimateToRepairOrder } from "@/lib/convert";
import { makeShop, testDb } from "./helpers";

const db = testDb();
afterAll(async () => { await db.$disconnect(); });

async function estimateWithWork(shop: Awaited<ReturnType<typeof makeShop>>) {
  const est = await createEstimate(shop.tenant.id, {
    customerId: shop.customer.id,
    vehicleId: shop.vehicle.id,
    authorId: shop.advisor.id,
    locationId: shop.location.id,
  });
  await addLine(shop.tenant.id, est.id, { kind: "PART", name: "Pads", section: "Front brakes", qty: 1, priceCents: 8_900 });
  await addLine(shop.tenant.id, est.id, { kind: "LABOR", name: "R&R brakes", section: "Front brakes", qty: 1.5, priceCents: 12_500 });
  await addLine(shop.tenant.id, est.id, { kind: "PART", name: "Struts", section: "Struts", qty: 2, priceCents: 17_500 });
  return est;
}

describe("creating", () => {
  it("numbers estimates sequentially per shop", async () => {
    const a = await makeShop(db);
    const b = await makeShop(db);
    const a1 = await createEstimate(a.tenant.id, { customerId: a.customer.id, vehicleId: a.vehicle.id });
    const a2 = await createEstimate(a.tenant.id, { customerId: a.customer.id, vehicleId: a.vehicle.id });
    const b1 = await createEstimate(b.tenant.id, { customerId: b.customer.id, vehicleId: b.vehicle.id });

    expect(a2.number).toBe(a1.number + 1);
    // Numbering restarts per shop, so two shops share numbers without clashing.
    expect(b1.number).toBe(a1.number);
  });

  it("captures the tax rate at creation so later rate changes cannot restate it", async () => {
    const shop = await makeShop(db, { taxRate: 7.75 });
    const est = await createEstimate(shop.tenant.id, { customerId: shop.customer.id, vehicleId: shop.vehicle.id, locationId: shop.location.id });
    expect(est.taxRate).toBe(7.75);

    await db.location.update({ where: { id: shop.location.id }, data: { taxRate: 9.5 } });
    const again = await db.estimate.findUniqueOrThrow({ where: { id: est.id } });
    expect(again.taxRate).toBe(7.75);
  });

  it("refuses a vehicle that belongs to a different customer", async () => {
    const shop = await makeShop(db);
    const other = await makeShop(db);
    await expect(
      createEstimate(shop.tenant.id, { customerId: shop.customer.id, vehicleId: other.vehicle.id }),
    ).rejects.toThrow(/belongs to this customer/);
  });
});

describe("line items and totals", () => {
  it("keeps the header total in step with the lines", async () => {
    const shop = await makeShop(db, { taxRate: 7.75 });
    const est = await estimateWithWork(shop);

    // 89.00 + (125.00 x 1.5 = 187.50) + (175.00 x 2 = 350.00) = 626.50
    const after = await db.estimate.findUniqueOrThrow({ where: { id: est.id } });
    expect(after.subtotalCents).toBe(62_650);
    expect(after.taxCents).toBe(Math.round(62_650 * 0.0775));
    expect(after.totalCents).toBe(62_650 + Math.round(62_650 * 0.0775));
  });

  it("recomputes when a line changes and when one is removed", async () => {
    const shop = await makeShop(db, { taxRate: 0 });
    const est = await createEstimate(shop.tenant.id, { customerId: shop.customer.id, vehicleId: shop.vehicle.id });
    await addLine(shop.tenant.id, est.id, { kind: "PART", name: "Filter", qty: 1, priceCents: 2_000 });
    const line = await db.lineItem.findFirstOrThrow({ where: { parentId: est.id } });

    await updateLine(shop.tenant.id, line.id, { kind: "PART", name: "Filter", qty: 3, priceCents: 2_000 });
    expect((await db.estimate.findUniqueOrThrow({ where: { id: est.id } })).totalCents).toBe(6_000);

    await removeLine(shop.tenant.id, line.id);
    expect((await db.estimate.findUniqueOrThrow({ where: { id: est.id } })).totalCents).toBe(0);
  });

  it("applies a discount to the header", async () => {
    const shop = await makeShop(db, { taxRate: 0 });
    const est = await createEstimate(shop.tenant.id, { customerId: shop.customer.id, vehicleId: shop.vehicle.id });
    await addLine(shop.tenant.id, est.id, { kind: "PART", name: "Part", qty: 1, priceCents: 100_000 });

    await updateEstimate(shop.tenant.id, est.id, { discountPct: 10 });
    const after = await db.estimate.findUniqueOrThrow({ where: { id: est.id } });
    expect(after.discountCents).toBe(10_000);
    expect(after.totalCents).toBe(90_000);
  });

  it("rejects nonsense lines and out-of-range discounts", async () => {
    const shop = await makeShop(db);
    const est = await createEstimate(shop.tenant.id, { customerId: shop.customer.id, vehicleId: shop.vehicle.id });

    await expect(addLine(shop.tenant.id, est.id, { kind: "PART", name: "  ", qty: 1, priceCents: 100 })).rejects.toThrow(/description/);
    await expect(addLine(shop.tenant.id, est.id, { kind: "PART", name: "X", qty: 0, priceCents: 100 })).rejects.toThrow(/more than zero/);
    await expect(addLine(shop.tenant.id, est.id, { kind: "PART", name: "X", qty: 1, priceCents: -5 })).rejects.toThrow(/negative/);
    await expect(addLine(shop.tenant.id, est.id, { kind: "PART", name: "X", qty: 50_000, priceCents: 1 })).rejects.toThrow(/typo/);
    await expect(updateEstimate(shop.tenant.id, est.id, { discountPct: 150 })).rejects.toThrow(/between 0 and 100/);
  });

  it("groups lines into the repairs a customer reads", async () => {
    const shop = await makeShop(db);
    const est = await estimateWithWork(shop);
    const loaded = await getEstimate(shop.tenant.id, est.id);
    const groups = groupBySection(loaded!.lineItems);

    expect(groups.map((g) => g.section)).toEqual(["Front brakes", "Struts"]);
    expect(groups[0].items).toHaveLength(2);
  });

  it("labels unsectioned lines rather than dropping them", async () => {
    const shop = await makeShop(db);
    const est = await createEstimate(shop.tenant.id, { customerId: shop.customer.id, vehicleId: shop.vehicle.id });
    await addLine(shop.tenant.id, est.id, { kind: "FEE", name: "Shop supplies", qty: 1, priceCents: 1_500 });
    const loaded = await getEstimate(shop.tenant.id, est.id);
    expect(groupBySection(loaded!.lineItems)[0].section).toBe("Other work");
  });

  it("keeps a non-taxable line out of the tax base", () => {
    const line = validateLine({ kind: "FEE", name: "Disposal", qty: 1, priceCents: 500, taxable: false });
    expect(line.taxable).toBe(false);
  });
});

describe("sending for approval", () => {
  it("mints an unguessable token and queues a message", async () => {
    const shop = await makeShop(db);
    const est = await estimateWithWork(shop);
    const { token, channel } = await sendForApproval(shop.tenant.id, est.id);

    expect(token.length).toBeGreaterThan(20);
    expect(channel).toBe("SMS");

    const messages = await db.message.findMany({ where: { parentType: "ESTIMATE", parentId: est.id } });
    expect(messages).toHaveLength(1);
    expect(messages[0].status).toBe("QUEUED");
  });

  it("respects an SMS opt-out by falling back to email", async () => {
    const shop = await makeShop(db);
    await db.customer.update({
      where: { id: shop.customer.id },
      data: { smsOptOut: true, email: "dana@example.test" },
    });
    const est = await estimateWithWork(shop);
    const { channel } = await sendForApproval(shop.tenant.id, est.id);
    expect(channel).toBe("EMAIL");
  });

  it("sends nothing when the customer has opted out of both", async () => {
    const shop = await makeShop(db);
    await db.customer.update({ where: { id: shop.customer.id }, data: { smsOptOut: true, emailOptOut: true } });
    const est = await estimateWithWork(shop);
    const { channel } = await sendForApproval(shop.tenant.id, est.id);

    expect(channel).toBeNull();
    expect(await db.message.count({ where: { parentId: est.id } })).toBe(0);
  });

  it("refuses to send an empty estimate", async () => {
    const shop = await makeShop(db);
    const est = await createEstimate(shop.tenant.id, { customerId: shop.customer.id, vehicleId: shop.vehicle.id });
    await expect(sendForApproval(shop.tenant.id, est.id)).rejects.toThrow(/at least one line/);
  });

  it("keeps the same token when resent", async () => {
    const shop = await makeShop(db);
    const est = await estimateWithWork(shop);
    const first = await sendForApproval(shop.tenant.id, est.id);
    const second = await sendForApproval(shop.tenant.id, est.id);
    expect(second.token).toBe(first.token);
  });
});

describe("customer approval", () => {
  it("approves everything and totals what was agreed", async () => {
    const shop = await makeShop(db, { taxRate: 0 });
    const est = await estimateWithWork(shop);
    const { token } = await sendForApproval(shop.tenant.id, est.id);

    await recordApproval(token, { declinedSections: [], signature: "Dana Whitfield", ip: "203.0.113.9" });

    const after = await db.estimate.findUniqueOrThrow({ where: { id: est.id } });
    expect(after.status).toBe("APPROVED");
    expect(after.approvalSignature).toBe("Dana Whitfield");
    expect(after.totalCents).toBe(62_650);
  });

  it("keeps declined work on the record but out of the total", async () => {
    const shop = await makeShop(db, { taxRate: 0 });
    const est = await estimateWithWork(shop);
    const { token } = await sendForApproval(shop.tenant.id, est.id);

    await recordApproval(token, { declinedSections: ["Struts"], signature: "Dana" });

    const after = await db.estimate.findUniqueOrThrow({ where: { id: est.id } });
    expect(after.status).toBe("APPROVED");
    expect(after.totalCents).toBe(27_650); // brakes only

    // The declined lines are still there, so the shop can follow up.
    const struts = await db.lineItem.findFirstOrThrow({ where: { parentId: est.id, section: "Struts" } });
    expect(struts.approved).toBe(false);
    expect(struts.declinedAt).not.toBeNull();
  });

  it("marks the estimate declined when everything is turned down", async () => {
    const shop = await makeShop(db);
    const est = await estimateWithWork(shop);
    const { token } = await sendForApproval(shop.tenant.id, est.id);

    await recordApproval(token, { declinedSections: ["Front brakes", "Struts"] });
    expect((await db.estimate.findUniqueOrThrow({ where: { id: est.id } })).status).toBe("DECLINED");
  });

  it("refuses an unknown token and refuses to answer twice", async () => {
    const shop = await makeShop(db);
    const est = await estimateWithWork(shop);
    const { token } = await sendForApproval(shop.tenant.id, est.id);

    await expect(recordApproval("not-a-real-token", { declinedSections: [] })).rejects.toThrow(/not valid/);
    await recordApproval(token, { declinedSections: [] });
    await expect(recordApproval(token, { declinedSections: [] })).rejects.toThrow(/already been answered/);
  });

  it("writes an audit entry recording the decision", async () => {
    const shop = await makeShop(db);
    const est = await estimateWithWork(shop);
    const { token } = await sendForApproval(shop.tenant.id, est.id);
    await recordApproval(token, { declinedSections: ["Struts"] });

    const logs = await db.auditLog.findMany({ where: { entityType: "Estimate", entityId: est.id } });
    expect(logs.map((l) => l.action)).toContain("CUSTOMER_APPROVED");
  });

  it("exposes only that estimate through its token", async () => {
    const a = await makeShop(db);
    const b = await makeShop(db);
    const estA = await estimateWithWork(a);
    await estimateWithWork(b);
    const { token } = await sendForApproval(a.tenant.id, estA.id);

    const fetched = await getEstimateByToken(token);
    expect(fetched?.id).toBe(estA.id);
    expect(fetched?.tenantId).toBe(a.tenant.id);
  });
});

describe("locking once answered", () => {
  it("stops accepting edits after approval", async () => {
    const shop = await makeShop(db);
    const est = await estimateWithWork(shop);
    const { token } = await sendForApproval(shop.tenant.id, est.id);
    await recordApproval(token, { declinedSections: [] });

    expect(isEditable("APPROVED")).toBe(false);
    await expect(
      addLine(shop.tenant.id, est.id, { kind: "PART", name: "Sneaky extra", qty: 1, priceCents: 50_000 }),
    ).rejects.toThrow(/can no longer be edited/);

    const line = await db.lineItem.findFirstOrThrow({ where: { parentId: est.id } });
    await expect(removeLine(shop.tenant.id, line.id)).rejects.toThrow(/can no longer be edited/);
  });

  it("hands the approved total to the repair order untouched", async () => {
    const shop = await makeShop(db, { taxRate: 0 });
    const est = await estimateWithWork(shop);
    const { token } = await sendForApproval(shop.tenant.id, est.id);
    await recordApproval(token, { declinedSections: ["Struts"] });

    const ro = await estimateToRepairOrder(db, { estimateId: est.id, advisorId: shop.advisor.id });
    expect(ro.totalCents).toBe(27_650);

    // Only the approved repair crossed over.
    const roLines = await db.lineItem.findMany({ where: { parentType: "REPAIR_ORDER", parentId: ro.id } });
    expect(roLines.map((l) => l.section)).toEqual(["Front brakes", "Front brakes"]);
  });
});

describe("tenant scoping", () => {
  it("hides another shop's estimate", async () => {
    const a = await makeShop(db);
    const b = await makeShop(db);
    const theirs = await estimateWithWork(b);
    expect(await getEstimate(a.tenant.id, theirs.id)).toBeNull();
  });

  it("refuses to add a line to another shop's estimate", async () => {
    const a = await makeShop(db);
    const b = await makeShop(db);
    const theirs = await estimateWithWork(b);
    await expect(
      addLine(a.tenant.id, theirs.id, { kind: "PART", name: "X", qty: 1, priceCents: 100 }),
    ).rejects.toThrow(/no longer exists/);
  });

  it("refuses to edit a line on another shop's estimate", async () => {
    const a = await makeShop(db);
    const b = await makeShop(db);
    const theirs = await estimateWithWork(b);
    const line = await db.lineItem.findFirstOrThrow({ where: { parentId: theirs.id } });

    await expect(updateLine(a.tenant.id, line.id, { kind: "PART", name: "Hijack", qty: 1, priceCents: 1 })).rejects.toThrow();
    await expect(removeLine(a.tenant.id, line.id)).rejects.toThrow();
    expect(await db.lineItem.findUnique({ where: { id: line.id } })).not.toBeNull();
  });
});
