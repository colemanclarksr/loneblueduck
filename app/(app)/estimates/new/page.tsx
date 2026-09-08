import Link from "next/link";
import { requirePermission } from "@/lib/session";
import { searchCustomers, displayName, describeVehicle } from "@/lib/customers";
import { Empty } from "../../_ui";
import { NewEstimateForm, type PickerCustomer } from "./NewEstimateForm";

export default async function NewEstimatePage() {
  const session = await requirePermission("estimate:write");
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
      <h1 className="mb-4 text-2xl font-bold text-slate-900 dark:text-slate-50">New estimate</h1>
      {picker.length === 0 ? (
        <Empty>
          You need a customer first.{" "}
          <Link href="/customers/new" className="font-medium underline">Add one</Link>.
        </Empty>
      ) : (
        <NewEstimateForm customers={picker} />
      )}
    </div>
  );
}
