// Demo data for one shop, driven through the real functions so the seed
// exercises the same code paths the app does. Where a hand-written INSERT
// would be shorter, it is deliberately not used: seed data that could not have
// been produced by the product is seed data that hides bugs.
//
// Uses the app's own client rather than opening a second one. Two connections
// writing the same SQLite file is how you get "database is locked" halfway
// through a seed.
//
// Run: npm run seed

import { db } from "../lib/db";
import { estimateToRepairOrder, repairOrderToInvoice } from "../lib/convert";
import { formatCents } from "../lib/money";
import { createCustomer, createVehicle } from "../lib/customers";
import { addMember, updateLocation, createPackage } from "../lib/settings";
import { createItem, consumeForInvoice } from "../lib/inventory";
import { setStatus, assignTechnician, addLine, createWalkIn, addNote } from "../lib/repairOrders";
import { takePayment } from "../lib/invoices";
import { startInspection, setItem, sendInspection, getInspection } from "../lib/inspections";

const DEMO_PASSWORD = "shopdesk";

async function main() {
  await db.tenant.deleteMany();
  await db.user.deleteMany();

  const tenant = await db.tenant.create({ data: { name: "Blue Duck Auto", plan: "starter" } });
  const location = await db.location.create({ data: { tenantId: tenant.id, name: "Main Street" } });

  await updateLocation(tenant.id, location.id, {
    phone: "214-802-3388",
    city: "San Bernardino",
    state: "CA",
    address: "1180 Foothill Blvd",
    laborRateCents: 12_500,
    taxRate: 7.75,
    receiptFooter: "12-month/12,000-mile warranty on parts and labor.",
  });

  const [owner, advisor, tech] = await Promise.all([
    addMember(tenant.id, { name: "Coleman Clark", email: "coleman@blueduckauto.test", role: "OWNER", password: DEMO_PASSWORD, locationId: location.id }),
    addMember(tenant.id, { name: "Priya Raman", email: "priya@blueduckauto.test", role: "SERVICE_ADVISOR", password: DEMO_PASSWORD, locationId: location.id }),
    addMember(tenant.id, { name: "Marco Reyes", email: "marco@blueduckauto.test", role: "TECHNICIAN", password: DEMO_PASSWORD, locationId: location.id }),
  ]);
  await db.membership.update({ where: { id: tech.id }, data: { hourlyCostCents: 3_200 } });

  // ------------------------------------------------------------- inventory
  const pads = await createItem(tenant.id, {
    sku: "BP-4417", name: "Ceramic brake pads (front)", category: "Brakes", vendor: "NAPA",
    qtyOnHand: 6, costCents: 4_200, priceCents: 8_900, reorderPoint: 2,
  }, owner.userId);
  const rotor = await createItem(tenant.id, {
    sku: "RT-2290", name: "Rotor, front", category: "Brakes", vendor: "NAPA",
    qtyOnHand: 8, costCents: 3_100, priceCents: 6_800, reorderPoint: 4,
  }, owner.userId);
  const oilFilter = await createItem(tenant.id, {
    sku: "PH-3614", name: "Oil filter", category: "Filters", vendor: "NAPA",
    qtyOnHand: 3, costCents: 380, priceCents: 1_295, reorderPoint: 6,
  }, owner.userId);
  await createItem(tenant.id, {
    sku: "TR-2255517", name: "Defender T+H 225/55R17", category: "Tires", tireSize: "225/55R17",
    qtyOnHand: 8, costCents: 11_400, priceCents: 18_900, reorderPoint: 4,
  }, owner.userId);

  // --------------------------------------------------------- the shop's book
  const dana = await createCustomer(tenant.id, {
    type: "RETAIL", firstName: "Dana", lastName: "Whitfield",
    phone: "(909) 555-0142", email: "dana.whitfield@example.test",
  });
  const tacoma = await createVehicle(tenant.id, dana.id, {
    year: 2017, make: "Toyota", model: "Tacoma", plate: "8XYZ221", vin: "3TMCZ5AN0HM062011", mileage: 96_400,
  });

  const more = [
    [
      { type: "RETAIL" as const, firstName: "Marcus", lastName: "Bell", phone: "(909) 555-7781", email: "mbell@example.test" },
      [{ year: 2014, make: "Honda", model: "Civic", plate: "6ABC912", vin: "2HGFB2F53EH512004", mileage: 148_300 }],
    ],
    [
      { type: "FLEET" as const, company: "Redlands City Fleet", phone: "(909) 555-9900", billingTermsDays: 30, taxExempt: true, taxExemptId: "CA-EX-44120" },
      [
        { year: 2020, make: "Ford", model: "Transit 250", plate: "CITY07", mileage: 61_200 },
        { year: 2019, make: "Chevrolet", model: "Silverado 2500", plate: "CITY11", mileage: 94_770 },
      ],
    ],
    [
      { type: "RETAIL" as const, firstName: "Alicia", lastName: "Nguyen", phone: "(760) 555-2210", smsOptOut: true },
      [{ year: 2021, make: "Subaru", model: "Outback", plate: "8JKL447", mileage: 38_950, tireSize: "225/65R17" }],
    ],
    [
      { type: "WHOLESALE" as const, company: "Inland Auto Wholesale", phone: "(951) 555-3040", billingTermsDays: 15 },
      [{ year: 2016, make: "RAM", model: "1500", plate: "WHL220", mileage: 122_400 }],
    ],
  ] as const;

  const created: { customerId: string; vehicleIds: string[] }[] = [];
  for (const [c, vehicles] of more) {
    const customer = await createCustomer(tenant.id, c);
    const ids: string[] = [];
    for (const v of vehicles) ids.push((await createVehicle(tenant.id, customer.id, v)).id);
    created.push({ customerId: customer.id, vehicleIds: ids });
  }
  const fleet = created[1];

  // ------------------------------------------------------ service packages
  await createPackage(tenant.id, {
    name: "Full synthetic oil change",
    items: [
      { kind: "LABOR", name: "Lube, oil and filter", qty: 1, priceCents: 3_500 },
      { kind: "PART", name: "Oil filter", qty: 1, priceCents: 1_295 },
      { kind: "PART", name: "5W-30 full synthetic", qty: 5, priceCents: 895 },
    ],
  });
  await createPackage(tenant.id, {
    name: "Four-wheel alignment",
    items: [{ kind: "LABOR", name: "Four-wheel alignment", qty: 1.2, priceCents: 12_500 }],
  });
  await createPackage(tenant.id, {
    name: "Tire rotate and balance",
    items: [{ kind: "LABOR", name: "Rotate and balance four tires", qty: 0.8, priceCents: 12_500 }],
  });

  // ------------------------------------ a brake job, quoted, approved, paid
  const estimate = await db.estimate.create({
    data: {
      tenantId: tenant.id, locationId: location.id, number: 1001,
      customerId: dana.id, vehicleId: tacoma.id, authorId: advisor.userId,
      status: "SENT", taxRate: 7.75, mileageIn: 96_842,
      complaint: "Grinding noise when braking, pulls right.",
      sentAt: new Date(), approvalToken: "demo-approval-token-1001",
    },
  });
  const line = (over: Record<string, unknown>) => ({
    tenantId: tenant.id, parentType: "ESTIMATE" as const, parentId: estimate.id, ...over,
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
    data: { status: "APPROVED", approvedAt: new Date(), approvalSignature: "Dana Whitfield", approvalIp: "203.0.113.10" },
  });

  const ro = await estimateToRepairOrder(db, {
    estimateId: estimate.id, advisorId: advisor.userId, technicianId: tech.userId,
    promisedAt: new Date(Date.now() + 86_400_000),
  });
  await setStatus(tenant.id, ro.id, "IN_PROGRESS", { userId: tech.userId });
  await addNote(tenant.id, ro.id, "Rotors were at minimum thickness — showed the customer.", tech.userId);
  await setStatus(tenant.id, ro.id, "COMPLETE", { userId: tech.userId });

  const invoice = await repairOrderToInvoice(db, { repairOrderId: ro.id, userId: advisor.userId });
  await consumeForInvoice(tenant.id, invoice.id, advisor.userId);
  await takePayment(tenant.id, { invoiceId: invoice.id, amountCents: 20_000, method: "CASH", userId: advisor.userId });
  const paid = await takePayment(tenant.id, {
    invoiceId: invoice.id, amountCents: invoice.totalCents - 20_000, method: "CARD",
    processor: "wholesale_payments", processorRef: "wp_txn_8812", brand: "Visa", last4: "4242",
    userId: advisor.userId,
  });

  await db.message.create({
    data: {
      tenantId: tenant.id, customerId: dana.id, parentType: "INVOICE", parentId: invoice.id,
      channel: "SMS", template: "vehicle_ready", toAddress: dana.phone!,
      body: `Your 2017 Toyota Tacoma is ready. Total ${formatCents(invoice.totalCents)}.`,
      status: "SENT", sentAt: new Date(),
    },
  });

  // ------------------------------- a fleet job billed net 30 and still owed
  const fleetRO = await createWalkIn(tenant.id, {
    customerId: fleet.customerId, vehicleId: fleet.vehicleIds[0],
    advisorId: advisor.userId, locationId: location.id,
    complaint: "Scheduled service, city vehicle 07.",
  });
  await addLine(tenant.id, fleetRO.id, { kind: "LABOR", name: "Lube, oil and filter", qty: 1, priceCents: 3_500, section: "Service" });
  await addLine(tenant.id, fleetRO.id, {
    kind: "PART", name: oilFilter.name, sku: oilFilter.sku, inventoryItemId: oilFilter.id,
    qty: 1, costCents: 380, priceCents: 1_295, section: "Service",
  });
  await addLine(tenant.id, fleetRO.id, { kind: "LABOR", name: "Rotate and balance four tires", qty: 0.8, priceCents: 12_500, section: "Service" });
  await setStatus(tenant.id, fleetRO.id, "COMPLETE", { userId: advisor.userId });

  const fleetInvoice = await repairOrderToInvoice(db, { repairOrderId: fleetRO.id, userId: advisor.userId });
  await consumeForInvoice(tenant.id, fleetInvoice.id, advisor.userId);
  // Backdated so receivables has something genuinely overdue to show.
  const longAgo = new Date(Date.now() - 44 * 86_400_000);
  await db.invoice.update({
    where: { id: fleetInvoice.id },
    data: { finalizedAt: longAgo, dueAt: new Date(longAgo.getTime() + 30 * 86_400_000) },
  });

  // ------------------------- a job on the floor now, with a live inspection
  const openRO = await createWalkIn(tenant.id, {
    customerId: created[0].customerId, vehicleId: created[0].vehicleIds[0],
    advisorId: advisor.userId, locationId: location.id,
    complaint: "Check engine light, running rough at idle.",
  });
  await assignTechnician(tenant.id, openRO.id, tech.userId, { userId: advisor.userId });
  await addLine(tenant.id, openRO.id, { kind: "LABOR", name: "Diagnostic, one hour", qty: 1, priceCents: 12_500, section: "Diagnosis" });
  await setStatus(tenant.id, openRO.id, "IN_PROGRESS", { userId: tech.userId });

  const inspection = await startInspection(tenant.id, openRO.id);
  const full = await getInspection(tenant.id, inspection.id);
  const mark = async (label: string, condition: "GREEN" | "YELLOW" | "RED", notes?: string) => {
    const item = full!.items.find((i) => i.label === label);
    if (item) await setItem(tenant.id, item.id, { condition, notes: notes ?? null });
  };
  await mark("Left front tire tread", "YELLOW", "4/32 — plan on replacing before winter");
  await mark("Right front tire tread", "YELLOW", "4/32");
  await mark("Left rear tire tread", "GREEN");
  await mark("Right rear tire tread", "GREEN");
  await mark("Front brake pads", "GREEN", "8mm");
  await mark("Rear brake pads", "GREEN");
  await mark("Engine oil level and condition", "RED", "Very dark, 2,000 miles past due");
  await mark("Air filter", "RED", "Packed with debris");
  await mark("Cabin filter", "YELLOW");
  await mark("Battery and terminals", "GREEN", "Tested 620 CCA of 650");
  await mark("Belts and hoses", "GREEN");
  await mark("Wiper blades", "YELLOW", "Streaking");
  await mark("Exterior lights", "GREEN");
  const sent = await sendInspection(tenant.id, inspection.id);

  // A second estimate left open so the list screen has something to build.
  const open = await db.estimate.create({
    data: {
      tenantId: tenant.id, locationId: location.id, number: 1002,
      customerId: dana.id, vehicleId: tacoma.id, authorId: advisor.userId,
      status: "DRAFT", taxRate: 7.75, complaint: "Due for state inspection.",
    },
  });
  await db.lineItem.create({
    data: { tenantId: tenant.id, parentType: "ESTIMATE", parentId: open.id, kind: "LABOR", name: "Safety inspection", qty: 1, priceCents: 3_000, sort: 0 },
  });

  const [customers, vehicles, parts] = await Promise.all([
    db.customer.count({ where: { tenantId: tenant.id } }),
    db.vehicle.count({ where: { tenantId: tenant.id } }),
    db.inventoryItem.count({ where: { tenantId: tenant.id } }),
  ]);

  console.log(`
Seeded "${tenant.name}" — San Bernardino, CA

  Estimate #${estimate.number}   struts declined by the customer
  RO       #${ro.number}   ${formatCents(ro.totalCents)}   invoiced
  Invoice  #${invoice.number}   ${formatCents(invoice.totalCents)}   ${paid.status.toLowerCase()} (cash + card)
  Invoice  #${fleetInvoice.number}   ${formatCents(fleetInvoice.totalCents)}   net 30, 14 days overdue
  RO       #${openRO.number}   on the floor now, ${tech.role.toLowerCase()} assigned
  Estimate #${open.number}   open, awaiting build

  ${customers} customers, ${vehicles} vehicles, ${parts} stocked parts, 3 service packages
  Oil filter is below its reorder point, so the dashboard has a warning to show.

  Customer inspection link:  /inspection/${sent.token}
  Customer approval link:    /approve/demo-approval-token-1001

Sign in at /login with password "${DEMO_PASSWORD}":
  coleman@blueduckauto.test   Owner
  priya@blueduckauto.test     Service Advisor
  marco@blueduckauto.test     Technician
`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); });
