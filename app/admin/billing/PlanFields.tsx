"use client";

import type { BillingInterval } from "@prisma/client";
import type { Category } from "@/lib/categories";
import { INPUT, LABEL } from "@/components/ui/styles";
import { availabilityLabel } from "@/lib/categories";
import { formatCents, type PricingConfig, type QuoteAmounts } from "@/lib/pricing";
import type { CategoryOption } from "./checkout-view";

/**
 * The three things a plan is made of, as form fields: categories, surgeon
 * seats, and monthly or yearly. Shared by the plan picker (a first plan) and
 * the plan changer (a plan that is being paid for), so both ask for a plan
 * the same way. The picks live in the form that uses these, as ordinary
 * React state; nothing here decides a price.
 */

/** A category that can be ticked: one for sale, or (when changing a plan) one the clinic already has. */
export function canPick(option: CategoryOption, alreadyHas: Category[] = []): boolean {
  return option.availability === "sellable" || alreadyHas.includes(option.value);
}

export function CategoryChoices({
  config,
  options,
  picked,
  onToggle,
  alreadyHas = [],
  notes = {},
}: {
  config: PricingConfig;
  options: CategoryOption[];
  picked: Category[];
  onToggle: (category: Category) => void;
  /** Categories on the clinic's current plan. They can be kept even when they are no longer for sale. */
  alreadyHas?: Category[];
  /** A word beside a category that says more than "On your plan" would (where the paid plan and the library disagree). */
  notes?: Partial<Record<Category, string>>;
}) {
  return (
    <fieldset>
      <legend className="text-[15px] font-medium text-ink">Categories</legend>
      <p className="mt-1 text-sm text-ink-muted">
        The price depends on how many you take, not which.
        {config.fullLibraryFrom !== null && ` Take ${config.fullLibraryFrom} or more and every category is included.`}
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const canBuy = canPick(option, alreadyHas);
          // A category the clinic already has reads as "On your plan", not as "Not for sale".
          const label = notes[option.value] ?? (alreadyHas.includes(option.value) ? "On your plan" : availabilityLabel(option.availability));
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
                onChange={() => onToggle(option.value)}
                className="h-5 w-5 accent-[var(--brand-accent)]"
              />
              <span className="text-[15px] font-medium text-ink">{option.label}</span>
              {label && <span className="ml-auto text-sm text-ink-muted">{label}</span>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function SeatsField({ id, value, onChange, help }: { id: string; value: string; onChange: (value: string) => void; help: string }) {
  return (
    <div className="max-w-xs">
      <label htmlFor={id} className={LABEL}>
        Surgeon seats
      </label>
      <input
        id={id}
        name="seats"
        type="number"
        inputMode="numeric"
        min={1}
        step={1}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={`${id}-help`}
        className={INPUT}
      />
      <p id={`${id}-help`} className="mt-1 text-sm text-ink-muted">
        {help}
      </p>
    </div>
  );
}

export function IntervalChoices({
  config,
  chosen,
  onChoose,
  monthlyCents,
  yearlyCents,
}: {
  config: PricingConfig;
  chosen: BillingInterval;
  onChoose: (value: BillingInterval) => void;
  monthlyCents: number | null;
  yearlyCents: number | null;
}) {
  return (
    <fieldset>
      <legend className="text-[15px] font-medium text-ink">How often you pay</legend>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <IntervalChoice value="MONTH" label="Monthly" chosen={chosen} onChoose={onChoose} total={monthlyCents} per="month" />
        <IntervalChoice
          value="YEAR"
          label="Yearly"
          chosen={chosen}
          onChoose={onChoose}
          total={yearlyCents}
          per="year"
          note={config.yearlyMonths < 12 ? `A year for the price of ${config.yearlyMonths} months.` : undefined}
        />
      </div>
    </fieldset>
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

/**
 * The total as it stands, kept in view while the admin picks (Van, 2026-10-08:
 * the total did not visibly change as he ticked boxes, because it sat below
 * the fold). It is pinned to the bottom of the screen for as long as the form
 * is on it, and at the end of the form it settles into its own place above
 * the details. The number flashes briefly each time it changes, unless the
 * computer is set to reduce motion.
 *
 * It is labelled an ESTIMATE on purpose. It comes from the same pricing
 * engine the server uses, but the server works the price out again from its
 * own numbers when the form is sent (rule 8), and the amount that counts is
 * the one shown on the next step: Review for a change, Stripe's page for a
 * first plan.
 */
export function RunningTotal({
  heading,
  amounts,
  tooManySeats,
  clinicMax,
  until,
  before = null,
}: {
  /** "Total", or "New total" for a change. */
  heading: string;
  amounts: QuoteAmounts | null;
  tooManySeats: boolean;
  clinicMax: number;
  /** Where the exact amount is shown: "until you pay on Stripe's page", "until you review the change". */
  until: string;
  /** For a change, what the plan comes to now, so the two can be compared. */
  before?: string | null;
}) {
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      aria-label="Running total"
      data-running-total=""
      className="sticky bottom-0 z-10 -mx-1 rounded-xl border border-brand bg-surface px-4 py-3 shadow-lift sm:-mx-2"
    >
      {tooManySeats ? (
        <p className="text-[15px] text-ink-soft">More than {clinicMax} surgeon seats is set up by Pulse 3D by agreement, so there is no total here.</p>
      ) : !amounts ? (
        <p className="text-[15px] text-ink-soft">Pick at least one category and one surgeon seat to see the total.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="flex items-center gap-2 text-[15px] font-medium text-ink">
              <span className="rounded-md bg-wash-strong px-2 py-0.5 text-[13px] font-medium uppercase tracking-wide text-ink-soft">Estimate</span>
              {heading}
            </p>
            <p className="text-2xl font-semibold text-brand-bright">
              {/* Keyed by the amount, so a new amount is a new element and its flash runs again. */}
              <span key={amounts.totalCents} className="running-total rounded-md px-1">
                {formatCents(amounts.totalCents)}
              </span>{" "}
              <span className="text-base font-medium text-ink-soft">per {amounts.interval}</span>
            </p>
          </div>
          <p className="mt-1 text-sm text-ink-soft">
            {formatCents(amounts.perSeatCents)} per surgeon seat per {amounts.interval}, times {amounts.seats} {amounts.seats === 1 ? "seat" : "seats"}. In US dollars, an
            estimate {until}.{before && ` ${before}`}
          </p>
        </>
      )}
    </div>
  );
}

/** The amber note every card-payment form carries while the app runs Stripe in test mode only. */
export function TestModeNote({ children }: { children?: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-[15px] text-ink-soft">
      <strong className="font-semibold text-warn">Test mode.</strong> This is Stripe&rsquo;s test system, so no real card is charged.
      {children ? <> {children}</> : null}
    </p>
  );
}
