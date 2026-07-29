"use client";

import { useActionState, useState } from "react";
import { sendAction, convertAction, updateEstimateAction, type FormState } from "../actions";
import { Button, ErrorNote, Card, TextArea } from "../../_ui";

export function SendButton({ estimateId, resend }: { estimateId: string; resend: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(sendAction, {});
  return (
    <div>
      <form action={action}>
        <input type="hidden" name="estimateId" value={estimateId} />
        <Button disabled={pending} variant={resend ? "ghost" : "primary"}>
          {pending ? "Sending…" : resend ? "Resend" : "Send for approval"}
        </Button>
      </form>
      {state.error ? <div className="mt-2"><ErrorNote>{state.error}</ErrorNote></div> : null}
    </div>
  );
}

export function ConvertButton({ estimateId }: { estimateId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(convertAction, {});
  return (
    <div>
      <form action={action}>
        <input type="hidden" name="estimateId" value={estimateId} />
        <Button disabled={pending}>{pending ? "Converting…" : "Convert to repair order"}</Button>
      </form>
      {state.error ? <div className="mt-2"><ErrorNote>{state.error}</ErrorNote></div> : null}
    </div>
  );
}

export function NotesAndDiscount({
  estimateId, complaint, customerNote, internalNote, discountPct, editable,
}: {
  estimateId: string; complaint: string | null; customerNote: string | null;
  internalNote: string | null; discountPct: number; editable: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateEstimateAction, {});
  const [open, setOpen] = useState(false);

  if (!editable) {
    return (
      <Card>
        <dl className="space-y-2 text-sm">
          {complaint ? (
            <div><dt className="text-slate-500 dark:text-slate-400">Concern</dt><dd className="text-slate-900 dark:text-slate-100">{complaint}</dd></div>
          ) : null}
          {customerNote ? (
            <div><dt className="text-slate-500 dark:text-slate-400">Note to customer</dt><dd className="text-slate-900 dark:text-slate-100">{customerNote}</dd></div>
          ) : null}
        </dl>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Notes &amp; discount
        </h2>
        <button type="button" onClick={() => setOpen(!open)} className="ml-auto text-sm text-slate-600 hover:underline dark:text-slate-400">
          {open ? "Close" : "Edit"}
        </button>
      </div>

      {open ? (
        <form action={action} className="mt-3 space-y-3">
          <input type="hidden" name="estimateId" value={estimateId} />
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
      )}
    </Card>
  );
}
