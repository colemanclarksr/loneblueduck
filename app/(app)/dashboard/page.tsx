import Link from "next/link";
import { requireSession } from "@/lib/session";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { listItems } from "@/lib/inventory";
import { LinkButton } from "../_ui";

// Blueprint §4: daily sales, open ROs, paid/unpaid invoices, average ticket,
// card volume. Financial tiles are withheld from roles that §5 says cannot see
// them, so a technician's dashboard is their work queue and nothing else.
async function loadStats(tenantId: string) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [openEstimates, openROs, unpaid, todayPayments, paidToday] = await Promise.all([
    db.estimate.count({ where: { tenantId, status: { in: ["DRAFT", "SENT"] } } }),
    db.repairOrder.count({ where: { tenantId, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    db.invoice.aggregate({
      where: { tenantId, status: { in: ["OPEN", "PARTIAL"] } },
      _sum: { balanceDueCents: true },
      _count: true,
    }),
    db.payment.aggregate({
      where: { tenantId, status: "CAPTURED", capturedAt: { gte: startOfDay } },
      _sum: { amountCents: true },
    }),
    db.invoice.aggregate({
      where: { tenantId, status: "PAID", paidAt: { gte: startOfDay } },
      _sum: { totalCents: true },
      _count: true,
    }),
  ]);

  const cardVolume = await db.payment.aggregate({
    where: { tenantId, status: "CAPTURED", method: "CARD", capturedAt: { gte: startOfDay } },
    _sum: { amountCents: true },
  });

  // Filtered in JS because "at or below the reorder point" compares two
  // columns, which Prisma cannot express in a where clause.
  const lowStock = (await listItems(tenantId, { lowStock: true })).length;

  const ticketCount = paidToday._count;
  return {
    lowStock,
    openEstimates,
    openROs,
    unpaidCount: unpaid._count,
    unpaidCents: unpaid._sum.balanceDueCents ?? 0,
    todayCents: todayPayments._sum.amountCents ?? 0,
    cardCents: cardVolume._sum.amountCents ?? 0,
    averageTicketCents: ticketCount > 0 ? Math.round((paidToday._sum.totalCents ?? 0) / ticketCount) : 0,
  };
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <div className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-2 text-3xl font-bold tabular-nums text-slate-900 dark:text-slate-50">{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</div> : null}
    </div>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const session = await requireSession();
  const { denied } = await searchParams;
  const showMoney = can(session.membership.role, "reports:financial");
  const stats = await loadStats(session.tenant.id);

  return (
    <div>
      {denied ? (
        <p
          role="alert"
          className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
        >
          Your role does not have access to that page.
        </p>
      ) : null}

      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
        Good day, {session.user.name.split(" ")[0]}
      </h1>
      <p className="mt-1 text-slate-600 dark:text-slate-400">{session.tenant.name}</p>

      <div className="mt-5 flex flex-wrap gap-3">
        {can(session.membership.role, "estimate:write") ? (
          <LinkButton href="/estimates/new" variant="primary">New estimate</LinkButton>
        ) : null}
        {can(session.membership.role, "ro:write") ? (
          <LinkButton href="/repair-orders/new">Counter ticket</LinkButton>
        ) : null}
        {can(session.membership.role, "job:update") && !showMoney ? (
          <LinkButton href="/my-work" variant="primary">My work</LinkButton>
        ) : null}
      </div>

      {stats.lowStock > 0 ? (
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
          {stats.lowStock} part{stats.lowStock === 1 ? " is" : "s are"} at or below the reorder point.{" "}
          <Link href="/inventory?low=1" className="underline">See what to order</Link>.
        </p>
      ) : null}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Open estimates" value={String(stats.openEstimates)} />
        <Tile label="Open repair orders" value={String(stats.openROs)} />
        {showMoney ? (
          <>
            <Tile
              label="Unpaid invoices"
              value={formatCents(stats.unpaidCents)}
              hint={`${stats.unpaidCount} invoice${stats.unpaidCount === 1 ? "" : "s"} outstanding`}
            />
            <Tile label="Collected today" value={formatCents(stats.todayCents)} />
            <Tile label="Card volume today" value={formatCents(stats.cardCents)} />
            <Tile label="Average ticket today" value={formatCents(stats.averageTicketCents)} />
          </>
        ) : null}
      </div>

      {!showMoney ? (
        <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">
          Financial figures are visible to owners, managers and bookkeepers.
        </p>
      ) : null}
    </div>
  );
}
