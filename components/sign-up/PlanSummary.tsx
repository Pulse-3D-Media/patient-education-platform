import { formatCents, freeMonthsWords } from "@/lib/pricing";

/**
 * The "Your plan" card on the right of the plan and payment steps (on a phone,
 * under the form): the categories, the seats and how often, and the total.
 * Pure display; it decides nothing about money.
 */
export function PlanSummary({
  names,
  seats,
  interval,
  totalCents,
  freeMonths = null,
}: {
  /** Months a yearly plan gives free, already worked out from the prices (freeMonthsOnYearly in lib/pricing.ts). Shown only when yearly is chosen. */
  freeMonths?: number | null;
  /** "Knee, Shoulder, Hip". Empty when nothing is picked yet. */
  names: string;
  seats: number;
  interval: "MONTH" | "YEAR";
  /** Null when there is no total to show (nothing picked, or more seats than a card plan covers). */
  totalCents: number | null;
}) {
  const per = interval === "YEAR" ? "year" : "month";
  return (
    <section aria-label="Your plan" className="rounded-2xl border border-line bg-surface p-5">
      <p className="text-sm text-ink-soft">Your plan</p>
      <p className="mt-2 text-[15px] font-semibold text-ink">{names || "No categories picked yet"}</p>
      <p className="mt-1 text-[15px] font-semibold text-ink">
        {seats} {seats === 1 ? "seat" : "seats"} · {interval === "YEAR" ? "yearly" : "monthly"}
      </p>
      {interval === "YEAR" && freeMonths !== null && (
        <p data-free-months="" className="mt-1 text-sm font-semibold text-brand-bright">
          {freeMonthsWords(freeMonths)}
        </p>
      )}
      <div className="mt-4 flex items-baseline justify-between border-t border-line pt-4">
        <span className="text-sm text-ink-soft">Total</span>
        <span aria-live="polite">
          {totalCents === null ? (
            <span className="text-sm text-ink-soft">Not worked out yet</span>
          ) : (
            <>
              <span className="text-[1.75rem] font-semibold text-ink">{formatCents(totalCents)}</span>
              <span className="ml-1.5 text-sm text-ink-soft">/ {per}</span>
            </>
          )}
        </span>
      </div>
    </section>
  );
}
