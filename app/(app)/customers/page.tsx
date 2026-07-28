import { requirePermission } from "@/lib/session";
import { Placeholder } from "../_placeholder";

export default async function Page() {
  await requirePermission("customer:write");
  return <Placeholder title="Customers" sprint="Sprint 2" blurb="Customer and vehicle records, searchable by name, phone, VIN and plate." />;
}
