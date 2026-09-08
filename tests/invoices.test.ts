import { afterAll, describe, expect, it } from "vitest";
import {
  takePayment, refundPayment, voidInvoice, getInvoice, listInvoices,
  arAging, netCents, assertNoCardData, InvoiceError,
} from "@/lib/invoices";
import { estimateToRepairOrder, repairOrderToInvoice } from "@/lib/convert";
import { setStatus } from "@/lib/repairOrders";
import { makeShop, makeEstimate, testDb } from "./helpers";

const db = testDb();
afterAll(async () => { await db.$disconnect(); });

// $100.00 of work, no tax, so every expectation below is readable at a glance.
const FLAT = [{ kind: "LABOR" as const, name: "Diagnostic", qty: 1, priceCents: 10_000, taxable: false }];

async function makeInvoice(opts: { taxRate?: number; termsDays?: number; taxExempt?: boolean } = {}) {
  const shop = await makeShop(db, { taxRate: opts.taxRate ?? 0, termsDays: opts.termsDays, taxExempt: opts.taxExempt });
  const est = await makeEstimate(db, shop, FLAT);
  const ro = await estimateToRepairOrder(db, { estimateId: est.id });
  await setStatus(shop.tenant.id, ro.id, "COMPLETE");
  const invoice = await repairOrderToInvoice(db, { repairOrderId: ro.id });
  return { shop, ro, invoice };
}

describe("taking payment", () => {
  it("pays an invoice in full", async () => {
    const { shop, invoice } = await makeInvoice();
    const paid = await takePayment(shop.tenant.id, {
      invoiceId: invoice.id, amountCents: 10_000, method: "CASH", userId: shop.advisor.id,
    });

    expect(paid.status).toBe("PAID");
    expect(paid.paidCents).toBe(10_000);
    expect(paid.balanceDueCents).toBe(0);
    expect(paid.paidAt).not.toBeNull();
  });

  it("splits a bill across two methods", async () => {
    const { shop, invoice } = await makeInvoice();
    const part = await takePayment(shop.tenant.id, { invoiceId: invoice.id, amountCents: 4_000, method: "CASH" });
    expect(part.status).toBe("PARTIAL");
    expect(part.balanceDueCents).toBe(6_000);

    const rest = await takePayment(shop.tenant.id, {
      invoiceId: invoice.id, amountCents: 6_000, method: "CARD", brand: "Visa", last4: "4242",
    });
    expect(rest.status).toBe("PAID");
    expect(rest.balanceDueCents).toBe(0);
  });

  it("refuses to overpay", async () => {
    const { shop, invoice } = await makeInvoice();
    await takePayment(shop.tenant.id, { invoiceId: invoice.id, amountCents: 9_000, method: "CASH" });

    await expect(
      takePayment(shop.tenant.id, { invoiceId: invoice.id, amountCents: 2_000, method: "CASH" }),
    ).rejects.toThrow(InvoiceError);
  });

  it("refuses a zero or negative amount", async () => {
    const { shop, invoice } = await makeInvoice();
    await expect(takePayment(shop.tenant.id, { invoiceId: invoice.id, amountCents: 0, method: "CASH" }))
      .rejects.toThrow(/greater than zero/);
    await expect(takePayment(shop.tenant.id, { invoiceId: invoice.id, amountCents: -500, method: "CASH" }))
      .rejects.toThrow(/greater than zero/);
  });

  it("will not take money for another shop's invoice", async () => {
    const { invoice } = await makeInvoice();
    const other = await makeShop(db);

    await expect(
      takePayment(other.tenant.id, { invoiceId: invoice.id, amountCents: 10_000, method: "CASH" }),
    ).rejects.toThrow(/no longer exists/);
  });

  it("stores a card reference without the card", async () => {
    const { shop, invoice } = await makeInvoice();
    await takePayment(shop.tenant.id, {
      invoiceId: invoice.id, amountCents: 10_000, method: "CARD",
      processor: "wholesale_payments", processorRef: "ch_8812", brand: "Visa", last4: "4242",
    });

    const payment = await db.payment.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    expect(payment.last4).toBe("4242");
    expect(payment.brand).toBe("Visa");
    expect(payment.processorRef).toBe("ch_8812");
    // Nothing on the row may hold a PAN-shaped string.
    const serialised = JSON.stringify(payment);
    expect(/\d{12,}/.test(serialised.replace(/[\s-]/g, ""))).toBe(false);
  });
});

