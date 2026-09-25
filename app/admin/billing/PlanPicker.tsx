"use client";

import type { BillingInterval, Category } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState } from "react";
import { INPUT, LABEL, PRIMARY_BUTTON } from "@/components/ui/styles";
import { PULSE_CONTACT_URL } from "@/lib/brand";
import { availabilityLabel } from "@/lib/categories";
import { engineInterval } from "@/lib/checkout-rules";
import { formatCents, quote, type PricingConfig, type Quote } from "@/lib/pricing";
import { startCheckoutAction } from "./actions";
import type { CategoryOption } from "./checkout-view";

/**
 * The plan picker on /admin/billing: categories, surgeon seats, monthly or
 * yearly, the total, and the button that goes to Stripe.
 *
 * A client component because the total has to follow the picks as they are
 * made. The arithmetic is the same pricing engine the server uses
 * (lib/pricing.ts, which is safe for the browser), fed the active prices
 * the page handed down. WHAT IS SHOWN HERE IS NEVER WHAT IS CHARGED BECAUSE
 * IT WAS SHOWN HERE: pressing the button sends the picks, and the server
 * works the price out again from its own numbers. The form also says which
 * total was on screen, and if the server's differs, nothing is made and the
 * new total is shown for the admin to accept.
 *
 * The picks are ordinary React state, so when the action comes back with a
 * message (a refusal, a lost connection, a changed total) everything that
 * was picked is still picked.
 */
