import { SignUpFrame } from "@/components/sign-up/SignUpFrame";
import { SignUpPlanForm } from "@/components/sign-up/SignUpPlanForm";
import { readPlanFromAddress } from "@/lib/sign-up-steps";
import { requireSignUpPicker } from "../sign-up-view";

/**
 * Sign-up step 2 of 3: "Choose your plan", at /onboarding/plan.
 *
 * A new clinic's owner arrives here from /onboarding right after the email
 * code. Offered only where Billing's plan picker would be offered
 * (requireSignUpPicker in ../sign-up-view.ts); everyone else is sent on, so
 * on the production deployment this page never draws.
 *
 * It opens on what was picked before: the picks in the address when the
 * person came back from the payment step, otherwise a checkout they started
 * and did not finish, otherwise the clinic's plan on file (the same starting
 * point as Billing's picker). Only categories that can be bought now start
 * ticked.
 */
export const dynamic = "force-dynamic";

export default async function SignUpPlanPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const { offer } = await requireSignUpPicker();
  const params = (await searchParams) ?? {};

  const sellable = offer.options.filter((option) => option.availability === "sellable").map((option) => option.value);
  const fromAddress = readPlanFromAddress(params, offer.options.map((option) => option.value));
  const start = fromAddress ?? offer.initial;
  const initial = {
    categories: start.categories.filter((category) => sellable.includes(category)),
    seats: Math.min(Math.max(start.seats, 1), offer.config.seats.clinicMax),
    interval: start.interval,
  };

  return (
    <SignUpFrame step="plan">
      <SignUpPlanForm config={offer.config} options={offer.options} initial={initial} />
    </SignUpFrame>
  );
}
