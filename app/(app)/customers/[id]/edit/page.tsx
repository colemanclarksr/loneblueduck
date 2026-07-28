import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/session";
import { getCustomer, displayName } from "@/lib/customers";
import { CustomerForm } from "../../CustomerForm";

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("customer:write");
  const { id } = await params;
  const customer = await getCustomer(session.tenant.id, id);
  // A customer belonging to another shop is indistinguishable from one that
  // does not exist, which is the point.
  if (!customer) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-2xl font-bold text-slate-900 dark:text-slate-50">Edit {displayName(customer)}</h1>
      <CustomerForm customer={customer} />
    </div>
  );
}
