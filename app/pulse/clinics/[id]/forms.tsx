"use client";

import type { Category, PracticeType, StaffAccess } from "@prisma/client";
import { useActionState } from "react";
import { INPUT, LABEL, TEXTAREA } from "@/components/ui/styles";
import { CATEGORIES, availabilityLabel, type CategoryAvailability } from "@/lib/categories";
import { MAX_LINK_DAYS, MIN_LINK_DAYS } from "@/lib/expiry";
import { addNoteAction, saveDetailsAction, setManagedAction, setPlanAction, setPracticeTypeAction, setStatusAction } from "../../actions";
import { Outcome, SaveButton } from "../../FormBits";

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

/** What the Status form can send. The first three are hand settings, which win over billing; FOLLOW removes the hand setting. */
const STATUS_CHOICES: { value: StaffAccess | "FOLLOW"; label: string; hint: string }[] = [
  { value: "OPEN", label: "Open", hint: "On, whatever billing says." },
  { value: "PAUSED", label: "Paused", hint: "Off for now, whatever billing says." },
  { value: "CANCELED", label: "Canceled", hint: "Ended, whatever billing says." },
  { value: "FOLLOW", label: "Follow billing", hint: "No hand setting: card payments decide." },
];

export function StatusForm({ clinicId, staffAccess }: { clinicId: string; staffAccess: StaffAccess | null }) {
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
              <input
                type="radio"
                name="status"
                value={choice.value}
                defaultChecked={(staffAccess ?? "FOLLOW") === choice.value}
                className="accent-[#2a829b]"
              />
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
      <p className="text-sm text-[#bfbfbf]">
        Pausing or cancelling here closes the clinic in this app only. It does not cancel a card subscription in Stripe: a clinic that pays by card
        keeps being charged until its subscription is cancelled in Stripe.
      </p>
    </form>
  );
}

const PRACTICE_CHOICES: { value: PracticeType; label: string; hint: string }[] = [
  { value: "UNKNOWN", label: "Not answered", hint: "Cannot check out until it is." },
  { value: "CLINIC", label: "Clinic or practice", hint: "May pay by card." },
  { value: "HOSPITAL", label: "Hospital or health system", hint: "Always Enterprise, set up by Pulse." },
];

export function PracticeTypeForm({ clinicId, practiceType }: { clinicId: string; practiceType: PracticeType }) {
  const [state, action, pending] = useActionState(setPracticeTypeAction, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="clinicId" value={clinicId} />
      <fieldset>
        <legend className={LABEL}>What kind of practice this is</legend>
        <div className="flex flex-wrap gap-2">
          {PRACTICE_CHOICES.map((choice) => (
            <label
              key={choice.value}
              className="flex h-12 cursor-pointer items-center gap-2 rounded-lg border border-white/15 px-3 has-[:checked]:border-[#2a829b] has-[:checked]:bg-[#2a829b]/15"
            >
              <input type="radio" name="practiceType" value={choice.value} defaultChecked={practiceType === choice.value} className="accent-[#2a829b]" />
              <span className="text-[15px] font-medium">{choice.label}</span>
              <span className="hidden text-sm text-[#667085] sm:inline">{choice.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <SaveButton pending={pending} />
        <Outcome state={state} />
      </div>
    </form>
  );
}

export function PlanForm({
  clinicId,
  categories,
  surgeonSeats,
  availability,
}: {
  clinicId: string;
  categories: Category[];
  surgeonSeats: number;
  /** Which categories can be bought right now. The others get a small label; they can still be ticked. */
  availability: Record<Category, CategoryAvailability>;
}) {
  const [state, action, pending] = useActionState(setPlanAction, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="clinicId" value={clinicId} />
      <fieldset>
        <legend className={LABEL}>Categories on the plan</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORIES.map((category) => {
            const label = availabilityLabel(availability[category.value]);
            return (
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
                {label && <span className="ml-auto text-xs font-medium uppercase tracking-wide text-[#f3b94d]">{label}</span>}
              </label>
            );
          })}
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
            For enterprise and comped clinics. Pulse sets the plan and status by hand, billing news never changes either, and the clinic never
            sees billing controls. Turning this on does not cancel a card subscription in Stripe: if the clinic pays by card, cancel that in
            Stripe too, or it keeps being charged.
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

/** The clinic's logo and phone are not here: they are on the Branding tab, which is the one form that saves them. */
export type DetailsValues = {
  name: string;
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
        <div className="md:col-span-2">
          <label htmlFor="noticeText" className={LABEL}>
            Notice shown at the top of their admin console
          </label>
          <input id="noticeText" name="noticeText" defaultValue={values.noticeText ?? ""} placeholder="Leave empty for no notice" className={INPUT} />
        </div>
        <div>
          <label htmlFor="viewDaysOverride" className={LABEL}>
            Days a link works after the first play
          </label>
          <input
            id="viewDaysOverride"
            name="viewDaysOverride"
            type="number"
            min={MIN_LINK_DAYS}
            max={MAX_LINK_DAYS}
            step={1}
            defaultValue={values.viewDaysOverride ?? ""}
            placeholder={`Platform setting: ${values.platformViewDays}`}
            className={INPUT}
          />
          <p className="mt-1 text-xs text-[#667085]">
            Empty means the platform setting ({values.platformViewDays} days). Applies to links made from now on; a link already sent keeps
            its number.
          </p>
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
