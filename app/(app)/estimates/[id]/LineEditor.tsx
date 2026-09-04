"use client";

import { useActionState, useState } from "react";
import { addLineAction, updateLineAction, removeLineAction, type FormState } from "../actions";
import { ErrorNote } from "../../_ui";
import { formatCents } from "@/lib/money";

export type Line = {
  id: string;
  kind: string;
  name: string;
  section: string | null;
  sku: string | null;
  qty: number;
  priceCents: number;
  costCents: number;
  taxable: boolean;
  approved: boolean;
};

const KINDS = [
  { value: "LABOR", label: "Labor" },
  { value: "PART", label: "Part" },
  { value: "TIRE", label: "Tire" },
  { value: "FEE", label: "Fee" },
  { value: "SUBLET", label: "Sublet" },
];

const input =
  "h-11 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-base text-slate-900 outline-none " +
  "focus:border-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50";

/** One row of the builder. Editing swaps the row for the same form the add
 *  bar uses, so there is a single shape to learn. */
export function LineRow({ line, estimateId, editable, showCost }: {
  line: Line; estimateId: string; editable: boolean; showCost: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [updState, updAction, updPending] = useActionState<FormState, FormData>(updateLineAction, {});
  const [delState, delAction, delPending] = useActionState<FormState, FormData>(removeLineAction, {});

  const total = Math.round(line.qty * line.priceCents);
  const margin = line.costCents > 0 ? total - Math.round(line.qty * line.costCents) : null;

  if (editing && editable) {
    return (
      <tr className="border-t border-slate-100 dark:border-slate-800">
        <td colSpan={showCost ? 6 : 5} className="p-2">
          <form
            action={updAction}
            onSubmit={() => setEditing(false)}
            className="grid gap-2 sm:grid-cols-[7rem_1fr_5rem_7rem_auto]"
          >
            <input type="hidden" name="lineId" value={line.id} />
            <input type="hidden" name="estimateId" value={estimateId} />
            <input type="hidden" name="section" value={line.section ?? ""} />
            <select name="kind" defaultValue={line.kind} className={input}>
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
            <input name="name" defaultValue={line.name} className={input} required />
            <input name="qty" defaultValue={line.qty} inputMode="decimal" className={input} aria-label="Quantity" />
            <input name="price" defaultValue={(line.priceCents / 100).toFixed(2)} inputMode="decimal" className={input} aria-label="Price" />
            <div className="flex gap-2">
              <label className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-400">
                <input type="checkbox" name="taxable" defaultChecked={line.taxable} className="size-4" />
                Tax
              </label>
              <button type="submit" disabled={updPending} className="h-11 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white dark:bg-slate-50 dark:text-slate-900">
                Save
              </button>
              <button type="button" onClick={() => setEditing(false)} className="h-11 rounded-lg px-3 text-sm text-slate-600 dark:text-slate-400">
                Cancel
              </button>
            </div>
            {updState.error ? <div className="sm:col-span-5"><ErrorNote>{updState.error}</ErrorNote></div> : null}
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr className={`border-t border-slate-100 dark:border-slate-800 ${line.approved ? "" : "opacity-50"}`}>
      <td className="py-2.5 pr-2 align-top">
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-400">
          {line.kind === "LABOR" ? "Labor" : line.kind.toLowerCase()}
        </span>
      </td>
      <td className="py-2.5 pr-2 align-top">
        <div className="text-slate-900 dark:text-slate-100">{line.name}</div>
        {line.sku ? <div className="font-mono text-xs text-slate-500 dark:text-slate-400">{line.sku}</div> : null}
        {!line.approved ? <div className="text-xs font-medium text-red-600 dark:text-red-400">declined</div> : null}
        {!line.taxable ? <div className="text-xs text-slate-500 dark:text-slate-400">not taxed</div> : null}
      </td>
      <td className="py-2.5 pr-2 text-right align-top tabular-nums text-slate-700 dark:text-slate-300">{line.qty}</td>
      <td className="py-2.5 pr-2 text-right align-top tabular-nums text-slate-700 dark:text-slate-300">{formatCents(line.priceCents)}</td>
      {showCost ? (
        <td className="py-2.5 pr-2 text-right align-top tabular-nums text-slate-500 dark:text-slate-400">
          {margin != null ? formatCents(margin) : "—"}
        </td>
      ) : null}
      <td className="py-2.5 text-right align-top">
        <div className="flex items-center justify-end gap-3">
          <span className="font-medium tabular-nums text-slate-900 dark:text-slate-100">{formatCents(total)}</span>
          {editable ? (
            <>
              <button type="button" onClick={() => setEditing(true)} className="text-sm text-slate-500 hover:underline dark:text-slate-400">
                Edit
              </button>
              <form action={delAction}>
                <input type="hidden" name="lineId" value={line.id} />
                <input type="hidden" name="estimateId" value={estimateId} />
                <button type="submit" disabled={delPending} className="text-sm text-red-600 hover:underline dark:text-red-400">
                  Remove
                </button>
              </form>
            </>
          ) : null}
        </div>
        {delState.error ? <ErrorNote>{delState.error}</ErrorNote> : null}
      </td>
    </tr>
  );
}

/** The add bar under each section. Keeping section on a hidden field means a
 *  new line lands in the repair the advisor is looking at. */
export function AddLine({ estimateId, section, laborRateCents }: {
  estimateId: string; section: string; laborRateCents: number;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(addLineAction, {});
  const [kind, setKind] = useState("LABOR");

  return (
    <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
      <form action={action} className="grid gap-2 sm:grid-cols-[7rem_1fr_5rem_7rem_auto]">
        <input type="hidden" name="estimateId" value={estimateId} />
        <input type="hidden" name="section" value={section} />
        <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className={input} aria-label="Type">
          {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
        <input name="name" placeholder="Description" className={input} required aria-label="Description" />
        <input name="qty" defaultValue="1" inputMode="decimal" className={input} aria-label="Quantity" />
        <input
          name="price"
          // Labour defaults to the shop's rate so the common case is one field.
          defaultValue={kind === "LABOR" ? (laborRateCents / 100).toFixed(2) : ""}
          key={kind}
          placeholder="0.00"
          inputMode="decimal"
          className={input}
          aria-label="Price"
        />
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-400">
            <input type="checkbox" name="taxable" defaultChecked className="size-4" />
            Tax
          </label>
          <button type="submit" disabled={pending} className="h-11 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white dark:bg-slate-50 dark:text-slate-900">
            {pending ? "Adding…" : "Add"}
          </button>
        </div>
      </form>
      {state.error ? <div className="mt-2"><ErrorNote>{state.error}</ErrorNote></div> : null}
    </div>
  );
}

/** Starts a new repair on the estimate. Sections are just a label on the line,
 *  so this only needs to seed the first one. */
export function AddSection({ estimateId, laborRateCents }: { estimateId: string; laborRateCents: number }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-12 rounded-xl bg-white px-5 text-base font-semibold text-slate-700 ring-1 ring-slate-300 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700"
      >
        Add a repair
      </button>
    );
  }

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Repair name, e.g. Front brakes"
        autoFocus
        className={`${input} mb-3`}
        aria-label="Repair name"
      />
      {name.trim() ? (
        <AddLine estimateId={estimateId} section={name.trim()} laborRateCents={laborRateCents} />
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">Name the repair, then add labor and parts to it.</p>
      )}
      <button type="button" onClick={() => { setOpen(false); setName(""); }} className="mt-3 text-sm text-slate-500 dark:text-slate-400">
        Done
      </button>
    </div>
  );
}
