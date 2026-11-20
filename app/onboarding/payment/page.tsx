import { redirect } from "next/navigation";
import { PayForm } from "@/components/sign-up/PayForm";
import { formatCents, freeMonthsOnYearly } from "@/lib/pricing";
import { categoryNames, quotePlan } from "@/components/sign-up/plan-quote";
import { PlanSummary } from "@/components/sign-up/PlanSummary";
import { SignUpFrame } from "@/components/sign-up/SignUpFrame";
import { planHref, readPlanFromAddress, SIGN_UP_PATHS } from "@/lib/sign-up-steps";
import { requireSignUpPicker } from "../sign-up-view";

/**
 * Sign-up step 3 of 3: "Payment method", at /onboarding/payment (the approved
 * design, screens 02-signup-3 and 3b).
 *
 * THE CARD IS ENTERED ON STRIPE'S OWN PAGE, not on this one. The design draws
 * Stripe's form inside this page with express checkout buttons; that needs
 * Stripe's browser script, a new package and a wider content policy, which
 * were not added without asking (rule 6). So this page shows the plan, the
 * total and the test-mode line, and "Pay $X and start" opens Stripe's hosted
 * payment page, exactly as Billing does. Stripe's hosted page offers the
 * card wallets the Stripe account has switched on.
 *
 * The plan comes from the address (what the plan step picked) or, when
 * Stripe sends the person back without a payment (?stopped=1), from the
 * checkout they started, which the server has on record. The total shown is
 * worked out HERE, on the server, from the active pricing version; the Pay
 * button's checkout works it out again and refuses if it differs (rule 8).
 *
 * Offered only where Billing's plan picker would be (requireSignUpPicker),
 * so never on the production deployment.
 */
export const dynamic = "force-dynamic";

export default async function SignUpPaymentPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const { offer, view } = await requireSignUpPicker();
  const params = (await searchParams) ?? {};
  const stopped = params.stopped === "1";

  // What was picked: the address, else the checkout already on record (offer.initial starts from it), else back to the plan step.
  const plan = readPlanFromAddress(params, offer.options.map((option) => option.value)) ?? (view.waiting ? offer.initial : null);
  if (!plan) redirect(SIGN_UP_PATHS.plan);

  const priced = quotePlan(offer.config, offer.options, plan);
  const amounts = priced?.amounts ?? null;
  // Nothing to pay for (a category no longer for sale, more seats than a card plan covers, a broken address): pick again.
  if (!priced || !amounts || priced.band === "enterprise") redirect(planHref(plan, "plan"));

  const per = plan.interval === "YEAR" ? "year" : "month";
  // "2 months free" on a yearly plan, worked out here from the same plan quoted both ways (never a fixed claim).
  const freeMonths = freeMonthsOnYearly(
    quotePlan(offer.config, offer.options, { ...plan, interval: "MONTH" })?.amounts?.totalCents,
    quotePlan(offer.config, offer.options, { ...plan, interval: "YEAR" })?.amounts?.totalCents,
  );

  return (
    <SignUpFrame step="payment" backToPlan={planHref(plan, "plan")}>
      <div className="mx-auto grid max-w-[884px] gap-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-12">
        <div>
          <h1 className="text-[2.25rem] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[2.5rem]">Payment method</h1>

          {stopped && (
            <div role="alert" className="mt-6 flex gap-3 rounded-xl border border-warn/40 bg-warn/10 px-5 py-4 text-[15px] text-ink">
              <span aria-hidden="true" className="text-warn">
                ⚠
              </span>
              <p>
                <strong className="font-semibold">The payment was not finished.</strong> Nothing was charged. Try again, with another card or payment method if yours was declined.
              </p>
            </div>
          )}

          <div className="mt-6 rounded-xl border border-line-strong bg-surface px-5 py-5">
            <p className="text-[15px] font-semibold text-ink">You enter your card on Stripe&rsquo;s secure page.</p>
            <p className="mt-1 text-sm text-ink-soft">
              Your card details go to Stripe, never to Pulse 3D. Stripe charges {formatCents(amounts.totalCents)} every {per}, starting today, and the library opens once Stripe
              confirms the payment.
            </p>
          </div>

          <p className="mt-4 flex items-center gap-2 text-sm font-semibold text-warn">
            <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm bg-warn" />
            Test mode: no card is charged
          </p>
          <p className="mt-1 text-sm text-ink-soft">On Stripe&rsquo;s page, use the test card 4242 4242 4242 4242, any future date and any three digits.</p>
        </div>

        <div>
          <PlanSummary names={categoryNames(offer.options, priced.selectedCategories)} seats={plan.seats} interval={plan.interval} totalCents={amounts.totalCents} freeMonths={freeMonths} />
        </div>

        <PayForm plan={plan} versionId={offer.versionId} totalCents={amounts.totalCents} retry={stopped} />
      </div>
    </SignUpFrame>
  );
}

