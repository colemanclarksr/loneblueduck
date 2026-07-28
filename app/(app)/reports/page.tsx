import { requirePermission } from "@/lib/session";
import { Placeholder } from "../_placeholder";

export default async function Page() {
  await requirePermission("reports:financial");
  return <Placeholder title="Reports" sprint="Sprint 6" blurb="Sales, tax, payment type, card volume, unpaid invoices and advisor performance." />;
}
