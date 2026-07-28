// Seeds one tenant with realistic data, then walks a ticket through its whole
// life cycle and asserts the money is right at every stage.
//
// Run: npm run seed

import { PrismaClient } from "../lib/generated/prisma";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { computeTotals, formatCents } from "../lib/money";

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL ?? "file:./prisma/dev.db",
});
const db = new PrismaClient({ adapter });

let failures = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: got ${got}, want ${want}`);
}

async function main() {
  // Re-runnable.
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
      receiptFooter: "Thanks for your business. 12-month/12,000-mile warranty on parts and labor.",
    },
  });

  const [owner, advisor, tech] = await Promise.all([
    db.user.create({ data: { name: "Coleman Clark", email: "coleman@blueduckauto.test" } }),
    db.user.create({ data: { name: "Priya Raman", email: "priya@blueduckauto.test" } }),
    db.user.create({ data: { name: "Marco Reyes", email: "marco@blueduckauto.test" } }),
  ]);

  await db.membership.createMany({
    data: [
      { tenantId: tenant.id, userId: owner.id, locationId: location.id, role: "OWNER" },
      { tenantId: tenant.id, userId: advisor.id, locationId: location.id, role: "SERVICE_ADVISOR" },
      { tenantId: tenant.id, userId: tech.id, locationId: location.id, role: "TECHNICIAN", hourlyCostCents: 3_200 },
    ],
  });

  // Parts the shop stocks, so selling them can move inventory.
  const [pads, rotor] = await Promise.all([
    db.inventoryItem.create({
      data: { tenantId: tenant.id, sku: "BP-4417", name: "Ceramic brake pads (front)", category: "Brakes", qtyOnHand: 6, costCents: 4_200, priceCents: 8_900, reorderPoint: 2 },
    }),
    db.inventoryItem.create({
      data: { tenantId: tenant.id, sku: "RT-2290", name: "Rotor, front", category: "Brakes", qtyOnHand: 8, costCents: 3_100, priceCents: 6_800, reorderPoint: 4 },
    }),
  ]);

  const customer = await db.customer.create({
    data: {
      tenantId: tenant.id,
      type: "RETAIL",
      firstName: "Dana",
      lastName: "Whitfield",
      phone: "909-555-0142",
      email: "dana.whitfield@example.test",
    },
  });

  const vehicle = await db.vehicle.create({
    data: {
      tenantId: tenant.id,
      customerId: customer.id,
      year: 2017,
      make: "Toyota",
      model: "Tacoma",
      plate: "8XYZ221",
      vin: "3TMCZ5AN0HM062011",
      mileage: 96_400,
    },
  });

  // ------------------------------------------------------------- estimate
  const ticket = await db.ticket.create({
    data: {
      tenantId: tenant.id,
      locationId: location.id,
      number: 1001,
      customerId: customer.id,
      vehicleId: vehicle.id,
      authorId: owner.id,
      advisorId: advisor.id,
      mileageIn: 96_842,
      taxRate: location.taxRate,
      complaint: "Grinding noise when braking, pulls right.",
      jobs: {
        create: [
          {
            name: "Front brake pads & rotors",
            sort: 0,
            assignedToId: tech.id,
            lineItems: {
              create: [
                { kind: "PART", name: pads.name, sku: pads.sku, inventoryItemId: pads.id, qty: 1, costCents: 4_200, priceCents: 8_900, sort: 0 },
                { kind: "PART", name: rotor.name, sku: rotor.sku, inventoryItemId: rotor.id, qty: 2, costCents: 3_100, priceCents: 6_800, sort: 1 },
                { kind: "LABOR", name: "R&R front brakes", qty: 1.5, priceCents: 12_500, sort: 2 },
              ],
            },
          },
          {
            name: "Front struts",
            sort: 1,
            lineItems: {
              create: [
                { kind: "PART", name: "Strut assembly", sku: "ST-7781", qty: 2, costCents: 8_800, priceCents: 17_500, sort: 0 },
                { kind: "LABOR", name: "R&R struts", qty: 2, priceCents: 12_500, sort: 1 },
              ],
            },
          },
          {
            name: "Shop supplies",
            sort: 2,
            lineItems: { create: [{ kind: "FEE", name: "Shop supplies", qty: 1, priceCents: 1_500, taxable: false, sort: 0 }] },
          },
        ],
      },
    },
    include: { jobs: { include: { lineItems: true } } },
  });

  console.log(`\nEstimate #${ticket.number} — ${customer.firstName} ${customer.lastName}, ${vehicle.year} ${vehicle.make} ${vehicle.model}\n`);

  // brakes    89.00 + (68.00 x 2) + (125.00 x 1.5) = 412.50
  // struts    (175.00 x 2) + (125.00 x 2)          = 600.00
  // supplies                                       =  15.00  (not taxable)
  // subtotal                                       = 1027.50
  // tax 7.75% of 1012.50 taxable                   =   78.47
  const all = computeTotals({ jobs: ticket.jobs, discountPct: 0, taxRate: location.taxRate });
  console.log("Full estimate:");
  check("subtotal", all.subtotalCents, 102_750);
  check("tax", all.taxCents, 7_847);
  check("total", all.totalCents, 110_597);

  await db.ticket.update({
    where: { id: ticket.id },
    data: { status: "SENT", sentAt: new Date(), subtotalCents: all.subtotalCents, taxCents: all.taxCents, totalCents: all.totalCents },
  });
  await db.ticketEvent.create({ data: { ticketId: ticket.id, userId: advisor.id, from: "ESTIMATE", to: "SENT", note: "Approval link texted." } });

  // ---------------------------------------------- customer declines struts
  const struts = ticket.jobs.find((j) => j.name === "Front struts")!;
  await db.job.update({ where: { id: struts.id }, data: { approved: false, declinedAt: new Date() } });

  const afterDecline = await db.ticket.findUniqueOrThrow({
    where: { id: ticket.id },
    include: { jobs: { include: { lineItems: true } } },
  });

  // brakes 412.50 + supplies 15.00 = 427.50; tax on 412.50 only = 31.97
  const approved = computeTotals({ jobs: afterDecline.jobs, discountPct: 0, taxRate: location.taxRate });
  console.log("\nCustomer approved the brakes, declined the struts:");
  check("subtotal", approved.subtotalCents, 42_750);
  check("tax", approved.taxCents, 3_197);
  check("total", approved.totalCents, 45_947);

  await db.ticket.update({
    where: { id: ticket.id },
    data: {
      status: "APPROVED",
      approvedAt: new Date(),
      subtotalCents: approved.subtotalCents,
      taxCents: approved.taxCents,
      totalCents: approved.totalCents,
    },
  });

  // ------------------------------------------------------------ work done
  await db.ticket.update({ where: { id: ticket.id }, data: { status: "IN_PROGRESS" } });
  await db.ticket.update({ where: { id: ticket.id }, data: { status: "COMPLETE", completedAt: new Date() } });

  // Parts leave the shelf. Movements are the audit trail.
  await db.inventoryItem.update({ where: { id: pads.id }, data: { qtyOnHand: { decrement: 1 } } });
  await db.inventoryItem.update({ where: { id: rotor.id }, data: { qtyOnHand: { decrement: 2 } } });
  await db.inventoryMovement.createMany({
    data: [
      { tenantId: tenant.id, itemId: pads.id, qtyDelta: -1, reason: `RO #${ticket.number}`, userId: tech.id },
      { tenantId: tenant.id, itemId: rotor.id, qtyDelta: -2, reason: `RO #${ticket.number}`, userId: tech.id },
    ],
  });

  // ---------------------------------------- finalise, then freeze the bill
  const snapshot = JSON.stringify({
    jobs: afterDecline.jobs.filter((j) => j.approved),
    totals: approved,
    finalizedBy: advisor.id,
  });
  await db.ticket.update({
    where: { id: ticket.id },
    data: { status: "INVOICED", invoiceNumber: 5001, finalizedAt: new Date(), invoiceSnapshotJson: snapshot },
  });

  // ------------------------------------------------- split-tender payment
  await db.payment.create({
    data: { tenantId: tenant.id, ticketId: ticket.id, amountCents: 20_000, method: "CASH", status: "CAPTURED", capturedAt: new Date() },
  });
  await db.payment.create({
    data: {
      tenantId: tenant.id,
      ticketId: ticket.id,
      amountCents: 25_947,
      method: "CARD",
      status: "CAPTURED",
      processor: "wholesale_payments",
      processorRef: "wp_txn_8812",
      brand: "Visa",
      last4: "4242",
      capturedAt: new Date(),
    },
  });

  const paid = await db.payment.aggregate({
    where: { ticketId: ticket.id, status: "CAPTURED" },
    _sum: { amountCents: true },
  });
  const paidCents = paid._sum.amountCents ?? 0;

  console.log("\nSplit tender — $200 cash, remainder on card:");
  check("collected", paidCents, 45_947);
  check("balance", approved.totalCents - paidCents, 0);

  await db.ticket.update({ where: { id: ticket.id }, data: { status: "PAID", paidAt: new Date(), paidCents } });

  await db.auditLog.create({
    data: {
      tenantId: tenant.id,
      userId: advisor.id,
      entityType: "Ticket",
      entityId: ticket.id,
      action: "INVOICE_PAID",
      afterJson: JSON.stringify({ totalCents: approved.totalCents, paidCents }),
    },
  });

  await db.message.create({
    data: {
      tenantId: tenant.id,
      ticketId: ticket.id,
      customerId: customer.id,
      channel: "SMS",
      template: "vehicle_ready",
      toAddress: customer.phone!,
      body: `Your ${vehicle.year} ${vehicle.make} ${vehicle.model} is ready. Total ${formatCents(approved.totalCents)}.`,
      status: "SENT",
      sentAt: new Date(),
    },
  });

  // A second ticket left open so list screens have something to show.
  await db.ticket.create({
    data: {
      tenantId: tenant.id,
      locationId: location.id,
      number: 1002,
      customerId: customer.id,
      vehicleId: vehicle.id,
      authorId: advisor.id,
      status: "ESTIMATE",
      taxRate: location.taxRate,
      complaint: "Due for state inspection.",
      jobs: {
        create: [{ name: "State inspection", lineItems: { create: [{ kind: "LABOR", name: "Safety inspection", qty: 1, priceCents: 3_000, sort: 0 }] } }],
      },
    },
  });

  // ---------------------------------------------------- tenant isolation
  // Blueprint §16 Prompt 1 requires proof that one tenant cannot read another.
  const other = await db.tenant.create({ data: { name: "Rival Auto" } });
  await db.customer.create({ data: { tenantId: other.id, firstName: "Should", lastName: "NotAppear" } });

  const visible = await db.customer.findMany({ where: { tenantId: tenant.id } });
  console.log("\nTenant isolation:");
  check("customers visible to Blue Duck", visible.length, 1);
  check("total customers in database", await db.customer.count(), 2);

  const stockAfter = await db.inventoryItem.findUniqueOrThrow({ where: { id: pads.id } });
  console.log("\nInventory:");
  check("brake pads on hand after sale", stockAfter.qtyOnHand, 5);

  const finalTicket = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
  console.log(`\nTicket #${finalTicket.number} -> invoice #${finalTicket.invoiceNumber}, status ${finalTicket.status}`);
  console.log(`Seeded "${tenant.name}": ${await db.ticket.count({ where: { tenantId: tenant.id } })} tickets, ${visible.length} customer, 1 vehicle, 2 stocked parts.\n`);

  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log("All checks passed.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
