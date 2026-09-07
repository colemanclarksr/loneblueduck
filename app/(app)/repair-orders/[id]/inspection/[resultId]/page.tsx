import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/session";
import { can } from "@/lib/permissions";
import { getInspection, groupItems, summarise } from "@/lib/inspections";
import { describeVehicle, displayName } from "@/lib/customers";
import { Card } from "../../../../_ui";
import { ItemRow, FinishBar, type Item } from "./Checklist";

export default async function InspectionPage({
  params,
}: {
  params: Promise<{ id: string; resultId: string }>;
}) {
  const session = await requirePermission("job:update");
  const { id, resultId } = await params;

  const inspection = await getInspection(session.tenant.id, resultId);
  if (!inspection || inspection.repairOrderId !== id) notFound();

  const counts = summarise(inspection.items);
  const groups = groupItems(inspection.items);
  const frozen = inspection.status === "SENT";

  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
  const shareUrl = inspection.shareToken ? `${origin}/inspection/${inspection.shareToken}` : null;

  return (
    <div className="mx-auto max-w-3xl">
      <Link href={`/repair-orders/${id}`} className="text-sm text-slate-500 hover:underline dark:text-slate-400">
        ← RO #{inspection.repairOrder.number}
      </Link>

      <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-50">
        {inspection.template?.name ?? "Inspection"}
      </h1>
      <p className="mt-1 text-slate-700 dark:text-slate-300">
        {describeVehicle(inspection.repairOrder.vehicle)} · {displayName(inspection.repairOrder.customer)}
      </p>

      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        <span className="rounded-full bg-emerald-100 px-3 py-1 font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          {counts.GREEN} good
        </span>
        <span className="rounded-full bg-amber-100 px-3 py-1 font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-300">
          {counts.YELLOW} watch
        </span>
        <span className="rounded-full bg-red-100 px-3 py-1 font-medium text-red-800 dark:bg-red-950 dark:text-red-300">
          {counts.RED} needs work
        </span>
        <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
          {counts.checked} of {counts.total} checked
        </span>
      </div>

      {frozen ? (
        <p className="mt-3 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          This inspection has been sent to the customer, so it can no longer be changed. Start a new one if something
          else turns up.
        </p>
      ) : null}

      <div className="mt-4 space-y-4">
        {groups.map(({ section, items }) => (
          <Card key={section}>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">{section}</h2>
            <ul>
              {items.map((item) => (
                <ItemRow key={item.id} item={item as Item} repairOrderId={id} frozen={frozen} />
              ))}
            </ul>
          </Card>
        ))}

        <FinishBar
          resultId={inspection.id}
          repairOrderId={id}
          status={inspection.status}
          canSend={can(session.membership.role, "message:send")}
          shareUrl={shareUrl}
        />
      </div>
    </div>
  );
}
