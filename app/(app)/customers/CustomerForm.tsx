"use client";

import { useActionState, useState } from "react";
import { saveCustomer, type FormState } from "./actions";
import { Field, TextArea, Check, Button, LinkButton, Card, ErrorNote } from "../_ui";
import type { Customer } from "@/lib/generated/prisma";

export function CustomerForm({ customer }: { customer?: Customer }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveCustomer, {});

  // What the user just typed wins over what is stored, so a rejected submit
  // keeps their work instead of making them key it all again.
  const v = (name: string, stored?: string | number | null) => state.values?.[name] ?? stored ?? undefined;
  const checked = (name: string, stored?: boolean) =>
    state.values ? state.values[name] === "on" : (stored ?? false);

  // defaultValue is only read when an input mounts, so the fields are remounted
  // whenever a rejected submission comes back with values to restore.
  const formKey = state.values ? JSON.stringify(state.values) : "initial";

  // Company and terms only matter for a fleet or wholesale account.
  const [type, setType] = useState<string>(String(v("type", customer?.type) ?? "RETAIL"));
  const isBusiness = type !== "RETAIL";

  return (
    <form action={action} className="space-y-4">
      {customer ? <input type="hidden" name="id" value={customer.id} /> : null}

      {state.error ? <ErrorNote>{state.error}</ErrorNote> : null}

      <div key={formKey} className="space-y-4">
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Account type</span>
              <select
                name="type"
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 outline-none focus:border-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
              >
                <option value="RETAIL">Retail</option>
                <option value="FLEET">Fleet</option>
                <option value="WHOLESALE">Wholesale</option>
              </select>
            </label>

            {isBusiness ? (
              <Field label="Company" name="company" defaultValue={v("company", customer?.company)} required />
            ) : (
              <div className="hidden sm:block" />
            )}

            <Field label="First name" name="firstName" defaultValue={v("firstName", customer?.firstName)} />
            <Field label="Last name" name="lastName" defaultValue={v("lastName", customer?.lastName)} />
            <Field label="Phone" name="phone" type="tel" inputMode="tel" defaultValue={v("phone", customer?.phone)} placeholder="(909) 555-0142" />
            <Field label="Email" name="email" type="email" inputMode="email" defaultValue={v("email", customer?.email)} />
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Address</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Street" name="address" defaultValue={v("address", customer?.address)} className="sm:col-span-2" />
            <Field label="City" name="city" defaultValue={v("city", customer?.city)} />
            <div className="grid grid-cols-2 gap-4">
              <Field label="State" name="state" defaultValue={v("state", customer?.state)} />
              <Field label="ZIP" name="zip" inputMode="numeric" defaultValue={v("zip", customer?.zip)} />
            </div>
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Billing &amp; contact
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {isBusiness ? (
              <Field
                label="Payment terms (days)"
                name="billingTermsDays"
                inputMode="numeric"
                defaultValue={v("billingTermsDays", customer?.billingTermsDays)}
                placeholder="30"
              />
            ) : null}
            <Field label="Tax exemption ID" name="taxExemptId" defaultValue={v("taxExemptId", customer?.taxExemptId)} />
          </div>
          <div className="mt-2 grid gap-1 sm:grid-cols-3">
            <Check label="Tax exempt" name="taxExempt" defaultChecked={checked("taxExempt", customer?.taxExempt)} />
            <Check label="No texts" name="smsOptOut" defaultChecked={checked("smsOptOut", customer?.smsOptOut)} />
            <Check label="No emails" name="emailOptOut" defaultChecked={checked("emailOptOut", customer?.emailOptOut)} />
          </div>
          <div className="mt-4">
            <TextArea label="Notes" name="notes" defaultValue={v("notes", customer?.notes)} />
          </div>
        </Card>
      </div>

      <div className="flex gap-3">
        <Button disabled={pending}>{pending ? "Saving…" : customer ? "Save changes" : "Create customer"}</Button>
        <LinkButton href={customer ? `/customers/${customer.id}` : "/customers"}>Cancel</LinkButton>
      </div>
    </form>
  );
}
