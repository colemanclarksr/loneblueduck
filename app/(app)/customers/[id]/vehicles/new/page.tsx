import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/session";
import { getCustomer, displayName } from "@/lib/customers";
import { VehicleForm } from "../../../VehicleForm";

export default async function NewVehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("customer:write");
  const { id } = await params;
  const customer = await getCustomer(session.tenant.id, id);
  if (!customer) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-2xl font-bold text-slate-900 dark:text-slate-50">
        Add a vehicle for {displayName(customer)}
      </h1>
      <VehicleForm customerId={customer.id} />
    </div>
  );
}
