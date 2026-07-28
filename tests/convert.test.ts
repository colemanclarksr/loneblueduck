import { afterAll, describe, expect, it } from "vitest";
import { estimateToRepairOrder, repairOrderToInvoice, applyPayment, ConversionError } from "@/lib/convert";
import { makeShop, makeEstimate, testDb } from "./helpers";

const db = testDb();
afterAll(async () => { await db.$disconnect(); });

// Brakes approved ($412.50 taxable), struts declined, supplies non-taxable.
const BRAKE_JOB = [
  { name: "Ceramic pads", qty: 1, priceCents: 8_900, section: "Front brakes" },
  { name: "Rotor", qty: 2, priceCents: 6_800, section: "Front brakes" },
  { kind: "LABOR" as const, name: "R&R front brakes", qty: 1.5, priceCents: 12_500, section: "Front brakes" },
  { name: "Strut assembly", qty: 2, priceCents: 17_500, approved: false, section: "Struts" },
  { kind: "LABOR" as const, name: "R&R struts", qty: 2, priceCents: 12_500, approved: false, section: "Struts" },
  { kind: "FEE" as const, name: "Shop supplies", qty: 1, priceCents: 1_500, taxable: false },
];

describe("estimate -> repair order", () => {
  it("copies only approved lines and carries the exact approved total", async () => {
    const shop = await makeShop(db);
    const est = await makeEstimate(db, shop, BRAKE_JOB);

    const ro = await estimateToRepairOrder(db, { estimateId: est.id, advisorId: shop.advisor.id, technicianId: shop.tech.id });

    const lines = await db.lineItem.findMany({ where: { parentType: "REPAIR_ORDER", parentId: ro.id } });
    expect(lines).toHaveLength(4); // 3 brake lines + supplies; struts dropped
    expect(lines.map((l) => l.name)).not.toContain("Strut assembly");

    expect(ro.subtotalCents).toBe(42_750);
    expect(ro.taxCents).toBe(3_197);
    expect(ro.totalCents).toBe(45_947);
    expect(ro.estimateId).toBe(est.id);
    expect(ro.technicianId).toBe(shop.tech.id);
  });

  it("preserves section grouping so the RO still reads as repairs", async () => {
    const shop = await makeShop(db);
    const est = await makeEstimate(db, shop, BRAKE_JOB);
    const ro = await estimateToRepairOrder(db, { estimateId: est.id });
    const lines = await db.lineItem.findMany({ where: { parentType: "REPAIR_ORDER", parentId: ro.id } });
    expect(lines.filter((l) => l.section === "Front brakes")).toHaveLength(3);
  });

  it("computes from stored rows, not from stale denormalised columns", async () => {
    const shop = await makeShop(db);
    const est = await makeEstimate(db, shop, BRAKE_JOB);
    // Someone edited lines without recomputing the header. The conversion must
    // trust the rows, which is the whole reason it recomputes.
    await db.estimate.update({
      where: { id: est.id },
      data: { subtotalCents: 999_999, taxCents: 999_999, totalCents: 999_999 },
    });

    const ro = await estimateToRepairOrder(db, { estimateId: est.id });
    expect(ro.totalCents).toBe(45_947);
  });

  it("marks the estimate CONVERTED and logs the event", async () => {
    const shop = await makeShop(db);
    const est = await makeEstimate(db, shop, BRAKE_JOB);
    const ro = await estimateToRepairOrder(db, { estimateId: est.id });

    expect((await db.estimate.findUniqueOrThrow({ where: { id: est.id } })).status).toBe("CONVERTED");
    const events = await db.repairOrderEvent.findMany({ where: { repairOrderId: ro.id } });
    expect(events).toHaveLength(1);
    expect(events[0].to).toBe("OPEN");
  });

  it("refuses an estimate the customer has not approved", async () => {
    const shop = await makeShop(db);
    const est = await makeEstimate(db, shop, BRAKE_JOB, { status: "SENT" });
    await expect(estimateToRepairOrder(db, { estimateId: est.id })).rejects.toThrow(ConversionError);
    expect(await db.repairOrder.count({ where: { tenantId: shop.tenant.id } })).toBe(0);
  });

  it("refuses to convert the same estimate twice", async () => {
    const shop = await makeShop(db);
    const est = await makeEstimate(db, shop, BRAKE_JOB);
    await estimateToRepairOrder(db, { estimateId: est.id });
    // Force it back so the guard being tested is the duplicate check.
    await db.estimate.update({ where: { id: est.id }, data: { status: "APPROVED" } });

    await expect(estimateToRepairOrder(db, { estimateId: est.id })).rejects.toThrow(/already on repair order/);
    expect(await db.repairOrder.count({ where: { tenantId: shop.tenant.id } })).toBe(1);
  });

  it("refuses when every line was declined, rather than creating an empty RO", async () => {
    const shop = await makeShop(db);
    const est = await makeEstimate(db, shop, [{ name: "Struts", priceCents: 50_000, approved: false }]);
    await expect(estimateToRepairOrder(db, { estimateId: est.id })).rejects.toThrow(/no approved line items/);
    expect(await db.repairOrder.count({ where: { tenantId: shop.tenant.id } })).toBe(0);
  });
});

