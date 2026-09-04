import Link from "next/link";
import { requirePermission } from "@/lib/session";
import { listInvoices, STATUS_LABEL } from "@/lib/invoices";
import { displayName, describeVehicle } from "@/lib/customers";
import { formatCents } from "@/lib/money";
import { Empty } from "../_ui";
import type { InvoiceStatus } from "@/lib/generated/prisma";

const BADGE: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  OPEN: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  PARTIAL: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  PAID: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  VOID: "bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

const FILTERS = [
  { key: "unpaid", label: "Owed" },
  { key: "PAID", label: "Paid" },
  { key: "all", label: "All" },
] as const;

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const session = await requirePermission("payment:take");
  const { filter = "unpaid" } = await searchParams;

  const invoices = await listInvoices(
    session.tenant.id,
    filter === "unpaid" ? { unpaid: true } : filter === "all" ? {} : { status: filter as InvoiceStatus },
  );
  const owed = invoices.reduce((sum, i) => sum + i.balanceDueCents, 0);
  const now = new Date();

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Invoices</h1>
        {filter === "unpaid" && owed > 0 ? (
          <span className="ml-auto text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">
            {formatCents(owed)} outstanding
          </span>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/invoices?filter=${f.key}`}
            className={`inline-flex h-10 items-center rounded-full px-4 text-sm font-medium ${
              filter === f.key
                ? "bg-slate-900 text-white dark:bg-slate-50 dark:text-slate-900"
                : "bg-white text-slate-600 ring-1 ring-slate-300 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {invoices.length === 0 ? (
        <div className="mt-4">
          <Empty>
            {filter === "unpaid"
              ? "Nothing outstanding. Invoices appear here when a finished repair order is billed."
              : "No invoices match this filter."}
          </Empty>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {invoices.map((inv) => {
            const overdue = inv.dueAt != null && inv.dueAt < now && inv.balanceDueCents > 0;
            return (
              <li key={inv.id}>
                <Link
                  href={`/invoices/${inv.id}`}
                  className="block rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 hover:ring-slate-400 dark:bg-slate-900 dark:ring-slate-800 dark:hover:ring-slate-600"
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-semibold text-slate-900 dark:text-slate-50">#{inv.number}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[inv.status]}`}>
                      {STATUS_LABEL[inv.status]}
                    </span>
                    {overdue ? (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950 dark:text-red-300">
                        overdue
                      </span>
                    ) : null}
                    <span className="text-slate-900 dark:text-slate-100">{displayName(inv.customer)}</span>
                    <span className="text-sm text-slate-600 dark:text-slate-400">{describeVehicle(inv.vehicle)}</span>
                    <span className="ml-auto text-right">
                      <span className="block font-semibold tabular-nums text-slate-900 dark:text-slate-50">
                        {formatCents(inv.totalCents)}
                      </span>
                      {inv.balanceDueCents > 0 && inv.balanceDueCents !== inv.totalCents ? (
                        <span className="block text-xs tabular-nums text-slate-500 dark:text-slate-400">
                          {formatCents(inv.balanceDueCents)} due
                        </span>
                      ) : null}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
