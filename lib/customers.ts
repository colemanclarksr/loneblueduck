// Customer and vehicle data access.
//
// Every read and write takes a tenantId and filters on it. Nothing here accepts
// a bare record id, because a route parameter is attacker-controlled: looking a
// customer up by id alone would let anyone with a valid session read another
// shop's book by guessing or reusing an id.

import { db } from "@/lib/db";
import type { CustomerType, Prisma } from "@/lib/generated/prisma";

export type CustomerInput = {
  type: CustomerType;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  billingTermsDays?: number | null;
  taxExempt?: boolean;
  taxExemptId?: string | null;
  smsOptOut?: boolean;
  emailOptOut?: boolean;
  notes?: string | null;
};

export type VehicleInput = {
  vin?: string | null;
  plate?: string | null;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  engine?: string | null;
  color?: string | null;
  tireSize?: string | null;
  mileage?: number | null;
  warrantyNotes?: string | null;
  notes?: string | null;
};

export const digitsOnly = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "") || null;
const trim = (s: string | null | undefined) => {
  const v = (s ?? "").trim();
  return v === "" ? null : v;
};
const upper = (s: string | null | undefined) => trim(s)?.toUpperCase() ?? null;

/** Name as the counter says it: the company for a fleet, the person otherwise. */
export function displayName(c: { type: CustomerType; firstName: string | null; lastName: string | null; company: string | null }): string {
  if (c.type !== "RETAIL" && c.company) return c.company;
  const person = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  return person || c.company || "(no name)";
}

