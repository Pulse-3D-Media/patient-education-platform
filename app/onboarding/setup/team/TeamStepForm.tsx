"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { confirmAddSeatAction, reviewAddSeatAction, type AddSeatReview } from "@/app/admin/billing/actions";
import { INPUT } from "@/components/ui/styles";
import { SAVE_NOT_CONFIRMED, safeSave } from "@/lib/form-save";
import { formatCents } from "@/lib/pricing";
import { finishTeamStepAction, sendSetupInvitationsAction, type InviteOutcome } from "../actions";
import { SETUP_PRIMARY, SETUP_SECONDARY, StepProblem } from "../SetupButtons";
import { StepBody, StepHeading } from "../SetupFrame";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Step 3's form: one email box per seat nobody holds, "Add another" for one
 * more seat (where plan changes are offered), and Send invitations.
 *
 * Each address is answered on its own: the ones that went out leave their
 * box and appear in the list above; a box whose address was refused (not an
 * email, already in the clinic, already invited) keeps it, with the reason
 * under it, so it can be corrected and sent again. When every address went
 * out, the server moves setup on to the next step.
 */
export function TeamStepForm({
  seats,
  free,
  me,
  invited,
  canAddSeat,
  unreadable,
  welcomeBack,
}: {
  seats: number;
  /** Seats nobody holds and no invitation holds: one box each. */
  free: number;
  /** The person setting up, and whether they hold a seat. */
  me: { email: string; seated: boolean } | null;
  /** Addresses with an open invitation that holds a seat. */
  invited: string[];
  canAddSeat: boolean;
  /** Clerk could not be asked about the clinic's people just now. */
  unreadable: boolean;
  welcomeBack: boolean;
}) {
  const router = useRouter();
  const [boxes, setBoxes] = useState<string[]>(() => Array.from({ length: free }, () => ""));
  const [problems, setProblems] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);

  const others = me?.seated ? seats - 1 : seats;
  const typed = boxes.some((value) => value.trim());

  function send() {
    setError(null);
    setProblems({});
    start(async () => {
      const outcome = await safeSave<InviteOutcome | { error: string }>(async () => sendSetupInvitationsAction(boxes));
      if ("sent" in outcome && outcome.failed.length === 0 && !outcome.error) return; // the server sent the browser on
      if (!("sent" in outcome) || outcome.error) {
        setError(outcome.error ?? SAVE_NOT_CONFIRMED);
        return;
      }
      // Keep only the boxes that were refused, in order, with their reasons; the rest went out.
      const remaining: string[] = [];
      const reasons: Record<number, string> = {};
      for (const value of boxes) {
        const failure = outcome.failed.find((entry) => entry.email === value.trim());
        if (failure) {
          reasons[remaining.length] = failure.message;
          remaining.push(value);
        } else if (!value.trim()) remaining.push("");
      }
      setBoxes(remaining);
      setProblems(reasons);
      if (outcome.sent.length > 0) router.refresh();
    });
  }

  function continueOn() {
    setError(null);
    start(async () => {
      const outcome = await safeSave(() => finishTeamStepAction());
      if (outcome?.error) setError(outcome.error);
    });
  }

  return (
    <StepBody
      step="team"
      welcomeBack={welcomeBack}
      actions={
        typed || free > 0 ? (
          <button type="button" onClick={send} disabled={pending} className={SETUP_PRIMARY}>
            {pending ? "Sending..." : "Send invitations"}
          </button>
        ) : (
          <button type="button" onClick={continueOn} disabled={pending} className={SETUP_PRIMARY}>
            {pending ? "Saving..." : "Continue"}
          </button>
        )
      }
    >
      <StepHeading>Invite your team</StepHeading>
      <p className="mt-5 text-[15px] text-ink-soft">
        <strong className="font-semibold text-ink">{plural(seats, "seat", "seats")}</strong> on your plan
        {me?.seated ? `: you and ${others} more` : ""}
      </p>

      <ul className="mt-4 flex flex-col gap-3">
        {me && (
          <li className="flex min-h-12 items-center rounded-xl bg-wash px-4 py-3 text-[15px] text-ink-soft">
            <span className="font-semibold text-ink">You</span>
            <span className="mx-2" aria-hidden="true">
              ·
            </span>
            <span className="min-w-0 truncate">{me.email}</span>
            {!me.seated && <span className="ml-auto pl-3 text-sm">No seat</span>}
          </li>
        )}
        {invited.map((email) => (
          <li key={email} className="flex min-h-12 items-center rounded-xl border border-line bg-surface px-4 py-3 text-[15px] text-ink-soft">
            <span className="min-w-0 truncate">{email}</span>
            <span className="ml-auto pl-3 text-sm font-semibold">Invited</span>
          </li>
        ))}
      </ul>

      {unreadable && <StepProblem message="We could not read your clinic's people just now. Reload this page in a moment, or skip this step and invite people from People later." />}

      <div className="mt-3 flex flex-col gap-3">
        {boxes.map((value, index) => (
          <div key={index}>
            <label htmlFor={`setup-invite-${index}`} className="sr-only">
              Email for seat {index + 1}
            </label>
            <input
              id={`setup-invite-${index}`}
              type="email"
              inputMode="email"
              autoComplete="off"
              placeholder="name@clinic.com"
              value={value}
              onChange={(event) => setBoxes((now) => now.map((old, i) => (i === index ? event.target.value : old)))}
              aria-invalid={problems[index] ? true : undefined}
              aria-describedby={problems[index] ? `setup-invite-${index}-problem` : undefined}
              className={`${INPUT} h-12 text-base`}
            />
            {problems[index] && (
              <p id={`setup-invite-${index}-problem`} className="mt-1 text-sm text-warn">
                {problems[index]}
              </p>
            )}
          </div>
        ))}
      </div>

      {canAddSeat && (
        <button type="button" onClick={() => setAdding(true)} disabled={pending} className={`${SETUP_SECONDARY} mt-3 h-11`}>
          <span aria-hidden="true">+</span> Add another
        </button>
      )}

      <StepProblem message={error} />
      {adding && <AddSeatDialog onClose={() => setAdding(false)} onAdded={() => {
            // The new seat's box opens at once; the page is then drawn again with the new seat count.
            setBoxes((now) => [...now, ""]);
            router.refresh();
          }} />}
    </StepBody>
  );
}

