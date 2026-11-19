"use client";

import type { BillingInterval } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Category } from "@/lib/categories";
import { PULSE_CONTACT_URL } from "@/lib/brand";
import type { PricingConfig } from "@/lib/pricing";
import { planHref } from "@/lib/sign-up-steps";
// A type only, so nothing of that server file reaches the browser.
import type { CategoryOption } from "@/app/admin/billing/checkout-view";
import { categoryNames, quotePlan } from "./plan-quote";
import { PlanSummary } from "./PlanSummary";

/**
 * Sign-up step 2 of 3, "Choose your plan" (the approved design, screen
 * 02-signup-2): category tiles, seats with minus and plus, Monthly or Yearly,
 * "Your plan" with the total, and Continue to payment.
 *
 * The total follows the picks as they are made, from the same pricing engine
 * and the same active prices as Billing's plan picker. Continue only moves
 * to the payment step with the picks in the address (lib/sign-up-steps.ts);
 * nothing is saved or charged here, and the payment page works the price out
 * again on the server. The picks are ordinary React state, so nothing is
 * lost while choosing.
 */
export function SignUpPlanForm({
  config,
  options,
  initial,
}: {
  config: PricingConfig;
  options: CategoryOption[];
  initial: { categories: Category[]; seats: number; interval: BillingInterval };
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Category[]>(initial.categories);
  const [seats, setSeats] = useState(initial.seats);
  const [every, setEvery] = useState<BillingInterval>(initial.interval);
  const [going, setGoing] = useState(false);

  const clinicMax = config.seats.clinicMax;
  const tooManySeats = seats > clinicMax;
  const plan = { categories: options.map((option) => option.value).filter((value) => picked.includes(value)), seats, interval: every };
  const current = tooManySeats ? null : quotePlan(config, options, plan);
  const totalCents = current?.amounts?.totalCents ?? null;
  const canContinue = totalCents !== null && !going;

  const toggle = (category: Category) => setPicked((now) => (now.includes(category) ? now.filter((value) => value !== category) : [...now, category]));
  const setSeatCount = (value: number) => setSeats(Math.max(1, Math.min(value, clinicMax + 1)));

  const onContinue = () => {
    if (!canContinue) return;
    setGoing(true);
    router.push(planHref(plan));
  };

  const stepButton = "grid h-12 w-12 place-items-center text-xl text-ink hover:bg-wash disabled:opacity-40";

  return (
    <div className="mx-auto grid max-w-[884px] gap-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-12">
      <div>
        <h1 className="text-[2.25rem] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[2.5rem]">Choose your plan</h1>

        <fieldset className="mt-7">
          <legend className="text-sm font-semibold text-ink">Categories</legend>
          <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
            {options.map((option) => {
              const canBuy = option.availability === "sellable";
              return (
                <label
                  key={option.value}
                  className={`flex min-h-[50px] items-center gap-3 rounded-xl border px-5 ${
                    canBuy ? "cursor-pointer border-line-strong bg-surface has-[:checked]:border-brand has-[:checked]:bg-brand/10" : "border-line bg-surface opacity-60"
                  }`}
                >
                  <input
                    type="checkbox"
                    value={option.value}
                    checked={picked.includes(option.value)}
                    disabled={!canBuy}
                    onChange={() => toggle(option.value)}
                    className="h-5 w-5 accent-[var(--brand-accent)]"
                  />
                  <span className="text-base text-ink">{option.label}</span>
                  {!canBuy && <span className="ml-auto text-sm text-ink-muted">{option.availability === "coming-soon" ? "Coming soon" : "Not available"}</span>}
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="mt-7 flex flex-wrap gap-x-[120px] gap-y-7">
          <div>
            <p id="seats-label" className="text-sm font-semibold text-ink">
              Seats
            </p>
            <div role="group" aria-labelledby="seats-label" className="mt-2.5 inline-flex overflow-hidden rounded-xl border border-line-strong bg-surface">
              <button type="button" aria-label="One seat fewer" onClick={() => setSeatCount(seats - 1)} disabled={seats <= 1} className={stepButton}>
                −
              </button>
              <input
                aria-label="Seats"
                inputMode="numeric"
                value={String(seats)}
                onChange={(event) => {
                  const digits = event.target.value.replace(/\D/g, "").slice(0, 5);
                  setSeatCount(digits === "" ? 1 : Number(digits));
                }}
                className="h-12 w-12 border-x border-line-strong bg-surface text-center text-base font-semibold text-ink"
              />
              <button type="button" aria-label="One seat more" onClick={() => setSeatCount(seats + 1)} disabled={tooManySeats} className={stepButton}>
                +
              </button>
            </div>
            <p className="mt-2 text-sm text-ink-soft">One for each person who sends videos.</p>
          </div>

          <fieldset>
            <legend className="text-sm font-semibold text-ink">Pay</legend>
            <div className="mt-2.5 inline-flex rounded-xl border border-line-strong bg-surface p-1">
              {(["MONTH", "YEAR"] as const).map((value) => (
                <label
                  key={value}
                  className="cursor-pointer rounded-lg px-4 py-2.5 text-base font-medium text-ink-soft has-[:checked]:bg-brand has-[:checked]:text-on-brand has-[:focus-visible]:outline has-[:focus-visible]:outline-2"
                >
                  <input type="radio" name="sign-up-interval" value={value} checked={every === value} onChange={() => setEvery(value)} className="sr-only" />
                  {value === "MONTH" ? "Monthly" : "Yearly"}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        {tooManySeats && (
          <p role="status" className="mt-5 text-[15px] text-ink-soft">
            More than {clinicMax} seats is set up by Pulse 3D by agreement, so there is no card payment for it here.{" "}
            <a href={PULSE_CONTACT_URL} className="font-medium text-brand-bright underline underline-offset-2">
              Schedule a call with Pulse 3D
            </a>
            .
          </p>
        )}
      </div>

      <div className="flex flex-col gap-8">
        <PlanSummary names={categoryNames(options, plan.categories)} seats={seats} interval={every} totalCents={totalCents} />
      </div>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end lg:col-span-2">
        <button
          type="button"
          onClick={onContinue}
          disabled={!canContinue}
          className="inline-flex min-h-[52px] items-center justify-center rounded-xl bg-brand px-7 text-base font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60"
        >
          {going ? "One moment" : "Continue to payment"}
        </button>
      </div>
    </div>
  );
}
