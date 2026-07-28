// Demo data for one shop, driven through the real conversion functions so the
// seed exercises the same code path the app does.
//
// Run: npm run seed

import { PrismaClient } from "../lib/generated/prisma";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { estimateToRepairOrder, repairOrderToInvoice, applyPayment } from "../lib/convert";
import { formatCents } from "../lib/money";
import { hashPassword } from "../lib/auth";

const db = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./prisma/dev.db" }),
});

async function main() {
  await db.tenant.deleteMany();
  await db.user.deleteMany();

  const tenant = await db.tenant.create({ data: { name: "Blue Duck Auto", plan: "starter" } });
  const location = await db.location.create({
    data: {
      tenantId: tenant.id,
      name: "Main Street",
      phone: "214-802-3388",
      city: "San Bernardino",
      state: "CA",
      laborRateCents: 12_500,
      taxRate: 7.75,
      receiptFooter: "12-month/12,000-mile warranty on parts and labor.",
    },
  });

  // Demo credentials. Every seeded user signs in with this password.
  const DEMO_PASSWORD = "shopdesk";
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const [owner, advisor, tech] = await Promise.all([
    db.user.create({ data: { name: "Coleman Clark", email: "coleman@blueduckauto.test", passwordHash } }),
    db.user.create({ data: { name: "Priya Raman", email: "priya@blueduckauto.test", passwordHash } }),
    db.user.create({ data: { name: "Marco Reyes", email: "marco@blueduckauto.test", passwordHash } }),
  ]);
  await db.membership.createMany({
    data: [
      { tenantId: tenant.id, userId: owner.id, locationId: location.id, role: "OWNER" },
      { tenantId: tenant.id, userId: advisor.id, locationId: location.id, role: "SERVICE_ADVISOR" },
      { tenantId: tenant.id, userId: tech.id, locationId: location.id, role: "TECHNICIAN", hourlyCostCents: 3_200 },
    ],
  });

  const [pads, rotor] = await Promise.all([
    db.inventoryItem.create({
      data: { tenantId: tenant.id, sku: "BP-4417", name: "Ceramic brake pads (front)", category: "Brakes", qtyOnHand: 6, costCents: 4_200, priceCents: 8_900, reorderPoint: 2 },
    }),
    db.inventoryItem.create({
      data: { tenantId: tenant.id, sku: "RT-2290", name: "Rotor, front", category: "Brakes", qtyOnHand: 8, costCents: 3_100, priceCents: 6_800, reorderPoint: 4 },
    }),
  ]);

  const customer = await db.customer.create({
    data: { tenantId: tenant.id, type: "RETAIL", firstName: "Dana", lastName: "Whitfield", phone: "909-555-0142", email: "dana.whitfield@example.test" },
  });
  const vehicle = await db.vehicle.create({
    data: { tenantId: tenant.id, customerId: customer.id, year: 2017, make: "Toyota", model: "Tacoma", plate: "8XYZ221", vin: "3TMCZ5AN0HM062011", mileage: 96_400 },
  });

  // ------------------------------------------------------------- estimate
  const estimate = await db.estimate.create({
    data: {
      tenantId: tenant.id,
      locationId: location.id,
      number: 1001,
      customerId: customer.id,
      vehicleId: vehicle.id,
      authorId: advisor.id,
      status: "SENT",
      taxRate: location.taxRate,
      mileageIn: 96_842,
      complaint: "Grinding noise when braking, pulls right.",
      sentAt: new Date(),
      approvalToken: "demo-approval-token-1001",
    },
  });
  const line = (over: Record<string, unknown>) => ({
    tenantId: tenant.id,
    parentType: "ESTIMATE" as const,
    parentId: estimate.id,
    ...over,
  });
  await db.lineItem.createMany({
    data: [
      line({ kind: "PART", name: pads.name, sku: pads.sku, inventoryItemId: pads.id, section: "Front brakes", qty: 1, costCents: 4_200, priceCents: 8_900, sort: 0 }),
      line({ kind: "PART", name: rotor.name, sku: rotor.sku, inventoryItemId: rotor.id, section: "Front brakes", qty: 2, costCents: 3_100, priceCents: 6_800, sort: 1 }),
      line({ kind: "LABOR", name: "R&R front brakes", section: "Front brakes", qty: 1.5, priceCents: 12_500, sort: 2 }),
      line({ kind: "PART", name: "Strut assembly", sku: "ST-7781", section: "Front struts", qty: 2, costCents: 8_800, priceCents: 17_500, sort: 3 }),
      line({ kind: "LABOR", name: "R&R struts", section: "Front struts", qty: 2, priceCents: 12_500, sort: 4 }),
      line({ kind: "FEE", name: "Shop supplies", qty: 1, priceCents: 1_500, taxable: false, sort: 5 }),
    ] as never,
  });

  // Customer approves the brakes, declines the struts.
  await db.lineItem.updateMany({
    where: { parentType: "ESTIMATE", parentId: estimate.id, section: "Front struts" },
    data: { approved: false, declinedAt: new Date() },
  });
  await db.estimate.update({
    where: { id: estimate.id },
    data: { status: "APPROVED", approvedAt: new Date(), approvalSignature: "data:demo", approvalIp: "203.0.113.10" },
  });

  // ------------------------------------------------ RO, work, invoice, pay
  const ro = await estimateToRepairOrder(db, {
    estimateId: estimate.id,
    advisorId: advisor.id,
    technicianId: tech.id,
    promisedAt: new Date(Date.now() + 86_400_000),
  });

  await db.repairOrder.update({ where: { id: ro.id }, data: { status: "IN_PROGRESS", startedAt: new Date() } });
  await db.inventoryItem.update({ where: { id: pads.id }, data: { qtyOnHand: { decrement: 1 } } });
  await db.inventoryItem.update({ where: { id: rotor.id }, data: { qtyOnHand: { decrement: 2 } } });
  await db.inventoryMovement.createMany({
    data: [
      { tenantId: tenant.id, itemId: pads.id, qtyDelta: -1, reason: `RO #${ro.number}`, userId: tech.id },
      { tenantId: tenant.id, itemId: rotor.id, qtyDelta: -2, reason: `RO #${ro.number}`, userId: tech.id },
    ],
  });
  await db.repairOrder.update({ where: { id: ro.id }, data: { status: "COMPLETE", completedAt: new Date() } });

  const invoice = await repairOrderToInvoice(db, { repairOrderId: ro.id, userId: advisor.id });
  await applyPayment(db, { invoiceId: invoice.id, amountCents: 20_000, method: "CASH", userId: advisor.id });
  const paid = await applyPayment(db, {
    invoiceId: invoice.id,
    amountCents: invoice.totalCents - 20_000,
    method: "CARD",
    processor: "wholesale_payments",
    processorRef: "wp_txn_8812",
    brand: "Visa",
    last4: "4242",
    userId: advisor.id,
  });

  await db.message.create({
    data: {
      tenantId: tenant.id,
      customerId: customer.id,
      parentType: "INVOICE",
      parentId: invoice.id,
      channel: "SMS",
      template: "vehicle_ready",
      toAddress: customer.phone!,
      body: `Your ${vehicle.year} ${vehicle.make} ${vehicle.model} is ready. Total ${formatCents(invoice.totalCents)}.`,
      status: "SENT",
      sentAt: new Date(),
    },
  });

  // A second estimate left open so list screens have something to show.
  const open = await db.estimate.create({
    data: {
      tenantId: tenant.id, locationId: location.id, number: 1002,
      customerId: customer.id, vehicleId: vehicle.id, authorId: advisor.id,
      status: "DRAFT", taxRate: location.taxRate, complaint: "Due for state inspection.",
    },
  });
  await db.lineItem.create({
    data: { tenantId: tenant.id, parentType: "ESTIMATE", parentId: open.id, kind: "LABOR", name: "Safety inspection", qty: 1, priceCents: 3_000, sort: 0 },
  });

  console.log(`
Seeded "${tenant.name}" (${location.city}, ${location.state})

  Estimate #${estimate.number}   struts declined by customer
  RO       #${ro.number}   ${formatCents(ro.totalCents)}   tech: ${tech.name}
  Invoice  #${invoice.number}   ${formatCents(invoice.totalCents)}   ${paid.status}, balance ${formatCents(paid.balanceDueCents)}
  Estimate #${open.number}   open, awaiting build

  ${await db.customer.count({ where: { tenantId: tenant.id } })} customer, ${await db.vehicle.count({ where: { tenantId: tenant.id } })} vehicle, ${await db.inventoryItem.count({ where: { tenantId: tenant.id } })} stocked parts

Sign in at /login with password "${DEMO_PASSWORD}":
  coleman@blueduckauto.test   Owner
  priya@blueduckauto.test     Service Advisor
  marco@blueduckauto.test     Technician
`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); });
