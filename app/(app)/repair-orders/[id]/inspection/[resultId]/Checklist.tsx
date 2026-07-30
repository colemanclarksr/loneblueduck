"use client";

import { useActionState, useState } from "react";
import { markAction, finishAction, sendAction, type FormState } from "../actions";
import { Button, ErrorNote, Card } from "../../../../_ui";

export type Item = {
  id: string;
  label: string;
  section: string | null;
  condition: string;
  notes: string | null;
};

// Green / yellow / red, in that order, sized for a gloved thumb on a tablet.
const CONDITIONS = [
  { value: "GREEN", label: "Good", on: "bg-emerald-600 text-white", off: "text-emerald-700 ring-1 ring-emerald-300 dark:text-emerald-400 dark:ring-emerald-800" },
  { value: "YELLOW", label: "Watch", on: "bg-amber-500 text-white", off: "text-amber-700 ring-1 ring-amber-300 dark:text-amber-400 dark:ring-amber-800" },
  { value: "RED", label: "Needs work", on: "bg-red-600 text-white", off: "text-red-700 ring-1 ring-red-300 dark:text-red-400 dark:ring-red-800" },
];

function Ok({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
      {children}
    </p>
  );
}

export function ItemRow({ item, repairOrderId, frozen }: { item: Item; repairOrderId: string; frozen: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(markAction, {});
  const [noteOpen, setNoteOpen] = useState(false);

  if (frozen) {
    return (
      <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-slate-100 py-3 dark:border-slate-800">
        <span className="text-slate-900 dark:text-slate-100">{item.label}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            item.condition === "RED" ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
              : item.condition === "YELLOW" ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300"
                : item.condition === "GREEN" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                  : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
          }`}
        >
          {CONDITIONS.find((c) => c.value === item.condition)?.label ?? "Not checked"}
        </span>
        {item.notes ? <span className="w-full text-sm text-slate-600 dark:text-slate-400">{item.notes}</span> : null}
      </li>
    );
  }

  return (
    <li className="border-t border-slate-100 py-3 dark:border-slate-800">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-40 flex-1 text-slate-900 dark:text-slate-100">{item.label}</span>
        <div className="flex gap-1.5">
          {CONDITIONS.map((c) => (
            <form key={c.value} action={action}>
              <input type="hidden" name="itemId" value={item.id} />
              <input type="hidden" name="repairOrderId" value={repairOrderId} />
              <input type="hidden" name="condition" value={c.value} />
              <button
                type="submit"
                disabled={pending}
                className={`h-11 rounded-lg px-3 text-sm font-semibold disabled:opacity-50 ${
                  item.condition === c.value ? c.on : `bg-white dark:bg-slate-900 ${c.off}`
                }`}
              >
                {c.label}
              </button>
            </form>
          ))}
        </div>
      </div>

      {item.notes && !noteOpen ? (
        <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
          {item.notes}{" "}
          <button type="button" onClick={() => setNoteOpen(true)} className="underline">edit</button>
        </p>
      ) : null}

      {!item.notes && !noteOpen ? (
        <button type="button" onClick={() => setNoteOpen(true)} className="mt-1.5 text-sm text-slate-500 underline dark:text-slate-400">
          Add a note
        </button>
      ) : null}

      {noteOpen ? (
        <form action={action} onSubmit={() => setNoteOpen(false)} className="mt-2 flex gap-2">
          <input type="hidden" name="itemId" value={item.id} />
          <input type="hidden" name="repairOrderId" value={repairOrderId} />
          <input type="hidden" name="condition" value={item.condition} />
          <input
            name="notes"
            defaultValue={item.notes ?? ""}
            placeholder="What you measured or saw, e.g. 2/32 remaining"
            aria-label={`Note for ${item.label}`}
            className="h-11 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
          />
          <button type="submit" className="h-11 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white dark:bg-slate-50 dark:text-slate-900">
            Save
          </button>
        </form>
      ) : null}

      {state.error ? <div className="mt-2"><ErrorNote>{state.error}</ErrorNote></div> : null}
    </li>
  );
}

export function FinishBar({ resultId, repairOrderId, status, canSend, shareUrl }: {
  resultId: string; repairOrderId: string; status: string; canSend: boolean; shareUrl: string | null;
}) {
  const [finState, finAction, finPending] = useActionState<FormState, FormData>(finishAction, {});
  const [sendState, sendActionFn, sendPending] = useActionState<FormState, FormData>(sendAction, {});

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        {status === "IN_PROGRESS" ? (
          <form action={finAction}>
            <input type="hidden" name="resultId" value={resultId} />
            <input type="hidden" name="repairOrderId" value={repairOrderId} />
            <Button variant="ghost" disabled={finPending}>{finPending ? "Saving…" : "Mark complete"}</Button>
          </form>
        ) : null}

        {status !== "SENT" && canSend ? (
          <form action={sendActionFn}>
            <input type="hidden" name="resultId" value={resultId} />
            <input type="hidden" name="repairOrderId" value={repairOrderId} />
            <Button disabled={sendPending}>{sendPending ? "Sending…" : "Send to customer"}</Button>
          </form>
        ) : null}

        {status === "SENT" && shareUrl ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Sent. The customer's link:{" "}
            <a href={shareUrl} className="break-all font-medium underline">{shareUrl}</a>
          </p>
        ) : null}
      </div>

      {finState.error ? <div className="mt-2"><ErrorNote>{finState.error}</ErrorNote></div> : null}
      {sendState.error ? <div className="mt-2"><ErrorNote>{sendState.error}</ErrorNote></div> : null}
      {finState.ok ? <div className="mt-2"><Ok>{finState.ok}</Ok></div> : null}
      {sendState.ok ? <div className="mt-2"><Ok>{sendState.ok}</Ok></div> : null}
    </Card>
  );
}
