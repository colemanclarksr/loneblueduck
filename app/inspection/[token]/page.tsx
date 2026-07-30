import { notFound } from "next/navigation";
import { getInspectionByToken, groupItems, summarise } from "@/lib/inspections";
import { displayName, describeVehicle } from "@/lib/customers";

// Public: no session, no shell, nothing about the shop's internals. The token
// in the URL is the only credential, and it only exists once the inspection
// has been deliberately sent.
export const dynamic = "force-dynamic";

const STYLE: Record<string, { dot: string; label: string; card: string }> = {
  RED: {
    dot: "bg-red-500",
    label: "Needs attention",
    card: "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40",
  },
  YELLOW: {
    dot: "bg-amber-500",
    label: "Worth watching",
    card: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40",
  },
  GREEN: {
    dot: "bg-emerald-500",
    label: "Good",
    card: "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900",
  },
  NA: {
    dot: "bg-slate-300",
    label: "Not checked",
    card: "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900",
  },
};

export default async function PublicInspectionPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inspection = await getInspectionByToken(token);
  if (!inspection) notFound();

  const counts = summarise(inspection.items);
  // The customer reads the problems first. Everything that was fine is still
  // listed underneath, because "we checked and it was fine" is most of the
  // value of handing this over.
  const attention = inspection.items.filter((i) => i.condition === "RED" || i.condition === "YELLOW");
  const rest = groupItems(inspection.items.filter((i) => i.condition === "GREEN" || i.condition === "NA"));

  const shop = inspection.repairOrder.location;

  return (
    <main className="min-h-dvh bg-slate-100 p-4 dark:bg-slate-950">
      <div className="mx-auto max-w-lg py-6">
        <header className="mb-6 text-center">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50">{shop?.name ?? "Your shop"}</h1>
          <p className="mt-1 text-slate-600 dark:text-slate-400">
            Inspection for {displayName(inspection.repairOrder.customer)}
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {describeVehicle(inspection.repairOrder.vehicle)}
            {inspection.repairOrder.vehicle.plate ? ` · ${inspection.repairOrder.vehicle.plate}` : ""}
          </p>
        </header>

        <div className="mb-5 rounded-2xl bg-white p-5 text-center shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          {counts.RED > 0 ? (
            <p className="text-lg font-semibold text-slate-900 dark:text-slate-50">
              We found {counts.RED} thing{counts.RED === 1 ? "" : "s"} that need
              {counts.RED === 1 ? "s" : ""} attention.
            </p>
          ) : counts.YELLOW > 0 ? (
            <p className="text-lg font-semibold text-slate-900 dark:text-slate-50">
              Nothing urgent — {counts.YELLOW} thing{counts.YELLOW === 1 ? "" : "s"} to keep an eye on.
            </p>
          ) : (
            <p className="text-lg font-semibold text-slate-900 dark:text-slate-50">Everything checked out fine.</p>
          )}
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            We checked {counts.checked} item{counts.checked === 1 ? "" : "s"} on your vehicle.
          </p>
        </div>

        {attention.length > 0 ? (
          <section className="mb-5 space-y-3">
            {attention.map((item) => {
              const style = STYLE[item.condition];
              return (
                <div key={item.id} className={`rounded-2xl border p-4 ${style.card}`}>
                  <div className="flex items-start gap-3">
                    <span className={`mt-1.5 size-3 shrink-0 rounded-full ${style.dot}`} aria-hidden />
                    <div>
                      <h2 className="font-semibold text-slate-900 dark:text-slate-50">{item.label}</h2>
                      <p className="text-sm font-medium text-slate-600 dark:text-slate-400">{style.label}</p>
                      {item.notes ? (
                        <p className="mt-1.5 text-slate-800 dark:text-slate-200">{item.notes}</p>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </section>
        ) : null}

        {rest.length > 0 ? (
          <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Everything else we looked at
            </h2>
            <div className="space-y-4">
              {rest.map(({ section, items }) => (
                <div key={section}>
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{section}</h3>
                  <ul className="mt-1 space-y-1">
                    {items.map((item) => (
                      <li key={item.id} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                        <span className={`size-2 shrink-0 rounded-full ${STYLE[item.condition].dot}`} aria-hidden />
                        {item.label}
                        {item.condition === "NA" ? (
                          <span className="text-xs text-slate-400 dark:text-slate-500">not checked</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <p className="mt-6 text-center text-sm text-slate-600 dark:text-slate-400">
          Questions? Call {shop?.phone ?? "the shop"} and we will walk you through it.
        </p>
        <p className="mt-2 text-center text-xs text-slate-500 dark:text-slate-500">
          Inspected{" "}
          {(inspection.completedAt ?? inspection.createdAt).toLocaleDateString("en-US", {
            month: "long", day: "numeric", year: "numeric",
          })}
        </p>
      </div>
    </main>
  );
}
