// Shop administration, per §7.
//
// The rule worth stating up front: a tenant must always have at least one
// active owner. Every path that could remove the last one -- demotion,
// deactivation -- checks first and refuses. Locking a shop out of its own
// account is not recoverable from inside the product, and the person it
// happens to is a three-person business on a Saturday.

import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import type { Role } from "@/lib/generated/prisma";
import type { LineInput } from "@/lib/estimates";

export class SettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsError";
  }
}

export const ROLE_LABEL: Record<Role, string> = {
  OWNER: "Owner",
  MANAGER: "Manager",
  SERVICE_ADVISOR: "Service advisor",
  TECHNICIAN: "Technician",
  COUNTER_CLERK: "Counter clerk",
  BOOKKEEPER: "Bookkeeper",
};

export const ROLE_BLURB: Record<Role, string> = {
  OWNER: "Everything, including payment settings and the audit trail.",
  MANAGER: "Runs the floor and approves refunds up to the limit.",
  SERVICE_ADVISOR: "Writes work and takes money. Cannot change tax or processor settings.",
  TECHNICIAN: "Their own assigned jobs, notes and inspections. No money, no reports.",
  COUNTER_CLERK: "Rings up tickets. Cannot edit an invoice that is already paid.",
  BOOKKEEPER: "Reads the books. Changes nothing operational.",
};

// ------------------------------------------------------------- locations

export async function getShop(tenantId: string) {
  return db.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    include: { locations: { orderBy: { createdAt: "asc" } } },
  });
}

export async function updateLocation(
  tenantId: string,
  locationId: string,
  input: {
    name?: string;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    taxRate?: number;
    laborRateCents?: number;
    receiptFooter?: string | null;
  },
  opts: { userId?: string } = {},
) {
  const location = await db.location.findFirst({ where: { id: locationId, tenantId } });
  if (!location) throw new SettingsError("That location no longer exists.");

  if (input.name !== undefined && !input.name.trim()) throw new SettingsError("The shop needs a name.");
  if (input.taxRate !== undefined && (input.taxRate < 0 || input.taxRate > 100)) {
    throw new SettingsError("A tax rate must be between 0 and 100 percent.");
  }
  if (input.laborRateCents !== undefined && input.laborRateCents < 0) {
    throw new SettingsError("A labor rate cannot be negative.");
  }

  const saved = await db.location.update({
    where: { id: locationId },
    data: {
      name: input.name?.trim() ?? undefined,
      phone: input.phone ?? undefined,
      email: input.email ?? undefined,
      address: input.address ?? undefined,
      city: input.city ?? undefined,
      state: input.state ?? undefined,
      zip: input.zip ?? undefined,
      taxRate: input.taxRate ?? undefined,
      laborRateCents: input.laborRateCents ?? undefined,
      receiptFooter: input.receiptFooter ?? undefined,
    },
  });

  // §8 wants tax changes audited. Documents capture their rate at creation, so
  // a change here only affects new work -- but an owner still needs to be able
  // to see when the rate moved and who moved it.
  if (
    (input.taxRate !== undefined && input.taxRate !== location.taxRate) ||
    (input.laborRateCents !== undefined && input.laborRateCents !== location.laborRateCents)
  ) {
    await db.auditLog.create({
      data: {
        tenantId,
        userId: opts.userId ?? null,
        entityType: "Location",
        entityId: locationId,
        action: "RATES_CHANGED",
        beforeJson: JSON.stringify({ taxRate: location.taxRate, laborRateCents: location.laborRateCents }),
        afterJson: JSON.stringify({ taxRate: saved.taxRate, laborRateCents: saved.laborRateCents }),
      },
    });
  }

  return saved;
}

// ----------------------------------------------------------------- people

export async function listMembers(tenantId: string) {
  return db.membership.findMany({
    where: { tenantId },
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
    include: {
      user: { select: { id: true, name: true, email: true, active: true } },
      location: { select: { name: true } },
    },
  });
}

async function activeOwnerCount(tenantId: string, excludingMembershipId?: string) {
  return db.membership.count({
    where: {
      tenantId,
      role: "OWNER",
      active: true,
      ...(excludingMembershipId ? { NOT: { id: excludingMembershipId } } : {}),
    },
  });
}

/**
 * Adds someone to the shop.
 *
 * Users are global -- one login can work at more than one shop -- so an email
 * that already exists is linked rather than duplicated. That is the normal
 * case for a bookkeeper serving several clients.
 */
