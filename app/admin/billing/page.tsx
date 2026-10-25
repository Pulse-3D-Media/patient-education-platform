import type { Category, ClinicStatus } from "@prisma/client";
import Link from "next/link";
import { AdminsOnly } from "@/components/ui/AdminsOnly";
import { ClinicShell } from "@/components/ui/ClinicShell";
import { PRIMARY_BUTTON } from "@/components/ui/styles";
import { ADD_ANCHOR, ADD_PARAM, readSuggestedCategory } from "@/lib/add-to-plan";
import { PULSE_CONTACT_URL } from "@/lib/brand";
import { findCategoryBySlug, labelOf, labelsInOrder, type CategoryDetails } from "@/lib/categories";
import { getCategoryList } from "@/lib/db/category-config";
import { requireClinicPage } from "@/lib/clinic";
import { clinicIsOpen, type ClinicOpenFacts } from "@/lib/clinic-status";
import { planLibraryGap } from "@/lib/plan-change";
import { formatCents } from "@/lib/pricing";
import { AdminFrame } from "../AdminFrame";
import { getBillingView } from "./billing";
import { CancelChangeButton, CheckWithStripeButton, PayInvoiceButton, PortalButton } from "./BillingButtons";
import { getCheckoutView, type CheckoutOffer, type CheckoutView, type PlanFacts } from "./checkout-view";
import { PlanChanger } from "./PlanChanger";
import { PlanPicker } from "./PlanPicker";

/**
 * Billing, at /admin/billing: the one place on the clinic side that shows
 * plan and price information, and the one place a clinic chooses a plan and
 * pays for it.
 *
 * What is on it, top to bottom: where the clinic stands; the subscription
 * it is paying for, when it has one, with any change that is waiting (one
 * scheduled for the renewal, or an upgrade whose payment has not gone
 * through); the plan on file with an estimate, labelled as an estimate,
 * when it does not; then ONE of: the plan picker (a first plan), the form
 * for changing the plan (a clinic that is paying), or a message about why
 * there is neither; and last, the way to Stripe's own billing page for the
 * card, invoices and cancelling.
 *
 * THE LIBRARY'S "ADD TO YOUR PLAN" LINK LANDS HERE, as /admin/billing?add=hip.
 * The category in the address is only a suggestion for which box starts
 * ticked (readSuggestedCategory in lib/add-to-plan.ts): an unknown one, one
 * that cannot be bought, or one the clinic already has is ignored, and so is
 * any suggestion where there is no form to tick it in (a managed clinic, a
 * hospital, card payment not open). Ticking a box charges nothing and grants
 * nothing; the price and the change are worked out by the server as always.
 * The form then shows the plan the clinic has plus that one category, and
 * NOTHING ELSE ticked (Van, 2026-10-08: anything more feels like being
 * talked into more than you came for). For the change form "the plan the
 * clinic has" is the plan it pays for; the first-plan picker, which
 * otherwise reopens on a checkout that was started and not paid, starts
 * from the plan on file instead. Where the plan paid for and the library
 * disagree (Pulse staff edited the library by hand), the page says so above
 * the form (planLibraryGap in lib/plan-change.ts).
 *
 * ANY OFFICE ADMIN MAY CHANGE BILLING, the account owner included (decided by Evan
 * on 2026-10-05). This is an admin page, so everyone who sees it sees the
 * buttons, and every action checks the admin role again (getBillingClinicId).
 * Nothing asks what kind of practice the clinic is: only
 * Pulse staff mark a clinic a hospital (on /pulse), and a clinic that was
 * never marked is treated as a clinic (see selfServeEligibility).
 *
 * THIS PAGE STAYS OPEN WHEN THE CLINIC IS NOT. An admin of a PENDING,
 * PAUSED, PAST_DUE or CANCELED clinic must be able to reach it, because it
 * is where a closed clinic pays and opens. So it checks that the person is
 * an admin, and does not check clinicIsOpen() the way every other admin
 * page does. Permission to see and repair billing is separate from
 * permission to use the library or make links; those still follow
 * clinicIsOpen().
 *
 * Who is offered what is decided on the server (checkout-view.ts), and
 * decided AGAIN by the Server Action when the button is pressed: a plan
 * picker drawn for a clinic that has since been marked managed, or a
 * hospital, is refused there. Nothing here is a bill, and nothing is
 * charged on this page: the card is entered on Stripe's own page.
 */