describe("refusing card data", () => {
  it("rejects a PAN typed into a reference field", () => {
    expect(() => assertNoCardData("The reference field", "4111111111111111")).toThrow(/looks like a card number/);
  });

  it("sees through spaces and dashes", () => {
    expect(() => assertNoCardData("The reference field", "4111 1111 1111 1111")).toThrow(/looks like a card number/);
    expect(() => assertNoCardData("The reference field", "4111-1111-1111-1111")).toThrow(/looks like a card number/);
  });

  it("leaves ordinary references alone", () => {
    expect(() => assertNoCardData("The reference field", "check 4471")).not.toThrow();
    expect(() => assertNoCardData("The reference field", "ch_8812xyz")).not.toThrow();
    expect(() => assertNoCardData("The reference field", null)).not.toThrow();
  });

  it("blocks a PAN posted through the payment form", async () => {
    const { shop, invoice } = await makeInvoice();
    await expect(
      takePayment(shop.tenant.id, {
        invoiceId: invoice.id, amountCents: 10_000, method: "CARD", reference: "4111111111111111",
      }),
    ).rejects.toThrow(/never hold one/);
    expect(await db.payment.count({ where: { invoiceId: invoice.id } })).toBe(0);
  });

  it("insists last4 is four digits", async () => {
    const { shop, invoice } = await makeInvoice();
    await expect(
      takePayment(shop.tenant.id, { invoiceId: invoice.id, amountCents: 10_000, method: "CARD", last4: "42424" }),
    ).rejects.toThrow(/exactly four digits/);
  });
});

describe("refunds", () => {
  async function paidInvoice() {
    const { shop, invoice } = await makeInvoice();
    await takePayment(shop.tenant.id, { invoiceId: invoice.id, amountCents: 10_000, method: "CARD", last4: "4242" });
    const payment = await db.payment.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    return { shop, invoice, payment };
  }

  it("refunds in full and reopens the balance", async () => {
    const { shop, payment } = await paidInvoice();
    const after = await refundPayment(shop.tenant.id, {
      paymentId: payment.id, amountCents: 10_000, reason: "Wrong car", approvedById: shop.advisor.id,
    });

    expect(after.paidCents).toBe(0);
    expect(after.balanceDueCents).toBe(10_000);
    expect(after.status).toBe("OPEN");
    expect(after.paidAt).toBeNull();

    const refreshed = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(refreshed.status).toBe("REFUNDED");
  });

  it("refunds part and leaves the rest paid", async () => {
    const { shop, payment } = await paidInvoice();
    const after = await refundPayment(shop.tenant.id, { paymentId: payment.id, amountCents: 2_500 });

    expect(after.paidCents).toBe(7_500);
    expect(after.balanceDueCents).toBe(2_500);
    expect(after.status).toBe("PARTIAL");

    const refreshed = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(refreshed.status).toBe("PARTIALLY_REFUNDED");
  });

  it("refunds twice without letting the second one exceed what is left", async () => {
    const { shop, payment } = await paidInvoice();
    await refundPayment(shop.tenant.id, { paymentId: payment.id, amountCents: 6_000 });

    await expect(refundPayment(shop.tenant.id, { paymentId: payment.id, amountCents: 5_000 }))
      .rejects.toThrow(/at most 40.00/);

    const after = await refundPayment(shop.tenant.id, { paymentId: payment.id, amountCents: 4_000 });
    expect(after.paidCents).toBe(0);
  });

  it("refuses to refund more than was taken", async () => {
    const { shop, payment } = await paidInvoice();
    await expect(refundPayment(shop.tenant.id, { paymentId: payment.id, amountCents: 12_000 }))
      .rejects.toThrow(/at most 100.00/);
  });

  it("refuses a second refund once the payment is fully returned", async () => {
    const { shop, payment } = await paidInvoice();
    await refundPayment(shop.tenant.id, { paymentId: payment.id, amountCents: 10_000 });
    await expect(refundPayment(shop.tenant.id, { paymentId: payment.id, amountCents: 100 }))
      .rejects.toThrow(/already been refunded in full/);
  });

  it("will not refund another shop's payment", async () => {
    const { payment } = await paidInvoice();
    const other = await makeShop(db);
    await expect(refundPayment(other.tenant.id, { paymentId: payment.id, amountCents: 100 }))
      .rejects.toThrow(/no longer exists/);
  });

  it("writes an audit entry naming who approved it", async () => {
    const { shop, invoice, payment } = await paidInvoice();
    await refundPayment(shop.tenant.id, {
      paymentId: payment.id, amountCents: 2_500, reason: "Goodwill", approvedById: shop.advisor.id,
    });

    const log = await db.auditLog.findFirstOrThrow({
      where: { entityType: "Invoice", entityId: invoice.id, action: "REFUND_ISSUED" },
    });
    expect(log.userId).toBe(shop.advisor.id);
    expect(log.afterJson).toContain("Goodwill");
  });

  it("recomputes the balance across several payments", async () => {
    const { shop, invoice } = await makeInvoice();
    await takePayment(shop.tenant.id, { invoiceId: invoice.id, amountCents: 3_000, method: "CASH" });
    await takePayment(shop.tenant.id, { invoiceId: invoice.id, amountCents: 7_000, method: "CARD", last4: "4242" });

    const card = await db.payment.findFirstOrThrow({ where: { invoiceId: invoice.id, method: "CARD" } });
    const after = await refundPayment(shop.tenant.id, { paymentId: card.id, amountCents: 7_000 });

    // The cash is untouched, so the invoice is back to part-paid, not unpaid.
    expect(after.paidCents).toBe(3_000);
    expect(after.status).toBe("PARTIAL");
  });

  it("reports what a payment actually kept", async () => {
    const { shop, payment } = await paidInvoice();
    await refundPayment(shop.tenant.id, { paymentId: payment.id, amountCents: 2_500 });

    const withRefunds = await db.payment.findUniqueOrThrow({ where: { id: payment.id }, include: { refunds: true } });
    expect(netCents(withRefunds)).toBe(7_500);
  });
});

