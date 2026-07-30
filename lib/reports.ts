// Reporting, per §6.6.
//
// One decision shapes all of it: a shop needs two different numbers and they
// are rarely the same. "Billed" is the work invoiced in the period. "Collected"
// is the money that actually arrived in it. A fleet account billed on the 30th
// and paying on the 60th shows up in different months, and an owner who is told
// only one of the two will either think they are broke or think they are rich.
//
// So every summary reports both, and says which is which.

import { db } from "@/lib/db";
import { lineTotalCents } from "@/lib/money";
import type { PaymentMethod } from "@/lib/generated/prisma";

export type Range = { from: Date; to: Date };

/** Calendar month containing `on`, in the server's timezone. Good enough for a
 *  single-location shop; a chain in two timezones would need the location's. */
export function monthOf(on = new Date()): Range {
  return {
    from: new Date(on.getFullYear(), on.getMonth(), 1),
    to: new Date(on.getFullYear(), on.getMonth() + 1, 1),
  };
}

/** The last `n` days, today included. Built by walking the date rather than
 *  subtracting milliseconds, so a clock change does not land `from` in the
 *  middle of a day and shift every bucket by one. */
export function daysBack(n: number, on = new Date()): Range {
  return {
    from: new Date(on.getFullYear(), on.getMonth(), on.getDate() - (n - 1)),
    to: new Date(on.getFullYear(), on.getMonth(), on.getDate() + 1),
  };
}

export function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ------------------------------------------------------------------ sales

/**
 * What the shop billed, and what it took, over a period.
 *
 * Void invoices are excluded from billed but their payments are not silently
 * dropped from collected -- if money arrived and was not refunded, it arrived.
 */
