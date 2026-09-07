import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession, clearSessionCookie, SESSION_COOKIE } from "@/lib/session";
import { navFor } from "@/lib/permissions";
import { db } from "@/lib/db";
import { destroySession } from "@/lib/auth";
import { cookies } from "next/headers";

async function signOut() {
  "use server";
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (id) await destroySession(db, id);
  await clearSessionCookie();
  redirect("/login");
}

const ROLE_LABEL: Record<string, string> = {
  OWNER: "Owner",
  MANAGER: "Manager",
  SERVICE_ADVISOR: "Service Advisor",
  TECHNICIAN: "Technician",
  COUNTER_CLERK: "Counter",
  BOOKKEEPER: "Bookkeeper",
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const nav = navFor(session.membership.role);

  return (
    <div className="min-h-dvh bg-slate-100 dark:bg-slate-950">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
          <Link href="/dashboard" className="text-lg font-bold text-slate-900 dark:text-slate-50">
            Shop&nbsp;Desk
          </Link>
          <span className="hidden text-sm text-slate-500 sm:inline dark:text-slate-400">
            {session.tenant.name}
          </span>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                {session.user.name}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {ROLE_LABEL[session.membership.role] ?? session.membership.role}
              </div>
            </div>
            <form action={signOut}>
              <button
                type="submit"
                className="h-11 rounded-lg px-3 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>

        {/* Scrolls sideways on a phone rather than wrapping into two rows. */}
        <nav className="mx-auto max-w-7xl overflow-x-auto px-2 pb-1">
          <ul className="flex gap-1">
            {nav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="mx-auto max-w-7xl p-4">{children}</main>
    </div>
  );
}
