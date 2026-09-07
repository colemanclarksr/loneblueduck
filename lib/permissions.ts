// Role permissions, per blueprint §5.
//
// Kept as an explicit matrix rather than scattered `if (role === "OWNER")`
// checks, so what each role can do is auditable in one place -- and so the
// tests can assert the whole table rather than a sample of it.

import type { Role } from "@/lib/generated/prisma";

export const PERMISSIONS = [
  "estimate:write",     // create and edit estimates
  "ro:write",           // create and edit repair orders
  "ro:status",          // move a repair order through its statuses
  "job:update",         // update assigned work, notes, photos, checklists
  "invoice:finalize",
  "invoice:editPaid",   // change an invoice after it has been paid
  "payment:take",
  "payment:refund",
  "customer:write",
  "customer:delete",
  "inventory:write",
  "message:send",
  "reports:financial",
  "reports:export",
  "settings:tax",       // tax and labour rates
  "settings:payment",   // processor configuration
  "settings:users",     // invite, change roles
  "audit:view",
  "audit:delete",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const MATRIX: Record<Role, Permission[]> = {
  // "Everything." §5 gives the owner no exclusions.
  OWNER: [...PERMISSIONS],

  // Manages the shop floor and approves refunds under a limit, but cannot
  // touch processor settings or erase the audit trail.
  MANAGER: [
    "estimate:write", "ro:write", "ro:status", "job:update",
    "invoice:finalize", "invoice:editPaid",
    "payment:take", "payment:refund",
    "customer:write", "customer:delete",
    "inventory:write", "message:send",
    "reports:financial", "reports:export",
    "settings:tax", "settings:users",
    "audit:view",
  ],

  // Writes work and takes money; cannot change what money means.
  SERVICE_ADVISOR: [
    "estimate:write", "ro:write", "ro:status", "job:update",
    "invoice:finalize", "payment:take",
    "customer:write", "inventory:write", "message:send",
  ],

  // Sees its own work only. No money, no reports.
  TECHNICIAN: ["job:update"],

  // Rings up quick tickets. Cannot edit an invoice that is already paid --
  // §5 requires manager approval for that.
  COUNTER_CLERK: [
    "estimate:write", "ro:write", "payment:take",
    "customer:write", "message:send",
  ],

  // Reads the books, changes nothing operational.
  BOOKKEEPER: ["reports:financial", "reports:export", "audit:view"],
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

/** Refund ceiling in cents. Above this a manager or owner must approve.
 *  §5: "approve refunds under limit". */
export const MANAGER_REFUND_LIMIT_CENTS = 50_000;

export function canRefund(role: Role, amountCents: number): boolean {
  if (!can(role, "payment:refund")) return false;
  if (role === "OWNER") return true;
  return amountCents <= MANAGER_REFUND_LIMIT_CENTS;
}

/** Navigation, filtered by what the role can actually reach. Returning an
 *  empty-safe list keeps the shell from rendering dead links. */
export const NAV = [
  { href: "/dashboard", label: "Dashboard", permission: null },
  { href: "/estimates", label: "Estimates", permission: "estimate:write" },
  { href: "/repair-orders", label: "Repair Orders", permission: "ro:write" },
  { href: "/my-work", label: "My Work", permission: "job:update" },
  { href: "/invoices", label: "Invoices", permission: "payment:take" },
  { href: "/customers", label: "Customers", permission: "customer:write" },
  { href: "/inventory", label: "Inventory", permission: "inventory:write" },
  { href: "/reports", label: "Reports", permission: "reports:financial" },
  { href: "/settings", label: "Settings", permission: "settings:users" },
] as const;

export function navFor(role: Role) {
  return NAV.filter((item) => item.permission === null || can(role, item.permission));
}
