// Shared form controls. Sized for a tablet on a counter: 48px minimum touch
// targets and 16px text, below which iOS zooms the page on focus.

import Link from "next/link";

const FIELD =
  "h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 outline-none " +
  "focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 " +
  "dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50 dark:focus:border-slate-400";

export function Field({
  label, name, defaultValue, type = "text", placeholder, required, inputMode, className = "",
}: {
  label: string; name: string; defaultValue?: string | number | null; type?: string;
  placeholder?: string; required?: boolean; inputMode?: "text" | "numeric" | "decimal" | "tel" | "email"; className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      <input
        name={name}
        type={type}
        inputMode={inputMode}
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue ?? undefined}
        className={FIELD}
      />
    </label>
  );
}

export function TextArea({ label, name, defaultValue, rows = 3 }: { label: string; name: string; defaultValue?: string | number | null; rows?: number }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      <textarea name={name} rows={rows} defaultValue={defaultValue ?? undefined} className={FIELD.replace("h-12", "min-h-24 py-2")} />
    </label>
  );
}

export function Select({ label, name, defaultValue, options }: {
  label: string; name: string; defaultValue?: string | null; options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      <select name={name} defaultValue={defaultValue ?? undefined} className={FIELD}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function Check({ label, name, defaultChecked }: { label: string; name: string; defaultChecked?: boolean }) {
  return (
    <label className="flex min-h-12 items-center gap-3">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-5 rounded border-slate-300 dark:border-slate-700" />
      <span className="text-base text-slate-700 dark:text-slate-300">{label}</span>
    </label>
  );
}

export function Button({ children, variant = "primary", type = "submit", disabled }: {
  children: React.ReactNode; variant?: "primary" | "ghost" | "danger"; type?: "submit" | "button"; disabled?: boolean;
}) {
  const styles = {
    primary: "bg-slate-900 text-white dark:bg-slate-50 dark:text-slate-900",
    ghost: "bg-white text-slate-700 ring-1 ring-slate-300 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700",
    danger: "bg-red-600 text-white",
  }[variant];
  return (
    <button type={type} disabled={disabled} className={`h-12 rounded-xl px-5 text-base font-semibold transition-opacity active:opacity-80 disabled:opacity-50 ${styles}`}>
      {children}
    </button>
  );
}

export function LinkButton({ href, children, variant = "ghost" }: { href: string; children: React.ReactNode; variant?: "primary" | "ghost" }) {
  const styles = variant === "primary"
    ? "bg-slate-900 text-white dark:bg-slate-50 dark:text-slate-900"
    : "bg-white text-slate-700 ring-1 ring-slate-300 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700";
  return (
    <Link href={href} className={`inline-flex h-12 items-center rounded-xl px-5 text-base font-semibold ${styles}`}>
      {children}
    </Link>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800 ${className}`}>
      {children}
    </div>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-800 dark:bg-red-950/50 dark:text-red-300">
      {children}
    </p>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
      {children}
    </div>
  );
}
