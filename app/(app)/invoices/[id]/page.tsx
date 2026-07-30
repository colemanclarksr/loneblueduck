import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/session";
import { can } from "@/lib/permissions";
import { getInvoice, netCents, METHOD_LABEL, STATUS_LABEL } from "@/lib/invoices";
import { groupBySection } from "@/lib/estimates";
import { displayName, describeVehicle } from "@/lib/customers";
import { formatCents } from "@/lib/money";
import { Card, LinkButton } from "../../_ui";
import { TakePayment, RefundButton, VoidButton } from "./PaymentPanel";

const BADGE: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  OPEN: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  PARTIAL: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  PAID: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  VOID: "bg-slate-200 text-slate-500 line-through dark:bg-slate-800 dark:text-slate-400",
};

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("payment:take");
  const { id } = await params;

  const invoice = await getInvoice(session.tenant.id, id);
  if (!invoice) notFound();

  const role = session.membership.role;
  const sections = groupBySection(invoice.lineItems);
  const owing = invoice.status === "OPEN" || invoice.status === "PARTIAL";
  const overdue = invoice.dueAt != null && invoice.dueAt < new Date() && owing;

  return (
    <div>
      <Link href="/invoices" className="text-sm text-slate-500 hover:underline dark:text-slate-400">← Invoices</Link>

      <div className="mt-1 flex flex-wrap items-start gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Invoice #{invoice.number}</h1>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${BADGE[invoice.status]}`}>
              {STATUS_LABEL[invoice.status]}
            </span>
          </div>
          <p className="mt-1 text-slate-700 dark:text-slate-300">
            <Link href={`/customers/${invoice.customerId}`} className="font-medium hover:underline">
              {displayName(invoice.customer)}
            </Link>
            {" · "}{describeVehicle(invoice.vehicle)}
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            <Link href={`/repair-orders/${invoice.repairOrder.id}`} className="underline">
              RO #{invoice.repairOrder.number}
            </Link>
            {invoice.termsDays ? ` · net ${invoice.termsDays}` : ""}
            {invoice.dueAt ? ` · due ${invoice.dueAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
          </p>
        </div>

        <div className="ml-auto text-right">
          <div className="text-3xl font-bold tabular-nums text-slate-900 dark:text-slate-50">
            {formatCents(invoice.totalCents)}
          </div>
          {owing ? (
            <div className={`text-sm font-medium ${overdue ? "text-red-600 dark:text-red-400" : "text-slate-600 dark:text-slate-400"}`}>
              {formatCents(invoice.balanceDueCents)} due{overdue ? " — overdue" : ""}
            </div>
          ) : null}
          <div className="mt-2">
            <LinkButton href={`/invoices/${invoice.id}/receipt`}>Receipt</LinkButton>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          {sections.map(({ section, items }) => (
            <Card key={section}>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">{section}</h2>
              <ul className="mt-2 space-y-1 text-sm">
                {items.map((i) => (
                  <li key={i.id} className="flex justify-between gap-4 text-slate-700 dark:text-slate-300">
                    <span>
                      {i.name}
                      {i.qty !== 1 ? ` × ${i.qty}` : ""}
                      {!i.taxable ? <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">not taxed</span> : null}
                    </span>
                    <span className="tabular-nums">{formatCents(Math.round(i.qty * i.priceCents))}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}

          <Card>
            <dl className="ml-auto max-w-xs space-y-1.5 text-sm">
              <div className="flex justify-between gap-6">
                <dt className="text-slate-600 dark:text-slate-400">Subtotal</dt>
                <dd className="tabular-nums text-slate-900 dark:text-slate-100">{formatCents(invoice.subtotalCents)}</dd>
              </div>
              {invoice.discountCents > 0 ? (
                <div className="flex justify-between gap-6">
                  <dt className="text-slate-600 dark:text-slate-400">Discount ({invoice.discountPct}%)</dt>
                  <dd className="tabular-nums text-slate-900 dark:text-slate-100">−{formatCents(invoice.discountCents)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-6">
                <dt className="text-slate-600 dark:text-slate-400">
                  Tax{invoice.customer.taxExempt ? " (exempt)" : ` (${invoice.taxRate}%)`}
                </dt>
                <dd className="tabular-nums text-slate-900 dark:text-slate-100">{formatCents(invoice.taxCents)}</dd>
              </div>
              <div className="flex justify-between gap-6 border-t border-slate-200 pt-1.5 dark:border-slate-800">
                <dt className="font-semibold text-slate-900 dark:text-slate-50">Total</dt>
                <dd className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-50">{formatCents(invoice.totalCents)}</dd>
              </div>
              {invoice.paidCents > 0 ? (
                <>
                  <div className="flex justify-between gap-6">
                    <dt className="text-slate-600 dark:text-slate-400">Paid</dt>
                    <dd className="tabular-nums text-slate-900 dark:text-slate-100">−{formatCents(invoice.paidCents)}</dd>
                  </div>
                  <div className="flex justify-between gap-6 border-t border-slate-200 pt-1.5 dark:border-slate-800">
                    <dt className="font-semibold text-slate-900 dark:text-slate-50">Balance</dt>
                    <dd className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-50">
                      {formatCents(invoice.balanceDueCents)}
                    </dd>
                  </div>
                </>
              ) : null}
            </dl>
          </Card>
        </div>

        <aside className="space-y-4">
          {owing ? <TakePayment invoiceId={invoice.id} balanceDueCents={invoice.balanceDueCents} /> : null}

          {invoice.payments.length > 0 ? (
            <Card>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Payments
              </h2>
              <ul className="space-y-3 text-sm">
                {invoice.payments.map((p) => {
                  const refundable = netCents(p);
                  const label = `${METHOD_LABEL[p.method]}${p.last4 ? ` ••${p.last4}` : ""}`;
                  return (
                    <li key={p.id} className="border-b border-slate-100 pb-3 last:border-0 last:pb-0 dark:border-slate-800">
                      <div className="flex justify-between gap-3">
                        <span className="text-slate-800 dark:text-slate-200">
                          {label}
                          {p.reference ? <span className="text-slate-500 dark:text-slate-400"> · {p.reference}</span> : null}
                        </span>
                        <span className="font-medium tabular-nums text-slate-900 dark:text-slate-100">
                          {formatCents(p.amountCents)}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {p.createdAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        {p.processorRef ? ` · ${p.processorRef}` : ""}
                      </div>

                      {p.refunds.map((r) => (
                        <div key={r.id} className="mt-1 flex justify-between gap-3 text-xs text-red-700 dark:text-red-400">
                          <span>
                            Refunded{r.reason ? ` — ${r.reason}` : ""}
                            {r.approvedBy ? ` (${r.approvedBy.name})` : ""}
                          </span>
                          <span className="tabular-nums">−{formatCents(r.amountCents)}</span>
                        </div>
                      ))}

                      {refundable > 0 && can(role, "payment:refund") && invoice.status !== "VOID" ? (
                        <div className="mt-1">
                          <RefundButton
                            invoiceId={invoice.id}
                            paymentId={p.id}
                            refundableCents={refundable}
                            label={label}
                          />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null}

          {invoice.status !== "VOID" && can(role, "invoice:editPaid") ? (
            <Card><VoidButton invoiceId={invoice.id} /></Card>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
