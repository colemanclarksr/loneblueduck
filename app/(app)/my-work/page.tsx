import { requirePermission } from "@/lib/session";
import { Placeholder } from "../_placeholder";

export default async function Page() {
  await requirePermission("job:update");
  return <Placeholder title="My Work" sprint="Sprint 4" blurb="Your assigned jobs, with status updates, notes and photos." />;
}
