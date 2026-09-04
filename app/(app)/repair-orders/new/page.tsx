import Link from "next/link";
import { requirePermission } from "@/lib/session";
import { searchCustomers, displayName, describeVehicle } from "@/lib/customers";
import { Empty } from "../../_ui";
import { WalkInForm, type PickerCustomer } from "./WalkInForm";

export default async function NewWalkInPage() {
  const session = await requirePermission("ro:write");
  const customers = await searchCustomers(session.tenant.id, "", 500);

  const picker: PickerCustomer[] = customers.map((c) => ({
    id: c.id,
    label: displayName(c) + (c.phone ? ` · ${c.phone}` : ""),
    vehicles: c.vehicles.map((v) => ({
      id: v.id,
      label: describeVehicle(v) + (v.plate ? ` · ${v.plate}` : ""),
      mileage: v.mileage,
    })),
  }));

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Counter ticket</h1>
      <p className="mb-4 mt-1 text-slate-600 dark:text-slate-400">
        Opens a repair order straight away, with no estimate to approve first.
      </p>
      {picker.length === 0 ? (
        <Empty>
          You need a customer first.{" "}
          <Link href="/customers/new" className="font-medium underline">Add one</Link>.
        </Empty>
      ) : (
        <WalkInForm customers={picker} />
      )}
    </div>
  );
}
