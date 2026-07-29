"use client";

import { useActionState, useState } from "react";
import { newEstimate, type FormState } from "../actions";
import { Field, TextArea, Button, LinkButton, Card, ErrorNote } from "../../_ui";

export type PickerCustomer = {
  id: string;
  label: string;
  vehicles: { id: string; label: string; mileage: number | null }[];
};

export function NewEstimateForm({ customers }: { customers: PickerCustomer[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(newEstimate, {});
  const [customerId, setCustomerId] = useState("");
  const [vehicleId, setVehicleId] = useState("");

  const selected = customers.find((c) => c.id === customerId);
  const vehicle = selected?.vehicles.find((v) => v.id === vehicleId);

  const select =
    "h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 outline-none " +
    "focus:border-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50";

  return (
    <form action={action} className="space-y-4">
      {state.error ? <ErrorNote>{state.error}</ErrorNote> : null}

      <Card>
        <div className="grid gap-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Customer</span>
            <select
              name="customerId"
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value);
                // Clearing this matters: a vehicle from the previous customer
                // would otherwise be submitted against the new one.
                setVehicleId("");
              }}
              className={select}
              required
            >
              <option value="">Choose a customer…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Vehicle</span>
            <select
              name="vehicleId"
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              className={select}
              disabled={!selected}
              required
            >
              <option value="">{selected ? "Choose a vehicle…" : "Pick a customer first"}</option>
              {selected?.vehicles.map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </select>
            {selected && selected.vehicles.length === 0 ? (
              <span className="mt-1.5 block text-sm text-amber-700 dark:text-amber-400">
                This customer has no vehicles on file yet.
              </span>
            ) : null}
          </label>

          <Field
            label="Mileage in"
            name="mileageIn"
            inputMode="numeric"
            // Pre-filled from the vehicle's last known reading; the advisor
            // overwrites it with whatever the odometer actually says.
            defaultValue={vehicle?.mileage ?? undefined}
            key={vehicleId}
          />

          <TextArea label="Customer concern" name="complaint" rows={3} />
        </div>
      </Card>

      <div className="flex gap-3">
        <Button disabled={pending || !customerId || !vehicleId}>
          {pending ? "Creating…" : "Start estimate"}
        </Button>
        <LinkButton href="/estimates">Cancel</LinkButton>
      </div>
    </form>
  );
}