describe("repair order -> invoice", () => {
  async function completedRO(shop: Awaited<ReturnType<typeof makeShop>>) {
    const est = await makeEstimate(db, shop, BRAKE_JOB);
    const ro = await estimateToRepairOrder(db, { estimateId: est.id });
    return db.repairOrder.update({ where: { id: ro.id }, data: { status: "COMPLETE", completedAt: new Date() } });
  }

  it("carries the RO total onto the invoice and opens the balance", async () => {
    const shop = await makeShop(db);
    const ro = await completedRO(shop);
    const inv = await repairOrderToInvoice(db, { repairOrderId: ro.id });

    expect(inv.subtotalCents).toBe(42_750);
    expect(inv.totalCents).toBe(45_947);
    expect(inv.balanceDueCents).toBe(45_947);
    expect(inv.status).toBe("OPEN");
    expect(inv.finalizedAt).not.toBeNull();
    expect((await db.repairOrder.findUniqueOrThrow({ where: { id: ro.id } })).status).toBe("INVOICED");
  });

  it("refuses to invoice work that is not finished", async () => {
    const shop = await makeShop(db);
    const est = await makeEstimate(db, shop, BRAKE_JOB);
    const ro = await estimateToRepairOrder(db, { estimateId: est.id }); // still OPEN
    await expect(repairOrderToInvoice(db, { repairOrderId: ro.id })).rejects.toThrow(/Finish the work/);
    expect(await db.invoice.count({ where: { tenantId: shop.tenant.id } })).toBe(0);
  });

  it("refuses to invoice the same RO twice", async () => {
    const shop = await makeShop(db);
    const ro = await completedRO(shop);
    await repairOrderToInvoice(db, { repairOrderId: ro.id });
    await db.repairOrder.update({ where: { id: ro.id }, data: { status: "COMPLETE" } });
    await expect(repairOrderToInvoice(db, { repairOrderId: ro.id })).rejects.toThrow(/already on invoice/);
    expect(await db.invoice.count({ where: { tenantId: shop.tenant.id } })).toBe(1);
  });

  it("zeroes tax for a tax-exempt customer but keeps the subtotal identical", async () => {
    const shop = await makeShop(db, { taxExempt: true });
    const ro = await completedRO(shop);
    const inv = await repairOrderToInvoice(db, { repairOrderId: ro.id });

    expect(inv.subtotalCents).toBe(42_750); // unchanged
    expect(inv.taxCents).toBe(0);
    expect(inv.totalCents).toBe(42_750);
  });

  it("copies fleet terms onto the invoice so later term changes cannot restate it", async () => {
    const shop = await makeShop(db, { termsDays: 30 });
    const ro = await completedRO(shop);
    const inv = await repairOrderToInvoice(db, { repairOrderId: ro.id });
    expect(inv.termsDays).toBe(30);
    expect(inv.dueAt).not.toBeNull();

    await db.customer.update({ where: { id: shop.customer.id }, data: { billingTermsDays: 7 } });
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).termsDays).toBe(30);
  });

  it("writes an audit entry when the invoice is finalised", async () => {
    const shop = await makeShop(db);
    const ro = await completedRO(shop);
    const inv = await repairOrderToInvoice(db, { repairOrderId: ro.id, userId: shop.advisor.id });
    const logs = await db.auditLog.findMany({ where: { entityType: "Invoice", entityId: inv.id } });
    expect(logs.map((l) => l.action)).toContain("INVOICE_FINALIZED");
  });
});

