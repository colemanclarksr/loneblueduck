import { afterAll, describe, expect, it } from "vitest";
import {
  createItem, updateItem, deactivateItem, adjust, listItems, getItem,
  consumeForInvoice, restoreForInvoice, stockValueCents, isLow, InventoryError,
} from "@/lib/inventory";
import { estimateToRepairOrder, repairOrderToInvoice } from "@/lib/convert";
import { setStatus, addLine } from "@/lib/repairOrders";
import { voidInvoice } from "@/lib/invoices";
import { makeShop, makeEstimate, testDb } from "./helpers";

const db = testDb();
afterAll(async () => { await db.$disconnect(); });

const FILTER = { sku: "PH-3614", name: "Oil filter", costCents: 380, priceCents: 1_295, reorderPoint: 4 };

describe("keeping a count", () => {
  it("starts a part at zero and books opening stock as a movement", async () => {
    const shop = await makeShop(db);
    const item = await createItem(shop.tenant.id, { ...FILTER, qtyOnHand: 24 }, shop.advisor.id);

    expect(item.qtyOnHand).toBe(24);
    const movements = await db.inventoryMovement.findMany({ where: { itemId: item.id } });
    expect(movements).toHaveLength(1);
    expect(movements[0].reason).toBe("Opening stock");
    expect(movements[0].qtyDelta).toBe(24);
  });

  it("moves stock only through adjust, and logs every move", async () => {
    const shop = await makeShop(db);
    const item = await createItem(shop.tenant.id, FILTER);

    await adjust(shop.tenant.id, item.id, 12, "Delivery from NAPA", shop.advisor.id);
    const after = await adjust(shop.tenant.id, item.id, -1, "Damaged in the rack", shop.advisor.id);

    expect(after.qtyOnHand).toBe(11);
    const full = await getItem(shop.tenant.id, item.id);
    expect(full!.movements).toHaveLength(2);
    expect(full!.movements[0].reason).toBe("Damaged in the rack");
    expect(full!.movements[0].user?.name).toBe(shop.advisor.name);
  });

  it("audits a hand adjustment", async () => {
    const shop = await makeShop(db);
    const item = await createItem(shop.tenant.id, FILTER);
    await adjust(shop.tenant.id, item.id, 5, "Found behind the bench", shop.advisor.id);

    const log = await db.auditLog.findFirst({
      where: { entityType: "InventoryItem", entityId: item.id, action: "STOCK_ADJUSTED" },
    });
    expect(log).not.toBeNull();
    expect(log!.afterJson).toContain("Found behind the bench");
  });

  it("refuses a move with no quantity or no reason", async () => {
    const shop = await makeShop(db);
    const item = await createItem(shop.tenant.id, FILTER);

    await expect(adjust(shop.tenant.id, item.id, 0, "Nothing")).rejects.toThrow(/how many units/);
    await expect(adjust(shop.tenant.id, item.id, 3, "  ")).rejects.toThrow(/why the count is changing/);
  });

  it("will not adjust another shop's stock", async () => {
    const shop = await makeShop(db);
    const other = await makeShop(db);
    const item = await createItem(shop.tenant.id, FILTER);

    await expect(adjust(other.tenant.id, item.id, 5, "Delivery")).rejects.toThrow(/no longer exists/);
  });

  it("keeps SKUs unique within a shop but not across shops", async () => {
    const shop = await makeShop(db);
    const other = await makeShop(db);
    await createItem(shop.tenant.id, FILTER);

    await expect(createItem(shop.tenant.id, { ...FILTER, name: "Different filter" }))
      .rejects.toThrow(/already on Oil filter/);
    await expect(createItem(other.tenant.id, FILTER)).resolves.toBeTruthy();
  });

  it("rejects a part with no SKU or no name", async () => {
    const shop = await makeShop(db);
    await expect(createItem(shop.tenant.id, { ...FILTER, sku: " " })).rejects.toThrow(/SKU or part number/);
    await expect(createItem(shop.tenant.id, { ...FILTER, name: " " })).rejects.toThrow(/give the part a name/i);
  });

  it("does not let an edit quietly restate the count", async () => {
    const shop = await makeShop(db);
    const item = await createItem(shop.tenant.id, { ...FILTER, qtyOnHand: 10 });

    // qtyOnHand is not part of ItemInput; passing it changes nothing.
    const updated = await updateItem(shop.tenant.id, item.id, {
      ...FILTER, name: "Oil filter (long)", priceCents: 1_495,
    } as never);

    expect(updated.name).toBe("Oil filter (long)");
    expect(updated.qtyOnHand).toBe(10);
  });

  it("deactivates rather than deletes, because old invoices point at it", async () => {
    const shop = await makeShop(db);
    const item = await createItem(shop.tenant.id, FILTER);
    await deactivateItem(shop.tenant.id, item.id);

    expect(await listItems(shop.tenant.id)).toHaveLength(0);
    expect(await db.inventoryItem.findUnique({ where: { id: item.id } })).not.toBeNull();
  });
});

