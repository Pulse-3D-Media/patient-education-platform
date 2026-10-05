"use client";

import type { BillingInterval, Category } from "@prisma/client";
import { INPUT, LABEL } from "@/components/ui/styles";
import { availabilityLabel } from "@/lib/categories";
import { formatCents, type PricingConfig } from "@/lib/pricing";
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
}: {
  config: PricingConfig;
  options: CategoryOption[];
  picked: Category[];
  onToggle: (category: Category) => void;
  /** Categories on the clinic's current plan. They can be kept even when they are no longer for sale. */
  alreadyHas?: Category[];
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
          const label = alreadyHas.includes(option.value) ? "On your plan" : availabilityLabel(option.availability);
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

/** The amber note every card-payment form carries while the app runs Stripe in test mode only. */
export function TestModeNote({ children }: { children?: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-[15px] text-ink-soft">
      <strong className="font-semibold text-warn">Test mode.</strong> This is Stripe&rsquo;s test system, so no real card is charged.
      {children ? <> {children}</> : null}
    </p>
  );
}
