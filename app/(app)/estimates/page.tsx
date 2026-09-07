import Link from "next/link";
import { requirePermission } from "@/lib/session";
import { listEstimates } from "@/lib/estimates";
import { displayName, describeVehicle } from "@/lib/customers";
import { formatCents } from "@/lib/money";
import { LinkButton, Empty } from "../_ui";
import type { EstimateStatus } from "@/lib/generated/prisma";

const STATUS: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  SENT: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  APPROVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  DECLINED: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  EXPIRED: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  CONVERTED: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300",
};
const FILTERS = ["ALL", "DRAFT", "SENT", "APPROVED", "CONVERTED", "DECLINED"] as const;

export default async function EstimatesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await requirePermission("estimate:write");
  const { status = "ALL" } = await searchParams;
  const estimates = await listEstimates(
    session.tenant.id,
    status !== "ALL" ? (status as EstimateStatus) : undefined,
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Estimates</h1>
        <div className="ml-auto">
          <LinkButton href="/estimates/new" variant="primary">New estimate</LinkButton>
        </div>
      </div>

      <nav className="mt-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={f === "ALL" ? "/estimates" : `/estimates?status=${f}`}
            className={`rounded-full px-4 py-2 text-sm font-medium ${
              status === f
                ? "bg-slate-900 text-white dark:bg-slate-50 dark:text-slate-900"
                : "bg-white text-slate-700 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-800"
            }`}
          >
            {f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()}
          </Link>
        ))}
      </nav>

      {estimates.length === 0 ? (
        <div className="mt-4">
          <Empty>
            No estimates here.{" "}
            <Link href="/estimates/new" className="font-medium underline">Write one</Link>.
          </Empty>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {estimates.map((e) => (
            <li key={e.id}>
              <Link
                href={`/estimates/${e.id}`}
                className="block rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 hover:ring-slate-400 dark:bg-slate-900 dark:ring-slate-800 dark:hover:ring-slate-600"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-semibold text-slate-900 dark:text-slate-50">#{e.number}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[e.status]}`}>
                    {e.status.toLowerCase()}
                  </span>
                  <span className="text-slate-900 dark:text-slate-100">{displayName(e.customer)}</span>
                  <span className="text-sm text-slate-600 dark:text-slate-400">{describeVehicle(e.vehicle)}</span>
                  {e.repairOrders[0] ? (
                    <span className="text-sm text-purple-700 dark:text-purple-300">→ RO #{e.repairOrders[0].number}</span>
                  ) : null}
                  <span className="ml-auto font-semibold tabular-nums text-slate-900 dark:text-slate-50">
                    {formatCents(e.totalCents)}
                  </span>
                </div>
                {e.complaint ? (
                  <p className="mt-1 truncate text-sm text-slate-600 dark:text-slate-400">{e.complaint}</p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