describe("finding things", () => {
  it("searches name, SKU and tire size", async () => {
    const shop = await makeShop(db);
    await createItem(shop.tenant.id, FILTER);
    await createItem(shop.tenant.id, { sku: "TR-2255517", name: "Defender T+H", tireSize: "225/55R17", priceCents: 18_900 });

    expect(await listItems(shop.tenant.id, { q: "oil" })).toHaveLength(1);
    expect(await listItems(shop.tenant.id, { q: "PH-36" })).toHaveLength(1);
    expect(await listItems(shop.tenant.id, { q: "225/55" })).toHaveLength(1);
    expect(await listItems(shop.tenant.id, { q: "zzz" })).toHaveLength(0);
  });

  it("flags what needs reordering", async () => {
    const shop = await makeShop(db);
    const low = await createItem(shop.tenant.id, { ...FILTER, qtyOnHand: 3 });   // reorder at 4
    await createItem(shop.tenant.id, { sku: "AF-100", name: "Air filter", qtyOnHand: 20, reorderPoint: 4 });
    // No reorder point set means the shop is not tracking it, so it never nags.
    await createItem(shop.tenant.id, { sku: "WB-9", name: "Wheel weights", qtyOnHand: 0, reorderPoint: 0 });

    const short = await listItems(shop.tenant.id, { lowStock: true });
    expect(short.map((i) => i.id)).toEqual([low.id]);
    expect(isLow({ qtyOnHand: 0, reorderPoint: 0 })).toBe(false);
  });

  it("values the shelf at cost", async () => {
    const shop = await makeShop(db);
    await createItem(shop.tenant.id, { ...FILTER, qtyOnHand: 10 });              // 10 × $3.80
    await createItem(shop.tenant.id, { sku: "TR-1", name: "Tire", qtyOnHand: 4, costCents: 11_000 });

    expect(await stockValueCents(shop.tenant.id)).toBe(3_800 + 44_000);
  });
});

