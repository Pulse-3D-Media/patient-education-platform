"use client";

import type { BillingInterval, Category } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "@/components/ui/styles";
import { PULSE_CONTACT_URL } from "@/lib/brand";
import { CATEGORIES } from "@/lib/categories";
import { engineInterval } from "@/lib/checkout-rules";
import { classifyPlanChange, RENEWAL_REASON_WORDS } from "@/lib/plan-change";
import { formatCents, quote, type Quote } from "@/lib/pricing";
import { confirmPlanChangeAction, reviewPlanChangeAction, type ChangeReview } from "./actions";
import type { ChangeOffer } from "./checkout-view";
import { canPick, CategoryChoices, IntervalChoices, SeatsField, TestModeNote } from "./PlanFields";

/**
 * Changing a plan that is being paid for, on /admin/billing. For any
 * office admin (this is an admin page, and the actions refuse anyone else).
 *
 * Two steps, on purpose:
 *
 *   1. Pick what the plan should be and press "Review change". The server
 *      works out what that would do: whether it starts now or at the next
 *      renewal, what the plan would come to, and, for a change that starts
 *      now, what Stripe would charge today. Nothing has changed yet.
 *   2. Read that, and press Confirm. The server works it all out again and
 *      only goes ahead if it still comes to what was shown.
 *
 * The numbers this form shows while picking come from the same pricing
 * engine the server uses, fed the clinic's own prices. They are a guide:
 * what is charged is what the server and Stripe work out, never a number
 * this form sent.
 *
 * The form opens on the plan the clinic has, plus one extra tick when the
 * admin came from the library's "Add to your plan" link (`suggested`).
 *
 * The picks are ordinary React state, so a refusal, a lost connection or a
 * changed total leaves everything as it was picked.
 */
type Changer = Extract<ChangeOffer, { kind: "changer" }>;

const DATE_WORDS = { dateStyle: "long", timeZone: "America/Denver" } as const;
const dateWords = (date: Date | null) => (date ? new Date(date).toLocaleDateString("en-US", DATE_WORDS) : "your next renewal");

