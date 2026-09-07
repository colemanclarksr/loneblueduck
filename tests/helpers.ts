import type { PrismaClient } from "@/lib/generated/prisma";
import { db } from "@/lib/db";

/**
 * The application's own client, pointed at the test database by
 * vitest.config.ts. Deliberately not a second connection: code under test
 * imports lib/db, and a separate client here would mean fixtures and code were
 * writing to different files.
 */
export function testDb(): PrismaClient {
  return db;
}

let seq = 0;

/** A tenant with a location, an advisor, a tech, a customer and a vehicle.
 *  Every call is isolated, so suites never collide on document numbers. */
export async function makeShop(db: PrismaClient, opts: { taxRate?: number; taxExempt?: boolean; termsDays?: number } = {}) {
  const n = ++seq;
  const tenant = await db.tenant.create({ data: { name: `Shop ${n}-${Date.now()}` } });
  const location = await db.location.create({
    data: { tenantId: tenant.id, name: "Main", taxRate: opts.taxRate ?? 7.75, laborRateCents: 12_500 },
  });
  const advisor = await db.user.create({ data: { name: `Advisor ${n}`, email: `advisor-${n}-${Date.now()}@t.test` } });
  const tech = await db.user.create({ data: { name: `Tech ${n}`, email: `tech-${n}-${Date.now()}@t.test` } });
  await db.membership.createMany({
    data: [
      { tenantId: tenant.id, userId: advisor.id, locationId: location.id, role: "SERVICE_ADVISOR" },
      { tenantId: tenant.id, userId: tech.id, locationId: location.id, role: "TECHNICIAN" },
    ],
  });
  const customer = await db.customer.create({
    data: {
      tenantId: tenant.id,
      firstName: "Dana",
      lastName: "Whitfield",
      phone: "909-555-0142",
      taxExempt: opts.taxExempt ?? false,
      billingTermsDays: opts.termsDays ?? null,
    },
  });
  const vehicle = await db.vehicle.create({
    data: { tenantId: tenant.id, customerId: customer.id, year: 2017, make: "Toyota", model: "Tacoma", mileage: 96_400 },
  });
  return { tenant, location, advisor, tech, customer, vehicle };
}

type LineSpec = {
  kind?: "PART" | "LABOR" | "FEE" | "SUBLET" | "TIRE";
  name: string;
  qty?: number;
  priceCents: number;
  costCents?: number;
  taxable?: boolean;
  approved?: boolean;
  section?: string;
};

/** An estimate with lines. Totals are left at zero on purpose unless the test
 *  sets them, so conversions cannot pass by reading a stale column. */
export async function makeEstimate(
  db: PrismaClient,
  shop: Awaited<ReturnType<typeof makeShop>>,
  lines: LineSpec[],
  opts: { status?: "DRAFT" | "SENT" | "APPROVED" | "DECLINED"; discountPct?: number } = {},
) {
  const last = await db.estimate.findFirst({ where: { tenantId: shop.tenant.id }, orderBy: { number: "desc" } });
  const estimate = await db.estimate.create({
    data: {
      tenantId: shop.tenant.id,
      locationId: shop.location.id,
      number: (last?.number ?? 1000) + 1,
      customerId: shop.customer.id,
      vehicleId: shop.vehicle.id,
      authorId: shop.advisor.id,
      status: opts.status ?? "APPROVED",
      taxRate: shop.location.taxRate,
      discountPct: opts.discountPct ?? 0,
      approvedAt: (opts.status ?? "APPROVED") === "APPROVED" ? new Date() : null,
    },
  });
  await db.lineItem.createMany({
    data: lines.map((l, i) => ({
      tenantId: shop.tenant.id,
      parentType: "ESTIMATE" as const,
      parentId: estimate.id,
      kind: l.kind ?? "PART",
      name: l.name,
      section: l.section ?? null,
      qty: l.qty ?? 1,
      costCents: l.costCents ?? 0,
      priceCents: l.priceCents,
      taxable: l.taxable ?? true,
      approved: l.approved ?? true,
      sort: i,
    })),
  });
  return estimate;
}
