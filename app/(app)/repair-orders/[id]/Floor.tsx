"use client";

import { useActionState, useState } from "react";
import { statusAction, assignAction, addNoteAction, invoiceAction, updateROAction, type FormState } from "../actions";
import { Button, ErrorNote, Card, TextArea } from "../../_ui";

const STATUS_TEXT: Record<string, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  COMPLETE: "Ready to invoice",
  INVOICED: "Invoiced",
  CANCELLED: "Cancelled",
};

// What the button says, rather than what the enum is called. "COMPLETE" as a
// verb reads like a command; "Mark ready to invoice" says what happens next.
const MOVE_LABEL: Record<string, string> = {
  OPEN: "Move back to open",
  IN_PROGRESS: "Start work",
  COMPLETE: "Mark ready to invoice",
  CANCELLED: "Cancel this job",
};

export function StatusBar({ repairOrderId, status, next }: {
  repairOrderId: string; status: string; next: string[];
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(statusAction, {});

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {next.map((to) => (
          <form key={to} action={action}>
            <input type="hidden" name="repairOrderId" value={repairOrderId} />
            <input type="hidden" name="to" value={to} />
            <Button
              disabled={pending}
              variant={to === "CANCELLED" ? "danger" : to === "OPEN" ? "ghost" : "primary"}
            >
              {/* Reopening a finished job is the one move worth naming plainly. */}
              {status === "COMPLETE" && to === "IN_PROGRESS" ? "Reopen" : MOVE_LABEL[to] ?? STATUS_TEXT[to]}
            </Button>
          </form>
        ))}
      </div>
      {state.error ? <div className="mt-2"><ErrorNote>{state.error}</ErrorNote></div> : null}
    </div>
  );
}

export function InvoiceButton({ repairOrderId }: { repairOrderId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(invoiceAction, {});
  return (
    <div>
      <form action={action}>
        <input type="hidden" name="repairOrderId" value={repairOrderId} />
        <Button disabled={pending}>{pending ? "Creating…" : "Create invoice"}</Button>
      </form>
      {state.error ? <div className="mt-2"><ErrorNote>{state.error}</ErrorNote></div> : null}
    </div>
  );
}

export function AssignPicker({ repairOrderId, technicianId, people }: {
  repairOrderId: string; technicianId: string | null; people: { id: string; name: string; role: string }[];
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(assignAction, {});

  return (
    <div>
      <form action={action} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="repairOrderId" value={repairOrderId} />
        <label className="block flex-1">
          <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Technician</span>
          <select
            name="technicianId"
            defaultValue={technicianId ?? ""}
            className="h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
          >
            <option value="">Unassigned</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.role !== "TECHNICIAN" ? ` (${p.role.replace("_", " ").toLowerCase()})` : ""}
              </option>
            ))}
          </select>
        </label>
        <Button variant="ghost" disabled={pending}>{pending ? "Saving…" : "Assign"}</Button>
      </form>
      {state.error ? <div className="mt-2"><ErrorNote>{state.error}</ErrorNote></div> : null}
    </div>
  );
}

export function NoteForm({ repairOrderId }: { repairOrderId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addNoteAction, {});
  // Remount on success so the textarea empties; a note that stays on screen
  // after saving invites the same note being written twice.
  const key = state.error ? "err" : String(pending);

  return (
    <div>
      <form action={action} className="space-y-2" key={key}>
        <input type="hidden" name="repairOrderId" value={repairOrderId} />
        <textarea
          name="body"
          rows={2}
          placeholder="What you found, what you told the customer…"
          aria-label="Note"
          className="min-h-20 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
        />
        <Button variant="ghost" disabled={pending}>{pending ? "Saving…" : "Add note"}</Button>
      </form>
      {state.error ? <div className="mt-2"><ErrorNote>{state.error}</ErrorNote></div> : null}
    </div>
  );
}

export function NotesAndDiscount({
  repairOrderId, complaint, customerNote, internalNote, discountPct, editable,
}: {
  repairOrderId: string; complaint: string | null; customerNote: string | null;
  internalNote: string | null; discountPct: number; editable: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateROAction, {});
  const [open, setOpen] = useState(false);

  const summary = (
    <dl className="mt-2 space-y-2 text-sm">
      {complaint ? (
        <div><dt className="text-slate-500 dark:text-slate-400">Concern</dt><dd className="text-slate-900 dark:text-slate-100">{complaint}</dd></div>
      ) : null}
      {internalNote ? (
        <div><dt className="text-slate-500 dark:text-slate-400">Internal</dt><dd className="text-slate-900 dark:text-slate-100">{internalNote}</dd></div>
      ) : null}
      {discountPct > 0 ? (
        <div><dt className="text-slate-500 dark:text-slate-400">Discount</dt><dd className="text-slate-900 dark:text-slate-100">{discountPct}%</dd></div>
      ) : null}
      {!complaint && !internalNote && discountPct === 0 ? (
        <p className="text-slate-400 dark:text-slate-500">Nothing recorded.</p>
      ) : null}
    </dl>
  );

  if (!editable) {
    return (
      <Card>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Details</h2>
        {summary}
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Details &amp; discount
        </h2>
        <button type="button" onClick={() => setOpen(!open)} className="ml-auto text-sm text-slate-600 hover:underline dark:text-slate-400">
          {open ? "Close" : "Edit"}
        </button>
      </div>

      {open ? (
        <form action={action} className="mt-3 space-y-3">
          <input type="hidden" name="repairOrderId" value={repairOrderId} />
          <TextArea label="Customer concern" name="complaint" defaultValue={complaint} rows={2} />
          <TextArea label="Note to customer (printed)" name="customerNote" defaultValue={customerNote} rows={2} />
          <TextArea label="Internal note (never printed)" name="internalNote" defaultValue={internalNote} rows={2} />
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Discount %</span>
            <input
              name="discountPct"
              defaultValue={discountPct}
              inputMode="decimal"
              className="h-11 w-32 rounded-lg border border-slate-300 bg-white px-2.5 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
            />
          </label>
          {state.error ? <ErrorNote>{state.error}</ErrorNote> : null}
          <Button disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        </form>
      ) : (
        summary
      )}
    </Card>
  );
}