export function PlanChanger({ offer, suggested = null }: { offer: Changer; suggested?: Category | null }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const { current } = offer;

  // Opens on the plan the clinic has. Someone who came from the library's "Add to your plan" link also gets that one
  // category ticked (the page checked it is for sale and not already on the plan). It is a pick like any other:
  // nothing happens until it is reviewed and confirmed.
  const [picked, setPicked] = useState<Category[]>(suggested && !current.picked.includes(suggested) ? [...current.picked, suggested] : current.picked);
  const [seatsText, setSeatsText] = useState(String(current.seats));
  const [every, setEvery] = useState<BillingInterval>(current.interval);
  const [useLatest, setUseLatest] = useState(false);

  const [review, setReview] = useState<ChangeReview | null>(null);
  const [note, setNote] = useState<{ text: string; problem: boolean } | null>(null);
  const [unpaid, setUnpaid] = useState<{ text: string; payUrl: string | null } | null>(null);
  const [working, startWork] = useTransition();

  const prices = useLatest && offer.latest ? offer.latest : offer.own;
  const { config } = prices;
  // What may be ticked: anything for sale, and anything already on the plan.
  const sellable = useMemo(() => offer.options.filter((option) => canPick(option, current.included)).map((option) => option.value), [offer.options, current.included]);
  const seats = /^\d{1,5}$/.test(seatsText.trim()) ? Number(seatsText.trim()) : 0;
  const clinicMax = config.seats.clinicMax;
  const tooManySeats = seats > clinicMax;

  const quoteFor = (which: BillingInterval): Quote | null => {
    if (picked.length === 0 || seats < 1) return null;
    const result = quote(config, { seats, categories: picked, interval: engineInterval(which), founding: false, practiceType: "clinic", sellable });
    return result.ok ? result.quote : null;
  };
  const monthly = quoteFor("MONTH");
  const yearly = quoteFor("YEAR");
  const chosen = every === "YEAR" ? yearly : monthly;
  const amounts = chosen?.amounts ?? null;

  // The same sorting rule the server uses, so the form can say up front when a change would start.
  const kind =
    chosen && amounts
      ? classifyPlanChange(
          { pricingVersionId: offer.own.versionId, entitledCategories: current.included, surgeonSeats: current.seats, interval: current.interval, perSeatCents: -1 },
          { pricingVersionId: prices.versionId, entitledCategories: chosen.entitledCategories, surgeonSeats: seats, interval: every, perSeatCents: -1 },
        )
      : null;

  // Any new pick makes an earlier review out of date.
  const changed = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setReview(null);
    setNote(null);
    setUnpaid(null);
  };
  const toggle = (category: Category) => changed(setPicked)(picked.includes(category) ? picked.filter((value) => value !== category) : [...picked, category]);

  const askForReview = () =>
    startWork(async () => {
      if (!form.current) return;
      setNote(null);
      setUnpaid(null);
      const result = await reviewPlanChangeAction(new FormData(form.current));
      if (result?.review) setReview(result.review);
      else if (result?.message) setNote({ text: result.message, problem: false });
      else setNote({ text: result?.error ?? "We could not work that out just now. Try again in a moment.", problem: true });
      if (result?.error) router.refresh();
    });

  const confirm = () =>
    startWork(async () => {
      if (!form.current || !review) return;
      const data = new FormData(form.current);
      data.set("seenTiming", review.now ? "now" : "renewal");
      if (review.now) {
        data.set("seenAt", String(review.now.atSeconds));
        data.set("seenDueNowCents", String(review.now.dueNowCents));
      }
      const result = await confirmPlanChangeAction(data);
      setReview(null);
      if (result?.done) setNote({ text: result.done, problem: false });
      else if (result?.unpaid) setUnpaid({ text: result.unpaid, payUrl: result.payUrl ?? null });
      else setNote({ text: result?.stale ?? result?.error ?? "We could not confirm that change just now.", problem: true });
      router.refresh();
    });

  const labels = (categories: Category[]) => CATEGORIES.filter((category) => categories.includes(category.value)).map((category) => category.label);

  return (
    <form ref={form} onSubmit={(event) => event.preventDefault()} className="mt-4 flex flex-col gap-6">
      <TestModeNote>A change that starts now is charged to the test card on file.</TestModeNote>

      <CategoryChoices config={config} options={offer.options} picked={picked} onToggle={toggle} alreadyHas={current.included} />

      <SeatsField
        id="change-seats"
        value={seatsText}
        onChange={changed(setSeatsText)}
        help="One for each person who uses the library, and one for each open invitation. It cannot go below the number taken now (the People page shows who holds one)."
      />

      <IntervalChoices config={config} chosen={every} onChoose={changed(setEvery)} monthlyCents={monthly?.amounts?.totalCents ?? null} yearlyCents={yearly?.amounts?.totalCents ?? null} />

      {offer.latest && (
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line-strong px-4 py-3 has-[:checked]:border-brand has-[:checked]:bg-brand/15">
          <input type="checkbox" checked={useLatest} onChange={(event) => changed(setUseLatest)(event.target.checked)} className="mt-0.5 h-5 w-5 accent-[var(--brand-accent)]" />
          <span>
            <span className="block text-[15px] font-medium text-ink">Move to current pricing</span>
            <span className="block text-sm text-ink-soft">
              Your plan is on the prices you signed up at, and it stays on them unless you tick this. Ticked, the totals here use the prices on offer today,
              and the whole change starts at your next renewal.
            </span>
          </span>
        </label>
      )}

      <section aria-live="polite" aria-label="What the changed plan comes to" className="rounded-xl border border-line bg-sunken p-5">
        {tooManySeats ? (
          <p className="text-[15px] text-ink-soft">
            More than {clinicMax} surgeon seats is set up by Pulse 3D by agreement, so there is no card payment for it here.{" "}
            <a href={PULSE_CONTACT_URL} className="font-medium text-brand-bright underline underline-offset-2">
              Schedule a call with Pulse 3D
            </a>
            .
          </p>
        ) : !chosen || !amounts ? (
          <p className="text-[15px] text-ink-soft">Choose at least one category and one surgeon seat to see what it comes to.</p>
        ) : (
          <>
            <p className="text-sm text-ink-muted">The changed plan, in US dollars</p>
            <p className="mt-1 text-3xl font-semibold text-brand-bright">
              {formatCents(amounts.totalCents)} <span className="text-base font-medium text-ink-soft">per {amounts.interval}</span>
            </p>
            <p className="mt-2 text-[15px] text-ink-soft">
              {formatCents(amounts.perSeatCents)} per surgeon seat per {amounts.interval}, times {amounts.seats} {amounts.seats === 1 ? "seat" : "seats"}.
              {chosen.fullLibrary ? " Includes the full library: every category." : ` Includes ${labels(chosen.entitledCategories).join(", ")}.`}
            </p>
            <p className="mt-2 text-[15px] text-ink-soft">
              {kind?.timing === "same"
                ? "This is the plan you have now."
                : kind?.timing === "now"
                  ? "This only adds to your plan, so it starts as soon as you confirm and Stripe has charged for the rest of the current period. Review it to see that amount."
                  : kind
                    ? RENEWAL_REASON_WORDS[kind.why]
                    : null}
            </p>
          </>
        )}
      </section>

      {/* What the admin was looking at. The server compares these with its own numbers and never charges them. */}
      <input type="hidden" name="interval" value={every} />
      <input type="hidden" name="seenVersionId" value={prices.versionId} />
      <input type="hidden" name="seenTotalCents" value={amounts ? String(amounts.totalCents) : ""} />
      <input type="hidden" name="moveToCurrentPricing" value={useLatest && offer.latest ? "yes" : "no"} />

      {review ? (
        <section aria-label="Review this change" className="rounded-xl border border-brand bg-brand/10 p-5">
          <h3 className="text-base font-semibold text-ink">Check this, then confirm</h3>
          <p className="mt-2 text-[15px] text-ink-soft">
            {review.summary.fullLibrary ? "The full library (every category)" : labels(review.summary.included).join(", ")}, {review.summary.seats}{" "}
            {review.summary.seats === 1 ? "surgeon seat" : "surgeon seats"}: {formatCents(review.summary.totalCents)} per {review.summary.interval === "YEAR" ? "year" : "month"}.
          </p>
          {review.now ? (
            <>
              <p className="mt-2 text-[15px] text-ink">
                <strong className="font-semibold">Starts now.</strong>{" "}
                {review.now.dueNowCents > 0
                  ? `Stripe will charge the card on file ${formatCents(review.now.dueNowCents)} today, for the rest of the period you have already paid for.`
                  : "Nothing is charged today."}
              </p>
              <p className="mt-1 text-[15px] text-ink-soft">
                From {dateWords(review.now.renewsAt)} it renews at {formatCents(review.summary.totalCents)} per {review.summary.interval === "YEAR" ? "year" : "month"}. If the
                payment does not go through, nothing changes and you keep the plan you have.
              </p>
            </>
          ) : review.renewal ? (
            <>
              <p className="mt-2 text-[15px] text-ink">
                <strong className="font-semibold">Starts on {dateWords(review.renewal.at)}, at your next renewal.</strong> Nothing is charged today.
              </p>
              <p className="mt-1 text-[15px] text-ink-soft">
                {review.renewal.words}
                {review.renewal.replaces && " This takes the place of the change that is already scheduled."}
              </p>
            </>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" onClick={confirm} disabled={working} className={`${PRIMARY_BUTTON} h-12 px-6 text-[15px]`}>
              {working ? "Working..." : review.now ? (review.now.dueNowCents > 0 ? `Confirm and pay ${formatCents(review.now.dueNowCents)}` : "Confirm change") : "Schedule this change"}
            </button>
            <button type="button" onClick={() => setReview(null)} disabled={working} className={SECONDARY_BUTTON}>
              Go back
            </button>
          </div>
        </section>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={askForReview} disabled={working || !amounts || tooManySeats || kind?.timing === "same"} className={`${PRIMARY_BUTTON} h-12 px-6 text-[15px]`}>
            {working ? "Working..." : "Review change"}
          </button>
          <span className="text-sm text-ink-muted">Nothing changes until you confirm on the next step.</span>
        </div>
      )}

      <div aria-live="polite" className="text-[15px]">
        {note && <p className={note.problem ? "text-warn" : "text-ink"}>{note.text}</p>}
        {unpaid && (
          <p className="text-warn">
            {unpaid.text}{" "}
            {unpaid.payUrl && (
              <a href={unpaid.payUrl} className="font-medium text-brand-bright underline underline-offset-2">
                Pay on Stripe&rsquo;s page
              </a>
            )}
          </p>
        )}
      </div>
    </form>
  );
}
