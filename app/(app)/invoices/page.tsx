import { requirePermission } from "@/lib/session";
import { Placeholder } from "../_placeholder";

export default async function Page() {
  await requirePermission("payment:take");
  return <Placeholder title="Invoices" sprint="Sprint 5" blurb="Finalize an invoice from a completed repair order and take payment." />;
}
