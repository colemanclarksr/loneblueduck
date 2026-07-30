import { afterAll, describe, expect, it } from "vitest";
import {
  salesSummary, technicianProductivity, pipeline, approvalRate,
  monthOf, daysBack, dayKey,
} from "@/lib/reports";
import { estimateToRepairOrder, repairOrderToInvoice } from "@/lib/convert";
import { setStatus, assignTechnician } from "@/lib/repairOrders";
import { takePayment, refundPayment, voidInvoice } from "@/lib/invoices";
import { makeShop, makeEstimate, testDb } from "./helpers";

const db = testDb();
afterAll(async () => { await db.$disconnect(); });

// $100 of labour at cost $0, plus a $50 part costing $20. No tax, so the
// arithmetic below is checkable by eye.
const JOB = [
  { kind: "LABOR" as const, name: "Brake job", qty: 1, priceCents: 10_000, taxable: false },
  { kind: "PART" as const, name: "Ceramic pads", qty: 1, priceCents: 5_000, costCents: 2_000, taxable: false },
];

const WIDE = { from: new Date(2000, 0, 1), to: new Date(2100, 0, 1) };

async function billedJob(shop: Awaited<ReturnType<typeof makeShop>>, lines: Parameters<typeof makeEstimate>[2] = JOB) {
  const est = await makeEstimate(db, shop, lines);
  const ro = await estimateToRepairOrder(db, { estimateId: est.id });
  await setStatus(shop.tenant.id, ro.id, "COMPLETE");
  const invoice = await repairOrderToInvoice(db, { repairOrderId: ro.id });
  return { est, ro, invoice };
}

