import type { ClinicStatus } from "@prisma/client";
import type { Category } from "@/lib/categories";
import Link from "next/link";
import type { ReactNode } from "react";
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
import { BILLING_HISTORY_LIMIT, type BillingHistoryEntry } from "@/lib/stripe";
import { AdminFrame } from "../AdminFrame";
import { DetailHeader, Facts } from "../DetailParts";
import { getBillingView } from "./billing";
import { CancelChangeButton, CheckWithStripeButton, PayInvoiceButton, PortalButton } from "./BillingButtons";
import { getCheckoutView, type CheckoutOffer, type CheckoutView, type PlanFacts } from "./checkout-view";
import { getBillingHistory, type BillingHistoryView } from "./history";
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
  const [list, history] = await Promise.all([getCategoryList(), getBillingHistory(clinic.id, Boolean(checkout?.portal))]);
  const offer: CheckoutOffer = checkout?.offer ?? { kind: "closed", message: "Your clinic could not be found. Try again in a moment." };
  const params = props.searchParams ? await props.searchParams : {};
  const cameBackWithoutPaying = params.checkout === "cancelled";
  const cameBackFromStripe = params.from === "stripe";

  const managed = view?.plan.managedByPulse ?? false;
  const subscription = checkout?.subscription ?? null;
  const canPayHere = offer.kind === "picker";
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
  // The change form opens from "Change plan", or from the library's "Add to your plan" link; otherwise the page stays short.
  const canChange = offer.kind === "subscribed" && !managed && offer.change.kind === "changer";
  const changing = canChange && (params.change === "1" || params[ADD_PARAM] !== undefined);

  const open = clinicIsOpen(clinic);
  const inGrace = open && clinic.status === "PAST_DUE";
  const statusLabel = inGrace ? GRACE_COPY.label : STATUS_COPY[clinic.status].label;
  const renews = subscription && !subscription.cancelAt && checkout?.billingStatus === "ACTIVE" ? subscription.currentPeriodEnd : null;
  // The card about where the clinic stands is only drawn when it has something to say beyond the line under the title.
  const plainlyOpen = open && clinic.status === "ACTIVE";

  return (
    <AdminFrame clinic={clinic} title="Billing" bare>
      <div className="px-4 py-6 md:px-9 md:py-8">
        <DetailHeader
          as="h1"
          title="Billing"
          sub={`${statusLabel}${renews ? ` · next payment ${renews.toLocaleDateString("en-US", DAY_WORDS)}` : ""}`}
          end={
            <p className="flex items-center gap-2 text-sm font-medium text-warn">
              <span aria-hidden="true" className="h-2 w-2 rounded-sm bg-warn" />
              Test mode, no card is charged
            </p>
          }
        />

        <div className="max-w-3xl">
          {cameBackWithoutPaying && (
            <p role="status" className="mt-6 rounded-xl border border-line-strong bg-surface px-5 py-4 text-[15px] text-ink-soft">
              You left Stripe&rsquo;s page before paying, so nothing was charged. Your picks are still below.
            </p>
          )}

          {cameBackFromStripe && (
            <p role="status" className="mt-6 rounded-xl border border-line-strong bg-surface px-5 py-4 text-[15px] text-ink-soft">
              You are back from Stripe. If you changed something there and this page does not show it yet, press Check with Stripe.
            </p>
          )}

          {!plainlyOpen && (
            <StatusCard clinic={clinic} managed={managed} canPayHere={canPayHere} firstPayment={offer.kind === "first-payment"} repair={checkout?.portal ? "here" : "none"} />
          )}

          {checkout?.billingStatus === "PAST_DUE" && canRepair && !managed && (
            <section aria-labelledby="missed-heading" className="mt-6 rounded-2xl border border-warn/40 bg-warn/10 p-5 sm:p-6">
              <h2 id="missed-heading" className="text-lg font-semibold">
                Settle the missed payment
              </h2>
              <p className="mt-2 text-[15px] text-ink-soft">
                Pay it on Stripe&rsquo;s page with any card. If the card on file is the problem, update it on Stripe as well, so the next renewal goes through.
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

          {checkout && <WaitingChanges list={list} view={checkout} />}

          <PlanSection list={list} view={view} subscription={subscription} status={checkout?.billingStatus ?? "NONE"} managed={managed} canPayHere={canPayHere} canChange={canChange && !changing} />

          {/* Where the library's "Add to your plan" link lands: the picker, the change form, or the words that stand in for them. */}
          {/* The scroll margin keeps the card's heading clear of the banner across the top (64px tall). */}
          <div id={ADD_ANCHOR} className="scroll-mt-20">
            {(!canChange || changing) && <OfferSection list={list} offer={offer} managed={managed} suggested={suggested} asked={asked} />}
          </div>

          {history.kind !== "none" && <PaymentSection history={history} live={checkout?.billingStatus === "ACTIVE" || checkout?.billingStatus === "PAST_DUE"} />}

          {checkout?.portal && (
            <div className="mt-8 flex flex-col gap-3 border-t border-line pt-6">
              <CheckWithStripeButton />
            </div>
          )}
        </div>
      </div>
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
          the payment failed or was never completed, Stripe drops it 23 hours after checkout started. Press Check with Stripe after that, and you can choose a plan
          here again.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Link href="/admin/billing/return" className={PRIMARY_BUTTON}>
            Check on your payment
          </Link>
          <CheckWithStripeButton />
        </div>
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

  if (offer.kind === "closed" && !managed) {
    // Choosing a plan is not open on this deployment (production today), or the plans could not be read. Either way the next
    // step is Pulse 3D, so the card says so and gives the way there, instead of a heading with nothing to do (audit C1, 2026-11-16).
    return (
      <section aria-labelledby="next-heading" className="mt-6 rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <h2 id="next-heading" className="text-lg font-semibold">
          Getting your clinic open
        </h2>
        <p className="mt-2 text-ink-soft">{offer.message}</p>
        <a href={PULSE_CONTACT_URL} className={`mt-5 ${PRIMARY_BUTTON}`}>
          Schedule a call with Pulse 3D
        </a>
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

/** "December 5". Utah time, like the rest of the admin area. */
const DAY_WORDS = { month: "long", day: "numeric", timeZone: "America/Denver" } as const;

/**
 * "Your plan": the categories, the seats, how often it is billed and the
 * next payment. With a subscription the amounts are the real ones it
 * accepted; without one, the plan on file is quoted as an estimate,
 * labelled as one. "Change plan" opens the change form below it.
 */
function PlanSection({
  list,
  view,
  subscription,
  status,
  managed,
  canPayHere,
  canChange,
}: {
  list: CategoryDetails[];
  view: Awaited<ReturnType<typeof getBillingView>>;
  subscription: { plan: PlanFacts; currentPeriodEnd: Date | null; cancelAt: Date | null } | null;
  status: string;
  managed: boolean;
  canPayHere: boolean;
  /** True when the change form can be opened and is not open yet. */
  canChange: boolean;
}) {
  const seatsInUse = view?.seatsInUse ?? null;
  const rows: { label: string; value: ReactNode }[] = [];
  let note: ReactNode = null;

  if (subscription) {
    const { plan } = subscription;
    const per = plan.interval === "YEAR" ? "year" : "month";
    const ended = status === "CANCELED";
    rows.push({ label: "Categories", value: labelsInOrder(list, plan.included).join(", ") });
    rows.push({ label: "Seats", value: seatsInUse !== null ? `${seatsInUse} of ${plan.seats} in use` : `${plan.seats} ${plan.seats === 1 ? "seat" : "seats"}` });
    rows.push({ label: "Billed", value: plan.interval === "YEAR" ? "Yearly" : "Monthly" });
    rows.push({
      label: ended ? "Ended" : subscription.cancelAt ? "Ends" : status === "PAST_DUE" ? "Missed payment" : "Next payment",
      value: ended ? (
        `You paid ${formatCents(plan.totalCents)} per ${per}`
      ) : subscription.cancelAt ? (
        `${subscription.cancelAt.toLocaleDateString("en-US", DATE_WORDS)}. A cancellation is scheduled; the plan stays active until then.`
      ) : subscription.currentPeriodEnd ? (
        <>
          <strong className="font-semibold">{formatCents(plan.totalCents)}</strong> {status === "PAST_DUE" ? "due on" : "on"} {subscription.currentPeriodEnd.toLocaleDateString("en-US", DATE_WORDS)}
          {status === "PAST_DUE" ? ", which did not go through" : ""}
        </>
      ) : (
        `${formatCents(plan.totalCents)} per ${per}`
      ),
    });
    note = (
      <>
        {formatCents(plan.perSeatCents)} per surgeon seat per {per}, times {plan.seats} {plan.seats === 1 ? "seat" : "seats"}, in US dollars. Accepted by {plan.acceptedByName} on{" "}
        {plan.acceptedAt.toLocaleDateString("en-US", DATE_WORDS)} at the prices on offer then (price list {plan.version}).
      </>
    );
  } else if (view?.hasPlan) {
    rows.push({ label: "Categories", value: labelsInOrder(list, view.plan.categories).join(", ") });
    rows.push({
      label: "Seats",
      value: seatsInUse !== null ? `${seatsInUse} of ${view.plan.surgeonSeats} in use` : `${view.plan.surgeonSeats} ${view.plan.surgeonSeats === 1 ? "seat" : "seats"}`,
    });
    rows.push({
      label: "Estimate",
      value: view.problem ? (
        view.problem
      ) : view.estimate?.band === "enterprise" ? (
        `Priced by agreement with Pulse 3D. ${view.estimate.notes.join(" ")}`
      ) : view.estimate ? (
        <>
          <strong className="font-semibold">{formatCents(view.estimate.monthlyCents ?? 0)}</strong> per month, or{" "}
          <strong className="font-semibold">{formatCents(view.estimate.yearlyCents ?? 0)}</strong> per year
        </>
      ) : (
        "None yet"
      ),
    });
    note = managed
      ? "An estimate from the plan on file, not your invoice. Pulse 3D invoices your clinic by agreement."
      : "An estimate from the plan Pulse 3D put on file for you. It is not an invoice, and nothing has been charged for it.";
  }

  const paidSeats = subscription?.plan.seats ?? view?.plan.surgeonSeats ?? null;
  const over = seatsInUse !== null && paidSeats !== null && seatsInUse > paidSeats;

  return (
    <section aria-labelledby="plan-heading" className="mt-6 border-b border-line pb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="plan-heading" className="text-lg font-semibold">
          Your plan
        </h2>
        {canChange && (
          <Link
            href={`/admin/billing?change=1#${ADD_ANCHOR}`}
            className="inline-flex h-11 items-center rounded-xl bg-brand px-5 text-[15px] font-semibold text-on-brand transition hover:bg-brand-hover"
          >
            Change plan
          </Link>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-ink-soft">{managed ? "Pulse 3D is setting your plan up with you." : canPayHere ? "No plan yet. Choose one below." : "No plan yet."}</p>
      ) : (
        <div className="mt-4">
          <Facts rows={rows} />
        </div>
      )}
      {view?.estimate?.fullLibrary && !subscription && <p className="mt-3 text-sm text-ink-soft">That is the full library: all current categories.</p>}
      {over && (
        <p className="mt-3 text-sm text-warn">
          More seats are taken than your plan pays for. Nothing extra is being charged. Nobody else can be given a seat until someone is removed or an invitation is revoked on the{" "}
          <Link href="/admin/people" className="font-medium underline underline-offset-2">
            People page
          </Link>
          , or a seat is added.
        </p>
      )}
      {note && <p className="mt-3 text-sm text-ink-muted">{note}</p>}
      {managed && <p className="mt-3 text-sm text-ink-soft">Your plan is managed by Pulse 3D and invoiced by agreement. To change categories or seats, get in touch with Pulse 3D.</p>}
    </section>
  );
}

/** "Visa", "Mastercard": Stripe's brand word, as a person writes it. */
function brandWords(brand: string): string {
  const known: Record<string, string> = {
    visa: "Visa",
    mastercard: "Mastercard",
    amex: "American Express",
    american_express: "American Express",
    discover: "Discover",
    jcb: "JCB",
    diners: "Diners Club",
    diners_club: "Diners Club",
    unionpay: "UnionPay",
    union_pay: "UnionPay",
  };
  return known[brand] ?? "Card";
}

/** "$120.00", in the invoice's own currency, as Stripe reported it. */
function invoiceAmount(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

const STATUS_WORDS: Record<BillingHistoryEntry["status"], string> = {
  paid: "Paid",
  open: "Not paid yet",
  void: "Cancelled",
  uncollectible: "Not collected",
  draft: "Draft",
  other: "See Stripe",
};

/** The payment method and the billing history, both read from Stripe just now (history.ts). */
function PaymentSection({ history, live }: { history: Exclude<BillingHistoryView, { kind: "none" }>; live: boolean }) {
  return (
    <>
      <section aria-labelledby="method-heading" className="mt-6 border-b border-line pb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="method-heading" className="text-lg font-semibold">
            Payment method
          </h2>
          <PortalButton label="Update on Stripe" />
        </div>
        <p className="mt-3 text-[16px] text-ink-soft">
          {history.kind === "unreachable"
            ? "We could not reach Stripe just now, so the card on file is not shown. Reload this page in a moment."
            : history.record.card
              ? `${brandWords(history.record.card.brand)} ending ${history.record.card.last4} · expires ${String(history.record.card.expMonth).padStart(2, "0")}/${String(history.record.card.expYear).slice(-2)}`
              : history.record.method
                ? `${history.record.method}. Its details are on Stripe.`
                : "No payment method on file. Add one on Stripe."}
        </p>
        {/* A money disclosure, so it stays: cancelling happens on Stripe's page too. */}
        {live && (
          <p className="mt-2 text-sm text-ink-muted">
            Cancelling is on Stripe&rsquo;s page too. If you cancel, your plan stays on until the end of the period you have already paid for, and you can undo it there before then.
          </p>
        )}
      </section>

      <section aria-labelledby="history-heading" className="mt-6">
        <h2 id="history-heading" className="text-lg font-semibold">
          Billing history
        </h2>
        {history.kind === "unreachable" ? (
          <p className="mt-3 text-[15px] text-ink-soft">We could not reach Stripe just now, so your billing history is not shown. Reload this page in a moment.</p>
        ) : history.record.history.length === 0 ? (
          <p className="mt-3 text-[15px] text-ink-soft">No invoices yet.</p>
        ) : (
          <>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left text-[15px]">
                <thead>
                  <tr className="border-b border-line text-[13px] text-ink-muted">
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Date
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      What
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      Amount
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Status
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      <span className="sr-only">Receipt</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {history.record.history.map((entry) => (
                    <tr key={entry.id} className="border-b border-line">
                      <td className="py-4 pr-4 whitespace-nowrap text-ink">
                        {entry.date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Denver" })}
                      </td>
                      <td className="py-4 pr-4 text-ink">{entry.what}</td>
                      <td className="py-4 pr-4 text-right whitespace-nowrap text-ink">{invoiceAmount(entry.amountCents, entry.currency)}</td>
                      <td className="py-4 pr-4 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-2 text-sm font-medium ${entry.status === "paid" ? "text-ink" : "text-warn"}`}>
                          <span aria-hidden="true" className={`h-2 w-2 rounded-sm ${entry.status === "paid" ? "bg-brand" : "bg-warn"}`} />
                          {STATUS_WORDS[entry.status]}
                        </span>
                      </td>
                      <td className="py-4 text-right">
                        {entry.pageUrl && (
                          <a href={entry.pageUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-bright underline underline-offset-2">
                            {entry.status === "paid" ? "Receipt" : "View"}
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-sm text-ink-muted">The newest {BILLING_HISTORY_LIMIT} at most. Every invoice is on Stripe.</p>
          </>
        )}
      </section>
    </>
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
