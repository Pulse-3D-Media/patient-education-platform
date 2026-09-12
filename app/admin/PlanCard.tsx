import type { Category } from "@prisma/client";
import { CATEGORIES } from "@/lib/categories";
import { formatCents, quote, type PricingConfig } from "@/lib/pricing";

/**
 * The read-only "Your plan" card at the top of the admin console: the
 * categories on the clinic's plan, its surgeon seats, and an estimate of
 * the monthly amount from the prices the clinic is on.
 *
 * "Estimated" is the operative word, and it is on the card. Nothing here
 * is a bill: billing does not exist yet, and a clinic managed by Pulse is
 * invoiced by agreement, not by this number. Nothing internal reaches
 * this card either: no version numbers, no notes, no catalogue switches.
 */

export type PlanOnFile = {
  categories: Category[];
  surgeonSeats: number;
  managedByPulse: boolean;
};

export function PlanCard({ plan, config }: { plan: PlanOnFile; config: PricingConfig | null }) {
  const labels = CATEGORIES.filter((category) => plan.categories.includes(category.value)).map((category) => category.label);
  const hasPlan = plan.categories.length > 0 && plan.surgeonSeats > 0;

  // The estimate. The clinic's own categories are what it may be quoted
  // for here: this is the plan it already has, not a new purchase.
  const estimate =
    hasPlan && config
      ? quote(config, {
          seats: plan.surgeonSeats,
          categories: plan.categories,
          interval: "month",
          founding: false,
          practiceType: "clinic",
          sellable: plan.categories,
        })
      : null;

  return (
    <section aria-labelledby="plan-heading" className="mt-6 rounded-2xl border border-white/10 bg-[#0d1113] p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="plan-heading" className="text-lg font-semibold">
          Your plan
        </h2>
        <span className="rounded-md bg-white/10 px-2 py-0.5 text-[13px] font-medium uppercase tracking-wide text-[#bfbfbf]">Estimated</span>
      </div>

      {!hasPlan ? (
        <p className="mt-2 text-[#bfbfbf]">No plan on file yet. Pulse 3D will set it up with you.</p>
      ) : (
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-sm text-[#667085]">Categories</p>
            <p className="mt-1 text-[15px]">{labels.join(", ")}</p>
          </div>
          <div>
            <p className="text-sm text-[#667085]">Surgeon seats</p>
            <p className="mt-1 text-[15px]">{plan.surgeonSeats}</p>
          </div>
          <div>
            <p className="text-sm text-[#667085]">Estimated monthly amount</p>
            <p className="mt-1 text-[15px]">
              {!estimate ? (
                "We could not work out an estimate right now."
              ) : !estimate.ok ? (
                "We could not work out an estimate for this plan."
              ) : estimate.quote.band === "enterprise" ? (
                "Priced by agreement with Pulse 3D."
              ) : (
                <span className="text-lg font-semibold text-[#5fb8d4]">{formatCents(estimate.quote.amounts?.totalCents ?? 0)}</span>
              )}
            </p>
          </div>
        </div>
      )}

      <p className="mt-3 text-sm text-[#667085]">
        {plan.managedByPulse
          ? "Your plan is managed by Pulse 3D. This estimate is not your invoice."
          : "Estimated from the plan on file. Not a bill: nothing is charged until billing is set up."}
      </p>
    </section>
  );
}
