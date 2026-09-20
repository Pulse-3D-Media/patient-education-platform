"use client";

import { useActionState } from "react";
import { PRIMARY_BUTTON } from "@/components/ui/styles";
import { answerPracticeTypeAction } from "./actions";

/**
 * The one question on the Billing page: is this a clinic or a hospital?
 * Asked once, of an admin, while the answer is still unknown. A client
 * component only because a form needs to show that it is sending and what
 * came back; the checks are all in the Server Action.
 *
 * The radio buttons are ordinary form fields, so when a save fails the
 * choice that was made stays selected and can be sent again.
 */
export function PracticeTypeQuestion() {
  const [state, action, pending] = useActionState(answerPracticeTypeAction, null);
  if (state?.ok) return <p className="mt-3 text-brand-bright">{state.ok}</p>;

  return (
    <form action={action} className="mt-3 flex flex-col gap-4">
      <fieldset>
        <legend className="text-[15px] text-ink-soft">Which describes your practice?</legend>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Choice value="CLINIC" label="A clinic or private practice" />
          <Choice value="HOSPITAL" label="A hospital or health system" />
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
          {pending ? "Saving..." : "Save"}
        </button>
        <span aria-live="polite" className="text-[15px]">
          {state?.error && <span className="text-warn">{state.error}</span>}
        </span>
      </div>
    </form>
  );
}

function Choice({ value, label }: { value: string; label: string }) {
  return (
    <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-line-strong px-4 has-[:checked]:border-brand has-[:checked]:bg-brand/15">
      <input type="radio" name="practiceType" value={value} required className="h-5 w-5 accent-[var(--brand-accent)]" />
      <span className="text-[15px] font-medium text-ink">{label}</span>
    </label>
  );
}
