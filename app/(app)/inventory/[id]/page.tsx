import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/session";
import { can } from "@/lib/permissions";
import { getItem, isLow } from "@/lib/inventory";
import { formatCents } from "@/lib/money";
import { Card } from "../../_ui";
import { AdjustForm, DeactivateButton } from "../ItemForm";

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("inventory:write");
  const { id } = await params;

  const item = await getItem(session.tenant.id, id);
  if (!item) notFound();

  const showCost = can(session.membership.role, "reports:financial");
  const marginCents = item.priceCents - item.costCents;
  const marginPct = item.priceCents > 0 ? Math.round((marginCents / item.priceCents) * 100) : 0;

  return (
    <div>
      <Link href="/inventory" className="text-sm text-slate-500 hover:underline dark:text-slate-400">← Inventory</Link>

      <div className="mt-1 flex flex-wrap items-start gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{item.name}</h1>
          <p className="mt-1 font-mono text-sm text-slate-500 dark:text-slate-400">{item.sku}</p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {[item.category, item.vendor, item.tireSize].filter(Boolean).join(" · ") || "No category set"}
          </p>
        </div>
        <div className="ml-auto text-right">
          <div className={`text-3xl font-bold tabular-nums ${item.qtyOnHand < 0 ? "text-red-600 dark:text-red-400" : "text-slate-900 dark:text-slate-50"}`}>
            {item.qtyOnHand}
          </div>
          <div className="text-sm text-slate-600 dark:text-slate-400">on hand</div>
          {isLow(item) ? (
            <div className="mt-1 text-sm font-medium text-amber-700 dark:text-amber-400">
              at or below {item.reorderPoint}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <Card>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Pricing
            </h2>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              {showCost ? (
                <div>
                  <dt className="text-slate-500 dark:text-slate-400">Your cost</dt>
                  <dd className="text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">{formatCents(item.costCents)}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-slate-500 dark:text-slate-400">Price</dt>
                <dd className="text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">{formatCents(item.priceCents)}</dd>
              </div>
              {showCost ? (
                <div>
                  <dt className="text-slate-500 dark:text-slate-400">Margin</dt>
                  <dd className="text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">
                    {formatCents(marginCents)}
                    <span className="ml-1 text-sm font-normal text-slate-500 dark:text-slate-400">{marginPct}%</span>
                  </dd>
                </div>
              ) : null}
            </dl>
            <div className="mt-3">
              <Link href={`/inventory/${item.id}/edit`} className="text-sm text-slate-600 hover:underline dark:text-slate-400">
                Edit details
              </Link>
            </div>
          </Card>

          <Card>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Movements
            </h2>
            {item.movements.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">Nothing has moved yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {item.movements.map((m) => (
                  <li key={m.id} className="flex items-baseline gap-3 py-2">
                    <span
                      className={`w-14 shrink-0 text-right font-semibold tabular-nums ${
                        m.qtyDelta < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"
                      }`}
                    >
                      {m.qtyDelta > 0 ? "+" : ""}{m.qtyDelta}
                    </span>
                    <span className="text-slate-800 dark:text-slate-200">{m.reason}</span>
                    <span className="ml-auto shrink-0 text-xs text-slate-500 dark:text-slate-400">
                      {m.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      {m.user ? ` · ${m.user.name}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <aside className="space-y-4">
          <Card>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Change the count
            </h2>
            <AdjustForm itemId={item.id} />
          </Card>
          <Card><DeactivateButton itemId={item.id} /></Card>
        </aside>
      </div>
    </div>
  );
}
