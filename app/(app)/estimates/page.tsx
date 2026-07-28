import { requirePermission } from "@/lib/session";
import { Placeholder } from "../_placeholder";

export default async function Page() {
  await requirePermission("estimate:write");
  return <Placeholder title="Estimates" sprint="Sprint 3" blurb="Build an estimate with labor, parts, fees, taxes and discounts, then send it for approval." />;
}
