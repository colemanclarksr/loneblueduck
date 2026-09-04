import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/session";
import { getItem } from "@/lib/inventory";
import { ItemForm } from "../../ItemForm";

export default async function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("inventory:write");
  const { id } = await params;

  const item = await getItem(session.tenant.id, id);
  if (!item) notFound();

  return (
    <div className="mx-auto max-w-2xl">
      <Link href={`/inventory/${item.id}`} className="text-sm text-slate-500 hover:underline dark:text-slate-400">
        ← {item.name}
      </Link>
      <h1 className="mb-4 mt-1 text-2xl font-bold text-slate-900 dark:text-slate-50">Edit part</h1>
      <ItemForm
        item={{
          id: item.id,
          sku: item.sku,
          name: item.name,
          category: item.category,
          vendor: item.vendor,
          tireSize: item.tireSize,
          costCents: item.costCents,
          priceCents: item.priceCents,
          reorderPoint: item.reorderPoint,
        }}
      />
    </div>
  );
}
