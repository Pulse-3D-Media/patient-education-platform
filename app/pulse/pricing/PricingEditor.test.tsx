import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CATEGORY_VALUES, DEFAULT_PRICING_CONFIG, type PricingConfig } from "@/lib/pricing";
import { PricingEditor, type EditorVersion } from "./PricingEditor";

/**
 * The pricing editor rendered on the server, the way the page first paints
 * it, with no Clerk and no database: the router and the Server Actions are
 * stand-ins. This checks that the page opens on the right numbers and
 * that the calculator and the example column quote from the same engine
 * the server uses. Typing, saving and Make active need a signed-in
 * browser and are checked on the preview.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("../actions", () => ({ savePricingVersionAction: vi.fn(), activatePricingVersionAction: vi.fn() }));

const ALL_SELLABLE = Object.fromEntries(CATEGORY_VALUES.map((category) => [category, "sellable"])) as Record<
  (typeof CATEGORY_VALUES)[number],
  "sellable" | "not-for-sale" | "coming-soon"
>;

function version(overrides: Partial<EditorVersion> & { config: PricingConfig | null }): EditorVersion {
  return {
    id: "v_1",
    version: 1,
    note: "First prices",
    createdText: "Sep 11, 2026, 7:00 PM",
    createdByName: "Evan Miller",
    active: false,
    problem: null,
    ...overrides,
  };
}

describe("PricingEditor", () => {
  it("opens on the built-in defaults when nothing is active, and says so", () => {
    const html = renderToStaticMarkup(<PricingEditor versions={[]} availability={ALL_SELLABLE} source={{ kind: "estimate" }} />);
    expect(html).toContain("No version is active yet.");
    expect(html).toContain("Loaded from the built-in defaults");
    // The example column: the exact cents for one to five categories, and the full library at five and six.
    for (const text of ["$59.00", "$88.97", "$109.03", "$125.08", "$138.95 (full library)"]) expect(html).toContain(text);
    // The calculator starts at one seat and the first category for sale, quoted from the same engine.
    expect(html).toContain("Quoting from the built-in defaults");
    expect(html).toContain("1 seat, per month");
    expect(html).toContain("No versions saved yet.");
  });

  it("opens on the active version's numbers and lists the history with Make active on the others", () => {
    const active = version({ id: "v_2", version: 2, note: "Knee to $65", active: true, config: { ...DEFAULT_PRICING_CONFIG, perSeatCents: { ...DEFAULT_PRICING_CONFIG.perSeatCents, KNEE: 6500 } } });
    const older = version({ id: "v_1", version: 1, config: DEFAULT_PRICING_CONFIG });
    const html = renderToStaticMarkup(
      <PricingEditor versions={[active, older]} availability={ALL_SELLABLE} source={{ kind: "version", version: 2 }} />,
    );
    expect(html).toContain("Version 2 is active.");
    expect(html).toContain("Loaded from version 2 (active)");
    expect(html).toContain('value="65.00"');
    expect(html).toContain("Knee to $65");
    // Exactly one Make active button: the older version. The active one has none.
    expect(html.match(/Make active/g)).toHaveLength(1);
    expect(html.match(/Load into editor/g)).toHaveLength(2);
  });

  it("labels categories that cannot be bought and keeps them out of the calculator", () => {
    const availability = { ...ALL_SELLABLE, COMPLEX_SPINE: "coming-soon" as const, FOOT_ANKLE: "not-for-sale" as const };
    const html = renderToStaticMarkup(<PricingEditor versions={[]} availability={availability} source={{ kind: "estimate" }} />);
    expect(html).toContain("Coming soon");
    expect(html).toContain("Not for sale");
    // Two disabled buttons on the whole page: the calculator chips for the two categories that cannot be bought.
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });

  it("shows a damaged active version as a problem, not a crash, and marks the row", () => {
    const bad = version({ id: "v_9", version: 9, active: true, config: null, problem: "perSeatCents.KNEE: A whole number of cents" });
    const html = renderToStaticMarkup(
      <PricingEditor versions={[bad]} availability={ALL_SELLABLE} source={{ kind: "problem", message: "The active version, pricing version 9 (v_9), has a stored config that is not valid." }} />,
    );
    expect(html).toContain("pricing version 9 (v_9)");
    // The row says both: it is the active one, and its config is damaged.
    expect(html).toContain("Active");
    expect(html).toContain("Stored config is not valid");
    expect(html).not.toContain("Make active");
    // With nothing usable to load, the editor falls back to the defaults.
    expect(html).toContain("Loaded from the built-in defaults");
  });
});
