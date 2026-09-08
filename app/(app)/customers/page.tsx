import Link from "next/link";
import { requirePermission } from "@/lib/session";
import { searchCustomers, displayName, describeVehicle } from "@/lib/customers";
import { LinkButton, Empty } from "../_ui";

const TYPE_BADGE: Record<string, string> = {
  RETAIL: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  FLEET: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  WHOLESALE: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300",
};

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requirePermission("customer:write");
  const { q = "" } = await searchParams;
  const customers = await searchCustomers(session.tenant.id, q);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Customers</h1>
        <div className="ml-auto">
          <LinkButton href="/customers/new" variant="primary">New customer</LinkButton>
        </div>
      </div>

      {/* A GET form, so a search is a plain URL the counter can bookmark or reload. */}
      <form className="mt-4 flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Name, phone, VIN or plate"
          aria-label="Search customers"
          className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-900 outline-none focus:border-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
        />
        <button
          type="submit"
          className="h-12 shrink-0 rounded-xl bg-slate-900 px-5 text-base font-semibold text-white dark:bg-slate-50 dark:text-slate-900"
        >
          Search
        </button>
      </form>

      <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
        {customers.length === 0
          ? "No matches"
          : `${customers.length} customer${customers.length === 1 ? "" : "s"}${q ? ` matching “${q}”` : ""}`}
      </p>

      {customers.length === 0 ? (
        <div className="mt-4">
          <Empty>
            {q ? (
              <>
                Nothing matched “{q}”.{" "}
                <Link href="/customers" className="font-medium underline">Clear the search</Link>, or{" "}
                <Link href="/customers/new" className="font-medium underline">add a new customer</Link>.
              </>
            ) : (
              <>
                No customers yet.{" "}
                <Link href="/customers/new" className="font-medium underline">Add the first one</Link>.
              </>
            )}
          </Empty>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {customers.map((c) => (
            <li key={c.id}>
              <Link
                href={`/customers/${c.id}`}
                className="block rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 hover:ring-slate-400 dark:bg-slate-900 dark:ring-slate-800 dark:hover:ring-slate-600"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-lg font-semibold text-slate-900 dark:text-slate-50">{displayName(c)}</span>
                  {c.type !== "RETAIL" ? (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_BADGE[c.type]}`}>
                      {c.type === "FLEET" ? "Fleet" : "Wholesale"}
                    </span>
                  ) : null}
                  {c.taxExempt ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-300">
                      Tax exempt
                    </span>
                  ) : null}
                  {c.phone ? <span className="text-sm text-slate-600 dark:text-slate-400">{c.phone}</span> : null}
                </div>
                {c.vehicles.length > 0 ? (
                  <div className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                    {c.vehicles
                      .slice(0, 3)
                      .map((v) => `${describeVehicle(v)}${v.plate ? ` · ${v.plate}` : ""}`)
                      .join("   ·   ")}
                    {c.vehicles.length > 3 ? `   +${c.vehicles.length - 3} more` : ""}
                  </div>
                ) : (
                  <div className="mt-1 text-sm text-slate-400 dark:text-slate-500">No vehicles on file</div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
