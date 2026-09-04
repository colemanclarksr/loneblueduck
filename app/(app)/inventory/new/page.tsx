import { requirePermission } from "@/lib/session";
import { ItemForm } from "../ItemForm";

export default async function NewItemPage() {
  await requirePermission("inventory:write");
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-2xl font-bold text-slate-900 dark:text-slate-50">Add a part</h1>
      <ItemForm />
    </div>
  );
}
