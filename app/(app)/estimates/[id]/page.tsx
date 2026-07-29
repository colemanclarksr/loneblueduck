import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/session";
import { getEstimate, groupBySection, isEditable } from "@/lib/estimates";
import { displayName, describeVehicle } from "@/lib/customers";
import { can } from "@/lib/permissions";
import { formatCents } from "@/lib/money";
import { db } from "@/lib/db";
import { Card } from "../../_ui";
import { LineRow, AddLine, AddSection } from "./LineEditor";
import { SendButton, ConvertButton, NotesAndDiscount } from "./EstimateActions";

const STATUS: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  SENT: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  APPROVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  DECLINED: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  CONVERTED: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300",
  EXPIRED: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

export default async function EstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("estimate:write");
  const { id } = await params;
  const estimate = await getEstimate(session.tenant.id, id);
  if (!estimate) notFound();

  const location = estimate.locationId
    ? await db.location.findFirst({ where: { id: estimate.locationId, tenantId: session.tenant.id } })
    : await db.location.findFirst({ where: { tenantId: session.tenant.id } });

  const editable = isEditable(estimate.status);
  // Cost and margin are the shop's business, not the counter clerk's.
  const showCost = can(session.membership.role, "reports:financial");
  const sections = groupBySection(estimate.lineItems);
  const laborRateCents = location?.laborRateCents ?? 12_500;

  return (
    <div className="pb-24">
      <Link href="/estimates" className="text-sm text-slate-500 hover:underline dark:text-slate-400">← Estimates</Link>

      <div className="mt-1 flex flex-wrap items-start gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Estimate #{estimate.number}</h1>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS[estimate.status]}`}>
              {estimate.status.toLowerCase()}
            </span>
          </div>
          <p className="mt-1 text-slate-700 dark:text-slate-300">
            <Link href={`/customers/${estimate.customerId}`} className="font-medium hover:underline">
              {displayName(estimate.customer)}
            </Link>
            {" · "}
            {describeVehicle(estimate.vehicle)}
            {estimate.vehicle.plate ? ` · ${estimate.vehicle.plate}` : ""}
            {estimate.mileageIn != null ? ` · ${estimate.mileageIn.toLocaleString("en-US")} mi` : ""}
          </p>
        </div>

        <div className="ml-auto flex flex-wrap gap-2">
          {estimate.repairOrders[0] ? (
            <Link
              href={`/repair-orders/${estimate.repairOrders[0].id}`}
              className="inline-flex h-12 items-center rounded-xl bg-purple-100 px-5 text-base font-semibold text-purple-900 dark:bg-purple-950 dark:text-purple-200"
            >
              RO #{estimate.repairOrders[0].number}
            </Link>
          ) : null}
          {editable ? <SendButton estimateId={estimate.id} resend={estimate.status === "SENT"} /> : null}
          {estimate.status === "APPROVED" && can(session.membership.role, "ro:write") ? (
            <ConvertButton estimateId={estimate.id} />
          ) : null}
        </div>
      </div>

      {estimate.status === "SENT" && estimate.approvalToken ? (
        <p className="mt-4 rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:bg-blue-950/50 dark:text-blue-200">
          Waiting on the customer. Approval link:{" "}
          <Link href={`/approve/${estimate.approvalToken}`} className="font-mono font-medium underline">
            /approve/{estimate.approvalToken.slice(0, 12)}…
          </Link>
        </p>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          {sections.length === 0 ? (
            <Card>
              <p className="text-slate-600 dark:text-slate-400">
                No work on this estimate yet. Add a repair below to start.
              </p>
            </Card>
          ) : (
            sections.map(({ section, items }) => {
              const sectionTotal = items
                .filter((i) => i.approved)
                .reduce((sum, i) => sum + Math.round(i.qty * i.priceCents), 0);
              return (
                <Card key={section}>
                  <div className="flex items-baseline gap-3">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">{section}</h2>
                    <span className="ml-auto font-semibold tabular-nums text-slate-900 dark:text-slate-50">
                      {formatCents(sectionTotal)}
                    </span>
                  </div>

                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          <th className="pb-1 pr-2 font-medium">Type</th>
                          <th className="pb-1 pr-2 font-medium">Description</th>
                          <th className="pb-1 pr-2 text-right font-medium">Qty</th>
                          <th className="pb-1 pr-2 text-right font-medium">Price</th>
                          {showCost ? <th className="pb-1 pr-2 text-right font-medium">Margin</th> : null}
                          <th className="pb-1 text-right font-medium">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((line) => (
                          <LineRow key={line.id} line={line} estimateId={estimate.id} editable={editable} showCost={showCost} />
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {editable ? (
                    <div className="mt-3">
                      <AddLine estimateId={estimate.id} section={section} laborRateCents={laborRateCents} />
                    </div>
                  ) : null}
                </Card>
              );
            })
          )}

          {editable ? <AddSection estimateId={estimate.id} laborRateCents={laborRateCents} /> : null}
        </div>

        <div className="space-y-4">
          <Card>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Total</h2>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-600 dark:text-slate-400">Subtotal</dt>
                <dd className="tabular-nums text-slate-900 dark:text-slate-100">{formatCents(estimate.subtotalCents)}</dd>
              </div>
              {estimate.discountCents > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-slate-600 dark:text-slate-400">Discount ({estimate.discountPct}%)</dt>
                  <dd className="tabular-nums text-slate-900 dark:text-slate-100">−{formatCents(estimate.discountCents)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between">
                <dt className="text-slate-600 dark:text-slate-400">Tax ({estimate.taxRate}%)</dt>
                <dd className="tabular-nums text-slate-900 dark:text-slate-100">{formatCents(estimate.taxCents)}</dd>
              </div>
              <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 dark:border-slate-800">
                <dt className="font-semibold text-slate-900 dark:text-slate-50">Total</dt>
                <dd className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-50">
                  {formatCents(estimate.totalCents)}
                </dd>
              </div>
            </dl>
          </Card>

          <NotesAndDiscount
            estimateId={estimate.id}
            complaint={estimate.complaint}
            customerNote={estimate.customerNote}
            internalNote={estimate.internalNote}
            discountPct={estimate.discountPct}
            editable={editable}
          />
        </div>
      </div>
    </div>
  );
}