export function PlanPicker({
  versionId,
  config,
  options,
  initial,
}: {
  versionId: string;
  config: PricingConfig;
  options: CategoryOption[];
  initial: { categories: Category[]; seats: number; interval: BillingInterval };
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(startCheckoutAction, null);
  const [picked, setPicked] = useState<Category[]>(initial.categories);
  const [seatsText, setSeatsText] = useState(String(initial.seats));
  const [every, setEvery] = useState<BillingInterval>(initial.interval);

  const sellable = useMemo(() => options.filter((option) => option.availability === "sellable").map((option) => option.value), [options]);
  const seats = /^\d{1,5}$/.test(seatsText.trim()) ? Number(seatsText.trim()) : 0;
  const clinicMax = config.seats.clinicMax;
  const tooManySeats = seats > clinicMax;

  // Both intervals are quoted so each choice can show its own total.
  const quoteFor = (which: BillingInterval): Quote | null => {
    if (picked.length === 0 || seats < 1) return null;
    const result = quote(config, { seats, categories: picked, interval: engineInterval(which), founding: false, practiceType: "clinic", sellable });
    return result.ok ? result.quote : null;
  };
  const monthly = quoteFor("MONTH");
  const yearly = quoteFor("YEAR");
  const current = every === "YEAR" ? yearly : monthly;
  const amounts = current?.amounts ?? null;

  // The server answered with Stripe's address (or, for an attempt that was
  // already paid, the return page). Go there.
  useEffect(() => {
    if (!state?.redirectTo) return;
    if (state.redirectTo.startsWith("/")) router.push(state.redirectTo);
    else window.location.assign(state.redirectTo);
  }, [state, router]);

  const toggle = (category: Category) =>
    setPicked((now) => (now.includes(category) ? now.filter((value) => value !== category) : [...now, category]));

  const leaving = pending || Boolean(state?.redirectTo);

  return (
    <form action={action} className="mt-4 flex flex-col gap-6">
      <p className="rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-[15px] text-ink-soft">
        <strong className="font-semibold text-warn">Test mode.</strong> This is Stripe&rsquo;s test system, so no real card is charged. To try it, pay
        with the card number 4242 4242 4242 4242, any date in the future and any three digits.
      </p>

      <fieldset>
        <legend className="text-[15px] font-medium text-ink">Categories</legend>
        <p className="mt-1 text-sm text-ink-muted">
          The price depends on how many you take, not which.
          {config.fullLibraryFrom !== null && ` Take ${config.fullLibraryFrom} or more and every category is included.`}
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {options.map((option) => {
            const label = availabilityLabel(option.availability);
            const canBuy = option.availability === "sellable";
            return (
              <label
                key={option.value}
                className={`flex min-h-12 items-center gap-3 rounded-lg border px-4 ${
                  canBuy ? "cursor-pointer border-line-strong has-[:checked]:border-brand has-[:checked]:bg-brand/15" : "border-line opacity-60"
                }`}
              >
                <input
                  type="checkbox"
                  name="categories"
                  value={option.value}
                  checked={picked.includes(option.value)}
                  disabled={!canBuy}
                  onChange={() => toggle(option.value)}
                  className="h-5 w-5 accent-[var(--brand-accent)]"
                />
                <span className="text-[15px] font-medium text-ink">{option.label}</span>
                {label && <span className="ml-auto text-sm text-ink-muted">{label}</span>}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="max-w-xs">
        <label htmlFor="plan-seats" className={LABEL}>
          Surgeon seats
        </label>
        <input
          id="plan-seats"
          name="seats"
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          required
          value={seatsText}
          onChange={(event) => setSeatsText(event.target.value)}
          aria-describedby="plan-seats-help"
          className={INPUT}
        />
        <p id="plan-seats-help" className="mt-1 text-sm text-ink-muted">
          One for each person who will use the library. The account owner does not need one: take one only if you will use the library
          yourself. At least one.
        </p>
      </div>

      <fieldset>
        <legend className="text-[15px] font-medium text-ink">How often you pay</legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <IntervalChoice value="MONTH" label="Monthly" chosen={every} onChoose={setEvery} total={monthly?.amounts?.totalCents ?? null} per="month" />
          <IntervalChoice
            value="YEAR"
            label="Yearly"
            chosen={every}
            onChoose={setEvery}
            total={yearly?.amounts?.totalCents ?? null}
            per="year"
            note={config.yearlyMonths < 12 ? `A year for the price of ${config.yearlyMonths} months.` : undefined}
          />
        </div>
      </fieldset>

      <section aria-live="polite" aria-label="What this plan comes to" className="rounded-xl border border-line bg-sunken p-5">
        {tooManySeats ? (
          <p className="text-[15px] text-ink-soft">
            More than {clinicMax} surgeon seats is set up by Pulse 3D by agreement, so there is no card payment for it here.{" "}
            <a href={PULSE_CONTACT_URL} className="font-medium text-brand-bright underline underline-offset-2">
              Schedule a call with Pulse 3D
            </a>
            .
          </p>
        ) : !current || !amounts ? (
          <p className="text-[15px] text-ink-soft">Choose at least one category and one surgeon seat to see what it comes to.</p>
        ) : (
          <>
            <p className="text-sm text-ink-muted">Total, in US dollars</p>
            <p className="mt-1 text-3xl font-semibold text-brand-bright">
              {formatCents(amounts.totalCents)} <span className="text-base font-medium text-ink-soft">per {amounts.interval}</span>
            </p>
            <p className="mt-2 text-[15px] text-ink-soft">
              {formatCents(amounts.perSeatCents)} per surgeon seat per {amounts.interval}, times {amounts.seats} {amounts.seats === 1 ? "seat" : "seats"}.
              {amounts.monthlyEquivalentCents !== null && ` That works out to ${formatCents(amounts.monthlyEquivalentCents)} a month.`}
            </p>
            <p className="mt-2 text-[15px] text-ink-soft">
              {current.fullLibrary
                ? "Includes the full library: every category."
                : `Includes ${current.entitledCategories.length === 1 ? "the category" : `the ${current.entitledCategories.length} categories`} you picked.`}
            </p>
            {current.notes
              .filter((note) => !note.startsWith("The full library:"))
              .map((note) => (
                <p key={note} className="mt-2 text-sm text-ink-muted">
                  {note}
                </p>
              ))}
            <p className="mt-3 text-sm text-ink-muted">
              Charged to your card by Stripe every {amounts.interval}, starting today. Your card details go to Stripe, never to Pulse 3D. The library opens once
              Stripe confirms the payment.
            </p>
          </>
        )}
      </section>

      {/* What the admin was looking at when they pressed the button. The server compares these with its own numbers and never charges them. */}
      <input type="hidden" name="interval" value={every} />
      <input type="hidden" name="seenVersionId" value={versionId} />
      <input type="hidden" name="seenTotalCents" value={amounts ? String(amounts.totalCents) : ""} />

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={leaving || !amounts || tooManySeats} className={`${PRIMARY_BUTTON} h-12 px-6 text-[15px]`}>
          {leaving ? "Opening Stripe..." : "Continue to payment"}
        </button>
        <span aria-live="polite" className="text-[15px]">
          {state?.error && <span className="text-warn">{state.error}</span>}
          {state?.changed && <span className="text-warn">{state.changed}</span>}
        </span>
      </div>
    </form>
  );
}

function IntervalChoice({
  value,
  label,
  chosen,
  onChoose,
  total,
  per,
  note,
}: {
  value: BillingInterval;
  label: string;
  chosen: BillingInterval;
  onChoose: (value: BillingInterval) => void;
  total: number | null;
  per: string;
  note?: string;
}) {
  return (
    <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border border-line-strong px-4 py-3 has-[:checked]:border-brand has-[:checked]:bg-brand/15">
      {/* Named only so the two behave as one group for the arrow keys. The server reads the hidden "interval" field, never this one. */}
      <input type="radio" name="intervalChoice" value={value} checked={chosen === value} onChange={() => onChoose(value)} className="mt-0.5 h-5 w-5 accent-[var(--brand-accent)]" />
      <span>
        <span className="block text-[15px] font-medium text-ink">{label}</span>
        <span className="block text-sm text-ink-soft">{total === null ? "Pick categories and seats to see the price" : `${formatCents(total)} per ${per}`}</span>
        {note && <span className="block text-sm text-ink-muted">{note}</span>}
      </span>
    </label>
  );
}