/**
 * "Add a seat?" (screen 04-setup-3b-add-seat): the plan's seats now and
 * after, the new price and what was paid before, and what is charged today,
 * all worked out on the server (reviewAddSeatAction, through the same
 * plan-change code as Billing) before anything is bought. "Add a seat" buys
 * exactly what was shown or, if it moved in between, nothing ("stale").
 */
function AddSeatDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [review, setReview] = useState<AddSeatReview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [payUrl, setPayUrl] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function load() {
    setMessage(null);
    start(async () => {
      const answer = await safeSave(() => reviewAddSeatAction());
      if (answer?.review) setReview(answer.review);
      else setMessage(answer?.error ?? SAVE_NOT_CONFIRMED);
    });
  }

  function confirm() {
    if (!review) return;
    const form = new FormData();
    form.set("seenVersionId", review.versionId);
    form.set("seenTotalCents", String(review.totalCents));
    if (review.now) {
      form.set("seenTiming", "now");
      form.set("seenAt", String(review.now.atSeconds));
      form.set("seenDueNowCents", String(review.now.dueNowCents));
    } else form.set("seenTiming", "renewal");
    setMessage(null);
    start(async () => {
      const answer = await safeSave(() => confirmAddSeatAction(form));
      if (answer?.done) {
        onAdded();
        onClose();
        return;
      }
      if (answer?.unpaid) setPayUrl(answer.payUrl ?? null);
      // Out of date: show the new figures straight away, so nothing is bought that was not seen.
      if (answer?.stale) setReview(null);
      setMessage(answer?.unpaid ?? answer?.stale ?? answer?.error ?? SAVE_NOT_CONFIRMED);
      if (answer?.stale) load();
    });
  }

  const per = review?.interval === "YEAR" ? "a year" : "a month";

  return (
    <dialog
      ref={(element) => {
        // When the dialog first appears: open it, and ask the server what one more seat costs.
        if (element && dialog.current !== element) {
          dialog.current = element;
          if (!element.open) element.showModal();
          load();
        }
      }}
      onClose={onClose}
      aria-labelledby="add-seat-heading"
      className="m-auto w-[calc(100%-2rem)] max-w-[480px] rounded-3xl border border-line bg-surface p-7 text-ink-soft shadow-lift backdrop:bg-black/40"
    >
      <h2 id="add-seat-heading" className="text-[1.5rem] font-semibold text-ink">
        Add a seat?
      </h2>
      {review ? (
        <dl className="mt-5 flex flex-col gap-3 text-[15px]">
          <div className="flex justify-between gap-4 border-b border-line pb-3">
            <dt>Your plan</dt>
            <dd className="text-right text-ink">
              {plural(review.seatsNow, "seat", "seats")}, becomes {review.seatsAfter}
            </dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-line pb-3">
            <dt>New price</dt>
            <dd className="text-right text-ink">
              {formatCents(review.totalCents)} {per}
              {review.wasCents !== null && <span className="text-ink-soft"> (was {formatCents(review.wasCents)})</span>}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Charged today</dt>
            <dd className="text-right font-semibold text-ink">{review.now ? formatCents(review.now.dueNowCents) : "Nothing until your renewal"}</dd>
          </div>
          <p className="text-sm text-ink-soft">Test mode: no card is charged.</p>
        </dl>
      ) : (
        !message && <p className="mt-5 text-[15px]">Working out the price...</p>
      )}
      {message && (
        <p role="alert" className="mt-4 text-[15px] text-warn">
          {message}
        </p>
      )}
      {payUrl && (
        <a href={payUrl} className="mt-2 inline-block text-[15px] font-semibold text-brand underline">
          Pay on Stripe&apos;s page
        </a>
      )}
      <div className="mt-6 flex justify-end gap-3">
        <button type="button" onClick={() => dialog.current?.close()} disabled={pending} className={SETUP_SECONDARY}>
          Cancel
        </button>
        <button type="button" onClick={confirm} disabled={pending || !review} className={SETUP_PRIMARY}>
          {pending && review ? "Adding..." : "Add a seat"}
        </button>
      </div>
    </dialog>
  );
}
