import type { Category } from "@prisma/client";
import { getClinicPlan, type ClinicPlan } from "@/lib/db/clinics";
import { getPricingForClinic } from "@/lib/db/pricing";
import { quote, type Band } from "@/lib/pricing";

/**
 * What /admin/billing shows, worked out on the server from the clinic's
 * own plan and the prices the server chooses for it (rule 8: nothing the
 * browser sends decides a price).
 *
 * The arithmetic is the pricing engine in lib/pricing.ts, the same one
 * /pulse/pricing and, later, checkout use. Nothing here adds to it.
 *
 * Server only: it reads the database. The page turns the result into words.
 */

/** The monthly and yearly amounts for the plan on file, from the engine. */
export type PlanEstimate = {
  band: Band;
  /** What a month would come to, in cents. Null for Enterprise, which has no self-serve amount. */
  monthlyCents: number | null;
  /** What a year would come to, in cents. Null for Enterprise. */
  yearlyCents: number | null;
  /** Everything the clinic would get, which is more than it picked when the full library is included. */
  entitledCategories: Category[];
  fullLibrary: boolean;
  /** The engine's own plain sentences about this quote. */
  notes: string[];
  /** True when no pricing version is active yet and the built-in defaults were used. Shown as an estimate either way. */
  fromDefaults: boolean;
};

export type BillingView = {
  plan: ClinicPlan;
  /** True when the plan has at least one category and one surgeon seat. */
  hasPlan: boolean;
  /** Null when there is no plan to estimate, or when the estimate could not be worked out (see `problem`). */
  estimate: PlanEstimate | null;
  /** Why there is no estimate for a clinic that does have a plan, in plain words. Null when there is one, or no plan. */
  problem: string | null;
};

/**
 * The billing view for one clinic, or null for an unknown id.
 *
 * A pricing problem (a damaged version, a pin that points nowhere) is
 * logged on the server and turned into a plain sentence, never thrown at
 * the page: the office manager still sees their plan, just no number.
 */
export async function getBillingView(clinicId: string): Promise<BillingView | null> {
  const plan = await getClinicPlan(clinicId);
  if (!plan) return null;

  const hasPlan = plan.categories.length > 0 && plan.surgeonSeats > 0;
  if (!hasPlan) return { plan, hasPlan, estimate: null, problem: null };

  // The estimate is the secondary thing on the page: the plan still shows
  // when the prices cannot be read. A PricingError (a damaged version, a
  // pin that points nowhere) and a database error (for instance a preview
  // whose database is behind on migrations) both become the same plain
  // sentence, with the detail in the server log.
  let pricing;
  try {
    pricing = await getPricingForClinic(clinicId);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`Billing estimate for clinic ${clinicId}: ${detail}`);
    return { plan, hasPlan, estimate: null, problem: "We could not work out an estimate right now. Your plan is unchanged." };
  }

  // The clinic's own categories are what it may be quoted for here: this is
  // the plan it already has, not a new purchase, so the sale switches on
  // /pulse/videos do not apply.
  const ask = (interval: "month" | "year") =>
    quote(pricing.config, {
      seats: plan.surgeonSeats,
      categories: plan.categories,
      interval,
      founding: false,
      practiceType: "clinic",
      sellable: plan.categories,
    });

  const monthly = ask("month");
  const yearly = ask("year");

  // The engine refuses input it cannot quote (it should not happen for a
  // plan staff set, but the page must not crash if it does).
  const cannotQuote = "We could not work out an estimate for this plan. Your plan is unchanged.";
  if (!monthly.ok) {
    console.error(`Billing estimate for clinic ${clinicId}: ${monthly.error}`);
    return { plan, hasPlan, estimate: null, problem: cannotQuote };
  }
  if (!yearly.ok) {
    console.error(`Billing estimate for clinic ${clinicId}: ${yearly.error}`);
    return { plan, hasPlan, estimate: null, problem: cannotQuote };
  }

  return {
    plan,
    hasPlan,
    problem: null,
    estimate: {
      band: monthly.quote.band,
      monthlyCents: monthly.quote.amounts?.totalCents ?? null,
      yearlyCents: yearly.quote.amounts?.totalCents ?? null,
      entitledCategories: monthly.quote.entitledCategories,
      fullLibrary: monthly.quote.fullLibrary,
      notes: monthly.quote.notes,
      fromDefaults: pricing.source.kind === "estimate",
    },
  };
}
