import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PRICING_CONFIG, quote, type QuoteAmounts } from "@/lib/pricing";
import type { CategoryOption } from "./checkout-view";
import { CategoryChoices, RunningTotal } from "./PlanFields";

/**
 * The running total and the category boxes on the Billing page's plan forms,
 * as the browser first draws them, with plain values (no database, no
 * Stripe). What these prove: the total is pinned to the bottom of the
 * screen, labelled an estimate, and says per seat and where the exact amount
 * is shown; with nothing to price it says so and shows no amount; and a
 * category where the paid plan and the library disagree says which way
 * beside its box. That the bar really stays in view while scrolling, and the
 * flash when the total changes, are browser checks. The whole page, with
 * the database, is in checkout-pages.test.tsx.
 */

/** Two categories at the default prices, three seats, monthly: $89 a seat, $267 in all. */
function amounts(): QuoteAmounts {
  const result = quote(DEFAULT_PRICING_CONFIG, {
    seats: 3,
    categories: ["KNEE", "HIP"],
    interval: "month",
    founding: false,
    practiceType: "clinic",
    sellable: ["KNEE", "HIP", "SPINE", "SHOULDER"],
  });
  if (!result.ok || !result.quote.amounts) throw new Error("The default prices should quote two categories.");
  return result.quote.amounts;
}

const bar = (props: Partial<Parameters<typeof RunningTotal>[0]> = {}) =>
  renderToStaticMarkup(<RunningTotal heading="Total" amounts={amounts()} tooManySeats={false} clinicMax={10} until="until you review the change" {...props} />);

describe("RunningTotal", () => {
  it("is pinned to the bottom of the screen, says Estimate, the total, the price per seat and where the exact amount is shown", () => {
    const html = bar();
    expect(html).toMatch(/data-running-total=""[^>]*class="sticky bottom-0/);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Estimate");
    expect(html).toContain("$267.00");
    expect(html).toContain("per month");
    expect(html).toContain("$89.00 per surgeon seat per month, times 3 seats.");
    expect(html).toContain("an estimate until you review the change.");
    // The number carries the class whose flash runs when it changes.
    expect(html).toMatch(/class="running-total[^"]*"[^>]*>\$267\.00/);
  });

  it("for a change, also says what the plan comes to now", () => {
    expect(bar({ heading: "New total", before: "Your plan now: $177.00 per month." })).toContain("Your plan now: $177.00 per month.");
    expect(bar()).not.toContain("Your plan now");
  });

  it("with nothing to price, says what to pick and shows no amount", () => {
    const html = bar({ amounts: null });
    expect(html).toContain("Pick at least one category and one surgeon seat to see the total.");
    expect(html).not.toMatch(/\$\d/);
  });

  it("with more seats than a card plan covers, points at Pulse 3D and shows no amount", () => {
    const html = bar({ tooManySeats: true });
    expect(html).toContain("More than 10 surgeon seats is set up by Pulse 3D by agreement");
    expect(html).not.toMatch(/\$\d/);
  });
});

describe("CategoryChoices: a word beside a category where the paid plan and the library disagree", () => {
  const options: CategoryOption[] = [
    { value: "KNEE", label: "Knee", availability: "sellable" },
    { value: "HIP", label: "Hip", availability: "sellable" },
    { value: "SHOULDER", label: "Shoulder", availability: "sellable" },
  ];
  const draw = (notes?: Parameters<typeof CategoryChoices>[0]["notes"]) =>
    renderToStaticMarkup(
      <CategoryChoices config={DEFAULT_PRICING_CONFIG} options={options} picked={["KNEE", "HIP"]} onToggle={vi.fn()} alreadyHas={["KNEE", "HIP"]} notes={notes} />,
    );

  it("says On your plan with no notes", () => {
    const html = draw();
    expect(html.match(/On your plan/g)).toHaveLength(2);
  });

  it("a note takes the place of the usual word, and only on its own category", () => {
    const html = draw({ HIP: "Paid for, off in your library", SHOULDER: "In your library, not paid for" });
    expect(html.match(/On your plan/g)).toHaveLength(1);
    expect(html).toContain("Paid for, off in your library");
    expect(html).toContain("In your library, not paid for");
  });
});
