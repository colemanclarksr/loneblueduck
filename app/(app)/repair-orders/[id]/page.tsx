import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/session";
import { can } from "@/lib/permissions";
import { getRepairOrder, technicians, nextStatuses, isEditable, STATUS_LABEL } from "@/lib/repairOrders";
import { groupBySection } from "@/lib/estimates";
import { displayName, describeVehicle } from "@/lib/customers";
import { formatCents } from "@/lib/money";
import { Card } from "../../_ui";
import { listTemplates, ensureDefaultTemplate } from "@/lib/inspections";
import { LineRow, AddLine, AddSection } from "./LineEditor";
import { StatusBar, InvoiceButton, AssignPicker, NoteForm, NotesAndDiscount } from "./Floor";
import { StartInspection } from "./inspection/StartInspection";

const BADGE: Record<string, string> = {
  OPEN: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  IN_PROGRESS: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  COMPLETE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  INVOICED: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  CANCELLED: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

export default async function RepairOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("ro:write");
  const { id } = await params;

  const ro = await getRepairOrder(session.tenant.id, id);
  if (!ro) notFound();

  const role = session.membership.role;
  const editable = isEditable(ro.status);
  const showCost = can(role, "reports:financial");
  const people = await technicians(session.tenant.id);
  // Seeds the default checklist on first use, so the button is never a dead end.
  await ensureDefaultTemplate(session.tenant.id);
  const templates = await listTemplates(session.tenant.id);
  const sections = groupBySection(ro.lineItems);
  const laborRate = ro.location?.laborRateCents ?? 12_500;

  return (
    <div>
      <Link href="/repair-orders" className="text-sm text-slate-500 hover:underline dark:text-slate-400">← Repair orders</Link>

      <div className="mt-1 flex flex-wrap items-start gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">RO #{ro.number}</h1>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${BADGE[ro.status]}`}>
              {STATUS_LABEL[ro.status]}
            </span>
          </div>
          <p className="mt-1 text-slate-700 dark:text-slate-300">
            <Link href={`/customers/${ro.customerId}`} className="font-medium hover:underline">
              {displayName(ro.customer)}
            </Link>
            {" · "}{describeVehicle(ro.vehicle)}
            {ro.mileageIn != null ? ` · ${ro.mileageIn.toLocaleString("en-US")} mi` : ""}
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {ro.estimate ? (
              <>From <Link href={`/estimates/${ro.estimate.id}`} className="underline">estimate #{ro.estimate.number}</Link></>
            ) : (
              "Written at the counter"
            )}
            {ro.technician ? ` · ${ro.technician.name}` : " · unassigned"}
          </p>
        </div>

        <div className="ml-auto text-right">
          <div className="text-3xl font-bold tabular-nums text-slate-900 dark:text-slate-50">{formatCents(ro.totalCents)}</div>
          {ro.invoices[0] ? (
            <Link href={`/invoices/${ro.invoices[0].id}`} className="text-sm text-slate-600 underline dark:text-slate-400">
              Invoice #{ro.invoices[0].number}
            </Link>
          ) : null}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {can(role, "ro:status") ? (
          <StatusBar repairOrderId={ro.id} status={ro.status} next={[...nextStatuses(ro.status)]} />
        ) : null}
        {ro.status === "COMPLETE" && ro.invoices.length === 0 && can(role, "invoice:finalize") ? (
          <InvoiceButton repairOrderId={ro.id} />
        ) : null}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          {sections.length === 0 ? (
            <Card>
              <p className="text-slate-600 dark:text-slate-400">Nothing on this ticket yet.</p>
            </Card>
          ) : null}

          {sections.map(({ section, items }) => (
            <Card key={section}>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">{section}</h2>
              <table className="mt-2 w-full text-sm">
                <tbody>
                  {items.map((line) => (
                    <LineRow key={line.id} line={line} repairOrderId={ro.id} editable={editable} showCost={showCost} />
                  ))}
                </tbody>
              </table>
              {editable ? (
                <div className="mt-3">
                  <AddLine repairOrderId={ro.id} section={section} laborRateCents={laborRate} />
                </div>
              ) : null}
            </Card>
          ))}

          {editable ? <AddSection repairOrderId={ro.id} laborRateCents={laborRate} /> : null}

          <Card>
            <dl className="ml-auto max-w-xs space-y-1.5 text-sm">
              <div className="flex justify-between gap-6">
                <dt className="text-slate-600 dark:text-slate-400">Subtotal</dt>
                <dd className="tabular-nums text-slate-900 dark:text-slate-100">{formatCents(ro.subtotalCents)}</dd>
              </div>
              {ro.discountCents > 0 ? (
                <div className="flex justify-between gap-6">
                  <dt className="text-slate-600 dark:text-slate-400">Discount ({ro.discountPct}%)</dt>
                  <dd className="tabular-nums text-slate-900 dark:text-slate-100">−{formatCents(ro.discountCents)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-6">
                <dt className="text-slate-600 dark:text-slate-400">Tax ({ro.taxRate}%)</dt>
                <dd className="tabular-nums text-slate-900 dark:text-slate-100">{formatCents(ro.taxCents)}</dd>
              </div>
              <div className="flex justify-between gap-6 border-t border-slate-200 pt-1.5 dark:border-slate-800">
                <dt className="font-semibold text-slate-900 dark:text-slate-50">Total</dt>
                <dd className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-50">{formatCents(ro.totalCents)}</dd>
              </div>
            </dl>
          </Card>
        </div>

        <aside className="space-y-4">
          {ro.status !== "INVOICED" && ro.status !== "CANCELLED" ? (
            <Card><AssignPicker repairOrderId={ro.id} technicianId={ro.technicianId} people={people} /></Card>
          ) : null}

          <Card>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Inspections
            </h2>
            {ro.inspections.length > 0 ? (
              <ul className="mb-3 space-y-1.5 text-sm">
                {ro.inspections.map((i) => (
                  <li key={i.id}>
                    <Link href={`/repair-orders/${ro.id}/inspection/${i.id}`} className="text-slate-800 underline dark:text-slate-200">
                      {i.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </Link>
                    <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                      {i.status === "SENT" ? "sent to customer" : i.status === "COMPLETE" ? "complete" : "in progress"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {ro.status !== "CANCELLED" ? (
              <StartInspection repairOrderId={ro.id} templates={templates} />
            ) : null}
          </Card>

          <NotesAndDiscount
            repairOrderId={ro.id}
            complaint={ro.complaint}
            customerNote={ro.customerNote}
            internalNote={ro.internalNote}
            discountPct={ro.discountPct}
            editable={editable}
          />

          <Card>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Notes</h2>
            <NoteForm repairOrderId={ro.id} />
            {ro.notes.length > 0 ? (
              <ul className="mt-4 space-y-3 border-t border-slate-100 pt-3 text-sm dark:border-slate-800">
                {ro.notes.map((n) => (
                  <li key={n.id}>
                    <p className="text-slate-800 dark:text-slate-200">{n.body}</p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {n.author?.name ?? "Someone"}
                      {" · "}
                      {n.createdAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>

          <Card>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">History</h2>
            <ul className="space-y-1.5 text-sm text-slate-600 dark:text-slate-400">
              {ro.events.map((e) => (
                <li key={e.id}>
                  <span className="tabular-nums">
                    {e.createdAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </span>
                  {" — "}
                  {e.note ?? `${e.from ? STATUS_LABEL[e.from] : "New"} → ${STATUS_LABEL[e.to]}`}
                  {e.user ? ` (${e.user.name})` : ""}
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>
    </div>
  );
}