export const dynamic = "force-dynamic";

type BillingPageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

export default async function BillingPage(props: BillingPageProps = {}) {
  const clinic = await requireClinicPage();

  // Members never see billing; it is an admin page.
  if (!clinic.isAdmin) {
    return (
      <ClinicShell clinic={clinic}>
        <AdminsOnly billing />
      </ClinicShell>
    );
  }

  // Deliberately no clinicIsOpen() check here: see the note above.
  const view = await getBillingView(clinic.id);
  const checkout = view ? await getCheckoutView(clinic.id, view.plan) : null;
  // Each category's current name (Pulse staff can rename one): plans already bought say the new name too.
  const list = await getCategoryList();
  const offer: CheckoutOffer = checkout?.offer ?? { kind: "closed", message: "Your clinic could not be found. Try again in a moment." };
  const params = props.searchParams ? await props.searchParams : {};
  const cameBackWithoutPaying = params.checkout === "cancelled";
  const cameBackFromStripe = params.from === "stripe";

  const labels = view ? labelsInOrder(list, view.plan.categories) : [];
  const managed = view?.plan.managedByPulse ?? false;
  const subscription = checkout?.subscription ?? null;
  const canPayHere = offer.kind === "picker";
  const live = checkout?.billingStatus === "ACTIVE" || checkout?.billingStatus === "PAST_DUE";
  // Can a missed payment be settled from this page? Only where Stripe's pages can be opened.
  const canRepair = Boolean(checkout?.portal);
  // The category the library's "Add to your plan" link asked for, if there is a form here it can be ticked in.
  // The picker measures it against the plan on file, which is what it opens on when there is a suggestion.
  const suggested =
    offer.kind === "picker"
      ? readSuggestedCategory(params[ADD_PARAM], offer.options, offer.onFile.categories, list)
      : offer.kind === "subscribed" && !managed && offer.change.kind === "changer"
        ? readSuggestedCategory(params[ADD_PARAM], offer.change.options, offer.change.current.included, list)
        : null;
  // The category in the address, read only to say something about it when it cannot be ticked because it is already paid for.
  const asked = typeof params[ADD_PARAM] === "string" ? (findCategoryBySlug(list, params[ADD_PARAM])?.category.value ?? null) : null;

  return (
    <AdminFrame clinic={clinic} title="Billing" intro="Your plan, and what it comes to.">
      {cameBackWithoutPaying && (
        <p role="status" className="mt-6 rounded-xl border border-line-strong bg-surface px-5 py-4 text-[15px] text-ink-soft">
          You left Stripe&rsquo;s page before paying, so nothing was charged. Your picks are still below.
        </p>
      )}

      {cameBackFromStripe && (
        <p role="status" className="mt-6 rounded-xl border border-line-strong bg-surface px-5 py-4 text-[15px] text-ink-soft">
          You are back from Stripe. If you changed something there and this page does not show it yet, press Check with Stripe at the bottom.
        </p>
      )}

      <StatusCard clinic={clinic} managed={managed} canPayHere={canPayHere} firstPayment={offer.kind === "first-payment"} repair={checkout?.portal ? "here" : "none"} />

      {checkout?.billingStatus === "PAST_DUE" && canRepair && !managed && (
        <section aria-labelledby="missed-heading" className="mt-6 rounded-2xl border border-warn/40 bg-warn/10 p-5 sm:p-6">
          <h2 id="missed-heading" className="text-lg font-semibold">
            Settle the missed payment
          </h2>
          <p className="mt-2 text-[15px] text-ink-soft">
            Pay it on Stripe&rsquo;s page with any card. If the card on file is the problem, update it on Stripe&rsquo;s billing page (at the bottom of this page) as well, so the next
            renewal goes through.
          </p>
          <div className="mt-4">
            <PayInvoiceButton label="Pay the missed payment" />
          </div>
        </section>
      )}

      {checkout?.waiting && !cameBackWithoutPaying && offer.kind !== "first-payment" && (
        <p className="mt-6 rounded-xl border border-line bg-surface px-5 py-4 text-[15px] text-ink-soft">
          A checkout was started for your clinic and no payment has been confirmed for it. Paid already?{" "}
          <Link href="/admin/billing/return" className="font-medium text-brand-bright underline underline-offset-2">
            Check on your payment
          </Link>
          .
        </p>
      )}

      {subscription && <SubscriptionCard list={list} plan={subscription.plan} status={checkout?.billingStatus ?? "NONE"} renewsAt={subscription.currentPeriodEnd} endsAt={subscription.cancelAt} />}

      {checkout && <WaitingChanges list={list} view={checkout} />}

      <section aria-labelledby="plan-heading" className="mt-6 rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <h2 id="plan-heading" className="text-lg font-semibold">
          Your plan
        </h2>
        {!view || !view.hasPlan ? (
          <p className="mt-2 text-ink-soft">{managed ? "Pulse 3D is setting your plan up with you." : canPayHere ? "No plan yet. Choose one below." : "No plan yet."}</p>
        ) : (
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sm text-ink-muted">Categories</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {labels.map((label) => (
                  <li key={label} className="rounded-full border border-line-strong px-3 py-1 text-sm text-ink">
                    {label}
                  </li>
                ))}
              </ul>
              {view.estimate?.fullLibrary && <p className="mt-2 text-sm text-ink-soft">That is the full library: all current categories.</p>}
            </div>
            <div>
              <p className="text-sm text-ink-muted">Surgeon seats</p>
              <p className="mt-1 text-[15px] text-ink">
                {view.plan.surgeonSeats} {view.plan.surgeonSeats === 1 ? "seat" : "seats"}
                {view.seatsInUse !== null && <span className="text-ink-soft">, {view.seatsInUse} in use</span>}
              </p>
              {view.seatsInUse !== null && view.seatsInUse > view.plan.surgeonSeats && (
                <p className="mt-1 text-sm text-warn">
                  More seats are taken than your plan pays for. Nothing extra is being charged. Nobody else can be given a seat until someone is
                  removed or an invitation is revoked on the People page, or a seat is added.
                </p>
              )}
              <p className="mt-1 text-sm text-ink-muted">
                Everyone in your clinic uses a seat except the account owner, who can take one or not. Open invitations hold a seat too. Who holds
                one is on the{" "}
                <Link href="/admin/people" className="font-medium text-brand-bright underline underline-offset-2">
                  People page
                </Link>
                .
              </p>
            </div>
          </div>
        )}
        {managed && (
          <p className="mt-4 text-sm text-ink-soft">
            Your plan is managed by Pulse 3D and invoiced by agreement. To change categories or seats, get in touch with Pulse 3D.
          </p>
        )}
      </section>

      {/* An estimate is only shown while nothing is being paid for. Once there is a subscription, the card above has the real amounts. */}
      {view?.hasPlan && !subscription && (
        <section aria-labelledby="estimate-heading" className="mt-6 rounded-2xl border border-line bg-surface p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="estimate-heading" className="text-lg font-semibold">
              What it comes to
            </h2>
            <span className="rounded-md bg-wash-strong px-2 py-0.5 text-[13px] font-medium uppercase tracking-wide text-ink-soft">Estimate</span>
          </div>

          {view.problem ? (
            <p className="mt-2 text-ink-soft">{view.problem}</p>
          ) : view.estimate?.band === "enterprise" ? (
            <p className="mt-2 text-ink-soft">Priced by agreement with Pulse 3D. {view.estimate.notes.join(" ")}</p>
          ) : view.estimate ? (
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-sm text-ink-muted">Per month</p>
                <p className="mt-1 text-2xl font-semibold text-brand-bright">{formatCents(view.estimate.monthlyCents ?? 0)}</p>
              </div>
              <div>
                <p className="text-sm text-ink-muted">Per year</p>
                <p className="mt-1 text-2xl font-semibold text-brand-bright">{formatCents(view.estimate.yearlyCents ?? 0)}</p>
              </div>
            </div>
          ) : null}

          <p className="mt-4 text-sm text-ink-muted">
            {managed
              ? "An estimate from the plan on file, not your invoice. Pulse 3D invoices your clinic by agreement."
              : "An estimate from the plan Pulse 3D put on file for you. It is not an invoice, and nothing has been charged for it."}
          </p>
        </section>
      )}

      {/* Where the library's "Add to your plan" link lands: the picker, the change form, or the words that stand in for them. */}
      {/* The scroll margin keeps the card's heading clear of the banner across the top (64px tall). */}
      <div id={ADD_ANCHOR} className="scroll-mt-20">
        <OfferSection list={list} offer={offer} managed={managed} suggested={suggested} asked={asked} />
      </div>

      {checkout?.portal && (
        <section aria-labelledby="stripe-heading" className="mt-6 rounded-2xl border border-line bg-surface p-5 sm:p-6">
          <h2 id="stripe-heading" className="text-lg font-semibold">
            Card, invoices and cancelling
          </h2>
          <p className="mt-2 text-ink-soft">
            These are on Stripe&rsquo;s own billing page: the card you pay with, every invoice so far, and cancelling.
            {live && " If you cancel there, your plan stays on until the end of the period you have already paid for, and you can undo it there before then."}{" "}
            Seats and categories are changed on this page, not there.
          </p>
          <div className="mt-4 flex flex-col gap-3">
            <PortalButton />
            <CheckWithStripeButton />
          </div>
        </section>
      )}
    </AdminFrame>
  );
}

