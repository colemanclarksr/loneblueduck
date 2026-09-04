import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/session";
import { getInvoice, METHOD_LABEL } from "@/lib/invoices";
import { groupBySection } from "@/lib/estimates";
import { displayName, describeVehicle } from "@/lib/customers";
import { formatCents } from "@/lib/money";
import { PrintButton } from "./PrintButton";

/**
 * What the customer walks out with.
 *
 * Deliberately plain: black on white, no navigation, nothing that only makes
 * sense on a screen. It is styled to print onto letter paper from the counter
 * browser, because that is how a three-person shop produces a receipt.
 * Internal figures -- cost, margin, internal notes -- appear nowhere on it.
 */
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("payment:take");
  const { id } = await params;

  const invoice = await getInvoice(session.tenant.id, id);
  if (!invoice) notFound();

  const sections = groupBySection(invoice.lineItems);
  const paid = invoice.balanceDueCents === 0 && invoice.totalCents > 0;

  return (
    <div className="mx-auto max-w-2xl bg-white p-8 text-slate-900 print:p-0">
      <div className="print:hidden">
        <PrintButton invoiceId={invoice.id} />
      </div>

      <header className="mt-4 flex flex-wrap items-start gap-4 border-b border-slate-300 pb-4">
        <div>
          {/* The business name, not the location's internal label. */}
          <h1 className="text-xl font-bold">{session.tenant.name}</h1>
          {invoice.location?.address ? <p className="text-sm">{invoice.location.address}</p> : null}
          {invoice.location?.city ? (
            <p className="text-sm">
              {invoice.location.city}
              {invoice.location.state ? `, ${invoice.location.state}` : ""}
              {invoice.location.zip ? ` ${invoice.location.zip}` : ""}
            </p>
          ) : null}
          {invoice.location?.phone ? <p className="text-sm">{invoice.location.phone}</p> : null}
        </div>
        <div className="ml-auto text-right">
          <p className="text-lg font-semibold">Invoice #{invoice.number}</p>
          <p className="text-sm">
            {(invoice.finalizedAt ?? invoice.createdAt).toLocaleDateString("en-US", {
              year: "numeric", month: "long", day: "numeric",
            })}
          </p>
          {paid ? <p className="mt-1 text-sm font-bold uppercase tracking-wide">Paid in full</p> : null}
        </div>
      </header>

      <section className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customer</h2>
          <p className="font-medium">{displayName(invoice.customer)}</p>
          {invoice.customer.phone ? <p className="text-sm">{invoice.customer.phone}</p> : null}
          {invoice.customer.email ? <p className="text-sm">{invoice.customer.email}</p> : null}
        </div>
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vehicle</h2>
          <p className="font-medium">{describeVehicle(invoice.vehicle)}</p>
          {invoice.vehicle.plate ? <p className="text-sm">Plate {invoice.vehicle.plate}</p> : null}
          {invoice.vehicle.vin ? <p className="font-mono text-xs">{invoice.vehicle.vin}</p> : null}
          {invoice.repairOrder.mileageIn != null ? (
            <p className="text-sm">{invoice.repairOrder.mileageIn.toLocaleString("en-US")} miles</p>
          ) : null}
        </div>
      </section>

      {invoice.repairOrder.complaint ? (
        <p className="mt-4 text-sm">
          <span className="font-medium">You told us:</span> {invoice.repairOrder.complaint}
        </p>
      ) : null}

      <section className="mt-5">
        {sections.map(({ section, items }) => (
          <div key={section} className="mb-4 break-inside-avoid">
            <h3 className="border-b border-slate-200 pb-1 font-semibold">{section}</h3>
            <table className="mt-1 w-full text-sm">
              <tbody>
                {items.map((i) => (
                  <tr key={i.id}>
                    <td className="py-1 pr-3">
                      {i.name}
                      {i.kind === "LABOR" && i.qty !== 1 ? ` (${i.qty} hrs)` : i.qty !== 1 ? ` × ${i.qty}` : ""}
                    </td>
                    <td className="w-24 py-1 text-right tabular-nums">
                      {formatCents(Math.round(i.qty * i.priceCents))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>

      <section className="mt-4 border-t border-slate-300 pt-3">
        <dl className="ml-auto max-w-xs space-y-1 text-sm">
          <div className="flex justify-between gap-6">
            <dt>Subtotal</dt>
            <dd className="tabular-nums">{formatCents(invoice.subtotalCents)}</dd>
          </div>
          {invoice.discountCents > 0 ? (
            <div className="flex justify-between gap-6">
              <dt>Discount ({invoice.discountPct}%)</dt>
              <dd className="tabular-nums">−{formatCents(invoice.discountCents)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-6">
            <dt>Tax{invoice.customer.taxExempt ? " (exempt)" : ` (${invoice.taxRate}%)`}</dt>
            <dd className="tabular-nums">{formatCents(invoice.taxCents)}</dd>
          </div>
          <div className="flex justify-between gap-6 border-t border-slate-300 pt-1 text-base font-bold">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatCents(invoice.totalCents)}</dd>
          </div>

          {invoice.payments.map((p) => (
            <div key={p.id} className="flex justify-between gap-6">
              <dt>
                {METHOD_LABEL[p.method]}
                {p.last4 ? ` ••${p.last4}` : ""}
                {p.reference ? ` ${p.reference}` : ""}
              </dt>
              <dd className="tabular-nums">−{formatCents(p.amountCents)}</dd>
            </div>
          ))}
          {invoice.payments.flatMap((p) => p.refunds).map((r) => (
            <div key={r.id} className="flex justify-between gap-6">
              <dt>Refund</dt>
              <dd className="tabular-nums">{formatCents(r.amountCents)}</dd>
            </div>
          ))}

          <div className="flex justify-between gap-6 border-t border-slate-300 pt-1 text-base font-bold">
            <dt>{invoice.balanceDueCents > 0 ? "Balance due" : "Paid"}</dt>
            <dd className="tabular-nums">
              {formatCents(invoice.balanceDueCents > 0 ? invoice.balanceDueCents : invoice.totalCents)}
            </dd>
          </div>
          {invoice.dueAt && invoice.balanceDueCents > 0 ? (
            <p className="pt-1 text-right text-xs">
              Due {invoice.dueAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </p>
          ) : null}
        </dl>
      </section>

      {invoice.repairOrder.customerNote ? (
        <p className="mt-6 border-t border-slate-200 pt-3 text-sm">{invoice.repairOrder.customerNote}</p>
      ) : null}

      <footer className="mt-6 whitespace-pre-line border-t border-slate-200 pt-3 text-center text-xs text-slate-500">
        {/* Warranty terms, disposal notices and the like live on the location,
            so a shop sets them once instead of retyping them per invoice. */}
        {invoice.location?.receiptFooter ?? "Thank you for your business."}
      </footer>
    </div>
  );
}
