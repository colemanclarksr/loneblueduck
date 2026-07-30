"use client";

import { useActionState, useState } from "react";
import { payAction, refundAction, voidAction, type FormState } from "../actions";
import { Button, ErrorNote, Card } from "../../_ui";
import { formatCents } from "@/lib/money";

const METHODS = [
  { value: "CARD", label: "Card" },
  { value: "CASH", label: "Cash" },
  { value: "CHECK", label: "Check" },
  { value: "ACH", label: "Bank transfer" },
  { value: "HOUSE_ACCOUNT", label: "House account" },
  { value: "OTHER", label: "Other" },
];

const input =
  "h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 outline-none " +
  "focus:border-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50";

function Ok({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
      {children}
    </p>
  );
}

/**
 * The take-money panel.
 *
 * Amount is pre-filled with the balance because paying in full is the common
 * case, and a clerk who has to type $1,247.83 correctly under a queue of
 * customers will eventually type it wrong. The card fields are deliberately
 * a brand, a last 4 and a processor reference -- there is nowhere to enter a
 * card number, because this system must never hold one (§12).
 */
export function TakePayment({ invoiceId, balanceDueCents }: { invoiceId: string; balanceDueCents: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(payAction, {});
  const [method, setMethod] = useState("CARD");

  return (
    <Card>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Take payment</h2>

      <form action={action} className="mt-3 space-y-3">
        <input type="hidden" name="invoiceId" value={invoiceId} />

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Amount</span>
          <input
            name="amount"
            inputMode="decimal"
            defaultValue={(balanceDueCents / 100).toFixed(2)}
            className={`${input} text-xl font-semibold tabular-nums`}
            required
          />
        </label>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Method</span>
          <div className="grid grid-cols-3 gap-2">
            {METHODS.map((m) => (
              <label
                key={m.value}
                className={`flex h-12 cursor-pointer items-center justify-center rounded-xl text-sm font-semibold ${
                  method === m.value
                    ? "bg-slate-900 text-white dark:bg-slate-50 dark:text-slate-900"
                    : "bg-white text-slate-700 ring-1 ring-slate-300 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700"
                }`}
              >
                <input
                  type="radio"
                  name="method"
                  value={m.value}
                  checked={method === m.value}
                  onChange={(e) => setMethod(e.target.value)}
                  className="sr-only"
                />
                {m.label}
              </label>
            ))}
          </div>
        </div>

        {method === "CARD" ? (
          <div className="grid grid-cols-2 gap-2">
            <input name="brand" placeholder="Visa" className={input} aria-label="Card brand" />
            <input name="last4" placeholder="Last 4" inputMode="numeric" maxLength={4} className={input} aria-label="Card last 4" />
            <input name="processorRef" placeholder="Processor reference" className={`${input} col-span-2`} aria-label="Processor reference" />
            <p className="col-span-2 text-xs text-slate-500 dark:text-slate-400">
              Run the card on your terminal, then record the last 4 and the reference here. Never type a full card number.
            </p>
          </div>
        ) : method === "CHECK" ? (
          <input name="reference" placeholder="Check number" className={input} aria-label="Check number" />
        ) : method === "OTHER" || method === "ACH" ? (
          <input name="reference" placeholder="Reference" className={input} aria-label="Reference" />
        ) : null}

        {state.error ? <ErrorNote>{state.error}</ErrorNote> : null}
        {state.ok ? <Ok>{state.ok}</Ok> : null}

        <Button disabled={pending}>
          {pending ? "Recording…" : `Record ${formatCents(balanceDueCents)}`}
        </Button>
      </form>
    </Card>
  );
}

export function RefundButton({ invoiceId, paymentId, refundableCents, label }: {
  invoiceId: string; paymentId: string; refundableCents: number; label: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(refundAction, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm text-red-600 hover:underline dark:text-red-400">
        Refund
      </button>
    );
  }

  return (
    <form action={action} className="mt-2 space-y-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-950">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="paymentId" value={paymentId} />
      <p className="text-sm text-slate-600 dark:text-slate-400">Refund against {label}.</p>
      <input
        name="amount"
        inputMode="decimal"
        defaultValue={(refundableCents / 100).toFixed(2)}
        className="h-11 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-base tabular-nums text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        aria-label="Refund amount"
        required
      />
      <input
        name="reason"
        placeholder="Reason"
        className="h-11 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
        aria-label="Refund reason"
      />
      {state.error ? <ErrorNote>{state.error}</ErrorNote> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="h-11 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white disabled:opacity-50">
          {pending ? "Refunding…" : "Refund"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="h-11 px-3 text-sm text-slate-600 dark:text-slate-400">
          Cancel
        </button>
      </div>
    </form>
  );
}

export function VoidButton({ invoiceId }: { invoiceId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(voidAction, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm text-slate-500 hover:underline dark:text-slate-400">
        Void this invoice
      </button>
    );
  }

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input
        name="reason"
        placeholder="Why is it being voided?"
        className="h-11 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
        aria-label="Void reason"
      />
      {state.error ? <ErrorNote>{state.error}</ErrorNote> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="h-11 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white disabled:opacity-50">
          {pending ? "Voiding…" : "Void it"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="h-11 px-3 text-sm text-slate-600 dark:text-slate-400">
          Cancel
        </button>
      </div>
    </form>
  );
}
