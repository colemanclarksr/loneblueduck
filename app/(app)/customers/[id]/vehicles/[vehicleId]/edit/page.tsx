import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/session";
import { getVehicle, describeVehicle } from "@/lib/customers";
import { VehicleForm } from "../../../../VehicleForm";

export default async function EditVehiclePage({
  params,
}: {
  params: Promise<{ id: string; vehicleId: string }>;
}) {
  const session = await requirePermission("customer:write");
  const { id, vehicleId } = await params;
  const vehicle = await getVehicle(session.tenant.id, vehicleId);
  // Guard the pairing too: a vehicle in this tenant but under a different
  // customer must not be editable through this customer's URL.
  if (!vehicle || vehicle.customerId !== id) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-2xl font-bold text-slate-900 dark:text-slate-50">Edit {describeVehicle(vehicle)}</h1>
      <VehicleForm customerId={id} vehicle={vehicle} />
    </div>
  );
}
