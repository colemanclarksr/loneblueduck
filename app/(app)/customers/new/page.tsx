import { requirePermission } from "@/lib/session";
import { CustomerForm } from "../CustomerForm";

export default async function NewCustomerPage() {
  await requirePermission("customer:write");
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-2xl font-bold text-slate-900 dark:text-slate-50">New customer</h1>
      <CustomerForm />
    </div>
  );
}
