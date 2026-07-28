import { requirePermission } from "@/lib/session";
import { Placeholder } from "../_placeholder";

export default async function Page() {
  await requirePermission("settings:users");
  return <Placeholder title="Settings" sprint="Sprint 10" blurb="Users and roles, tax and labor rates, receipt text and payment configuration." />;
}
