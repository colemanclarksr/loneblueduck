"use client";

import { useActionState } from "react";
import { addPackageAction, type FormState } from "../actions";
import { ErrorNote } from "../../_ui";
import { formatCents } from "@/lib/money";

/**
 * One tap to drop a whole repair onto the estimate.
 *
 * Rendered as a row of buttons rather than a dropdown: a shop has five or six
 * of these, they are the most common thing on the screen, and a select box
 * hides them behind an extra tap on a tablet.
 */
export function PackagePicker({ estimateId, packages }: {
  estimateId: string;
  packages: { id: string; name: string; totalCents: number }[];
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(addPackageAction, {});
  if (packages.length === 0) return null;

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Common jobs
      </h2>
      <div className="flex flex-wrap gap-2">
        {packages.map((p) => (
          <form key={p.id} action={action}>
            <input type="hidden" name="estimateId" value={estimateId} />
            <input type="hidden" name="packageId" value={p.id} />
            <button
              type="submit"
              disabled={pending}
              className="h-12 rounded-xl bg-white px-4 text-left text-sm font-semibold text-slate-700 ring-1 ring-slate-300 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700"
            >
              {p.name}
              <span className="ml-2 font-normal tabular-nums text-slate-500 dark:text-slate-400">
                {formatCents(p.totalCents)}
              </span>
            </button>
          </form>
        ))}
      </div>
      {state.error ? <div className="mt-2"><ErrorNote>{state.error}</ErrorNote></div> : null}
    </div>
  );
}
