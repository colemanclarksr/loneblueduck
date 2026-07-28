import { requirePermission } from "@/lib/session";
import { Placeholder } from "../_placeholder";

export default async function Page() {
  await requirePermission("ro:write");
  return <Placeholder title="Repair Orders" sprint="Sprint 4" blurb="Convert approved estimates, assign a technician and track status through to completion." />;
}
