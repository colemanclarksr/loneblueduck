"use client";

import Link from "next/link";

// window.print is the whole feature. A shop with a counter printer wants paper,
// and a shop without one wants the browser's "save as PDF" -- both come free.
export function PrintButton({ invoiceId }: { invoiceId: string }) {
  return (
    <div className="flex gap-3">
      <Link
        href={`/invoices/${invoiceId}`}
        className="inline-flex h-12 items-center rounded-xl bg-white px-5 text-base font-semibold text-slate-700 ring-1 ring-slate-300"
      >
        ← Back
      </Link>
      <button
        type="button"
        onClick={() => window.print()}
        className="h-12 rounded-xl bg-slate-900 px-5 text-base font-semibold text-white"
      >
        Print
      </button>
    </div>
  );
}
