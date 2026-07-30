import Link from "next/link";
import { requirePermission } from "@/lib/session";
import { salesSummary, technicianProductivity, pipeline, approvalRate, monthOf, daysBack } from "@/lib/reports";
import { arAging, METHOD_LABEL } from "@/lib/invoices";
import { displayName } from "@/lib/customers";
import { formatCents } from "@/lib/money";
import { Card, Empty } from "../_ui";
import { STATUS_LABEL as RO_STATUS } from "@/lib/repairOrders";

const PERIODS = [
  { key: "7", label: "Last 7 days" },
  { key: "30", label: "Last 30 days" },
  { key: "month", label: "This month" },
] as const;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-sm text-slate-600 dark:text-slate-400">{label}</dt>
      <dd className="text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-50">{value}</dd>
      {hint ? <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p> : null}
    </div>
  );
}

/** A bar chart made of divs. No chart library, no client JavaScript, and it
 *  prints — which is what a shop owner actually does with this page. */
function DayBars({ days }: { days: { day: string; billedCents: number; collectedCents: number }[] }) {
  const peak = Math.max(1, ...days.map((d) => Math.max(d.billedCents, d.collectedCents)));

  return (
    <div className="flex items-end gap-1 overflow-x-auto pb-1" style={{ height: "9rem" }}>
      {days.map((d) => (
        <div key={d.day} className="flex min-w-6 flex-1 flex-col items-center justify-end gap-0.5">
          <div className="flex w-full items-end justify-center gap-0.5" style={{ height: "7rem" }}>
            <div
              className="w-1/2 rounded-t bg-slate-800 dark:bg-slate-300"
              style={{ height: `${(d.billedCents / peak) * 100}%` }}
              title={`Billed ${formatCents(d.billedCents)}`}
            />
            <div
              className="w-1/2 rounded-t bg-emerald-500"
              style={{ height: `${(d.collectedCents / peak) * 100}%` }}
              title={`Collected ${formatCents(d.collectedCents)}`}
            />
          </div>
          <span className="text-[10px] tabular-nums text-slate-500 dark:text-slate-400">{d.day.slice(8)}</span>
        </div>
      ))}
    </div>
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const session = await requirePermission("reports:financial");
  const { period = "30" } = await searchParams;

  const range = period === "month" ? monthOf() : daysBack(period === "7" ? 7 : 30);
  const [sales, techs, floor, approvals, aging] = await Promise.all([
    salesSummary(session.tenant.id, range),
    technicianProductivity(session.tenant.id, range),
    pipeline(session.tenant.id),
    approvalRate(session.tenant.id, range),
    arAging(session.tenant.id),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Reports</h1>

      <div className="mt-4 flex flex-wrap gap-2 print:hidden">
        {PERIODS.map((p) => (
          <Link
            key={p.key}
            href={`/reports?period=${p.key}`}
            className={`inline-flex h-10 items-center rounded-full px-4 text-sm font-medium ${
              period === p.key
                ? "bg-slate-900 text-white dark:bg-slate-50 dark:text-slate-900"
                : "bg-white text-slate-600 ring-1 ring-slate-300 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700"
            }`}
          >
            {p.label}
          </Link>
        ))}
      </div>

      <div className="mt-4 space-y-4">
        <Card>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Billed" value={formatCents(sales.billedCents)} hint={`${sales.invoiceCount} invoices`} />
            <Stat
              label="Collected"
              value={formatCents(sales.netCollectedCents)}
              hint={sales.refundedCents > 0 ? `after ${formatCents(sales.refundedCents)} refunded` : "money in the door"}
            />
            <Stat label="Average ticket" value={formatCents(sales.averageTicketCents)} />
            <Stat
              label="Gross profit"
              value={formatCents(sales.grossProfitCents)}
              hint={`${sales.grossMarginPct}% margin`}
            />
          </dl>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Billed is work invoiced in this period. Collected is money that arrived in it. On fleet accounts they
            land in different months, so both are shown.
          </p>
        </Card>

        <Card>
          <div className="mb-2 flex flex-wrap items-center gap-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Day by day
            </h2>
            <span className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
              <span className="size-2.5 rounded-sm bg-slate-800 dark:bg-slate-300" /> billed
            </span>
            <span className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
              <span className="size-2.5 rounded-sm bg-emerald-500" /> collected
            </span>
          </div>
          <DayBars days={sales.days} />
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Where the money came from
            </h2>
            {sales.byMethod.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">Nothing collected in this period.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {sales.byMethod.map((m) => (
                  <li key={m.method} className="flex justify-between gap-4">
                    <span className="text-slate-700 dark:text-slate-300">
                      {METHOD_LABEL[m.method]}
                      <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">{m.count}</span>
                    </span>
                    <span className="tabular-nums text-slate-900 dark:text-slate-100">{formatCents(m.cents)}</span>
                  </li>
                ))}
              </ul>
            )}

            <h3 className="mb-2 mt-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Mix
            </h3>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-700 dark:text-slate-300">Labor</dt>
                <dd className="tabular-nums text-slate-900 dark:text-slate-100">{formatCents(sales.laborCents)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-700 dark:text-slate-300">Parts and tires</dt>
                <dd className="tabular-nums text-slate-900 dark:text-slate-100">{formatCents(sales.partsCents)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-700 dark:text-slate-300">Fees and sublet</dt>
                <dd className="tabular-nums text-slate-900 dark:text-slate-100">{formatCents(sales.otherCents)}</dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-slate-200 pt-1.5 dark:border-slate-800">
                <dt className="text-slate-700 dark:text-slate-300">Sales tax collected</dt>
                <dd className="tabular-nums text-slate-900 dark:text-slate-100">{formatCents(sales.taxCents)}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Best sellers
            </h2>
            {sales.topSellers.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">Nothing billed in this period.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {sales.topSellers.map((s) => (
                  <li key={s.name} className="flex justify-between gap-4">
                    <span className="text-slate-700 dark:text-slate-300">
                      {s.name}
                      <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">×{s.count}</span>
                    </span>
                    <span className="tabular-nums text-slate-900 dark:text-slate-100">{formatCents(s.cents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Who turned the hours
            </h2>
            {techs.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No work finished in this period.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <th className="pb-1 font-medium">Technician</th>
                    <th className="pb-1 text-right font-medium">Jobs</th>
                    <th className="pb-1 text-right font-medium">Hours</th>
                    <th className="pb-1 text-right font-medium">Produced</th>
                  </tr>
                </thead>
                <tbody>
                  {techs.map((t) => (
                    <tr key={t.name} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="py-1.5 text-slate-800 dark:text-slate-200">{t.name}</td>
                      <td className="py-1.5 text-right tabular-nums text-slate-700 dark:text-slate-300">{t.jobs}</td>
                      <td className="py-1.5 text-right tabular-nums text-slate-700 dark:text-slate-300">{t.hours}</td>
                      <td className="py-1.5 text-right tabular-nums text-slate-900 dark:text-slate-100">
                        {formatCents(t.totalCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              In the building now
            </h2>
            {floor.repairOrders.length === 0 && floor.estimates.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">Nothing open.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {floor.repairOrders.map((r) => (
                  <li key={r.status} className="flex justify-between gap-4">
                    <span className="text-slate-700 dark:text-slate-300">
                      {RO_STATUS[r.status]}
                      <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">{r.count}</span>
                    </span>
                    <span className="tabular-nums text-slate-900 dark:text-slate-100">{formatCents(r.cents)}</span>
                  </li>
                ))}
                {floor.estimates.map((e) => (
                  <li key={e.status} className="flex justify-between gap-4">
                    <span className="text-slate-700 dark:text-slate-300">
                      Estimates {e.status.toLowerCase()}
                      <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">{e.count}</span>
                    </span>
                    <span className="tabular-nums text-slate-900 dark:text-slate-100">{formatCents(e.cents)}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-800">
              <Stat
                label="Estimate approval rate"
                value={`${approvals.ratePct}%`}
                hint={`${approvals.approved} of ${approvals.sent} answered · ${formatCents(approvals.approvedCents)} approved`}
              />
            </div>
          </Card>
        </div>

        <Card>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Who owes you
          </h2>
          {aging.rows.length === 0 ? (
            <Empty>Nothing outstanding.</Empty>
          ) : (
            <>
              <dl className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="Not due yet" value={formatCents(aging.buckets.current)} />
                <Stat label="1–30 days late" value={formatCents(aging.buckets.d30)} />
                <Stat label="31–60 days" value={formatCents(aging.buckets.d60)} />
                <Stat label="Over 60 days" value={formatCents(aging.buckets.d90)} />
              </dl>
              <ul className="space-y-1.5 text-sm">
                {aging.rows.map(({ invoice, daysLate }) => (
                  <li key={invoice.id} className="flex flex-wrap justify-between gap-x-4">
                    <Link href={`/invoices/${invoice.id}`} className="text-slate-800 underline dark:text-slate-200">
                      #{invoice.number} · {displayName(invoice.customer)}
                    </Link>
                    <span className="flex items-baseline gap-3">
                      {daysLate > 0 ? (
                        <span className="text-xs font-medium text-red-600 dark:text-red-400">{daysLate} days late</span>
                      ) : null}
                      <span className="tabular-nums text-slate-900 dark:text-slate-100">
                        {formatCents(invoice.balanceDueCents)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