describe("selling stock", () => {
  async function shopWithSoldPart(qtyOnHand = 24, qtySold = 1) {
    const shop = await makeShop(db, { taxRate: 0 });
    const item = await createItem(shop.tenant.id, { ...FILTER, qtyOnHand });
    const est = await makeEstimate(db, shop, [{ kind: "LABOR", name: "Oil change", priceCents: 4_995 }]);
    const ro = await estimateToRepairOrder(db, { estimateId: est.id });
    await addLine(shop.tenant.id, ro.id, {
      kind: "PART", name: item.name, sku: item.sku, qty: qtySold, priceCents: item.priceCents,
      inventoryItemId: item.id,
    });
    await setStatus(shop.tenant.id, ro.id, "COMPLETE");
    const invoice = await repairOrderToInvoice(db, { repairOrderId: ro.id });
    return { shop, item, invoice };
  }

  it("takes the part off the shelf when the invoice is created", async () => {
    const { shop, item, invoice } = await shopWithSoldPart();
    const result = await consumeForInvoice(shop.tenant.id, invoice.id, shop.advisor.id);

    expect(result.consumed).toBe(1);
    const after = await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.qtyOnHand).toBe(23);
  });

  it("does not decrement twice if it runs again", async () => {
    const { shop, item, invoice } = await shopWithSoldPart();
    await consumeForInvoice(shop.tenant.id, invoice.id);
    const second = await consumeForInvoice(shop.tenant.id, invoice.id);

    expect(second.skipped).toBe(true);
    const after = await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.qtyOnHand).toBe(23);
  });

  it("lets stock go negative rather than blocking a bill", async () => {
    const { shop, item, invoice } = await shopWithSoldPart(0, 2);
    await consumeForInvoice(shop.tenant.id, invoice.id);

    const after = await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.qtyOnHand).toBe(-2);
  });

  it("ignores lines that are not stocked parts", async () => {
    const shop = await makeShop(db, { taxRate: 0 });
    const est = await makeEstimate(db, shop, [{ kind: "LABOR", name: "Diagnostic", priceCents: 12_500 }]);
    const ro = await estimateToRepairOrder(db, { estimateId: est.id });
    await setStatus(shop.tenant.id, ro.id, "COMPLETE");
    const invoice = await repairOrderToInvoice(db, { repairOrderId: ro.id });

    const result = await consumeForInvoice(shop.tenant.id, invoice.id);
    expect(result.consumed).toBe(0);
    expect(await db.inventoryMovement.count({ where: { tenantId: shop.tenant.id } })).toBe(0);
  });

  it("books one movement per part even when a part is on two lines", async () => {
    const shop = await makeShop(db, { taxRate: 0 });
    const item = await createItem(shop.tenant.id, { ...FILTER, qtyOnHand: 10 });
    const est = await makeEstimate(db, shop, [{ kind: "LABOR", name: "Service", priceCents: 4_995 }]);
    const ro = await estimateToRepairOrder(db, { estimateId: est.id });
    for (const qty of [1, 2]) {
      await addLine(shop.tenant.id, ro.id, {
        kind: "PART", name: item.name, qty, priceCents: item.priceCents, inventoryItemId: item.id,
      });
    }
    await setStatus(shop.tenant.id, ro.id, "COMPLETE");
    const invoice = await repairOrderToInvoice(db, { repairOrderId: ro.id });
    await consumeForInvoice(shop.tenant.id, invoice.id);

    const sales = await db.inventoryMovement.findMany({ where: { itemId: item.id, reason: { contains: "Sold on invoice" } } });
    expect(sales).toHaveLength(1);
    expect(sales[0].qtyDelta).toBe(-3);
    const after = await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.qtyOnHand).toBe(7);
  });

  it("puts parts back when the invoice is voided", async () => {
    const { shop, item, invoice } = await shopWithSoldPart();
    await consumeForInvoice(shop.tenant.id, invoice.id);
    await voidInvoice(shop.tenant.id, invoice.id);
    await restoreForInvoice(shop.tenant.id, invoice.id, shop.advisor.id);

    const after = await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.qtyOnHand).toBe(24);
  });

  it("does not restore twice", async () => {
    const { shop, item, invoice } = await shopWithSoldPart();
    await consumeForInvoice(shop.tenant.id, invoice.id);
    await restoreForInvoice(shop.tenant.id, invoice.id);
    const second = await restoreForInvoice(shop.tenant.id, invoice.id);

    expect(second.restored).toBe(0);
    const after = await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.qtyOnHand).toBe(24);
  });

  it("does not audit sale movements twice over", async () => {
    const { shop, invoice } = await shopWithSoldPart();
    await consumeForInvoice(shop.tenant.id, invoice.id);

    // The invoice already has its own audit entry; a sale is not a hand
    // adjustment and should not appear as one.
    const adjustments = await db.auditLog.count({
      where: { tenantId: shop.tenant.id, action: "STOCK_ADJUSTED" },
    });
    expect(adjustments).toBe(1); // opening stock only
  });
});

describe("errors read like a person wrote them", () => {
  it("names the part already holding a SKU", async () => {
    const shop = await makeShop(db);
    await createItem(shop.tenant.id, FILTER);
    await expect(createItem(shop.tenant.id, { ...FILTER, name: "Other" }))
      .rejects.toThrow("SKU PH-3614 is already on Oil filter.");
  });

  it("rejects negative money", async () => {
    const shop = await makeShop(db);
    await expect(createItem(shop.tenant.id, { ...FILTER, priceCents: -1 }))
      .rejects.toThrow(InventoryError);
  });
});
