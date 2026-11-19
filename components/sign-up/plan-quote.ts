import { engineInterval } from "@/lib/checkout-rules";
import { quote, type PricingConfig, type Quote } from "@/lib/pricing";
import type { PlanInAddress } from "@/lib/sign-up-steps";
// A type only, so nothing of that server file reaches the browser.
import type { CategoryOption } from "@/app/admin/billing/checkout-view";

/**
 * What a plan comes to, worked out with the same pricing engine and the same
 * inputs as the Billing page's plan picker (app/admin/billing/PlanPicker.tsx).
 * Safe for the browser: the plan step uses it for the total while picking,
 * and the payment page uses it on the server for the total it shows.
 *
 * Neither is ever charged because it was shown: the checkout behind the Pay
 * button works the price out again from the server's own numbers, and
 * refuses to start if it differs from the total that was on screen (rule 8).
 */
export function quotePlan(config: PricingConfig, options: CategoryOption[], plan: PlanInAddress): Quote | null {
  if (plan.categories.length === 0 || plan.seats < 1) return null;
  const sellable = options.filter((option) => option.availability === "sellable").map((option) => option.value);
  const labels = Object.fromEntries(options.map((option) => [option.value, option.label]));
  const library = {
    all: options.map((option) => option.value),
    comingSoon: options.filter((option) => option.availability === "coming-soon").map((option) => option.value),
  };
  const result = quote(config, {
    seats: plan.seats,
    categories: plan.categories,
    interval: engineInterval(plan.interval),
    // No founding offer is approved, so none is ever applied.
    founding: false,
    // Hospitals never reach the sign-up steps (only Pulse staff mark one, and they pay by agreement).
    practiceType: "clinic",
    sellable,
    labels,
    library,
  });
  return result.ok ? result.quote : null;
}

/** "Knee, Shoulder, Hip" from a plan's categories, in the names the server handed down. */
export function categoryNames(options: CategoryOption[], categories: string[]): string {
  return options
    .filter((option) => categories.includes(option.value))
    .map((option) => option.label)
    .join(", ");
}