/**
 * A change that is waiting on a live subscription: one scheduled for the
 * next renewal, or an upgrade whose payment has not gone through. Neither
 * is in force, and the words say so.
 */
function WaitingChanges({ list, view }: { list: CategoryDetails[]; view: CheckoutView }) {
  const { scheduled, unpaidChange } = view;
  if (!scheduled && !unpaidChange) return null;
  const words = (plan: PlanFacts) => {
    const included = labelsInOrder(list, plan.included);
    return `${included.join(", ")}; ${plan.seats} ${plan.seats === 1 ? "surgeon seat" : "surgeon seats"}; ${formatCents(plan.totalCents)} per ${plan.interval === "YEAR" ? "year" : "month"}`;
  };
  return (
    <section aria-labelledby="waiting-heading" className="mt-6 rounded-2xl border border-line-strong bg-surface p-5 sm:p-6">
      <h2 id="waiting-heading" className="text-lg font-semibold">
        {scheduled && unpaidChange ? "Changes that are waiting" : "A change that is waiting"}
      </h2>
      {unpaidChange && (
        <div className="mt-3">
          <p className="text-[15px] text-ink">
            <strong className="font-semibold">Waiting for its payment:</strong> {words(unpaidChange)}.
          </p>
          <p className="mt-1 text-[15px] text-ink-soft">
            The payment for this change did not go through, so nothing has changed: your plan is still the one above. Stripe drops the change by itself if it is not paid
            within about a day.
          </p>
          <div className="mt-3 flex flex-col gap-3">
            <PayInvoiceButton />
            <CancelChangeButton which="payment" />
          </div>
        </div>
      )}
      {scheduled && (
        <div className={unpaidChange ? "mt-5 border-t border-line pt-5" : "mt-3"}>
          <p className="text-[15px] text-ink">
            <strong className="font-semibold">
              Starts on {scheduled.at ? scheduled.at.toLocaleDateString("en-US", DATE_WORDS) : "your next renewal"}:
            </strong>{" "}
            {words(scheduled.plan)}.
          </p>
          <p className="mt-1 text-[15px] text-ink-soft">
            Until that day your plan and what you pay stay as they are above. Nothing has been charged for this change.
            {scheduled.plan.seats < (view.subscription?.plan.seats ?? 0) &&
              ` Because it lowers your seats to ${scheduled.plan.seats}, nobody can be given a seat past that number until then.`}
          </p>
          <div className="mt-3">
            <CancelChangeButton which="scheduled" />
          </div>
        </div>
      )}
    </section>
  );
}