export async function salesSummary(tenantId: string, range: Range) {
  const invoices = await db.invoice.findMany({
    where: {
      tenantId,
      status: { not: "VOID" },
      finalizedAt: { gte: range.from, lt: range.to },
    },
    select: { id: true, subtotalCents: true, discountCents: true, taxCents: true, totalCents: true, finalizedAt: true },
  });

  const billedCents = invoices.reduce((sum, i) => sum + i.totalCents, 0);
  const taxCents = invoices.reduce((sum, i) => sum + i.taxCents, 0);
  const discountCents = invoices.reduce((sum, i) => sum + i.discountCents, 0);

  const payments = await db.payment.findMany({
    where: {
      tenantId,
      status: { in: ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"] },
      capturedAt: { gte: range.from, lt: range.to },
    },
    include: { refunds: true },
  });

  // Refunds count against the day the money went back, not the day it came in,
  // so yesterday's total does not change when today's refund is issued.
  const refunds = await db.refund.findMany({
    where: { tenantId, createdAt: { gte: range.from, lt: range.to } },
  });

  const collectedCents = payments.reduce((sum, p) => sum + p.amountCents, 0);
  const refundedCents = refunds.reduce((sum, r) => sum + r.amountCents, 0);

  const byMethod = new Map<PaymentMethod, { count: number; cents: number }>();
  for (const p of payments) {
    const row = byMethod.get(p.method) ?? { count: 0, cents: 0 };
    row.count += 1;
    row.cents += p.amountCents;
    byMethod.set(p.method, row);
  }

  // Daily series, with empty days present rather than missing -- a chart with
  // holes in it reads as "we were closed", which is usually wrong.
  const days = new Map<string, { billedCents: number; collectedCents: number }>();
  for (let d = new Date(range.from); d < range.to; d.setDate(d.getDate() + 1)) {
    days.set(dayKey(d), { billedCents: 0, collectedCents: 0 });
  }
  for (const i of invoices) {
    const row = days.get(dayKey(i.finalizedAt!));
    if (row) row.billedCents += i.totalCents;
  }
  for (const p of payments) {
    const row = days.get(dayKey(p.capturedAt!));
    if (row) row.collectedCents += p.amountCents;
  }

  const lines = await lineBreakdown(tenantId, invoices.map((i) => i.id));

  return {
    range,
    invoiceCount: invoices.length,
    billedCents,
    taxCents,
    discountCents,
    collectedCents,
    refundedCents,
    netCollectedCents: collectedCents - refundedCents,
    averageTicketCents: invoices.length === 0 ? 0 : Math.round(billedCents / invoices.length),
    byMethod: [...byMethod.entries()].map(([method, v]) => ({ method, ...v })).sort((a, b) => b.cents - a.cents),
    days: [...days.entries()].map(([day, v]) => ({ day, ...v })),
    ...lines,
  };
}

/** Parts versus labour, and the margin on each. Cost is on the line, so this
 *  is the shop's real gross profit rather than a guess from the total. */
async function lineBreakdown(tenantId: string, invoiceIds: string[]) {
  if (invoiceIds.length === 0) {
    return {
      partsCents: 0, laborCents: 0, otherCents: 0,
      costCents: 0, grossProfitCents: 0, grossMarginPct: 0,
      topSellers: [] as { name: string; count: number; cents: number }[],
    };
  }

  const lines = await db.lineItem.findMany({
    where: { tenantId, parentType: "INVOICE", parentId: { in: invoiceIds } },
    select: { kind: true, name: true, qty: true, priceCents: true, costCents: true },
  });

  let partsCents = 0, laborCents = 0, otherCents = 0, costCents = 0;
  const sellers = new Map<string, { count: number; cents: number }>();

  for (const line of lines) {
    const total = lineTotalCents(line.qty, line.priceCents);
    costCents += lineTotalCents(line.qty, line.costCents);

    if (line.kind === "LABOR") laborCents += total;
    else if (line.kind === "PART" || line.kind === "TIRE") partsCents += total;
    else otherCents += total;

    const seller = sellers.get(line.name) ?? { count: 0, cents: 0 };
    seller.count += 1;
    seller.cents += total;
    sellers.set(line.name, seller);
  }

  const revenue = partsCents + laborCents + otherCents;
  const grossProfitCents = revenue - costCents;

  return {
    partsCents,
    laborCents,
    otherCents,
    costCents,
    grossProfitCents,
    grossMarginPct: revenue === 0 ? 0 : Math.round((grossProfitCents / revenue) * 100),
    topSellers: [...sellers.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.cents - a.cents)
      .slice(0, 10),
  };
}

// ----------------------------------------------------------- technicians

/**
 * Per-technician output over a period.
 *
 * Counted from repair orders completed in the range and attributed to whoever
 * was assigned. Hours are the labour quantities actually billed, which is what
 * a shop means by "hours turned" -- not clock time.
 */
export async function technicianProductivity(tenantId: string, range: Range) {
  const orders = await db.repairOrder.findMany({
    where: {
      tenantId,
      status: { in: ["COMPLETE", "INVOICED"] },
      completedAt: { gte: range.from, lt: range.to },
    },
    select: { id: true, technicianId: true, totalCents: true, technician: { select: { name: true } } },
  });
  if (orders.length === 0) return [];

  const lines = await db.lineItem.findMany({
    where: {
      tenantId,
      parentType: "REPAIR_ORDER",
      parentId: { in: orders.map((o) => o.id) },
      kind: "LABOR",
    },
    select: { parentId: true, qty: true, priceCents: true },
  });

  const hoursByRO = new Map<string, { hours: number; cents: number }>();
  for (const line of lines) {
    const row = hoursByRO.get(line.parentId) ?? { hours: 0, cents: 0 };
    row.hours += line.qty;
    row.cents += lineTotalCents(line.qty, line.priceCents);
    hoursByRO.set(line.parentId, row);
  }

  const byTech = new Map<string, { name: string; jobs: number; hours: number; laborCents: number; totalCents: number }>();
  for (const ro of orders) {
    // Unassigned work is still work; showing it as its own row is how a shop
    // notices that half the month never got attributed to anyone.
    const key = ro.technicianId ?? "unassigned";
    const row = byTech.get(key) ?? {
      name: ro.technician?.name ?? "Unassigned",
      jobs: 0, hours: 0, laborCents: 0, totalCents: 0,
    };
    const labor = hoursByRO.get(ro.id) ?? { hours: 0, cents: 0 };
    row.jobs += 1;
    row.hours += labor.hours;
    row.laborCents += labor.cents;
    row.totalCents += ro.totalCents;
    byTech.set(key, row);
  }

  return [...byTech.values()].sort((a, b) => b.totalCents - a.totalCents);
}

// -------------------------------------------------------------- pipeline

/** What is on the floor right now, and what it is worth. Not a period report:
 *  this is the answer to "what is in the building". */
export async function pipeline(tenantId: string) {
  const orders = await db.repairOrder.groupBy({
    by: ["status"],
    where: { tenantId, status: { in: ["OPEN", "IN_PROGRESS", "COMPLETE"] } },
    _count: { _all: true },
    _sum: { totalCents: true },
  });

  const estimates = await db.estimate.groupBy({
    by: ["status"],
    where: { tenantId, status: { in: ["DRAFT", "SENT", "APPROVED"] } },
    _count: { _all: true },
    _sum: { totalCents: true },
  });

  return {
    repairOrders: orders.map((r) => ({
      status: r.status,
      count: r._count._all,
      cents: r._sum.totalCents ?? 0,
    })),
    estimates: estimates.map((r) => ({
      status: r.status,
      count: r._count._all,
      cents: r._sum.totalCents ?? 0,
    })),
  };
}

/** How much of what the shop quoted turned into work. The single number that
 *  tells an owner whether the problem is traffic or closing. */
export async function approvalRate(tenantId: string, range: Range) {
  const answered = await db.estimate.findMany({
    where: {
      tenantId,
      status: { in: ["APPROVED", "DECLINED"] },
      approvedAt: { gte: range.from, lt: range.to },
    },
    select: { status: true, totalCents: true },
  });

  const approved = answered.filter((e) => e.status === "APPROVED");
  return {
    sent: answered.length,
    approved: approved.length,
    ratePct: answered.length === 0 ? 0 : Math.round((approved.length / answered.length) * 100),
    approvedCents: approved.reduce((sum, e) => sum + e.totalCents, 0),
  };
}
