"use client";

import { useActionState } from "react";
import { startAction, type FormState } from "./actions";
import { Button, ErrorNote } from "../../../_ui";

export function StartInspection({ repairOrderId, templates }: {
  repairOrderId: string; templates: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(startAction, {});

  return (
    <div>
      <form action={action} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="repairOrderId" value={repairOrderId} />
        {/* One template is the normal case for a small shop, so the picker
            only appears when there is actually a choice to make. */}
        {templates.length > 1 ? (
          <label className="block flex-1">
            <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Checklist</span>
            <select
              name="templateId"
              className="h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
            >
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        ) : null}
        <Button variant="ghost" disabled={pending}>{pending ? "Starting…" : "Start an inspection"}</Button>
      </form>
      {state.error ? <div className="mt-2"><ErrorNote>{state.error}</ErrorNote></div> : null}
    </div>
  );
}