/** The last card on the page: the plan picker, the form for changing a plan, or why there is neither. */
function OfferSection({
  list,
  offer,
  managed,
  suggested,
  asked,
}: {
  list: CategoryDetails[];
  offer: CheckoutOffer;
  managed: boolean;
  suggested: Category | null;
  asked: Category | null;
}) {
  // Said once, above the form, so the extra tick is not a surprise.
  const suggestedLabel = suggested ? labelOf(list, suggested) : undefined;
  if (offer.kind === "picker") {
    return (
      <section aria-labelledby="choose-heading" className="mt-6 rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <h2 id="choose-heading" className="text-lg font-semibold">
          Choose a plan
        </h2>
        <p className="mt-2 text-ink-soft">Pick what you need, check the total, then pay on Stripe&rsquo;s page. Your clinic opens once Stripe confirms the payment.</p>
        {suggested && suggestedLabel && (
          <p className="mt-2 text-ink">{suggestedLabel} is ticked below because you chose it in the library. Nothing is charged until you pay on Stripe&rsquo;s page.</p>
        )}
        <PlanPicker
          versionId={offer.versionId}
          config={offer.config}
          options={offer.options}
          initial={suggested ? { ...offer.onFile, categories: [...offer.onFile.categories, suggested] } : offer.initial}
        />
      </section>
    );
  }

  if (offer.kind === "first-payment") {
    return (
      <section aria-labelledby="first-payment-heading" className="mt-6 rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <h2 id="first-payment-heading" className="text-lg font-semibold">
          Your first payment is under way
        </h2>
        <p className="mt-2 text-ink-soft">
          Stripe has not confirmed it yet, so your clinic is not open and a new plan cannot be started until it settles. A bank payment can take a few days to clear. If
          the payment is never completed, Stripe drops it within about a day, and you can choose a plan here again.
        </p>
        <Link href="/admin/billing/return" className={`mt-5 ${PRIMARY_BUTTON}`}>
          Check on your payment
        </Link>
      </section>
    );
  }

  if (offer.kind === "contact") {
    return (
      <section aria-labelledby="next-heading" className="mt-6 rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <h2 id="next-heading" className="text-lg font-semibold">
          {offer.reason === "hospital" ? "Set up by Pulse 3D" : "Talk to Pulse 3D first"}
        </h2>
        <p className="mt-2 text-ink-soft">
          {offer.reason === "hospital"
            ? "Hospitals and health systems are priced and set up by agreement, so there is no card payment here."
            : "Pulse 3D has paused this clinic by hand, so a card payment would not open it. Get in touch and we will sort it out with you."}
        </p>
        <a href={PULSE_CONTACT_URL} className={`mt-5 ${PRIMARY_BUTTON}`}>
          Schedule a call with Pulse 3D
        </a>
      </section>
    );
  }

  if (offer.kind === "subscribed" && !managed && offer.change.kind === "changer") {
    const { current } = offer.change;
    const gap = planLibraryGap(current.included, current.library);
    // The link asked for a category that is already paid for and turned off: said once, in its own sentence, and left
    // out of the general one below so it is not said twice.
    const askedLabel = asked && gap.offInLibrary.includes(asked) ? labelOf(list, asked) : undefined;
    const off = askedLabel ? gap.offInLibrary.filter((category) => category !== asked) : gap.offInLibrary;
    const offWords = wordList(labelsInOrder(list, off));
    const extraWords = wordList(labelsInOrder(list, gap.extraInLibrary));
    return (
      <section aria-labelledby="change-heading" className="mt-6 rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <h2 id="change-heading" className="text-lg font-semibold">
          Change your plan
        </h2>
        <p className="mt-2 text-ink-soft">
          Adding seats or categories starts as soon as you confirm and the card on file has been charged for the rest of the current period. Anything else (taking something
          off, swapping, or changing how often you pay) starts at your next renewal. You see exactly what happens, and what it costs, before anything changes.
        </p>
        {suggested && suggestedLabel && (
          <p className="mt-2 text-ink">
            {suggestedLabel} is ticked below because you chose it in the library. Nothing changes, and nothing is charged, until you review and confirm.
          </p>
        )}
        {askedLabel && (
          <p className="mt-2 text-ink">
            {askedLabel} is already part of the plan you pay for, so there is nothing to add here, and it stays ticked below. It is turned off in your library right
            now because Pulse 3D turned it off. Get in touch with Pulse 3D to turn it back on.
          </p>
        )}
        {(offWords || extraWords) && (
          <div className="mt-3 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-[15px] text-ink-soft">
            {offWords && (
              <p>
                Your plan pays for {offWords}, but {off.length === 1 ? "it is" : "they are"} turned off in your library right now. Pulse 3D set that by hand, so get in
                touch with Pulse 3D about it. {off.length === 1 ? "It is" : "They are"} ticked below because the form starts from what you pay for:
                untick one to stop paying for it from your next renewal.
              </p>
            )}
            {extraWords && (
              <p className={offWords ? "mt-2" : undefined}>
                Your library also has {extraWords}, which Pulse 3D added outside what you pay for. Once a change made here starts, your library is set to exactly what the
                changed plan includes, so tick {gap.extraInLibrary.length === 1 ? "it" : "them"} to keep {gap.extraInLibrary.length === 1 ? "it" : "them"} (and pay for{" "}
                {gap.extraInLibrary.length === 1 ? "it" : "them"}), or get in touch with Pulse 3D first.
              </p>
            )}
          </div>
        )}
        <PlanChanger offer={offer.change} suggested={suggested} />
      </section>
    );
  }

  const { heading, body } =
    managed || offer.kind === "managed"
      ? {
          heading: "Changes to your plan",
          body: "Pulse 3D manages this plan, so there is nothing to set up or pay for here. Questions about your invoice go to Pulse 3D.",
        }
      : offer.kind === "subscribed"
        ? { heading: "Changing your plan", body: offer.change.kind === "blocked" ? offer.change.message : "" }
        : { heading: "Coming here", body: offer.message };

  return (
    <section aria-labelledby="next-heading" className="mt-6 rounded-2xl border border-dashed border-line-strong p-5 sm:p-6">
      <h2 id="next-heading" className="text-lg font-semibold">
        {heading}
      </h2>
      <p className="mt-2 text-ink-soft">{body}</p>
    </section>
  );
}

