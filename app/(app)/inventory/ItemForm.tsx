"use client";

import { useActionState } from "react";
import { newItemAction, updateItemAction, adjustAction, deactivateAction, type FormState } from "./actions";
import { Field, Button, LinkButton, Card, ErrorNote } from "../_ui";

export type ItemValues = {
  id?: string;
  sku: string;
  name: string;
  category: string | null;
  vendor: string | null;
  tireSize: string | null;
  costCents: number;
  priceCents: number;
  reorderPoint: number;
};

function Ok({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
      {children}
    </p>
  );
}

export function ItemForm({ item }: { item?: ItemValues }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    item ? updateItemAction : newItemAction,
    {},
  );

  // Re-key on error so the fields remount with what was typed; defaultValue
  // only applies on mount, so without this a rejected save wipes the form.
  const v = state.values;
  const formKey = v ? "retry" : "fresh";

  return (
    <form action={action} className="space-y-4">
      {item ? <input type="hidden" name="itemId" value={item.id} /> : null}
      {state.error ? <ErrorNote>{state.error}</ErrorNote> : null}
      {state.ok ? <Ok>{state.ok}</Ok> : null}

      <Card>
        <div className="grid gap-4 sm:grid-cols-2" key={formKey}>
          <Field label="Part number / SKU" name="sku" defaultValue={v?.sku ?? item?.sku} required />
          <Field label="Name" name="name" defaultValue={v?.name ?? item?.name} required />
          <Field label="Category" name="category" defaultValue={v?.category ?? item?.category} placeholder="Filters, brakes, tires…" />
          <Field label="Vendor" name="vendor" defaultValue={v?.vendor ?? item?.vendor} />
          <Field label="Tire size" name="tireSize" defaultValue={v?.tireSize ?? item?.tireSize} placeholder="225/55R17" />
          <div />
          <Field
            label="Your cost"
            name="cost"
            inputMode="decimal"
            defaultValue={v?.cost ?? (item ? (item.costCents / 100).toFixed(2) : "")}
            placeholder="0.00"
          />
          <Field
            label="Price to customer"
            name="price"
            inputMode="decimal"
            defaultValue={v?.price ?? (item ? (item.priceCents / 100).toFixed(2) : "")}
            placeholder="0.00"
          />
          <Field
            label="Reorder at"
            name="reorderPoint"
            inputMode="decimal"
            defaultValue={v?.reorderPoint ?? item?.reorderPoint}
            placeholder="0"
          />
          {!item ? (
            <Field label="How many on hand now" name="qtyOnHand" inputMode="decimal" defaultValue={v?.qtyOnHand ?? "0"} />
          ) : null}
        </div>
        {!item ? (
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            Opening stock is booked as a movement, so the count explains itself from day one.
          </p>
        ) : null}
      </Card>

      <div className="flex gap-3">
        <Button disabled={pending}>{pending ? "Saving…" : item ? "Save" : "Add part"}</Button>
        <LinkButton href={item ? `/inventory/${item.id}` : "/inventory"}>Cancel</LinkButton>
      </div>
    </form>
  );
}

/** Counting the shelf. Reason is required, because an unexplained change is
 *  the thing that makes a shop stop believing the numbers. */
export function AdjustForm({ itemId }: { itemId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(adjustAction, {});
  const key = state.ok ? "done" : "editing";

  return (
    <div>
      <form action={action} className="space-y-2" key={key}>
        <input type="hidden" name="itemId" value={itemId} />
        <div className="grid grid-cols-[6rem_1fr] gap-2">
          <input
            name="qtyDelta"
            inputMode="decimal"
            placeholder="+12"
            aria-label="Change in quantity"
            className="h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base tabular-nums text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
            required
          />
          <input
            name="reason"
            placeholder="Delivery, damaged, recount…"
            aria-label="Reason"
            className="h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
            required
          />
        </div>
        {state.error ? <ErrorNote>{state.error}</ErrorNote> : null}
        {state.ok ? <Ok>{state.ok}</Ok> : null}
        <Button variant="ghost" disabled={pending}>{pending ? "Saving…" : "Adjust count"}</Button>
      </form>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        Use a minus sign to take stock off, e.g. −1 for a damaged part.
      </p>
    </div>
  );
}

export function DeactivateButton({ itemId }: { itemId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(deactivateAction, {});
  return (
    <div>
      <form action={action}>
        <input type="hidden" name="itemId" value={itemId} />
        <button type="submit" disabled={pending} className="text-sm text-red-600 hover:underline dark:text-red-400">
          {pending ? "Removing…" : "Stop stocking this part"}
        </button>
      </form>
      {state.error ? <div className="mt-2"><ErrorNote>{state.error}</ErrorNote></div> : null}
    </div>
  );
}
