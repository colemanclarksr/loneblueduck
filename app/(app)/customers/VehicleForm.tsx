"use client";

import { useActionState } from "react";
import { saveVehicle, type FormState } from "./actions";
import { Field, TextArea, Button, LinkButton, Card, ErrorNote } from "../_ui";
import type { Vehicle } from "@/lib/generated/prisma";

export function VehicleForm({ customerId, vehicle }: { customerId: string; vehicle?: Vehicle }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveVehicle, {});

  // What the user just typed wins over what is stored, so a rejected submit
  // keeps their work. defaultValue is only read on mount, hence the key below.
  const v = (name: string, stored?: string | number | null) => state.values?.[name] ?? stored ?? undefined;
  const formKey = state.values ? JSON.stringify(state.values) : "initial";

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="customerId" value={customerId} />
      {vehicle ? <input type="hidden" name="id" value={vehicle.id} /> : null}

      {state.error ? <ErrorNote>{state.error}</ErrorNote> : null}

      <div key={formKey} className="space-y-4">
        <Card>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Year" name="year" inputMode="numeric" defaultValue={v("year", vehicle?.year)} placeholder="2017" />
            <Field label="Make" name="make" defaultValue={v("make", vehicle?.make)} placeholder="Toyota" />
            <Field label="Model" name="model" defaultValue={v("model", vehicle?.model)} placeholder="Tacoma" />
            <Field label="Trim" name="trim" defaultValue={v("trim", vehicle?.trim)} />
            <Field label="Engine" name="engine" defaultValue={v("engine", vehicle?.engine)} placeholder="3.5L V6" />
            <Field label="Color" name="color" defaultValue={v("color", vehicle?.color)} />
          </div>
        </Card>

        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Plate" name="plate" defaultValue={v("plate", vehicle?.plate)} placeholder="8XYZ221" />
            <Field label="VIN" name="vin" defaultValue={v("vin", vehicle?.vin)} placeholder="17 characters" />
            <Field label="Mileage" name="mileage" inputMode="numeric" defaultValue={v("mileage", vehicle?.mileage)} />
            <Field label="Tire size" name="tireSize" defaultValue={v("tireSize", vehicle?.tireSize)} placeholder="265/70R17" />
          </div>
        </Card>

        <Card>
          <div className="grid gap-4">
            <TextArea label="Warranty notes" name="warrantyNotes" defaultValue={v("warrantyNotes", vehicle?.warrantyNotes)} rows={2} />
            <TextArea label="Notes" name="notes" defaultValue={v("notes", vehicle?.notes)} rows={2} />
          </div>
        </Card>
      </div>

      <div className="flex gap-3">
        <Button disabled={pending}>{pending ? "Saving…" : vehicle ? "Save vehicle" : "Add vehicle"}</Button>
        <LinkButton href={`/customers/${customerId}`}>Cancel</LinkButton>
      </div>
    </form>
  );
}