export function describeVehicle(v: { year: number | null; make: string | null; model: string | null; trim: string | null }): string {
  const s = [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ").trim();
  return s || "Vehicle";
}

export class ValidationError extends Error {
  constructor(public readonly field: string, message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export function validateCustomer(input: CustomerInput) {
  const first = trim(input.firstName);
  const last = trim(input.lastName);
  const company = trim(input.company);

  // A record with no name at all is unusable at the counter and impossible to
  // search for, so it is refused rather than silently created.
  if (!first && !last && !company) {
    throw new ValidationError("name", "Enter a first or last name, or a company name.");
  }
  if (input.type !== "RETAIL" && !company) {
    throw new ValidationError("company", "Fleet and wholesale accounts need a company name.");
  }

  const email = trim(input.email);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new ValidationError("email", "That email address does not look right.");
  }

  const phone = trim(input.phone);
  const phoneDigits = digitsOnly(phone);
  if (phone && (phoneDigits?.length ?? 0) < 10) {
    throw new ValidationError("phone", "A phone number needs at least 10 digits.");
  }

  if (input.billingTermsDays != null && (input.billingTermsDays < 0 || input.billingTermsDays > 365)) {
    throw new ValidationError("billingTermsDays", "Terms must be between 0 and 365 days.");
  }

  return {
    type: input.type,
    firstName: first,
    lastName: last,
    company,
    phone,
    phoneDigits,
    email,
    address: trim(input.address),
    city: trim(input.city),
    state: trim(input.state),
    zip: trim(input.zip),
    billingTermsDays: input.billingTermsDays ?? null,
    taxExempt: input.taxExempt ?? false,
    taxExemptId: trim(input.taxExemptId),
    smsOptOut: input.smsOptOut ?? false,
    emailOptOut: input.emailOptOut ?? false,
    notes: trim(input.notes),
  };
}

export function validateVehicle(input: VehicleInput) {
  const vin = upper(input.vin);
  // 17 characters since 1981, and I, O and Q are never used precisely so they
  // cannot be confused with 1 and 0.
  if (vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
    throw new ValidationError("vin", "A VIN is 17 characters and never contains I, O or Q.");
  }

  const year = input.year ?? null;
  if (year != null && (year < 1900 || year > new Date().getFullYear() + 2)) {
    throw new ValidationError("year", "Enter a realistic model year.");
  }

  const mileage = input.mileage ?? null;
  if (mileage != null && (mileage < 0 || mileage > 2_000_000)) {
    throw new ValidationError("mileage", "Enter a realistic mileage.");
  }

  if (!vin && !trim(input.plate) && !trim(input.make) && !trim(input.model)) {
    throw new ValidationError("identity", "Enter at least a plate, VIN, make or model.");
  }

  return {
    vin,
    plate: upper(input.plate),
    year,
    make: trim(input.make),
    model: trim(input.model),
    trim: trim(input.trim),
    engine: trim(input.engine),
    color: trim(input.color),
    tireSize: trim(input.tireSize),
    mileage,
    warrantyNotes: trim(input.warrantyNotes),
    notes: trim(input.notes),
  };
}

// ------------------------------------------------------------------ reads

/**
 * Search by name, phone, VIN or plate, per §16 Prompt 2.
 *
 * A phone query is matched on digits so formatting never matters, and a plate
 * or VIN query is matched uppercased for the same reason. A blank query lists
 * everyone, which is what an empty search box should do.
 */
export async function searchCustomers(tenantId: string, query: string, take = 50) {
  const q = query.trim();
  const where: Prisma.CustomerWhereInput = { tenantId };

  if (q) {
    const digits = digitsOnly(q);
    const or: Prisma.CustomerWhereInput[] = [
      { firstName: { contains: q } },
      { lastName: { contains: q } },
      { company: { contains: q } },
      { email: { contains: q } },
      { vehicles: { some: { plate: { contains: q.toUpperCase() } } } },
      { vehicles: { some: { vin: { contains: q.toUpperCase() } } } },
    ];
    // Only treat it as a phone search when the query actually has digits,
    // otherwise every text search also scans phone numbers for nothing.
    if (digits && digits.length >= 3) or.push({ phoneDigits: { contains: digits } });
    where.OR = or;
  }

  return db.customer.findMany({
    where,
    take,
    orderBy: [{ lastName: "asc" }, { company: "asc" }, { createdAt: "desc" }],
    include: {
      vehicles: { orderBy: { createdAt: "asc" } },
      _count: { select: { repairOrders: true, estimates: true } },
    },
  });
}

/** Null rather than a throw when the id belongs to another tenant, so the
 *  route can render a plain 404 and reveal nothing about what exists. */
export async function getCustomer(tenantId: string, id: string) {
  return db.customer.findFirst({
    where: { id, tenantId },
    include: {
      vehicles: { orderBy: { createdAt: "asc" } },
    },
  });
}

export async function getVehicle(tenantId: string, id: string) {
  return db.vehicle.findFirst({ where: { id, tenantId }, include: { customer: true } });
}

/** Service history for a vehicle: every repair order, newest first. §7. */
export async function vehicleHistory(tenantId: string, vehicleId: string) {
  return db.repairOrder.findMany({
    where: { tenantId, vehicleId },
    orderBy: { createdAt: "desc" },
    include: { invoices: { select: { id: true, number: true, status: true, totalCents: true } } },
    take: 100,
  });
}

// ----------------------------------------------------------------- writes

export async function createCustomer(tenantId: string, input: CustomerInput) {
  return db.customer.create({ data: { tenantId, ...validateCustomer(input) } });
}

export async function updateCustomer(tenantId: string, id: string, input: CustomerInput) {
  // updateMany scopes the write by tenant; a plain update would accept an id
  // from any shop.
  const { count } = await db.customer.updateMany({
    where: { id, tenantId },
    data: validateCustomer(input),
  });
  if (count === 0) throw new ValidationError("id", "That customer no longer exists.");
  return db.customer.findFirstOrThrow({ where: { id, tenantId } });
}

export async function createVehicle(tenantId: string, customerId: string, input: VehicleInput) {
  const owner = await db.customer.findFirst({ where: { id: customerId, tenantId }, select: { id: true } });
  if (!owner) throw new ValidationError("customerId", "That customer no longer exists.");
  return db.vehicle.create({ data: { tenantId, customerId, ...validateVehicle(input) } });
}

export async function updateVehicle(tenantId: string, id: string, input: VehicleInput) {
  const { count } = await db.vehicle.updateMany({
    where: { id, tenantId },
    data: validateVehicle(input),
  });
  if (count === 0) throw new ValidationError("id", "That vehicle no longer exists.");
  return db.vehicle.findFirstOrThrow({ where: { id, tenantId } });
}

/** Refuses to delete a customer with any history, which is the difference
 *  between removing a mistyped record and erasing a paid invoice. */
export async function deleteCustomer(tenantId: string, id: string) {
  const counts = await db.customer.findFirst({
    where: { id, tenantId },
    select: { _count: { select: { estimates: true, repairOrders: true, invoices: true } } },
  });
  if (!counts) throw new ValidationError("id", "That customer no longer exists.");

  const { estimates, repairOrders, invoices } = counts._count;
  if (estimates + repairOrders + invoices > 0) {
    throw new ValidationError(
      "id",
      `This customer has ${estimates} estimate(s), ${repairOrders} repair order(s) and ${invoices} invoice(s). ` +
        `Records with history cannot be deleted.`,
    );
  }
  await db.customer.deleteMany({ where: { id, tenantId } });
}
