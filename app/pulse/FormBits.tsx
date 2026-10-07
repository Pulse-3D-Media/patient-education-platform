"use client";

import { unstable_rethrow } from "next/navigation";
import { useActionState, type FormEvent } from "react";
import { PRIMARY_BUTTON } from "@/components/ui/styles";
import { safeSave } from "@/lib/form-save";
import type { FormState } from "./actions";

/**
 * What every form on the dashboard shares: the hook that keeps what was
 * typed (useKeptForm), the line that shows what the server said, and the
 * filled button that says "Saving..." while it works. Shared so the clinic
 * forms, the settings form and the video forms behave and read the same.
 */

/**
 * Send a form to a Server Action and KEEP WHAT WAS TYPED, whatever comes back.
 *
 * Two things would otherwise lose a draft:
 *
 *   1. React empties a form's boxes back to their starting values after
 *      every send, refused or not. It does that by "resetting" the form, and
 *      a reset can be declined: `onReset` below declines it, so every box,
 *      tick and choice stays exactly as it was left. After a save that
 *      worked, what is in the boxes is what was just saved, so keeping it is
 *      right then too.
 *   2. A save that fails outright (a lost connection, a server fault) would
 *      replace the whole page with an error page. safeSave() turns it into a
 *      plain sentence under the button instead (lib/form-save.ts).
 *
 * Use it in place of React's useActionState, and spread `form` onto the
 * <form>:
 *
 *   const { state, pending, form } = useKeptForm(saveDetailsAction);
 *   <form {...form}> ... <SaveButton pending={pending} /> <Outcome state={state} />
 *
 * `onSaved` runs once the server has confirmed a save, for the rare box
 * that should be emptied then (the reason typed for a status change).
 */
export function useKeptForm(serverAction: (previous: FormState, formData: FormData) => Promise<FormState>, onSaved?: () => void) {
  const [state, action, pending] = useActionState<FormState, FormData>(async (previous, formData) => {
    // unstable_rethrow hands Next.js's own signals (a redirect, a not-found) back to Next.js; only real failures become the sentence.
    const outcome = await safeSave(() => serverAction(previous, formData), unstable_rethrow);
    if (outcome?.ok) onSaved?.();
    return outcome;
  }, null);
  return { state, pending, form: { action, onReset: declineReset } };
}

/** Says no to the reset React asks for after a form is sent, so nothing typed is thrown away. */
function declineReset(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
}

/** The line under a form's button: what the server said, or nothing yet. */
export function Outcome({ state }: { state: FormState }) {
  if (!state) return null;
  if (state.error) {
    return (
      <p role="alert" className="text-sm text-[#f3b94d]">
        {state.error}
      </p>
    );
  }
  return (
    <p role="status" className="text-sm text-[#5fb8d4]">
      {state.ok}
    </p>
  );
}

/** The one filled button every form ends with. Says "Saving..." while the server works. */
export function SaveButton({ pending, label = "Save" }: { pending: boolean; label?: string }) {
  return (
    <button type="submit" disabled={pending} className={`${PRIMARY_BUTTON} h-11`}>
      {pending ? "Saving..." : label}
    </button>
  );
}
