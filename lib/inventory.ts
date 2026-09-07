// Parts and tires.
//
// Every change to qtyOnHand goes through adjust(), which writes a movement row
// in the same transaction. A shop that cannot explain where fourteen oil
// filters went will not trust the count, and an inventory nobody trusts is
// worse than no inventory at all -- people stop looking and start guessing.
//
// Stock comes off when the work is billed, not when the line is written onto a
// ticket. A part on an estimate the customer declines was never consumed.

import { db } from "@/lib/db";

export class InventoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryError";
  }
}

/** Movement reasons. Free text elsewhere, but sales carry the invoice id so a
 *  re-run of the same sale can be recognised and skipped. */
export const SALE_PREFIX = "Sold on invoice ";
export const saleReason = (invoiceId: string) => `${SALE_PREFIX}${invoiceId}`;

// ------------------------------------------------------------------ reads

export async function listItems(tenantId: string, opts: { q?: string; lowStock?: boolean } = {}) {
  const q = opts.q?.trim();
  const items = await db.inventoryItem.findMany({
    where: {
      tenantId,
      active: true,
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { sku: { contains: q } },
              { tireSize: { contains: q } },
              { category: { contains: q } },
            ],
          }
        : {}),
    },
    orderBy: [{ name: "asc" }],
    take: 500,
  });

  // Filtered here rather than in SQL: "at or below the reorder point" compares
  // two columns, which Prisma cannot express in a where clause.
  return opts.lowStock ? items.filter(isLow) : items;
}

export function isLow(item: { qtyOnHand: number; reorderPoint: number }) {
  return item.reorderPoint > 0 && item.qtyOnHand <= item.reorderPoint;
}

export async function getItem(tenantId: string, id: string) {
  const item = await db.inventoryItem.findFirst({
    where: { id, tenantId },
    include: {
      movements: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { user: { select: { name: true } } },
      },
    },
  });
  return item;
}

/** Total tied up in stock, at cost. */
export async function stockValueCents(tenantId: string) {
  const items = await db.inventoryItem.findMany({
    where: { tenantId, active: true },
    select: { qtyOnHand: true, costCents: true },
  });
  return items.reduce((sum, i) => sum + Math.round(i.qtyOnHand * i.costCents), 0);
}

// ----------------------------------------------------------------- writes

export type ItemInput = {
  sku: string;
  name: string;
  category?: string | null;
  vendor?: string | null;
  tireSize?: string | null;
  costCents?: number;
  priceCents?: number;
  reorderPoint?: number;
};

function validate(input: ItemInput) {
  const sku = input.sku.trim();
  const name = input.name.trim();
  if (!sku) throw new InventoryError("Give the part a SKU or part number.");
  if (!name) throw new InventoryError("Give the part a name.");
  if ((input.costCents ?? 0) < 0 || (input.priceCents ?? 0) < 0) {
    throw new InventoryError("Cost and price cannot be negative.");
  }
  if ((input.reorderPoint ?? 0) < 0) throw new InventoryError("A reorder point cannot be negative.");

  return {
    sku,
    name,
    category: input.category?.trim() || null,
    vendor: input.vendor?.trim() || null,
    tireSize: input.tireSize?.trim() || null,
    costCents: Math.round(input.costCents ?? 0),
    priceCents: Math.round(input.priceCents ?? 0),
    reorderPoint: input.reorderPoint ?? 0,
  };
}

export async function createItem(tenantId: string, input: ItemInput & { qtyOnHand?: number }, userId?: string) {
  const clean = validate(input);

  const clash = await db.inventoryItem.findFirst({ where: { tenantId, sku: clean.sku } });
  if (clash) throw new InventoryError(`SKU ${clean.sku} is already on ${clash.name}.`);

  const qty = input.qtyOnHand ?? 0;
  const item = await db.inventoryItem.create({ data: { tenantId, ...clean, qtyOnHand: 0 } });

  // Opening stock is a movement like any other, so the ledger starts at zero
  // and explains every unit from there.
  if (qty !== 0) {
    await adjust(tenantId, item.id, qty, "Opening stock", userId);
    return db.inventoryItem.findFirstOrThrow({ where: { id: item.id } });
  }
  return item;
}

export async function updateItem(tenantId: string, id: string, input: ItemInput) {
  const clean = validate(input);
  const item = await db.inventoryItem.findFirst({ where: { id, tenantId } });
  if (!item) throw new InventoryError("That part no longer exists.");

  const clash = await db.inventoryItem.findFirst({ where: { tenantId, sku: clean.sku, NOT: { id } } });
  if (clash) throw new InventoryError(`SKU ${clean.sku} is already on ${clash.name}.`);

  // qtyOnHand is deliberately absent: stock only moves through adjust().
  return db.inventoryItem.update({ where: { id }, data: clean });
}

