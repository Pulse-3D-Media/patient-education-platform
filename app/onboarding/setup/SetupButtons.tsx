"use client";

import { unstable_rethrow } from "next/navigation";
import { useActionState, useState, useTransition, type FormEvent } from "react";
import { safeSave } from "@/lib/form-save";
import type { SetupStepKey } from "@/lib/setup";
import { skipSetupStepAction, type SetupFormState } from "./actions";

/** The step's main button, as drawn: filled, 48px tall. */
export const SETUP_PRIMARY =
  "inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand px-6 text-[15px] font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60";
/** An outlined button beside it. */
export const SETUP_SECONDARY =
  "inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-line-strong bg-surface px-5 text-[15px] font-semibold text-ink hover:border-brand disabled:opacity-60";

/**
 * "Skip for now": the step is left as it is and shown as Later, and setup
 * moves on (skipSetupStepAction, which sends the browser on by a redirect).
 * If that cannot be confirmed, a sentence says so and the button stays.
 */
export function SkipButton({ step }: { step: SetupStepKey }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function skip() {
    setError(null);
    start(async () => {
      const outcome = await safeSave(() => skipSetupStepAction(step), unstable_rethrow);
      if (outcome?.error) setError(outcome.error);
    });
  }

  return (
    <div className="flex flex-col">
      <button type="button" onClick={skip} disabled={pending} className="h-12 rounded-xl px-3 text-[15px] font-medium text-ink-soft hover:text-ink disabled:opacity-60">
        {pending ? "Skipping..." : "Skip for now"}
      </button>
      {error && (
        <p role="alert" className="px-3 text-sm text-warn">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Send a step's form to its Server Action and KEEP WHAT WAS TYPED, whatever
 * comes back: the same two guards as useKeptForm() on /pulse
 * (app/pulse/FormBits.tsx). React's reset after a send is declined, so the
 * boxes stay as they were, and a save that fails outright becomes a plain
 * sentence (safeSave) instead of an error page. A save that worked sends the
 * browser on to the next step (a redirect, which is handed back to Next.js).
 */
export function useSetupForm(serverAction: (previous: SetupFormState, formData: FormData) => Promise<SetupFormState>) {
  const [state, action, pending] = useActionState<SetupFormState, FormData>(
    (previous, formData) => safeSave(() => serverAction(previous, formData), unstable_rethrow),
    null,
  );
  return { state, pending, form: { action, onReset: (event: FormEvent<HTMLFormElement>) => event.preventDefault() } };
}

/** The line under a step's form: what went wrong, in a plain sentence. */
export function StepProblem({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-4 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-[15px] text-ink">
      {message}
    </p>
  );
}