describe("date ranges", () => {
  it("bounds a calendar month exclusively at the end", () => {
    const r = monthOf(new Date(2026, 6, 15));
    expect(r.from.getTime()).toBe(new Date(2026, 6, 1).getTime());
    expect(r.to.getTime()).toBe(new Date(2026, 7, 1).getTime());
  });

  it("counts back from the end of today, so today is included", () => {
    const r = daysBack(7, new Date(2026, 6, 15));
    expect(r.to.getTime()).toBe(new Date(2026, 6, 16).getTime());
    // Seven days means the 9th through the 15th, not the 8th through the 15th.
    expect(r.from.getTime()).toBe(new Date(2026, 6, 9).getTime());
  });

  it("keys days without timezone drift", () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("billed versus collected", () => {
  it("reports them separately, because they are different questions", async () => {
    const shop = await makeShop(db, { taxRate: 0 });
    const { invoice } = await billedJob(shop);

    const beforePayment = await salesSummary(shop.tenant.id, WIDE);
    expect(beforePayment.billedCents).toBe(15_000);
    expect(beforePayment.collectedCents).toBe(0);

    await takePayment(shop.tenant.id, { invoiceId: invoice.id, amountCents: 6_000, method: "CASH" });
    const after = await salesSummary(shop.tenant.id, WIDE);
    expect(after.billedCents).toBe(15_000);
    expect(after.collectedCents).toBe(6_000);
  });

  it("nets refunds out of what was collected", async () => {
    const shop = await makeShop(db, { taxRate: 0 });
    const { invoice } = await billedJob(shop);
    await takePayment(shop.tenant.id, { invoiceId: invoice.id, amountCents: 15_000, method: "CARD", last4: "4242" });
    const payment = await db.payment.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    await refundPayment(shop.tenant.id, { paymentId: payment.id, amountCents: 5_000 });

    const s = await salesSummary(shop.tenant.id, WIDE);
    expect(s.collectedCents).toBe(15_000);
    expect(s.refundedCents).toBe(5_000);
    expect(s.netCollectedCents).toBe(10_000);
  });

  it("drops a voided invoice out of billed", async () => {
    const shop = await makeShop(db, { taxRate: 0 });
    const { invoice } = await billedJob(shop);
    await voidInvoice(shop.tenant.id, invoice.id);

    const s = await salesSummary(shop.tenant.id, WIDE);
    expect(s.billedCents).toBe(0);
    expect(s.invoiceCount).toBe(0);
  });

  it("splits parts from labour and shows the real margin", async () => {
    const shop = await makeShop(db, { taxRate: 0 });
    await billedJob(shop);

    const s = await salesSummary(shop.tenant.id, WIDE);
    expect(s.laborCents).toBe(10_000);
    expect(s.partsCents).toBe(5_000);
    expect(s.costCents).toBe(2_000);
    expect(s.grossProfitCents).toBe(13_000);
    expect(s.grossMarginPct).toBe(87);
  });

  it("breaks collections down by how customers paid", async () => {
    const shop = await makeShop(db, { taxRate: 0 });
    const { invoice } = await billedJob(shop);
    await takePayment(shop.tenant.id, { invoiceId: invoice.id, amountCents: 5_000, method: "CASH" });
    await takePayment(shop.tenant.id, { invoiceId: invoice.id, amountCents: 10_000, method: "CARD", last4: "4242" });

    const s = await salesSummary(shop.tenant.id, WIDE);
    expect(s.byMethod[0]).toEqual({ method: "CARD", count: 1, cents: 10_000 });
    expect(s.byMethod[1]).toEqual({ method: "CASH", count: 1, cents: 5_000 });
  });

  it("averages the ticket", async () => {
    const shop = await makeShop(db, { taxRate: 0 });
    await billedJob(shop);
    await billedJob(shop, [{ kind: "LABOR", name: "Oil change", priceCents: 5_000, taxable: false }]);

    const s = await salesSummary(shop.tenant.id, WIDE);
    expect(s.invoiceCount).toBe(2);
    expect(s.averageTicketCents).toBe(10_000);
  });

  it("ranks what actually sells", async () => {
    const shop = await makeShop(db, { taxRate: 0 });
    await billedJob(shop);
    await billedJob(shop);

    const s = await salesSummary(shop.tenant.id, WIDE);
    expect(s.topSellers[0]).toEqual({ name: "Brake job", count: 2, cents: 20_000 });
  });

  it("shows quiet days as zero rather than leaving holes in the chart", async () => {
    const shop = await makeShop(db, { taxRate: 0 });
    const range = daysBack(7);
    const s = await salesSummary(shop.tenant.id, range);

    expect(s.days).toHaveLength(7);
    expect(s.days.every((d) => d.billedCents === 0 && d.collectedCents === 0)).toBe(true);
  });

  it("puts today's work on today", async () => {
    const shop = await makeShop(db, { taxRate: 0 });
    const { invoice } = await billedJob(shop);
    await takePayment(shop.tenant.id, { invoiceId: invoice.id, amountCents: 15_000, method: "CASH" });

    const s = await salesSummary(shop.tenant.id, daysBack(1));
    const today = s.days.find((d) => d.day === dayKey(new Date()))!;
    expect(today.billedCents).toBe(15_000);
    expect(today.collectedCents).toBe(15_000);
  });

  it("ignores another shop's takings", async () => {
    const shop = await makeShop(db, { taxRate: 0 });
    const other = await makeShop(db, { taxRate: 0 });
    await billedJob(shop);

    const s = await salesSummary(other.tenant.id, WIDE);
    expect(s.billedCents).toBe(0);
    expect(s.topSellers).toHaveLength(0);
  });

  it("returns zeroes rather than NaN for a shop that has done nothing", async () => {
    const shop = await makeShop(db);
    const s = await salesSummary(shop.tenant.id, WIDE);

    expect(s.averageTicketCents).toBe(0);
    expect(s.grossMarginPct).toBe(0);
    expect(s.billedCents).toBe(0);
  });
});

describe("technician productivity", () => {
  it("attributes hours and revenue to whoever was assigned", async () => {
    const shop = await makeShop(db, { taxRate: 0 });
    const est = await makeEstimate(db, shop, [
      { kind: "LABOR", name: "Brakes", qty: 2.5, priceCents: 10_000, taxable: false },
    ]);
    const ro = await estimateToRepairOrder(db, { estimateId: est.id });
    await assignTechnician(shop.tenant.id, ro.id, shop.tech.id);
    await setStatus(shop.tenant.id, ro.id, "COMPLETE");

    const rows = await technicianProductivity(shop.tenant.id, WIDE);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe(shop.tech.name);
    expect(rows[0].jobs).toBe(1);
    expect(rows[0].hours).toBe(2.5);
    expect(rows[0].laborCents).toBe(25_000);
  });

  it("shows unattributed work as its own row rather than hiding it", async () => {
    const shop = await makeShop(db, { taxRate: 0 });
    const { ro } = await billedJob(shop);
    void ro;

    const rows = await technicianProductivity(shop.tenant.id, WIDE);
    expect(rows[0].name).toBe("Unassigned");
    expect(rows[0].jobs).toBe(1);
  });

  it("counts a job once, not once per labour line", async () => {
    const shop = await makeShop(db, { taxRate: 0 });
    const est = await makeEstimate(db, shop, [
      { kind: "LABOR", name: "Brakes", qty: 1, priceCents: 10_000, taxable: false },
      { kind: "LABOR", name: "Alignment", qty: 1, priceCents: 8_000, taxable: false },
    ]);
    const ro = await estimateToRepairOrder(db, { estimateId: est.id });
    await assignTechnician(shop.tenant.id, ro.id, shop.tech.id);
    await setStatus(shop.tenant.id, ro.id, "COMPLETE");

    const rows = await technicianProductivity(shop.tenant.id, WIDE);
    expect(rows[0].jobs).toBe(1);
    expect(rows[0].hours).toBe(2);
    expect(rows[0].laborCents).toBe(18_000);
  });

  it("keeps counting a job after it has been invoiced", async () => {
    const shop = await makeShop(db, { taxRate: 0 });
    const est = await makeEstimate(db, shop, JOB);
    const ro = await estimateToRepairOrder(db, { estimateId: est.id });
    await assignTechnician(shop.tenant.id, ro.id, shop.tech.id);
    await setStatus(shop.tenant.id, ro.id, "COMPLETE");
    await repairOrderToInvoice(db, { repairOrderId: ro.id });

    const rows = await technicianProductivity(shop.tenant.id, WIDE);
    expect(rows[0].jobs).toBe(1);
  });

  it("returns nothing for a period with no finished work", async () => {
    const shop = await makeShop(db);
    expect(await technicianProductivity(shop.tenant.id, WIDE)).toEqual([]);
  });
});

describe("what is in the building", () => {
  it("counts and values open work by status", async () => {
    const shop = await makeShop(db, { taxRate: 0 });
    const est = await makeEstimate(db, shop, JOB);
    const ro = await estimateToRepairOrder(db, { estimateId: est.id });
    await setStatus(shop.tenant.id, ro.id, "IN_PROGRESS");

    const p = await pipeline(shop.tenant.id);
    const inProgress = p.repairOrders.find((r) => r.status === "IN_PROGRESS")!;
    expect(inProgress.count).toBe(1);
    expect(inProgress.cents).toBe(15_000);
  });

  it("drops invoiced work out of the pipeline", async () => {
    const shop = await makeShop(db, { taxRate: 0 });
    await billedJob(shop);

    const p = await pipeline(shop.tenant.id);
    expect(p.repairOrders).toHaveLength(0);
  });
});

describe("approval rate", () => {
  it("measures what the shop quoted against what it closed", async () => {
    const shop = await makeShop(db, { taxRate: 0 });
    await makeEstimate(db, shop, JOB, { status: "APPROVED" });
    await makeEstimate(db, shop, JOB, { status: "APPROVED" });
    const declined = await makeEstimate(db, shop, JOB, { status: "APPROVED" });
    await db.estimate.update({ where: { id: declined.id }, data: { status: "DECLINED" } });

    const rate = await approvalRate(shop.tenant.id, WIDE);
    expect(rate.sent).toBe(3);
    expect(rate.approved).toBe(2);
    expect(rate.ratePct).toBe(67);
  });

  it("does not divide by zero when nothing was answered", async () => {
    const shop = await makeShop(db);
    const rate = await approvalRate(shop.tenant.id, WIDE);
    expect(rate.ratePct).toBe(0);
    expect(rate.approvedCents).toBe(0);
  });
});
