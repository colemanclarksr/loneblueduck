import Link from "next/link";
import { requirePermission } from "@/lib/session";
import { listRepairOrders, STATUS_LABEL } from "@/lib/repairOrders";
import { displayName, describeVehicle } from "@/lib/customers";
import { formatCents } from "@/lib/money";
import { Empty, LinkButton } from "../_ui";
import type { RepairOrderStatus } from "@/lib/generated/prisma";

const BADGE: Record<string, string> = {
  OPEN: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  IN_PROGRESS: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  COMPLETE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  INVOICED: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  CANCELLED: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

const FILTERS = [
  { key: "open", label: "On the floor" },
  { key: "OPEN", label: "Open" },
  { key: "IN_PROGRESS", label: "In progress" },
  { key: "COMPLETE", label: "Ready to invoice" },
  { key: "all", label: "All" },
] as const;

export default async function RepairOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const session = await requirePermission("ro:write");
  const { filter = "open" } = await searchParams;

  const orders = await listRepairOrders(
    session.tenant.id,
    filter === "open" ? { open: true } : filter === "all" ? {} : { status: filter as RepairOrderStatus },
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Repair orders</h1>
        <div className="ml-auto">
          <LinkButton href="/repair-orders/new" variant="primary">Counter ticket</LinkButton>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/repair-orders?filter=${f.key}`}
            className={`inline-flex h-10 items-center rounded-full px-4 text-sm font-medium ${
              filter === f.key
                ? "bg-slate-900 text-white dark:bg-slate-50 dark:text-slate-900"
                : "bg-white text-slate-600 ring-1 ring-slate-300 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {orders.length === 0 ? (
        <div className="mt-4">
          <Empty>
            {filter === "open"
              ? "Nothing on the floor. Convert an approved estimate, or open a counter ticket."
              : "No repair orders match this filter."}
          </Empty>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {orders.map((ro) => (
            <li key={ro.id}>
              <Link
                href={`/repair-orders/${ro.id}`}
                className="block rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 hover:ring-slate-400 dark:bg-slate-900 dark:ring-slate-800 dark:hover:ring-slate-600"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-semibold text-slate-900 dark:text-slate-50">RO #{ro.number}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[ro.status]}`}>
                    {STATUS_LABEL[ro.status]}
                  </span>
                  <span className="text-slate-900 dark:text-slate-100">{displayName(ro.customer)}</span>
                  <span className="text-sm text-slate-600 dark:text-slate-400">{describeVehicle(ro.vehicle)}</span>
                  <span className="text-sm text-slate-500 dark:text-slate-400">
                    {ro.technician?.name ?? "unassigned"}
                  </span>
                  <span className="ml-auto font-semibold tabular-nums text-slate-900 dark:text-slate-50">
                    {formatCents(ro.totalCents)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
