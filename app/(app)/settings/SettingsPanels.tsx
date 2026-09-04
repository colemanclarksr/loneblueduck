"use client";

import { useActionState, useState } from "react";
import {
  shopAction, addMemberAction, roleAction, accessAction, passwordAction,
  newPackageAction, deletePackageAction, type FormState,
} from "./actions";
import { Field, TextArea, Button, Card, ErrorNote } from "../_ui";
import { formatCents } from "@/lib/money";

const ROLES = [
  "OWNER", "MANAGER", "SERVICE_ADVISOR", "TECHNICIAN", "COUNTER_CLERK", "BOOKKEEPER",
] as const;

const KINDS = [
  { value: "LABOR", label: "Labor" },
  { value: "PART", label: "Part" },
  { value: "TIRE", label: "Tire" },
  { value: "FEE", label: "Fee" },
  { value: "SUBLET", label: "Sublet" },
];

const smallInput =
  "h-11 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-base text-slate-900 " +
  "dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50";

function Ok({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
      {children}
    </p>
  );
}

export type ShopValues = {
  locationId: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  taxRate: number;
  laborRateCents: number;
  receiptFooter: string | null;
};

export function ShopPanel({ shop, editable }: { shop: ShopValues; editable: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(shopAction, {});

  if (!editable) {
    return (
      <Card>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Shop</h2>
        <p className="mt-2 text-slate-900 dark:text-slate-100">{shop.name}</p>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Tax {shop.taxRate}% · labor {formatCents(shop.laborRateCents)}/hr
        </p>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Only an owner or manager can change these.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Shop details
      </h2>
      <form action={action} className="space-y-4">
        <input type="hidden" name="locationId" value={shop.locationId} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Shop name" name="name" defaultValue={shop.name} required />
          <Field label="Phone" name="phone" defaultValue={shop.phone} inputMode="tel" />
          <Field label="Email" name="email" defaultValue={shop.email} inputMode="email" />
          <Field label="Street" name="address" defaultValue={shop.address} />
          <Field label="City" name="city" defaultValue={shop.city} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="State" name="state" defaultValue={shop.state} />
            <Field label="ZIP" name="zip" defaultValue={shop.zip} inputMode="numeric" />
          </div>
          <Field label="Sales tax %" name="taxRate" defaultValue={shop.taxRate} inputMode="decimal" />
          <Field
            label="Labor rate per hour"
            name="laborRate"
            defaultValue={(shop.laborRateCents / 100).toFixed(2)}
            inputMode="decimal"
          />
        </div>
        <TextArea label="Receipt footer (warranty terms, notices)" name="receiptFooter" defaultValue={shop.receiptFooter} rows={2} />

        <p className="text-sm text-slate-500 dark:text-slate-400">
          Changing these affects new work only. Estimates, repair orders and invoices capture the rate they were
          written at, so an old document never restates itself.
        </p>

        {state.error ? <ErrorNote>{state.error}</ErrorNote> : null}
        {state.ok ? <Ok>{state.ok}</Ok> : null}
        <Button disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
      </form>
    </Card>
  );
}

export type Member = {
  id: string;
  role: string;
  active: boolean;
  name: string;
  email: string;
  isSelf: boolean;
};

export function PeoplePanel({ members, roleLabels, roleBlurbs }: {
  members: Member[];
  roleLabels: Record<string, string>;
  roleBlurbs: Record<string, string>;
}) {
  const [addState, addAction, addPending] = useActionState<FormState, FormData>(addMemberAction, {});
  const [adding, setAdding] = useState(false);

  return (
    <Card>
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">People</h2>
        <button type="button" onClick={() => setAdding(!adding)} className="ml-auto text-sm text-slate-600 hover:underline dark:text-slate-400">
          {adding ? "Close" : "Add someone"}
        </button>
      </div>

      {adding ? (
        <form action={addAction} className="mt-3 space-y-3 rounded-xl bg-slate-50 p-4 dark:bg-slate-950">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" name="name" defaultValue={addState.values?.name} required />
            <Field label="Email" name="email" inputMode="email" defaultValue={addState.values?.email} required />
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Role</span>
              <select name="role" defaultValue="TECHNICIAN" className={smallInput.replace("h-11", "h-12")}>
                {ROLES.map((r) => <option key={r} value={r}>{roleLabels[r]}</option>)}
              </select>
            </label>
            <Field label="Temporary password" name="password" type="password" placeholder="At least 8 characters" />
          </div>
          {addState.error ? <ErrorNote>{addState.error}</ErrorNote> : null}
          {addState.ok ? <Ok>{addState.ok}</Ok> : null}
          <Button disabled={addPending}>{addPending ? "Adding…" : "Add to shop"}</Button>
        </form>
      ) : null}

      <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
        {members.map((m) => (
          <MemberRow key={m.id} member={m} roleLabels={roleLabels} roleBlurbs={roleBlurbs} />
        ))}
      </ul>
    </Card>
  );
}

function MemberRow({ member, roleLabels, roleBlurbs }: {
  member: Member; roleLabels: Record<string, string>; roleBlurbs: Record<string, string>;
}) {
  const [roleState, roleActionFn, rolePending] = useActionState<FormState, FormData>(roleAction, {});
  const [accessState, accessActionFn, accessPending] = useActionState<FormState, FormData>(accessAction, {});
  const [pwState, pwAction, pwPending] = useActionState<FormState, FormData>(passwordAction, {});
  const [pwOpen, setPwOpen] = useState(false);

  return (
    <li className={`py-3 ${member.active ? "" : "opacity-60"}`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-40 flex-1">
          <p className="font-medium text-slate-900 dark:text-slate-50">
            {member.name}
            {member.isSelf ? <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">you</span> : null}
            {!member.active ? <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">no access</span> : null}
          </p>
          <p className="text-sm text-slate-600 dark:text-slate-400">{member.email}</p>
        </div>

        <form action={roleActionFn} className="flex items-center gap-2">
          <input type="hidden" name="membershipId" value={member.id} />
          <select name="role" defaultValue={member.role} className={`${smallInput} w-44`} aria-label={`Role for ${member.name}`}>
            {ROLES.map((r) => <option key={r} value={r}>{roleLabels[r]}</option>)}
          </select>
          <button type="submit" disabled={rolePending} className="h-11 rounded-lg bg-white px-3 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700">
            Set
          </button>
        </form>

        <form action={accessActionFn}>
          <input type="hidden" name="membershipId" value={member.id} />
          <input type="hidden" name="active" value={member.active ? "0" : "1"} />
          <button
            type="submit"
            disabled={accessPending}
            className={`h-11 rounded-lg px-3 text-sm font-semibold ${
              member.active ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"
            }`}
          >
            {member.active ? "Remove access" : "Restore access"}
          </button>
        </form>

        <button type="button" onClick={() => setPwOpen(!pwOpen)} className="text-sm text-slate-500 hover:underline dark:text-slate-400">
          Set password
        </button>
      </div>

      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{roleBlurbs[member.role]}</p>

      {pwOpen ? (
        <form action={pwAction} className="mt-2 flex gap-2">
          <input type="hidden" name="membershipId" value={member.id} />
          <input
            name="password"
            type="password"
            placeholder="At least 8 characters"
            aria-label={`New password for ${member.name}`}
            className={`${smallInput} max-w-xs`}
            required
          />
          <button type="submit" disabled={pwPending} className="h-11 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white dark:bg-slate-50 dark:text-slate-900">
            Set
          </button>
        </form>
      ) : null}

      {roleState.error ? <div className="mt-2"><ErrorNote>{roleState.error}</ErrorNote></div> : null}
      {accessState.error ? <div className="mt-2"><ErrorNote>{accessState.error}</ErrorNote></div> : null}
      {pwState.error ? <div className="mt-2"><ErrorNote>{pwState.error}</ErrorNote></div> : null}
      {pwState.ok ? <div className="mt-2"><Ok>{pwState.ok}</Ok></div> : null}
    </li>
  );
}

export type Pkg = {
  id: string;
  name: string;
  items: { kind: string; name: string; qty: number; priceCents: number }[];
};

export function PackagesPanel({ packages }: { packages: Pkg[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(newPackageAction, {});
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(3);

  return (
    <Card>
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Service packages
        </h2>
        <button type="button" onClick={() => setOpen(!open)} className="ml-auto text-sm text-slate-600 hover:underline dark:text-slate-400">
          {open ? "Close" : "New package"}
        </button>
      </div>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Work you sell constantly, dropped onto an estimate in one tap. Lines are copied when used, so editing a
        package never rewrites a document already written.
      </p>

      {open ? (
        <form action={action} className="mt-3 space-y-3 rounded-xl bg-slate-50 p-4 dark:bg-slate-950">
          <Field label="Package name" name="name" defaultValue={state.values?.name} required />
          <div className="space-y-2">
            {Array.from({ length: rows }, (_, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[7rem_1fr_4rem_6rem]">
                <select name="itemKind" defaultValue="LABOR" className={smallInput} aria-label="Type">
                  {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
                <input name="itemName" placeholder="Description" className={smallInput} aria-label="Description" />
                <input name="itemQty" defaultValue="1" inputMode="decimal" className={smallInput} aria-label="Quantity" />
                <input name="itemPrice" placeholder="0.00" inputMode="decimal" className={smallInput} aria-label="Price" />
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setRows(rows + 1)} className="text-sm text-slate-600 underline dark:text-slate-400">
            Another line
          </button>
          {state.error ? <ErrorNote>{state.error}</ErrorNote> : null}
          {state.ok ? <Ok>{state.ok}</Ok> : null}
          <div><Button disabled={pending}>{pending ? "Saving…" : "Save package"}</Button></div>
        </form>
      ) : null}

      {packages.length > 0 ? (
        <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
          {packages.map((p) => <PackageRow key={p.id} pkg={p} />)}
        </ul>
      ) : null}
    </Card>
  );
}

function PackageRow({ pkg }: { pkg: Pkg }) {
  const [state, action, pending] = useActionState<FormState, FormData>(deletePackageAction, {});
  const total = pkg.items.reduce((sum, i) => sum + Math.round(i.qty * i.priceCents), 0);

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="font-medium text-slate-900 dark:text-slate-50">{pkg.name}</span>
        <span className="text-sm text-slate-500 dark:text-slate-400">{pkg.items.length} lines</span>
        <span className="ml-auto font-semibold tabular-nums text-slate-900 dark:text-slate-50">{formatCents(total)}</span>
        <form action={action}>
          <input type="hidden" name="packageId" value={pkg.id} />
          <button type="submit" disabled={pending} className="text-sm text-red-600 hover:underline dark:text-red-400">
            Delete
          </button>
        </form>
      </div>
      <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
        {pkg.items.map((i) => i.name).join(" · ")}
      </p>
      {state.error ? <div className="mt-2"><ErrorNote>{state.error}</ErrorNote></div> : null}
    </li>
  );
}
