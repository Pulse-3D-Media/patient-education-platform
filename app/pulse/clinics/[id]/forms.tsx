"use client";

import type { Category, ClinicStatus } from "@prisma/client";
import { useActionState } from "react";
import { INPUT, LABEL, PRIMARY_BUTTON, TEXTAREA } from "@/components/ui/styles";
import { CATEGORIES } from "@/lib/categories";
import { formatUsPhone } from "@/lib/phone";
import { addNoteAction, saveDetailsAction, setManagedAction, setPlanAction, setStatusAction, type FormState } from "../../actions";

/**
 * The editable sections of one clinic's page, each a small form that calls
 * its own Server Action (app/pulse/actions.ts) and shows the answer under
 * its button. They are client components because a form needs to know
 * whether it is still sending and what came back.
 *
 * Every form carries the clinic id in a hidden field. The action looks that
 * id up before using it, so a changed hidden field gets "no longer exists",
 * not someone else's clinic.
 */

/** The line under a form's button: what the server said, or nothing yet. */
function Outcome({ state }: { state: FormState }) {
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
function SaveButton({ pending, label = "Save" }: { pending: boolean; label?: string }) {
  return (
    <button type="submit" disabled={pending} className={`${PRIMARY_BUTTON} h-11`}>
      {pending ? "Saving..." : label}
    </button>
  );
}

const STATUS_CHOICES: { value: ClinicStatus; label: string; hint: string }[] = [
  { value: "ACTIVE", label: "Active", hint: "Library and share links on." },
  { value: "PAUSED", label: "Paused", hint: "Off for now. People and settings kept." },
  { value: "CANCELED", label: "Canceled", hint: "The plan has ended." },
];

export function StatusForm({ clinicId, status }: { clinicId: string; status: ClinicStatus }) {
  const [state, action, pending] = useActionState(setStatusAction, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="clinicId" value={clinicId} />
      <fieldset>
        <legend className={LABEL}>Set the status to</legend>
        <div className="flex flex-wrap gap-2">
          {STATUS_CHOICES.map((choice) => (
            <label
              key={choice.value}
              className="flex h-12 cursor-pointer items-center gap-2 rounded-lg border border-white/15 px-3 has-[:checked]:border-[#2a829b] has-[:checked]:bg-[#2a829b]/15"
            >
              <input type="radio" name="status" value={choice.value} defaultChecked={status === choice.value} className="accent-[#2a829b]" />
              <span className="text-[15px] font-medium">{choice.label}</span>
              <span className="hidden text-sm text-[#667085] sm:inline">{choice.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor="reason" className={LABEL}>
          Why (required, kept with the change)
        </label>
        <input id="reason" name="reason" required className={INPUT} placeholder="Paid by invoice through March" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SaveButton pending={pending} label="Set status" />
        <Outcome state={state} />
      </div>
    </form>
  );
}

export function PlanForm({ clinicId, categories, surgeonSeats }: { clinicId: string; categories: Category[]; surgeonSeats: number }) {
  const [state, action, pending] = useActionState(setPlanAction, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="clinicId" value={clinicId} />
      <fieldset>
        <legend className={LABEL}>Categories on the plan</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORIES.map((category) => (
            <label
              key={category.value}
              className="flex h-12 cursor-pointer items-center gap-3 rounded-lg border border-white/15 px-3 has-[:checked]:border-[#2a829b] has-[:checked]:bg-[#2a829b]/15"
            >
              <input
                type="checkbox"
                name="categories"
                value={category.value}
                defaultChecked={categories.includes(category.value)}
                className="h-5 w-5 accent-[#2a829b]"
              />
              <span className="text-[15px]">{category.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="max-w-xs">
        <label htmlFor="surgeonSeats" className={LABEL}>
          Surgeon seats paid for
        </label>
        <input id="surgeonSeats" name="surgeonSeats" type="number" min={0} step={1} defaultValue={surgeonSeats} className={INPUT} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SaveButton pending={pending} label="Save plan" />
        <Outcome state={state} />
      </div>
    </form>
  );
}

export function ManagedForm({ clinicId, managedByPulse }: { clinicId: string; managedByPulse: boolean }) {
  const [state, action, pending] = useActionState(setManagedAction, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="clinicId" value={clinicId} />
      <label className="flex min-h-12 cursor-pointer items-start gap-3">
        <input type="checkbox" name="managedByPulse" defaultChecked={managedByPulse} className="mt-1 h-5 w-5 accent-[#2a829b]" />
        <span>
          <span className="block text-[15px] font-medium">Managed by Pulse</span>
          <span className="block text-sm text-[#bfbfbf]">
            For enterprise and comped clinics. Pulse sets the plan and status by hand, and the clinic never sees billing screens.
          </span>
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <SaveButton pending={pending} />
        <Outcome state={state} />
      </div>
    </form>
  );
}

export type DetailsValues = {
  name: string;
  logoUrl: string | null;
  /** Digits only, as stored. Shown formatted. */
  phone: string | null;
  noticeText: string | null;
  showPlaceholders: boolean;
  viewDaysOverride: number | null;
  /** The platform-wide number, shown as the fallback beside the override. */
  platformViewDays: number;
};

export function DetailsForm({ clinicId, values }: { clinicId: string; values: DetailsValues }) {
  const [state, action, pending] = useActionState(saveDetailsAction, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="clinicId" value={clinicId} />
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="name" className={LABEL}>
            Name
          </label>
          <input id="name" name="name" required defaultValue={values.name} className={INPUT} />
          <p className="mt-1 text-xs text-[#667085]">Renames the clinic in Clerk too, so it stays renamed.</p>
        </div>
        <div>
          <label htmlFor="phone" className={LABEL}>
            Phone
          </label>
          <input id="phone" name="phone" type="tel" defaultValue={formatUsPhone(values.phone)} placeholder="(801) 555-0123" className={INPUT} />
        </div>
        <div className="md:col-span-2">
          <label htmlFor="logoUrl" className={LABEL}>
            Logo address
          </label>
          <input id="logoUrl" name="logoUrl" type="url" defaultValue={values.logoUrl ?? ""} placeholder="https://" className={INPUT} />
          <p className="mt-1 text-xs text-[#667085]">A logo uploaded to the clinic&rsquo;s Clerk organization replaces this on their next sign-in.</p>
        </div>
        <div className="md:col-span-2">
          <label htmlFor="noticeText" className={LABEL}>
            Notice shown at the top of their admin console
          </label>
          <input id="noticeText" name="noticeText" defaultValue={values.noticeText ?? ""} placeholder="Leave empty for no notice" className={INPUT} />
        </div>
        <div>
          <label htmlFor="viewDaysOverride" className={LABEL}>
            Days a link works after first view
          </label>
          <input
            id="viewDaysOverride"
            name="viewDaysOverride"
            type="number"
            min={1}
            max={365}
            step={1}
            defaultValue={values.viewDaysOverride ?? ""}
            placeholder={`Platform setting: ${values.platformViewDays}`}
            className={INPUT}
          />
          <p className="mt-1 text-xs text-[#667085]">Empty means the platform setting ({values.platformViewDays} days).</p>
        </div>
        <label className="flex min-h-12 cursor-pointer items-start gap-3 md:pt-6">
          <input type="checkbox" name="showPlaceholders" defaultChecked={values.showPlaceholders} className="mt-1 h-5 w-5 accent-[#2a829b]" />
          <span>
            <span className="block text-[15px] font-medium">Show placeholder videos</span>
            <span className="block text-sm text-[#bfbfbf]">Off hides every placeholder from this clinic&rsquo;s library.</span>
          </span>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SaveButton pending={pending} label="Save details" />
        <Outcome state={state} />
      </div>
    </form>
  );
}

/**
 * Add one entry to the clinic's log. The box empties itself once the note
 * is saved (React resets a form after its action succeeds), and the list
 * under it refreshes with the new entry on top.
 */
export function NoteForm({ clinicId }: { clinicId: string }) {
  const [state, action, pending] = useActionState(addNoteAction, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="clinicId" value={clinicId} />
      <label htmlFor="body" className="sr-only">
        New note
      </label>
      <textarea
        id="body"
        name="body"
        rows={3}
        required
        placeholder="Who we talked to, what they asked for, what was agreed."
        className={TEXTAREA}
      />
      <div className="flex flex-wrap items-center gap-3">
        <SaveButton pending={pending} label="Add note" />
        <Outcome state={state} />
      </div>
    </form>
  );
}
