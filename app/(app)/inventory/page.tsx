import { requirePermission } from "@/lib/session";
import { Placeholder } from "../_placeholder";

export default async function Page() {
  await requirePermission("inventory:write");
  return <Placeholder title="Inventory" sprint="Sprint 8" blurb="Parts and tire stock with costs, margins, reorder points and adjustments." />;
}
