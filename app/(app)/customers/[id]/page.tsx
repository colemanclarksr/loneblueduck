import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/session";
import { getCustomer, vehicleHistory, displayName, describeVehicle } from "@/lib/customers";
import { can } from "@/lib/permissions";
import { formatCents } from "@/lib/money";
import { LinkButton, Card, Empty } from "../../_ui";
import { DeleteCustomer } from "../DeleteCustomer";

const RO_BADGE: Record<string, string> = {
  OPEN: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  IN_PROGRESS: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  COMPLETE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  INVOICED: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  CANCELLED: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null;
  return (
    <div className="flex gap-3 py-1.5 text-sm">
      <dt className="w-32 shrink-0 text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-slate-900 dark:text-slate-100">{value}</dd>
    </div>
  );
}

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("customer:write");
  const { id } = await params;
  const customer = await getCustomer(session.tenant.id, id);
  if (!customer) notFound();

  // Service history per vehicle, per §7 Vehicle Management.
  const histories = await Promise.all(
    customer.vehicles.map(async (v) => ({ vehicle: v, orders: await vehicleHistory(session.tenant.id, v.id) })),
  );

  const showMoney = can(session.membership.role, "reports:financial");

  return (
    <div>
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <Link href="/customers" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            ← Customers
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-50">{displayName(customer)}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {customer.type === "RETAIL" ? "Retail" : customer.type === "FLEET" ? "Fleet account" : "Wholesale account"}
            {customer.taxExempt ? " · Tax exempt" : ""}
            {customer.billingTermsDays ? ` · Net ${customer.billingTermsDays}` : ""}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <LinkButton href={`/customers/${customer.id}/edit`}>Edit</LinkButton>
          <LinkButton href={`/customers/${customer.id}/vehicles/new`} variant="primary">Add vehicle</LinkButton>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <Card>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Contact</h2>
          <dl>
            <Row label="Phone" value={customer.phone} />
            <Row label="Email" value={customer.email} />
            <Row
              label="Address"
              value={
                [customer.address, [customer.city, customer.state].filter(Boolean).join(", "), customer.zip]
                  .filter(Boolean)
                  .join(" · ") || null
              }
            />
            {customer.smsOptOut || customer.emailOptOut ? (
              <Row
                label="Do not contact"
                value={[customer.smsOptOut ? "texts" : null, customer.emailOptOut ? "emails" : null].filter(Boolean).join(" and ")}
              />
            ) : null}
          </dl>
          {customer.notes ? (
            <p className="mt-3 whitespace-pre-wrap border-t border-slate-200 pt-3 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-300">
              {customer.notes}
            </p>
          ) : null}
        </Card>

        <div className="lg:col-span-2">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Vehicles &amp; service history
          </h2>

          {histories.length === 0 ? (
            <Empty>
              No vehicles on file.{" "}
              <Link href={`/customers/${customer.id}/vehicles/new`} className="font-medium underline">
                Add one
              </Link>
              .
            </Empty>
          ) : (
            <div className="space-y-3">
              {histories.map(({ vehicle, orders }) => (
                <Card key={vehicle.id}>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-lg font-semibold text-slate-900 dark:text-slate-50">{describeVehicle(vehicle)}</span>
                    {vehicle.plate ? (
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {vehicle.plate}
                      </span>
                    ) : null}
                    <Link
                      href={`/customers/${customer.id}/vehicles/${vehicle.id}/edit`}
                      className="ml-auto text-sm font-medium text-slate-600 hover:underline dark:text-slate-400"
                    >
                      Edit
                    </Link>
                  </div>

                  <div className="mt-1 flex flex-wrap gap-x-4 text-sm text-slate-600 dark:text-slate-400">
                    {vehicle.vin ? <span className="font-mono">{vehicle.vin}</span> : null}
                    {vehicle.mileage != null ? <span>{vehicle.mileage.toLocaleString("en-US")} mi</span> : null}
                    {vehicle.engine ? <span>{vehicle.engine}</span> : null}
                    {vehicle.tireSize ? <span>{vehicle.tireSize}</span> : null}
                  </div>

                  {orders.length === 0 ? (
                    <p className="mt-3 text-sm text-slate-400 dark:text-slate-500">No service history yet.</p>
                  ) : (
                    <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800">
                      {orders.map((ro) => (
                        <li key={ro.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                          <span className="font-medium text-slate-900 dark:text-slate-100">RO #{ro.number}</span>
                          <span className="text-slate-500 dark:text-slate-400">
                            {ro.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${RO_BADGE[ro.status]}`}>
                            {ro.status.replace("_", " ").toLowerCase()}
                          </span>
                          {ro.complaint ? (
                            <span className="w-full truncate text-slate-600 sm:w-auto sm:flex-1 dark:text-slate-400">{ro.complaint}</span>
                          ) : null}
                          {showMoney ? (
                            <span className="ml-auto font-medium tabular-nums text-slate-900 dark:text-slate-100">
                              {formatCents(ro.totalCents)}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      {can(session.membership.role, "customer:delete") ? (
        <div className="mt-6 border-t border-slate-200 pt-5 dark:border-slate-800">
          <DeleteCustomer customerId={customer.id} name={displayName(customer)} />
        </div>
      ) : null}
    </div>
  );
}
