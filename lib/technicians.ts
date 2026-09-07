// Technicians and their time on a ticket.
//
// Shops manage techs on one number: efficiency, billed hours over actual hours.
// Sell three hours of brake work, finish it in two, and the shop earned three
// hours of labour for two hours of wages. Below 1.0 the shop is losing money on
// labour no matter what the invoice says, and no other report will tell you.
//
// Two rules make the number trustworthy:
//
//   1. Time accumulates. A tech gets pulled onto a comeback and returns an hour
//      later, so one job is worked in bursts. Every clock-off adds to the
//      running total instead of replacing it.
//   2. A tech is on one job at a time. Clocking onto a second ticket without
//      leaving the first would bill the same minutes twice, which flatters
//      efficiency exactly when the shop most needs the truth.

import { db } from "@/lib/db";

export class TechnicianError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TechnicianError";
  }
}

// ------------------------------------------------------------------ reads

export async function listTechnicians(
  tenantId: string,
  opts: { includeInactive?: boolean } = {},
) {
  return db.technician.findMany({
    where: { tenantId, ...(opts.includeInactive ? {} : { active: true }) },
    orderBy: [{ name: "asc" }],
  });
}

export async function getTechnician(tenantId: string, id: string) {
  return db.technician.findFirst({ where: { id, tenantId } });
}

/** The job a tech is clocked onto right now, or null if they are not on one. */
export async function openJobFor(tenantId: string, technicianId: string) {
  return db.technicianJob.findFirst({
    where: { tenantId, technicianId, startedAt: { not: null } },
  });
}

export async function jobsForOrder(tenantId: string, repairOrderId: string) {
  return db.technicianJob.findMany({
    where: { tenantId, repairOrderId },
    orderBy: [{ createdAt: "asc" }],
    include: { technician: { select: { id: true, name: true } } },
  });
}

// ------------------------------------------------------------------ roster

export type TechnicianInput = {
  name: string;
  phone?: string | null;
  email?: string | null;
  hourlyCostCents?: number;
  locationId?: string | null;
  userId?: string | null;
};

export async function createTechnician(tenantId: string, input: TechnicianInput) {
  const name = input.name.trim();
  if (!name) throw new TechnicianError("A technician needs a name.");
  if ((input.hourlyCostCents ?? 0) < 0) {
    throw new TechnicianError("Hourly cost cannot be negative.");
  }

  return db.technician.create({
    data: {
      tenantId,
      name,
      phone: input.phone ?? null,
      email: input.email ?? null,
      hourlyCostCents: input.hourlyCostCents ?? 0,
      locationId: input.locationId ?? null,
      userId: input.userId ?? null,
    },
  });
}

export async function updateTechnician(
  tenantId: string,
  id: string,
  input: Partial<TechnicianInput>,
) {
  const existing = await getTechnician(tenantId, id);
  if (!existing) throw new TechnicianError("No such technician in this shop.");
  if (input.hourlyCostCents !== undefined && input.hourlyCostCents < 0) {
    throw new TechnicianError("Hourly cost cannot be negative.");
  }

  return db.technician.update({
    where: { id: existing.id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.hourlyCostCents !== undefined
        ? { hourlyCostCents: input.hourlyCostCents }
        : {}),
      ...(input.locationId !== undefined ? { locationId: input.locationId } : {}),
      ...(input.userId !== undefined ? { userId: input.userId } : {}),
    },
  });
}

/** Soft, always. Past jobs point at this row and history has to stay readable. */
export async function deactivateTechnician(tenantId: string, id: string) {
  const existing = await getTechnician(tenantId, id);
  if (!existing) throw new TechnicianError("No such technician in this shop.");

  const open = await openJobFor(tenantId, id);
  if (open) {
    throw new TechnicianError(
      `${existing.name} is still clocked onto a job. Clock them off first.`,
    );
  }

  return db.technician.update({ where: { id: existing.id }, data: { active: false } });
}

// ------------------------------------------------------------------- clock

const MS_PER_MINUTE = 60_000;

export type ClockOnInput = {
  repairOrderId: string;
  technicianId: string;
  /** The labour line this time is against. Null books it to the whole ticket. */
  lineItemId?: string | null;
  /** Hours sold, from the labour line. Only applied when the job is created. */
  billedHours?: number;
};

/**
 * Starts the clock, resuming the existing job when this tech has already worked
 * this line before. Resuming rather than inserting is what keeps actual time
 * accumulating across the day instead of fragmenting into rows that each look
 * like a short, efficient job.
 */
