import Link from "next/link";
import { requirePermission } from "@/lib/session";
import { db } from "@/lib/db";
import { displayName, describeVehicle } from "@/lib/customers";
import { formatCents } from "@/lib/money";
import { Empty } from "../_ui";

const STATUS: Record<string, string> = {
  OPEN: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  IN_PROGRESS: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  COMPLETE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  INVOICED: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  CANCELLED: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

export default async function RepairOrdersPage() {
  const session = await requirePermission("ro:write");
  const orders = await db.repairOrder.findMany({
    where: { tenantId: session.tenant.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { customer: true, vehicle: true, technician: { select: { name: true } } },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Repair orders</h1>
      {orders.length === 0 ? (
        <div className="mt-4">
          <Empty>
            No repair orders yet. They appear here once an approved estimate is converted.
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
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[ro.status]}`}>
                    {ro.status.replace("_", " ").toLowerCase()}
                  </span>
                  <span className="text-slate-900 dark:text-slate-100">{displayName(ro.customer)}</span>
                  <span className="text-sm text-slate-600 dark:text-slate-400">{describeVehicle(ro.vehicle)}</span>
                  {ro.technician ? (
                    <span className="text-sm text-slate-500 dark:text-slate-400">{ro.technician.name}</span>
                  ) : null}
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
