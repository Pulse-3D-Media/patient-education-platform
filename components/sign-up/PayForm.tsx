"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import type { Category } from "@/lib/categories";
import { formatCents } from "@/lib/pricing";
import { planHref } from "@/lib/sign-up-steps";
import { checkoutDestination } from "@/lib/stripe-pages";
import { startSignUpCheckoutAction } from "@/app/admin/billing/actions";

/**
 * The buttons at the foot of the payment step: Back, and "Pay $X and start"
 * (or "Try again" after a payment that was not finished).
 *
 * Pressing Pay sends what was picked and which total was on screen to the
 * same checkout Billing uses (startSignUpCheckoutAction). The server works
 * the price out again and, if it matches, answers with the address of
 * Stripe's own payment page, where the card is entered (never on this site).
 * The browser goes there only if it really is Stripe's page or one of ours
 * (checkoutDestination), as on Billing.
 *
 * There are no boxes to type in, so nothing can be lost when something goes
 * wrong: the plan stays on the page and the sentence says what to do.
 */
export function PayForm({
  plan,
  versionId,
  totalCents,
  retry,
}: {
  plan: { categories: Category[]; seats: number; interval: "MONTH" | "YEAR" };
  versionId: string;
  totalCents: number;
  /** The person came back from Stripe without paying: the button says "Try again", as drawn. */
  retry: boolean;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(startSignUpCheckoutAction, null);

  useEffect(() => {
    if (!state?.redirectTo) return;
    const destination = checkoutDestination(state.redirectTo);
    if (destination?.kind === "here") router.push(destination.path);
    else if (destination?.kind === "stripe") window.location.assign(destination.url);
  }, [state, router]);

  const leaving = pending || Boolean(state?.redirectTo);

  return (
    <form action={action} className="lg:col-span-2">
      {plan.categories.map((category) => (
        <input key={category} type="hidden" name="categories" value={category} />
      ))}
      <input type="hidden" name="seats" value={String(plan.seats)} />
      <input type="hidden" name="interval" value={plan.interval} />
      {/* What the person was looking at. The server compares these with its own numbers and never charges them. */}
      <input type="hidden" name="seenVersionId" value={versionId} />
      <input type="hidden" name="seenTotalCents" value={String(totalCents)} />

      <div aria-live="polite" className="mb-4 text-right text-[15px]">
        {state?.error && (
          <p role="alert" className="font-medium text-problem">
            {state.error}
            {state.signIn && (
              <>
                {" "}
                <a href={`/sign-in?redirect_url=${encodeURIComponent(planHref(plan))}`} className="text-brand-bright underline underline-offset-2">
                  Sign in
                </a>
              </>
            )}
          </p>
        )}
        {state?.changed && (
          <p role="alert" className="font-medium text-problem">
            {state.changed}
          </p>
        )}
      </div>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <a
          href={planHref(plan, "plan")}
          className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-line-strong bg-surface px-5 text-base font-semibold text-ink hover:bg-wash"
        >
          Back
        </a>
        <button
          type="submit"
          disabled={leaving}
          className="inline-flex min-h-[52px] items-center justify-center rounded-xl bg-brand px-7 text-base font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60"
        >
          {leaving ? "Opening Stripe..." : retry ? "Try again" : `Pay ${formatCents(totalCents)} and start`}
        </button>
      </div>
    </form>
  );
}
