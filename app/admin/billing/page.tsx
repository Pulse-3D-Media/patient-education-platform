import type { ClinicStatus } from "@prisma/client";
import Link from "next/link";
import { AdminsOnly } from "@/components/ui/AdminsOnly";
import { ClinicShell } from "@/components/ui/ClinicShell";
import { PRIMARY_BUTTON } from "@/components/ui/styles";
import { PULSE_CONTACT_URL } from "@/lib/brand";
import { CATEGORIES } from "@/lib/categories";
import { requireClinicPage } from "@/lib/clinic";
import { clinicIsOpen, type ClinicOpenFacts } from "@/lib/clinic-status";
import { formatCents } from "@/lib/pricing";
import { AdminFrame } from "../AdminFrame";
import { getBillingView } from "./billing";
import { getCheckoutView, type CheckoutOffer, type PlanFacts } from "./checkout-view";
import { PlanPicker } from "./PlanPicker";

/**
 * Billing, at /admin/billing: the one place on the clinic side that shows
 * plan and price information, and the one place a clinic chooses a plan and
 * pays for it.
 *
 * What is on it, top to bottom: where the clinic stands; the subscription
 * it is paying for, when it has one; the plan on file with an estimate,
 * labelled as an estimate, when it does not; and then ONE of: the plan
 * picker, a message about why there is no card payment for this clinic, or
 * what comes later. Nothing asks what kind of practice the clinic is: only
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
  const offer: CheckoutOffer = checkout?.offer ?? { kind: "closed", message: "Your clinic could not be found. Try again in a moment." };
  const params = props.searchParams ? await props.searchParams : {};
  const cameBackWithoutPaying = params.checkout === "cancelled";

  const labels = view
    ? CATEGORIES.filter((category) => view.plan.categories.includes(category.value)).map((category) => category.label)
    : [];
  const managed = view?.plan.managedByPulse ?? false;
  const subscription = checkout?.subscription ?? null;
  const canPayHere = offer.kind === "picker";

  return (
    <AdminFrame clinic={clinic} title="Billing" intro="Your plan, and what it comes to.">
      {cameBackWithoutPaying && (
        <p role="status" className="mt-6 rounded-xl border border-line-strong bg-surface px-5 py-4 text-[15px] text-ink-soft">
          You left Stripe&rsquo;s page before paying, so nothing was charged. Your picks are still below.
        </p>
      )}

      <StatusCard clinic={clinic} managed={managed} canPayHere={canPayHere} />

      {checkout?.waiting && !cameBackWithoutPaying && (
        <p className="mt-6 rounded-xl border border-line bg-surface px-5 py-4 text-[15px] text-ink-soft">
          A checkout was started for your clinic and no payment has been confirmed for it. Paid already?{" "}
          <Link href="/admin/billing/return" className="font-medium text-brand-bright underline underline-offset-2">
            Check on your payment
          </Link>
          .
        </p>
      )}

      {subscription && <SubscriptionCard plan={subscription.plan} status={checkout?.billingStatus ?? "NONE"} renewsAt={subscription.currentPeriodEnd} endsAt={subscription.cancelAt} />}

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

      <OfferSection offer={offer} managed={managed} />
    </AdminFrame>
  );
}

/** The last card on the page: the plan picker, or why there is none. */
function OfferSection({ offer, managed }: { offer: CheckoutOffer; managed: boolean }) {
  if (offer.kind === "picker") {
    return (
      <section aria-labelledby="choose-heading" className="mt-6 rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <h2 id="choose-heading" className="text-lg font-semibold">
          Choose a plan
        </h2>
        <p className="mt-2 text-ink-soft">Pick what you need, check the total, then pay on Stripe&rsquo;s page. Your clinic opens once Stripe confirms the payment.</p>
        <PlanPicker versionId={offer.versionId} config={offer.config} options={offer.options} initial={offer.initial} />
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

  const { heading, body } =
    managed || offer.kind === "managed"
      ? {
          heading: "Changes to your plan",
          body: "Pulse 3D manages this plan, so there is nothing to set up or pay for here. Questions about your invoice go to Pulse 3D.",
        }
      : offer.kind === "subscribed"
        ? {
            heading: "Changing your plan",
            body: "Changing seats or categories, updating your card, your invoices and cancelling are coming to this page. Until then, get in touch with Pulse 3D and we will do it with you.",
          }
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

/** The plan the clinic is paying for, with the amounts it accepted. These are real amounts, not an estimate. */
function SubscriptionCard({ plan, status, renewsAt, endsAt }: { plan: PlanFacts; status: string; renewsAt: Date | null; endsAt: Date | null }) {
  const per = plan.interval === "YEAR" ? "year" : "month";
  const included = CATEGORIES.filter((category) => plan.included.includes(category.value)).map((category) => category.label);
  const ended = status === "CANCELED";
  return (
    <section aria-labelledby="subscription-heading" className="mt-6 rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <h2 id="subscription-heading" className="text-lg font-semibold">
        {ended ? "Your last subscription" : "Your subscription"}
      </h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-sm text-ink-muted">{ended ? "What you paid" : "What you pay"}</p>
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
            Accepted by {plan.acceptedByName} on {plan.acceptedAt.toLocaleDateString("en-US", DATE_WORDS)}.
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
function StatusCard({ clinic, managed, canPayHere }: { clinic: ClinicOpenFacts; managed: boolean; canPayHere: boolean }) {
  const status = clinic.status;
  const open = clinicIsOpen(clinic);
  const inGrace = open && status === "PAST_DUE";
  const { label, body } = inGrace ? GRACE_COPY : STATUS_COPY[status];
  const next = inGrace || managed ? null : NEXT_STEP[status]?.[canPayHere ? "canPay" : "cannotPay"];
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

/** A payment failed but the grace period has not run out: the clinic is still open, for now. */
const GRACE_COPY = {
  label: "Payment failed",
  body: "Your last payment did not go through. The library and shared links are still open for now. Updating your card on this page is coming; until then, get in touch with Pulse 3D.",
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
    body: "Your last payment did not go through, so the library and shared links are off. Updating your card on this page is coming; until then, get in touch with Pulse 3D.",
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
