import Link from "next/link";
import { requirePermission } from "@/lib/session";
import { can } from "@/lib/permissions";
import { listItems, stockValueCents, isLow } from "@/lib/inventory";
import { formatCents } from "@/lib/money";
import { Empty, LinkButton } from "../_ui";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; low?: string }>;
}) {
  const session = await requirePermission("inventory:write");
  const { q = "", low } = await searchParams;

  const lowOnly = low === "1";
  const items = await listItems(session.tenant.id, { q, lowStock: lowOnly });
  const showCost = can(session.membership.role, "reports:financial");
  const value = showCost ? await stockValueCents(session.tenant.id) : null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Inventory</h1>
        <div className="ml-auto flex items-center gap-3">
          {value != null ? (
            <span className="text-sm text-slate-600 dark:text-slate-400">
              {formatCents(value)} on the shelf
            </span>
          ) : null}
          <LinkButton href="/inventory/new" variant="primary">Add a part</LinkButton>
        </div>
      </div>

      <form className="mt-4 flex flex-wrap gap-2" action="/inventory">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search name, SKU or tire size"
          className="h-12 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
          aria-label="Search parts"
        />
        {lowOnly ? <input type="hidden" name="low" value="1" /> : null}
        <button type="submit" className="h-12 rounded-xl bg-slate-900 px-5 text-base font-semibold text-white dark:bg-slate-50 dark:text-slate-900">
          Search
        </button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href={`/inventory${q ? `?q=${encodeURIComponent(q)}` : ""}`}
          className={`inline-flex h-10 items-center rounded-full px-4 text-sm font-medium ${
            !lowOnly
              ? "bg-slate-900 text-white dark:bg-slate-50 dark:text-slate-900"
              : "bg-white text-slate-600 ring-1 ring-slate-300 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700"
          }`}
        >
          Everything
        </Link>
        <Link
          href={`/inventory?low=1${q ? `&q=${encodeURIComponent(q)}` : ""}`}
          className={`inline-flex h-10 items-center rounded-full px-4 text-sm font-medium ${
            lowOnly
              ? "bg-slate-900 text-white dark:bg-slate-50 dark:text-slate-900"
              : "bg-white text-slate-600 ring-1 ring-slate-300 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700"
          }`}
        >
          Needs reordering
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="mt-4">
          <Empty>
            {lowOnly
              ? "Nothing is at its reorder point."
              : q
                ? `Nothing matches “${q}”.`
                : "No parts on file yet. Add the ones you sell most and the rest can wait."}
          </Empty>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={`/inventory/${item.id}`}
                className="block rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 hover:ring-slate-400 dark:bg-slate-900 dark:ring-slate-800 dark:hover:ring-slate-600"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-semibold text-slate-900 dark:text-slate-50">{item.name}</span>
                  <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{item.sku}</span>
                  {item.tireSize ? (
                    <span className="text-sm text-slate-600 dark:text-slate-400">{item.tireSize}</span>
                  ) : null}
                  {isLow(item) ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-300">
                      reorder
                    </span>
                  ) : null}
                  <span className="ml-auto flex items-baseline gap-4">
                    <span className={`tabular-nums ${item.qtyOnHand < 0 ? "font-semibold text-red-600 dark:text-red-400" : "text-slate-600 dark:text-slate-400"}`}>
                      {item.qtyOnHand} on hand
                    </span>
                    <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-50">
                      {formatCents(item.priceCents)}
                    </span>
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