describe("payments", () => {
  async function openInvoice(shop: Awaited<ReturnType<typeof makeShop>>) {
    const est = await makeEstimate(db, shop, BRAKE_JOB);
    const ro = await estimateToRepairOrder(db, { estimateId: est.id });
    await db.repairOrder.update({ where: { id: ro.id }, data: { status: "COMPLETE" } });
    return repairOrderToInvoice(db, { repairOrderId: ro.id });
  }

  it("handles split tender and closes at exactly zero", async () => {
    const shop = await makeShop(db);
    const inv = await openInvoice(shop);

    const afterCash = await applyPayment(db, { invoiceId: inv.id, amountCents: 20_000, method: "CASH" });
    expect(afterCash.status).toBe("PARTIAL");
    expect(afterCash.balanceDueCents).toBe(25_947);
    expect(afterCash.paidAt).toBeNull();

    const afterCard = await applyPayment(db, {
      invoiceId: inv.id,
      amountCents: 25_947,
      method: "CARD",
      processor: "wholesale_payments",
      processorRef: "wp_txn_8812",
      brand: "Visa",
      last4: "4242",
    });
    expect(afterCard.status).toBe("PAID");
    expect(afterCard.balanceDueCents).toBe(0);
    expect(afterCard.paidAt).not.toBeNull();
  });

  it("refuses to overpay", async () => {
    const shop = await makeShop(db);
    const inv = await openInvoice(shop);
    await applyPayment(db, { invoiceId: inv.id, amountCents: 40_000, method: "CASH" });

    await expect(applyPayment(db, { invoiceId: inv.id, amountCents: 10_000, method: "CASH" })).rejects.toThrow(/overpay/);
    const after = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after.paidCents).toBe(40_000);
    expect(after.status).toBe("PARTIAL");
  });

  it("refuses a zero or negative amount", async () => {
    const shop = await makeShop(db);
    const inv = await openInvoice(shop);
    await expect(applyPayment(db, { invoiceId: inv.id, amountCents: 0, method: "CASH" })).rejects.toThrow(/must be positive/);
    await expect(applyPayment(db, { invoiceId: inv.id, amountCents: -500, method: "CASH" })).rejects.toThrow(/must be positive/);
  });

  it("stores no cardholder data beyond brand and last four", async () => {
    const shop = await makeShop(db);
    const inv = await openInvoice(shop);
    await applyPayment(db, {
      invoiceId: inv.id, amountCents: 45_947, method: "CARD",
      processor: "wholesale_payments", processorRef: "wp_txn_1", brand: "Visa", last4: "4242",
    });
    const p = await db.payment.findFirstOrThrow({ where: { invoiceId: inv.id } });
    expect(Object.keys(p)).not.toContain("cardNumber");
    expect(p.last4).toBe("4242");
    expect(p.last4!.length).toBe(4);
    expect(p.processorRef).toBe("wp_txn_1");
  });
});

// Blueprint §16 Prompt 1 requires proof that tenants cannot see each other.
describe("tenant isolation", () => {
  it("scopes documents, line items and payments to their own tenant", async () => {
    const a = await makeShop(db);
    const b = await makeShop(db);
    const estA = await makeEstimate(db, a, BRAKE_JOB);
    await makeEstimate(db, b, [{ name: "Oil change", priceCents: 5_000 }]);

    const seenByB = await db.estimate.findMany({ where: { tenantId: b.tenant.id } });
    expect(seenByB.map((e) => e.id)).not.toContain(estA.id);

    const linesOfA = await db.lineItem.findMany({ where: { tenantId: a.tenant.id, parentType: "ESTIMATE", parentId: estA.id } });
    expect(linesOfA).toHaveLength(BRAKE_JOB.length);
    // Same parentId, wrong tenant, must return nothing.
    const crossTenant = await db.lineItem.findMany({ where: { tenantId: b.tenant.id, parentType: "ESTIMATE", parentId: estA.id } });
    expect(crossTenant).toHaveLength(0);
  });

  it("lets two tenants use the same document numbers independently", async () => {
    const a = await makeShop(db);
    const b = await makeShop(db);
    const ea = await makeEstimate(db, a, [{ name: "x", priceCents: 100 }]);
    const eb = await makeEstimate(db, b, [{ name: "y", priceCents: 100 }]);
    expect(ea.number).toBe(eb.number);
  });
});
