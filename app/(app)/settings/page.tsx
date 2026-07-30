import { requirePermission } from "@/lib/session";
import { can } from "@/lib/permissions";
import { getShop, listMembers, listPackages, recentAudit, ROLE_LABEL, ROLE_BLURB } from "@/lib/settings";
import { Card } from "../_ui";
import { ShopPanel, PeoplePanel, PackagesPanel, type Member, type Pkg } from "./SettingsPanels";

export default async function SettingsPage() {
  const session = await requirePermission("settings:users");
  const role = session.membership.role;

  const [shop, members, packages] = await Promise.all([
    getShop(session.tenant.id),
    listMembers(session.tenant.id),
    listPackages(session.tenant.id),
  ]);
  const audit = can(role, "audit:view") ? await recentAudit(session.tenant.id, 40) : [];

  const location = shop.locations[0];

  const people: Member[] = members.map((m) => ({
    id: m.id,
    role: m.role,
    active: m.active,
    name: m.user.name,
    email: m.user.email,
    isSelf: m.userId === session.user.id,
  }));

  const pkgs: Pkg[] = packages.map((p) => ({
    id: p.id,
    name: p.name,
    items: p.items.map((i) => ({
      kind: i.kind,
      name: i.name,
      qty: i.qty,
      priceCents: i.priceCents,
    })),
  }));

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Settings</h1>
      <p className="mt-1 text-slate-600 dark:text-slate-400">{shop.name}</p>

      <div className="mt-4 space-y-4">
        {location ? (
          <ShopPanel
            shop={{
              locationId: location.id,
              name: location.name,
              phone: location.phone,
              email: location.email,
              address: location.address,
              city: location.city,
              state: location.state,
              zip: location.zip,
              taxRate: location.taxRate,
              laborRateCents: location.laborRateCents,
              receiptFooter: location.receiptFooter,
            }}
            editable={can(role, "settings:tax")}
          />
        ) : null}

        <PeoplePanel members={people} roleLabels={ROLE_LABEL} roleBlurbs={ROLE_BLURB} />

        <PackagesPanel packages={pkgs} />

        <Card>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Card processing
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Payments are recorded against whatever terminal or gateway you already use. This system stores a brand,
            the last four digits and the processor&apos;s own reference — never a card number, and never anything a
            card could be reconstructed from.
          </p>
        </Card>

        {audit.length > 0 ? (
          <Card>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Recent activity
            </h2>
            <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {audit.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 py-1.5">
                  <span className="font-medium text-slate-800 dark:text-slate-200">
                    {entry.action.replace(/_/g, " ").toLowerCase()}
                  </span>
                  <span className="text-slate-500 dark:text-slate-400">{entry.entityType}</span>
                  <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
                    {entry.user?.name ?? "system"}
                    {" · "}
                    {entry.createdAt.toLocaleString("en-US", {
                      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