export async function clockOn(tenantId: string, input: ClockOnInput, at = new Date()) {
  const tech = await getTechnician(tenantId, input.technicianId);
  if (!tech) throw new TechnicianError("No such technician in this shop.");
  if (!tech.active) throw new TechnicianError(`${tech.name} is not active.`);

  const ro = await db.repairOrder.findFirst({
    where: { id: input.repairOrderId, tenantId },
    select: { id: true, number: true },
  });
  if (!ro) throw new TechnicianError("No such repair order in this shop.");

  const open = await openJobFor(tenantId, input.technicianId);
  if (open) {
    const onThis = open.repairOrderId === input.repairOrderId;
    throw new TechnicianError(
      onThis
        ? `${tech.name} is already clocked onto this repair order.`
        : `${tech.name} is clocked onto another repair order. Clock them off first.`,
    );
  }

  const lineItemId = input.lineItemId ?? null;
  const existing = await db.technicianJob.findFirst({
    where: {
      tenantId,
      repairOrderId: input.repairOrderId,
      technicianId: input.technicianId,
      lineItemId,
    },
  });

  if (existing) {
    return db.technicianJob.update({
      where: { id: existing.id },
      data: { startedAt: at },
    });
  }

  return db.technicianJob.create({
    data: {
      tenantId,
      repairOrderId: input.repairOrderId,
      technicianId: input.technicianId,
      lineItemId,
      startedAt: at,
      billedHours: input.billedHours ?? 0,
    },
  });
}

/** Stops the clock and banks the elapsed minutes. */
export async function clockOff(tenantId: string, jobId: string, at = new Date()) {
  const job = await db.technicianJob.findFirst({ where: { id: jobId, tenantId } });
  if (!job) throw new TechnicianError("No such job in this shop.");
  if (!job.startedAt) throw new TechnicianError("That job's clock is not running.");

  const elapsedMs = at.getTime() - job.startedAt.getTime();
  if (elapsedMs < 0) {
    throw new TechnicianError("Clock-off time is before clock-on time.");
  }

  return db.technicianJob.update({
    where: { id: job.id },
    data: {
      startedAt: null,
      stoppedAt: at,
      actualMinutes: job.actualMinutes + Math.round(elapsedMs / MS_PER_MINUTE),
    },
  });
}

/** Hours sold on this job, set when the labour line is priced. */
export async function setBilledHours(tenantId: string, jobId: string, hours: number) {
  if (hours < 0) throw new TechnicianError("Billed hours cannot be negative.");
  const job = await db.technicianJob.findFirst({ where: { id: jobId, tenantId } });
  if (!job) throw new TechnicianError("No such job in this shop.");

  return db.technicianJob.update({ where: { id: job.id }, data: { billedHours: hours } });
}

// -------------------------------------------------------------- reporting

export type Efficiency = {
  billedHours: number;
  actualHours: number;
  /** billed / actual. Null when no time has been clocked -- not zero, which
   *  would read as "terrible" rather than "unknown". */
  ratio: number | null;
};

function ratioOf(billedHours: number, actualMinutes: number): Efficiency {
  const actualHours = actualMinutes / 60;
  return {
    billedHours: round2(billedHours),
    actualHours: round2(actualHours),
    ratio: actualMinutes === 0 ? null : round2(billedHours / actualHours),
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Efficiency across a date range, for one tech or the whole shop. */
export async function efficiencyFor(
  tenantId: string,
  opts: { technicianId?: string; from?: Date; to?: Date } = {},
): Promise<Efficiency> {
  const jobs = await db.technicianJob.findMany({
    where: {
      tenantId,
      ...(opts.technicianId ? { technicianId: opts.technicianId } : {}),
      ...(opts.from || opts.to
        ? { createdAt: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } }
        : {}),
    },
    select: { billedHours: true, actualMinutes: true },
  });

  return ratioOf(
    jobs.reduce((h, j) => h + j.billedHours, 0),
    jobs.reduce((m, j) => m + j.actualMinutes, 0),
  );
}

export async function efficiencyForOrder(tenantId: string, repairOrderId: string) {
  const jobs = await db.technicianJob.findMany({
    where: { tenantId, repairOrderId },
    select: { billedHours: true, actualMinutes: true },
  });

  return ratioOf(
    jobs.reduce((h, j) => h + j.billedHours, 0),
    jobs.reduce((m, j) => m + j.actualMinutes, 0),
  );
}

/**
 * What the labour on this ticket cost the shop in wages.
 *
 * Rounded once per job rather than once at the end, because each job carries
 * its own tech's rate and there is no single rate to apply to a summed total.
 */
export async function laborCostCentsForOrder(tenantId: string, repairOrderId: string) {
  const jobs = await db.technicianJob.findMany({
    where: { tenantId, repairOrderId },
    select: { actualMinutes: true, technician: { select: { hourlyCostCents: true } } },
  });

  return jobs.reduce(
    (cents, j) =>
      cents + Math.round((j.actualMinutes / 60) * j.technician.hourlyCostCents),
    0,
  );
}