export async function deactivateItem(tenantId: string, id: string) {
  const item = await db.inventoryItem.findFirst({ where: { id, tenantId } });
  if (!item) throw new InventoryError("That part no longer exists.");
  // Kept rather than deleted: old invoices still point at it.
  return db.inventoryItem.update({ where: { id }, data: { active: false } });
}

/**
 * The only way stock moves.
 *
 * Negative for a sale or a write-off, positive for a delivery. The movement row
 * and the new count are written in one transaction, so the ledger and the
 * balance cannot disagree.
 */
export async function adjust(
  tenantId: string,
  itemId: string,
  qtyDelta: number,
  reason: string,
  userId?: string,
) {
  if (!Number.isFinite(qtyDelta) || qtyDelta === 0) {
    throw new InventoryError("Enter how many units are moving.");
  }
  if (!reason.trim()) throw new InventoryError("Say why the count is changing.");

  return db.$transaction(async (tx) => {
    const item = await tx.inventoryItem.findFirst({ where: { id: itemId, tenantId } });
    if (!item) throw new InventoryError("That part no longer exists.");

    await tx.inventoryMovement.create({
      data: { tenantId, itemId, qtyDelta, reason: reason.trim(), userId: userId ?? null },
    });

    const updated = await tx.inventoryItem.update({
      where: { id: itemId },
      data: { qtyOnHand: { increment: qtyDelta } },
    });

    // §8 wants inventory adjustments audited. Sales are already covered by the
    // invoice's own audit entry, so only hand adjustments are logged here.
    if (!reason.startsWith(SALE_PREFIX)) {
      await tx.auditLog.create({
        data: {
          tenantId,
          userId: userId ?? null,
          entityType: "InventoryItem",
          entityId: itemId,
          action: "STOCK_ADJUSTED",
          beforeJson: JSON.stringify({ qtyOnHand: item.qtyOnHand }),
          afterJson: JSON.stringify({ qtyOnHand: updated.qtyOnHand, qtyDelta, reason: reason.trim() }),
        },
      });
    }

    return updated;
  });
}

// -------------------------------------------------------------- on billing

/**
 * Takes sold parts off the shelf when an invoice is created.
 *
 * Called after the invoice exists rather than inside the conversion, on
 * purpose: a stock problem must never undo a bill the shop has already handed
 * to a customer. Re-running it is safe -- an invoice whose sale movements are
 * already recorded is skipped, so a retried request cannot double-decrement.
 *
 * Stock is allowed to go negative. A shop that fits a filter it forgot to
 * receive should see minus one and go fix the count, not be blocked from
 * billing a car that is already back on the road.
 */
export async function consumeForInvoice(tenantId: string, invoiceId: string, userId?: string) {
  const reason = saleReason(invoiceId);

  const already = await db.inventoryMovement.findFirst({ where: { tenantId, reason } });
  if (already) return { consumed: 0, skipped: true as const };

  const lines = await db.lineItem.findMany({
    where: { tenantId, parentType: "INVOICE", parentId: invoiceId, inventoryItemId: { not: null } },
  });
  if (lines.length === 0) return { consumed: 0, skipped: false as const };

  // Two lines can point at the same part; sum them so the ledger shows one
  // movement per part per invoice.
  const byItem = new Map<string, number>();
  for (const line of lines) {
    byItem.set(line.inventoryItemId!, (byItem.get(line.inventoryItemId!) ?? 0) + line.qty);
  }

  let consumed = 0;
  for (const [itemId, qty] of byItem) {
    if (qty <= 0) continue;
    await adjust(tenantId, itemId, -qty, reason, userId);
    consumed += 1;
  }

  return { consumed, skipped: false as const };
}

/** Puts parts back when an invoice is voided. */
export async function restoreForInvoice(tenantId: string, invoiceId: string, userId?: string) {
  const sale = saleReason(invoiceId);
  const movements = await db.inventoryMovement.findMany({ where: { tenantId, reason: sale } });
  if (movements.length === 0) return { restored: 0 };

  const restoreReason = `Returned to stock from voided invoice ${invoiceId}`;
  const already = await db.inventoryMovement.findFirst({ where: { tenantId, reason: restoreReason } });
  if (already) return { restored: 0 };

  for (const m of movements) {
    await adjust(tenantId, m.itemId, -m.qtyDelta, restoreReason, userId);
  }
  return { restored: movements.length };
}
