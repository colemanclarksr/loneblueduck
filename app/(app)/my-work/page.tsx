import Link from "next/link";
import { requirePermission } from "@/lib/session";
import { myWork, STATUS_LABEL } from "@/lib/repairOrders";
import { displayName, describeVehicle } from "@/lib/customers";
import { Empty } from "../_ui";

// A technician's screen, and the one most likely to be a phone in a pocket.
// Big rows, no money, no navigation into anything they cannot change.
export default async function MyWorkPage() {
  const session = await requirePermission("job:update");
  const jobs = await myWork(session.tenant.id, session.user.id);

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">My work</h1>
      <p className="mt-1 text-slate-600 dark:text-slate-400">
        {jobs.length === 0 ? "Nothing assigned right now." : `${jobs.length} job${jobs.length === 1 ? "" : "s"} on your bench.`}
      </p>

      {jobs.length === 0 ? (
        <div className="mt-4">
          <Empty>When an advisor assigns you a repair order it shows up here.</Empty>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {jobs.map((ro) => (
            <li key={ro.id}>
              <Link
                href={`/repair-orders/${ro.id}`}
                className="block rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 hover:ring-slate-400 dark:bg-slate-900 dark:ring-slate-800 dark:hover:ring-slate-600"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-lg font-semibold text-slate-900 dark:text-slate-50">RO #{ro.number}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      ro.status === "IN_PROGRESS"
                        ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300"
                        : "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
                    }`}
                  >
                    {STATUS_LABEL[ro.status]}
                  </span>
                </div>
                <p className="mt-1 text-slate-900 dark:text-slate-100">{describeVehicle(ro.vehicle)}</p>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  {displayName(ro.customer)}
                  {ro.promisedAt
                    ? ` · promised ${ro.promisedAt.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}`
                    : ""}
                </p>
                {ro.complaint ? (
                  <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">{ro.complaint}</p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
