"use client";

import { useActionState, useState } from "react";
import { approve, type ApprovalState } from "./actions";
import { formatCents } from "@/lib/money";

export type Section = {
  section: string;
  totalCents: number;
  items: { id: string; name: string; kind: string; qty: number; priceCents: number }[];
};

export function ApprovalForm({ token, sections, taxRate }: { token: string; sections: Section[]; taxRate: number }) {
  const [state, action, pending] = useActionState<ApprovalState, FormData>(approve, {});
  // Everything starts approved. Declining is the deliberate act, which matches
  // how the conversation goes at the counter.
  const [declined, setDeclined] = useState<Set<string>>(new Set());

  const toggle = (section: string) => {
    const next = new Set(declined);
    if (next.has(section)) next.delete(section);
    else next.add(section);
    setDeclined(next);
  };

  const approvedSections = sections.filter((s) => !declined.has(s.section));
  const subtotal = approvedSections.reduce((sum, s) => sum + s.totalCents, 0);
  // Mirrors computeTotals: the customer must see the same arithmetic the shop
  // will bill. Tax is estimated here on the approved subtotal.
  const tax = Math.round(subtotal * (taxRate / 100));

  if (state.done) {
    return (
      <div className="rounded-2xl bg-emerald-50 p-6 text-center dark:bg-emerald-950/40">
        <p className="text-lg font-semibold text-emerald-900 dark:text-emerald-200">Thank you.</p>
        <p className="mt-1 text-emerald-800 dark:text-emerald-300">
          {declined.size === sections.length
            ? "We have recorded that you declined this work."
            : "Your approval has been sent to the shop."}
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      {[...declined].map((s) => <input key={s} type="hidden" name="declined" value={s} />)}
      {sections.map((s) => <input key={s.section} type="hidden" name="allSections" value={s.section} />)}

      <div className="space-y-3">
        {sections.map((s) => {
          const isDeclined = declined.has(s.section);
          return (
            <div
              key={s.section}
              className={`rounded-2xl border p-4 transition-colors ${
                isDeclined
                  ? "border-slate-200 bg-slate-50 opacity-60 dark:border-slate-800 dark:bg-slate-900/50"
                  : "border-emerald-300 bg-white dark:border-emerald-800 dark:bg-slate-900"
              }`}
            >
              <div className="flex flex-wrap items-baseline gap-3">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">{s.section}</h2>
                <span className="ml-auto text-lg font-bold tabular-nums text-slate-900 dark:text-slate-50">
                  {formatCents(s.totalCents)}
                </span>
              </div>

              <ul className="mt-2 space-y-1 text-sm text-slate-600 dark:text-slate-400">
                {s.items.map((i) => (
                  <li key={i.id} className="flex justify-between gap-4">
                    <span>{i.name}{i.qty !== 1 ? ` × ${i.qty}` : ""}</span>
                    <span className="tabular-nums">{formatCents(Math.round(i.qty * i.priceCents))}</span>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={() => toggle(s.section)}
                className={`mt-3 h-12 w-full rounded-xl text-base font-semibold ${
                  isDeclined
                    ? "bg-slate-900 text-white dark:bg-slate-50 dark:text-slate-900"
                    : "bg-white text-slate-700 ring-1 ring-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700"
                }`}
              >
                {isDeclined ? "Add this back" : "Not this time"}
              </button>
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-600 dark:text-slate-400">Approved work</dt>
            <dd className="tabular-nums text-slate-900 dark:text-slate-100">{formatCents(subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-600 dark:text-slate-400">Estimated tax</dt>
            <dd className="tabular-nums text-slate-900 dark:text-slate-100">{formatCents(tax)}</dd>
          </div>
          <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 dark:border-slate-800">
            <dt className="font-semibold text-slate-900 dark:text-slate-50">Total</dt>
            <dd className="text-xl font-bold tabular-nums text-slate-900 dark:text-slate-50">{formatCents(subtotal + tax)}</dd>
          </div>
        </dl>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
          Type your name to approve
        </span>
        <input
          name="signature"
          required={declined.size !== sections.length}
          className="h-14 w-full rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
        />
      </label>

      {state.error ? (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-800 dark:bg-red-950/50 dark:text-red-300">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        name="decision"
        value="approve"
        disabled={pending}
        className="h-14 w-full rounded-xl bg-emerald-600 text-base font-bold text-white disabled:opacity-50"
      >
        {pending
          ? "Sending…"
          : declined.size === sections.length
            ? "Decline everything"
            : `Approve ${formatCents(subtotal + tax)}`}
      </button>
    </form>
  );
}
