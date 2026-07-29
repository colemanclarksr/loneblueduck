import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/session";
import { db } from "@/lib/db";
import { groupBySection } from "@/lib/estimates";
import { displayName, describeVehicle } from "@/lib/customers";
import { formatCents } from "@/lib/money";
import { Card } from "../../_ui";

export default async function RepairOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("ro:write");
  const { id } = await params;

  const ro = await db.repairOrder.findFirst({
    where: { id, tenantId: session.tenant.id },
    include: {
      customer: true, vehicle: true, estimate: { select: { id: true, number: true } },
      technician: { select: { name: true } }, advisor: { select: { name: true } },
      invoices: { select: { id: true, number: true, status: true } },
      events: { orderBy: { createdAt: "asc" }, include: { user: { select: { name: true } } } },
    },
  });
  if (!ro) notFound();

  const lines = await db.lineItem.findMany({
    where: { tenantId: session.tenant.id, parentType: "REPAIR_ORDER", parentId: ro.id },
    orderBy: { sort: "asc" },
  });
  const sections = groupBySection(lines);

  return (
    <div>
      <Link href="/repair-orders" className="text-sm text-slate-500 hover:underline dark:text-slate-400">← Repair orders</Link>
      <div className="mt-1 flex flex-wrap items-start gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">RO #{ro.number}</h1>
          <p className="mt-1 text-slate-700 dark:text-slate-300">
            <Link href={`/customers/${ro.customerId}`} className="font-medium hover:underline">
              {displayName(ro.customer)}
            </Link>
            {" · "}{describeVehicle(ro.vehicle)}
            {ro.mileageIn != null ? ` · ${ro.mileageIn.toLocaleString("en-US")} mi` : ""}
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {ro.status.replace("_", " ").toLowerCase()}
            {ro.estimate ? <> · from <Link href={`/estimates/${ro.estimate.id}`} className="underline">estimate #{ro.estimate.number}</Link></> : null}
            {ro.technician ? ` · tech ${ro.technician.name}` : ""}
          </p>
        </div>
        <div className="ml-auto text-right">
          <div className="text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-50">{formatCents(ro.totalCents)}</div>
          {ro.invoices[0] ? (
            <div className="text-sm text-slate-600 dark:text-slate-400">Invoice #{ro.invoices[0].number}</div>
          ) : null}
        </div>
      </div>

      <div className="mt-5 space-y-4">
        {sections.map(({ section, items }) => (
          <Card key={section}>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">{section}</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {items.map((i) => (
                <li key={i.id} className="flex justify-between gap-4 text-slate-700 dark:text-slate-300">
                  <span>{i.name}{i.qty !== 1 ? ` × ${i.qty}` : ""}</span>
                  <span className="tabular-nums">{formatCents(Math.round(i.qty * i.priceCents))}</span>
                </li>
              ))}
            </ul>
          </Card>
        ))}

        {ro.events.length > 0 ? (
          <Card>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">History</h2>
            <ul className="space-y-1 text-sm text-slate-600 dark:text-slate-400">
              {ro.events.map((e) => (
                <li key={e.id}>
                  {e.createdAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  {" — "}{e.note ?? `${e.from ?? "new"} → ${e.to}`}
                  {e.user ? ` (${e.user.name})` : ""}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
