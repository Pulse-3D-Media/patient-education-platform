"use client";

import type { Category, PracticeType, StaffAccess } from "@prisma/client";
import { useActionState, useState } from "react";
import { INPUT, LABEL, TEXTAREA } from "@/components/ui/styles";
import { CATEGORIES, availabilityLabel, type CategoryAvailability } from "@/lib/categories";
import { MAX_LINK_DAYS, MIN_LINK_DAYS } from "@/lib/expiry";
import { addNoteAction, saveDetailsAction, setManagedAction, setOwnerAction, setPlanAction, setPracticeTypeAction, setStatusAction } from "../../actions";
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
  { value: "UNKNOWN", label: "Not set", hint: "Counts as a clinic: may pay by card." },
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
  seatsInUse,
  availability,
}: {
  clinicId: string;
  categories: Category[];
  surgeonSeats: number;
  /** How many people hold a surgeon seat right now. Lowering the seats below this needs the override box. */
  seatsInUse: number;
  /** Which categories can be bought right now. The others get a small label; they can still be ticked. */
  availability: Record<Category, CategoryAvailability>;
}) {
  const [state, action, pending] = useActionState(setPlanAction, null);
  // What is typed is kept here, not in the page, so a save that is refused
  // (fewer seats than are in use) leaves the draft exactly as it was.
  const [picked, setPicked] = useState<Category[]>(categories);
  const [seatsText, setSeatsText] = useState(String(surgeonSeats));
  const [allowFewer, setAllowFewer] = useState(false);
  const wanted = /^\d+$/.test(seatsText.trim()) ? Number(seatsText.trim()) : null;
  const wouldBeOver = wanted !== null && wanted < seatsInUse && wanted < surgeonSeats;
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
                  checked={picked.includes(category.value)}
                  onChange={(event) =>
                    setPicked((now) => (event.target.checked ? [...now, category.value] : now.filter((value) => value !== category.value)))
                  }
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
        <input
          id="surgeonSeats"
          name="surgeonSeats"
          type="number"
          min={0}
          step={1}
          value={seatsText}
          onChange={(event) => setSeatsText(event.target.value)}
          aria-describedby="surgeonSeats-help"
          className={INPUT}
        />
        <p id="surgeonSeats-help" className="mt-1 text-sm text-[#bfbfbf]">
          {seatsInUse} of {surgeonSeats} in use right now.
        </p>
      </div>
      {wouldBeOver && (
        <label className="flex min-h-12 max-w-2xl cursor-pointer items-start gap-3 rounded-lg border border-[#f3b94d]/40 bg-[#f3b94d]/10 p-3">
          <input
            type="checkbox"
            name="allowFewerSeats"
            checked={allowFewer}
            onChange={(event) => setAllowFewer(event.target.checked)}
            className="mt-1 h-5 w-5 accent-[#f3b94d]"
          />
          <span>
            <span className="block text-[15px] font-medium text-[#f3b94d]">Allow fewer seats than are in use</span>
            <span className="block text-sm text-[#bfbfbf]">
              {seatsInUse} {seatsInUse === 1 ? "person holds" : "people hold"} a surgeon seat, so {wanted} would leave this clinic {seatsInUse - (wanted ?? 0)} over.
              Nobody is relabelled, no seat is taken away and no charge is changed. The clinic sees the gap on its People page, and nobody new can be given
              a seat until a surgeon is marked as staff or a seat is added. It goes in the log under your name.
            </span>
          </span>
        </label>
      )}
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

/**
 * Make one current member the account owner (People tab). The list is the
 * clinic's people as Clerk reported them when the page was drawn; the action
 * checks with Clerk again before anything is written.
 */
export function OwnerForm({ clinicId, people, ownerUserId }: { clinicId: string; people: { userId: string; label: string }[]; ownerUserId: string | null }) {
  const [state, action, pending] = useActionState(setOwnerAction, null);
  return (
    <form action={action} className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
      <input type="hidden" name="clinicId" value={clinicId} />
      <div className="sm:w-96">
        <label htmlFor="ownerUserId" className={LABEL}>
          Account owner
        </label>
        <select id="ownerUserId" name="ownerUserId" defaultValue={ownerUserId ?? ""} className={INPUT}>
          {ownerUserId === null && <option value="">Choose a person</option>}
          {people.map((person) => (
            <option key={person.userId} value={person.userId}>
              {person.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SaveButton pending={pending} label="Make account owner" />
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