describe("voiding", () => {
  it("voids an unpaid invoice", async () => {
    const { shop, invoice } = await makeInvoice();
    const voided = await voidInvoice(shop.tenant.id, invoice.id, { userId: shop.advisor.id, reason: "Duplicate" });

    expect(voided.status).toBe("VOID");
    expect(voided.balanceDueCents).toBe(0);
  });

  it("refuses while money is still held", async () => {
    const { shop, invoice } = await makeInvoice();
    await takePayment(shop.tenant.id, { invoiceId: invoice.id, amountCents: 10_000, method: "CASH" });

    await expect(voidInvoice(shop.tenant.id, invoice.id)).rejects.toThrow(/Refund them before voiding/);
  });

  it("allows voiding once the money has gone back", async () => {
    const { shop, invoice } = await makeInvoice();
    await takePayment(shop.tenant.id, { invoiceId: invoice.id, amountCents: 10_000, method: "CASH" });
    const payment = await db.payment.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    await refundPayment(shop.tenant.id, { paymentId: payment.id, amountCents: 10_000 });

    const voided = await voidInvoice(shop.tenant.id, invoice.id);
    expect(voided.status).toBe("VOID");
  });

  it("will not take payment on a void invoice", async () => {
    const { shop, invoice } = await makeInvoice();
    await voidInvoice(shop.tenant.id, invoice.id);

    await expect(takePayment(shop.tenant.id, { invoiceId: invoice.id, amountCents: 10_000, method: "CASH" }))
      .rejects.toThrow(/is void/);
  });

  it("is idempotent", async () => {
    const { shop, invoice } = await makeInvoice();
    await voidInvoice(shop.tenant.id, invoice.id);
    const again = await voidInvoice(shop.tenant.id, invoice.id);
    expect(again.status).toBe("VOID");
  });
});

describe("receivables", () => {
  it("ages an overdue fleet invoice into the right bucket", async () => {
    const { shop, invoice } = await makeInvoice({ termsDays: 30 });
    // Due 30 days after finalisation; look at it 45 days after it was due.
    const asOf = new Date(invoice.dueAt!.getTime() + 45 * 86_400_000);

    const aging = await arAging(shop.tenant.id, asOf);
    expect(aging.rows).toHaveLength(1);
    expect(aging.rows[0].bucket).toBe("d60");
    expect(aging.rows[0].daysLate).toBe(45);
    expect(aging.buckets.d60).toBe(10_000);
    expect(aging.totalCents).toBe(10_000);
  });

  it("counts an invoice that is not due yet as current", async () => {
    const { shop, invoice } = await makeInvoice({ termsDays: 30 });
    const aging = await arAging(shop.tenant.id, invoice.finalizedAt!);
    expect(aging.rows[0].bucket).toBe("current");
    expect(aging.rows[0].daysLate).toBe(0);
  });

  it("drops an invoice out of receivables once it is paid", async () => {
    const { shop, invoice } = await makeInvoice({ termsDays: 30 });
    await takePayment(shop.tenant.id, { invoiceId: invoice.id, amountCents: 10_000, method: "CASH" });

    const aging = await arAging(shop.tenant.id);
    expect(aging.rows).toHaveLength(0);
    expect(aging.totalCents).toBe(0);
  });
});

describe("reads", () => {
  it("returns the invoice with its lines and payments", async () => {
    const { shop, invoice } = await makeInvoice();
    await takePayment(shop.tenant.id, { invoiceId: invoice.id, amountCents: 4_000, method: "CASH" });

    const full = await getInvoice(shop.tenant.id, invoice.id);
    expect(full!.lineItems).toHaveLength(1);
    expect(full!.payments).toHaveLength(1);
    expect(full!.repairOrder.number).toBeGreaterThan(1000);
  });

  it("does not hand over another shop's invoice", async () => {
    const { invoice } = await makeInvoice();
    const other = await makeShop(db);
    expect(await getInvoice(other.tenant.id, invoice.id)).toBeNull();
  });

  it("filters the list to what is still owed", async () => {
    const { shop, invoice } = await makeInvoice();
    expect(await listInvoices(shop.tenant.id, { unpaid: true })).toHaveLength(1);

    await takePayment(shop.tenant.id, { invoiceId: invoice.id, amountCents: 10_000, method: "CASH" });
    expect(await listInvoices(shop.tenant.id, { unpaid: true })).toHaveLength(0);
    expect(await listInvoices(shop.tenant.id)).toHaveLength(1);
  });
});