const DATE_WORDS = { dateStyle: "long", timeZone: "America/Denver" } as const;

/** "Hip", "Hip and Spine", "Hip, Knee and Spine"; empty for none. */
function wordList(words: string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** The plan the clinic is paying for, with the amounts it accepted. These are real amounts, not an estimate. */
function SubscriptionCard({
  list,
  plan,
  status,
  renewsAt,
  endsAt,
}: {
  list: CategoryDetails[];
  plan: PlanFacts;
  status: string;
  renewsAt: Date | null;
  endsAt: Date | null;
}) {
  const per = plan.interval === "YEAR" ? "year" : "month";
  const included = labelsInOrder(list, plan.included);
  const ended = status === "CANCELED";
  return (
    <section aria-labelledby="subscription-heading" className="mt-6 rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <h2 id="subscription-heading" className="text-lg font-semibold">
        {ended ? "Your last subscription" : "Your subscription"}
      </h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-sm text-ink-muted">{ended ? "What you paid" : `What you pay, ${plan.interval === "YEAR" ? "yearly" : "monthly"}`}</p>
          <p className="mt-1 text-2xl font-semibold text-brand-bright">
            {formatCents(plan.totalCents)} <span className="text-base font-medium text-ink-soft">per {per}</span>
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            {formatCents(plan.perSeatCents)} per surgeon seat per {per}, times {plan.seats} {plan.seats === 1 ? "seat" : "seats"}. In US dollars.
          </p>
        </div>
        <div>
          <p className="text-sm text-ink-muted">Includes</p>
          <p className="mt-1 text-[15px] text-ink">{included.join(", ")}</p>
          <p className="mt-1 text-sm text-ink-muted">
            Accepted by {plan.acceptedByName} on {plan.acceptedAt.toLocaleDateString("en-US", DATE_WORDS)}, at the prices on offer then (price list {plan.version}). Your price
            stays on that list unless you choose to move.
          </p>
        </div>
      </div>
      {!ended && endsAt ? (
        <p className="mt-4 text-[15px] text-ink-soft">A cancellation is scheduled. The subscription stays active until {endsAt.toLocaleDateString("en-US", DATE_WORDS)}.</p>
      ) : !ended && renewsAt ? (
        <p className="mt-4 text-[15px] text-ink-soft">
          {status === "PAST_DUE" ? "The payment due on" : "Renews on"} {renewsAt.toLocaleDateString("en-US", DATE_WORDS)}
          {status === "PAST_DUE" ? " did not go through." : "."}
        </p>
      ) : null}
    </section>
  );
}

/** Where the clinic stands, in one line, with what it means for the rest of the app. */
function StatusCard({
  clinic,
  managed,
  canPayHere,
  firstPayment,
  repair,
}: {
  clinic: ClinicOpenFacts;
  managed: boolean;
  canPayHere: boolean;
  /** A first payment is under way in Stripe: the clinic opens when it is confirmed, and nothing else needs doing. */
  firstPayment: boolean;
  repair: Repair;
}) {
  const status = clinic.status;
  const open = clinicIsOpen(clinic);
  const inGrace = open && status === "PAST_DUE";
  const { label, body: words } = inGrace ? GRACE_COPY : STATUS_COPY[status];
  // A missed payment: what to do about it depends on who is looking and whether Stripe's pages can be opened here.
  const body = status === "PAST_DUE" && !managed ? `${words} ${REPAIR_WORDS[repair]}` : words;
  const next =
    inGrace || managed
      ? null
      : firstPayment
        ? "They open as soon as Stripe confirms your first payment."
        : NEXT_STEP[status]?.[canPayHere ? "canPay" : "cannotPay"];
  return (
    <section
      aria-labelledby="status-heading"
      className={`mt-6 rounded-2xl border px-5 py-4 ${open && !inGrace ? "border-line bg-surface" : "border-warn/40 bg-warn/10"}`}
    >
      <h2 id="status-heading" className="flex flex-wrap items-center gap-3 text-lg font-semibold">
        Status
        <span
          className={`rounded-md px-2 py-0.5 text-[13px] font-medium uppercase tracking-wide ${
            open && !inGrace ? "bg-brand/20 text-brand-bright" : "bg-warn/20 text-warn"
          }`}
        >
          {label}
        </span>
      </h2>
      <p className="mt-2 text-[15px] text-ink-soft">
        {body}
        {next && ` ${next}`}
      </p>
      {inGrace && clinic.graceEndsAt && (
        <p className="mt-2 text-[15px] text-ink-soft">
          They stay open until{" "}
          {clinic.graceEndsAt.toLocaleString("en-US", { dateStyle: "long", timeStyle: "short", timeZone: "America/Denver" })} (Mountain Time).
        </p>
      )}
      {!open && managed && <p className="mt-2 text-[15px] text-ink-soft">Your plan is managed by Pulse 3D, so get in touch with Pulse 3D to sort this out.</p>}
    </section>
  );
}

/** How a missed payment can be settled: on this page, or not here at all (card payment is shut on this deployment). */
type Repair = "here" | "none";

const REPAIR_WORDS: Record<Repair, string> = {
  here: "Settle it below.",
  none: "Get in touch with Pulse 3D to settle it.",
};

/** A payment failed but the grace period has not run out: the clinic is still open, for now. */
const GRACE_COPY = {
  label: "Payment failed",
  body: "Your last payment did not go through. The library and shared links are still open for now.",
};

const STATUS_COPY: Record<ClinicStatus, { label: string; body: string }> = {
  PENDING: {
    label: "Pending",
    body: "Your clinic is set up but not on a plan yet, so the library and shared links are not open.",
  },
  ACTIVE: {
    label: "Active",
    body: "Your clinic is on a plan. The library and shared links are open.",
  },
  PAUSED: {
    label: "Paused",
    body: "Your plan is paused, so the library and shared links are off. Links patients already have keep working until they expire.",
  },
  PAST_DUE: {
    label: "Past due",
    body: "Your last payment did not go through, so the library and shared links are off.",
  },
  CANCELED: {
    label: "Ended",
    body: "Your plan has ended, so the library and shared links are off. Your people and settings are kept.",
  },
};

/** What to do about a closed clinic, which depends on whether a plan can be chosen on this page right now. */
const NEXT_STEP: Partial<Record<ClinicStatus, { canPay: string; cannotPay: string }>> = {
  PENDING: {
    canPay: "Choose a plan below and they open as soon as Stripe confirms the payment.",
    cannotPay: "Get in touch with Pulse 3D and we will turn yours on.",
  },
  CANCELED: {
    canPay: "Choose a plan below to start again.",
    cannotPay: "To start again, get in touch with Pulse 3D.",
  },
};
