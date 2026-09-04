"use client";

import { useActionState, useState } from "react";
import { removeCustomer, type FormState } from "./actions";
import { Button, ErrorNote } from "../_ui";

export function DeleteCustomer({ customerId, name }: { customerId: string; name: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(removeCustomer, {});
  // A two-step confirm rather than a browser confirm(), which is easy to
  // dismiss by accident on a tablet.
  const [armed, setArmed] = useState(false);

  return (
    <div className="space-y-3">
      {state.error ? <ErrorNote>{state.error}</ErrorNote> : null}

      {armed ? (
        <form action={action} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="id" value={customerId} />
          <span className="text-sm text-slate-700 dark:text-slate-300">Delete {name}? This cannot be undone.</span>
          <Button variant="danger" disabled={pending}>{pending ? "Deleting…" : "Yes, delete"}</Button>
          <button
            type="button"
            onClick={() => setArmed(false)}
            className="h-12 rounded-xl px-4 text-base font-medium text-slate-600 dark:text-slate-400"
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setArmed(true)}
          className="text-sm font-medium text-red-700 hover:underline dark:text-red-400"
        >
          Delete this customer
        </button>
      )}
    </div>
  );
}