export async function addMember(
  tenantId: string,
  input: { name: string; email: string; role: Role; password?: string; locationId?: string | null },
) {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name) throw new SettingsError("Give them a name.");
  if (!email.includes("@")) throw new SettingsError("That does not look like an email address.");
  if (input.password !== undefined && input.password.length < 8) {
    throw new SettingsError("A password needs at least 8 characters.");
  }

  let user = await db.user.findUnique({ where: { email } });
  if (user) {
    const existing = await db.membership.findFirst({ where: { tenantId, userId: user.id } });
    if (existing?.active) throw new SettingsError(`${user.name} already works here.`);
    if (existing) {
      // Rehiring someone: reactivate rather than stacking a second membership.
      return db.membership.update({
        where: { id: existing.id },
        data: { active: true, role: input.role, locationId: input.locationId ?? null },
      });
    }
  } else {
    user = await db.user.create({
      data: {
        name,
        email,
        passwordHash: input.password ? await hashPassword(input.password) : null,
      },
    });
  }

  return db.membership.create({
    data: { tenantId, userId: user.id, role: input.role, locationId: input.locationId ?? null },
  });
}

export async function changeRole(tenantId: string, membershipId: string, role: Role, opts: { userId?: string } = {}) {
  const membership = await db.membership.findFirst({ where: { id: membershipId, tenantId }, include: { user: true } });
  if (!membership) throw new SettingsError("That person is not on this shop's list.");
  if (membership.role === role) return membership;

  if (membership.role === "OWNER" && (await activeOwnerCount(tenantId, membershipId)) === 0) {
    throw new SettingsError(
      "This is the shop's only owner. Make someone else an owner first, or nobody can change payment settings.",
    );
  }

  const saved = await db.membership.update({ where: { id: membershipId }, data: { role } });

  // §8: permission changes are audited.
  await db.auditLog.create({
    data: {
      tenantId,
      userId: opts.userId ?? null,
      entityType: "Membership",
      entityId: membershipId,
      action: "ROLE_CHANGED",
      beforeJson: JSON.stringify({ role: membership.role, user: membership.user.email }),
      afterJson: JSON.stringify({ role }),
    },
  });

  return saved;
}

export async function setMemberActive(
  tenantId: string,
  membershipId: string,
  active: boolean,
  opts: { userId?: string } = {},
) {
  const membership = await db.membership.findFirst({ where: { id: membershipId, tenantId }, include: { user: true } });
  if (!membership) throw new SettingsError("That person is not on this shop's list.");

  if (!active && membership.role === "OWNER" && (await activeOwnerCount(tenantId, membershipId)) === 0) {
    throw new SettingsError("This is the shop's only owner. Make someone else an owner before removing them.");
  }

  const saved = await db.membership.update({ where: { id: membershipId }, data: { active } });

  // Signing out is the point of removing access; leaving live sessions running
  // would mean the person keeps working until their cookie expires.
  if (!active) {
    await db.session.deleteMany({ where: { userId: membership.userId, tenantId } });
  }

  await db.auditLog.create({
    data: {
      tenantId,
      userId: opts.userId ?? null,
      entityType: "Membership",
      entityId: membershipId,
      action: active ? "ACCESS_RESTORED" : "ACCESS_REMOVED",
      afterJson: JSON.stringify({ user: membership.user.email }),
    },
  });

  return saved;
}

export async function setPassword(tenantId: string, membershipId: string, password: string) {
  if (password.length < 8) throw new SettingsError("A password needs at least 8 characters.");
  const membership = await db.membership.findFirst({ where: { id: membershipId, tenantId } });
  if (!membership) throw new SettingsError("That person is not on this shop's list.");

  await db.user.update({
    where: { id: membership.userId },
    data: { passwordHash: await hashPassword(password) },
  });

  // A new password ends every session on the old one.
  await db.session.deleteMany({ where: { userId: membership.userId } });
  return true;
}

// ------------------------------------------------------- service packages

export async function listPackages(tenantId: string) {
  const packages = await db.servicePackage.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
  return packages.map((p) => ({ ...p, items: safeItems(p.itemsJson) }));
}

function safeItems(json: string): LineInput[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as LineInput[]) : [];
  } catch {
    // A hand-edited package should not break the settings screen.
    return [];
  }
}

export async function createPackage(tenantId: string, input: { name: string; items: LineInput[] }) {
  const name = input.name.trim();
  if (!name) throw new SettingsError("Give the package a name.");
  if (input.items.length === 0) throw new SettingsError("A package needs at least one line on it.");

  const clash = await db.servicePackage.findFirst({ where: { tenantId, name } });
  if (clash) throw new SettingsError(`You already have a package called "${name}".`);

  return db.servicePackage.create({
    data: { tenantId, name, itemsJson: JSON.stringify(input.items) },
  });
}

export async function deletePackage(tenantId: string, id: string) {
  const pkg = await db.servicePackage.findFirst({ where: { id, tenantId } });
  if (!pkg) throw new SettingsError("That package no longer exists.");
  // Safe to delete: items are copied onto a document when the package is used,
  // so no estimate or invoice depends on this row.
  await db.servicePackage.delete({ where: { id } });
  return true;
}

// ------------------------------------------------------------------ audit

export async function recentAudit(tenantId: string, take = 100) {
  return db.auditLog.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take,
    include: { user: { select: { name: true } } },
  });
}
