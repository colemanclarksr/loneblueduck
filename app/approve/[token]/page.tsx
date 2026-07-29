import { notFound } from "next/navigation";
import { getEstimateByToken, groupBySection } from "@/lib/estimates";
import { displayName, describeVehicle } from "@/lib/customers";
import { formatCents } from "@/lib/money";
import { ApprovalForm, type Section } from "./ApprovalForm";

// Public page: no session, no navigation shell, nothing about the shop's
// internals. The token in the URL is the only credential.
export const dynamic = "force-dynamic";

export default async function ApprovePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const estimate = await getEstimateByToken(token);
  if (!estimate) notFound();

  const sections: Section[] = groupBySection(estimate.lineItems).map((g) => ({
    section: g.section,
    totalCents: g.items.reduce((sum, i) => sum + Math.round(i.qty * i.priceCents), 0),
    items: g.items.map((i) => ({ id: i.id, name: i.name, kind: i.kind, qty: i.qty, priceCents: i.priceCents })),
  }));

  const answered = estimate.status !== "SENT";
  // On the receipt view, split by what the customer actually kept.
  const approvedIds = new Set(estimate.lineItems.filter((l) => l.approved).map((l) => l.id));
  const approvedSections = sections.filter((s) => s.items.some((i) => approvedIds.has(i.id)));
  const declinedSections = sections.filter((s) => !s.items.some((i) => approvedIds.has(i.id)));

  return (
    <main className="min-h-dvh bg-slate-100 p-4 dark:bg-slate-950">
      <div className="mx-auto max-w-lg py-6">
        <header className="mb-6 text-center">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50">
            {estimate.location?.name ?? "Your shop"}
          </h1>
          <p className="mt-1 text-slate-600 dark:text-slate-400">
            Estimate #{estimate.number} for {displayName(estimate.customer)}
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {describeVehicle(estimate.vehicle)}
            {estimate.vehicle.plate ? ` · ${estimate.vehicle.plate}` : ""}
          </p>
        </header>

        {estimate.complaint ? (
          <p className="mb-4 rounded-2xl bg-white p-4 text-sm text-slate-700 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-800">
            <span className="font-medium">You told us:</span> {estimate.complaint}
          </p>
        ) : null}

        {answered ? (
          // Also what a customer sees if they reopen the link later, so it has
          // to read as a receipt rather than a dead end.
          estimate.status === "DECLINED" ? (
            <div className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
              <p className="text-lg font-semibold text-slate-900 dark:text-slate-50">You declined this estimate.</p>
              <p className="mt-1 text-slate-600 dark:text-slate-400">
                Call {estimate.location?.phone ?? "the shop"} if you change your mind.
              </p>
            </div>
          ) : (
            <div className="rounded-2xl bg-emerald-50 p-6 dark:bg-emerald-950/40">
              <p className="text-center text-lg font-semibold text-emerald-900 dark:text-emerald-200">
                Thank you — your approval is in.
              </p>
              <dl className="mt-4 space-y-1.5 text-sm">
                {approvedSections.map((s) => (
                  <div key={s.section} className="flex justify-between gap-4">
                    <dt className="text-emerald-900 dark:text-emerald-200">{s.section}</dt>
                    <dd className="tabular-nums text-emerald-900 dark:text-emerald-200">{formatCents(s.totalCents)}</dd>
                  </div>
                ))}
                {declinedSections.length > 0 ? (
                  <div className="pt-2 text-emerald-800/70 dark:text-emerald-300/60">
                    Not doing today: {declinedSections.map((s) => s.section).join(", ")}
                  </div>
                ) : null}
                <div className="mt-2 flex justify-between border-t border-emerald-200 pt-2 dark:border-emerald-900">
                  <dt className="font-semibold text-emerald-900 dark:text-emerald-100">Approved total</dt>
                  <dd className="text-lg font-bold tabular-nums text-emerald-900 dark:text-emerald-100">
                    {formatCents(estimate.totalCents)}
                  </dd>
                </div>
              </dl>
              <p className="mt-4 text-center text-sm text-emerald-800 dark:text-emerald-300">
                We will call you before doing anything not listed here.
              </p>
            </div>
          )
        ) : (
          <>
            <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
              Approve everything, or tap <span className="font-medium">Not this time</span> on anything you want to
              hold off on. The total updates as you go.
            </p>
            <ApprovalForm token={token} sections={sections} taxRate={estimate.taxRate} />
          </>
        )}

        {estimate.customerNote ? (
          <p className="mt-6 rounded-2xl bg-white p-4 text-sm text-slate-700 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-800">
            {estimate.customerNote}
          </p>
        ) : null}

        <p className="mt-6 text-center text-xs text-slate-500 dark:text-slate-500">
          Prices are an estimate. We will call you before doing anything not listed here.
        </p>
      </div>
    </main>
  );
}
