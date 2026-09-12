import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CATEGORY_VALUES, DEFAULT_PRICING_CONFIG, type PricingConfig } from "@/lib/pricing";
import { ActivationConfirmation, PricingEditor, type EditorVersion } from "./PricingEditor";

/**
 * The pricing editor rendered on the server, the way the page first paints
 * it, with no Clerk and no database: the router and the Server Actions are
 * stand-ins. This checks that the page opens on the right numbers and
 * that the calculator and the example column quote from the same engine
 * the server uses. Typing, saving and the click that opens the
 * activation confirmation need a signed-in browser and are checked on
 * the preview; the confirmation's wording is checked here on its own.
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
    for (const text of ["$59.00", "$89.00", "$109.00", "$125.00", "$139.00 (full library)"]) expect(html).toContain(text);
    // The calculator starts at one seat and the first category for sale, quoted from the same engine.
    expect(html).toContain("Quoting from the built-in defaults");
    expect(html).toContain("1 seat, per month");
    expect(html).toContain("No versions saved yet.");
  });

  it("opens on the active version's numbers and lists the history with Make active on the others", () => {
    const activeConfig = { ...DEFAULT_PRICING_CONFIG, perSeatByCountCents: [6500, ...DEFAULT_PRICING_CONFIG.perSeatByCountCents.slice(1)] };
    const active = version({ id: "v_2", version: 2, note: "One category to $65", active: true, config: activeConfig });
    const older = version({ id: "v_1", version: 1, config: DEFAULT_PRICING_CONFIG });
    const html = renderToStaticMarkup(
      <PricingEditor versions={[active, older]} availability={ALL_SELLABLE} source={{ kind: "version", version: 2, config: activeConfig }} />,
    );
    expect(html).toContain("Version 2 is active.");
    expect(html).toContain("Loaded from version 2 (active)");
    expect(html).toContain('value="65.00"');
    expect(html).toContain("One category to $65");
    // Exactly one Make active button: the older version. The active one has none.
    expect(html.match(/Make active/g)).toHaveLength(1);
    expect(html.match(/Load into editor/g)).toHaveLength(2);
    // Nothing is sent on the first click: the confirmation is closed until the button is pressed.
    expect(html).not.toContain("Make version 1 active?");
    expect(html).not.toContain("Yes, make version");
  });

  it("opens on the active version's numbers even when it is older than the history shows", () => {
    // The history is bounded. Here it holds only newer, inactive versions;
    // the active one (version 3, one category at $65) is not in the list at
    // all, and the editor must still start from it, not from the defaults.
    const activeConfig = { ...DEFAULT_PRICING_CONFIG, perSeatByCountCents: [6500, ...DEFAULT_PRICING_CONFIG.perSeatByCountCents.slice(1)] };
    const newer = [
      version({ id: "v_9", version: 9, note: "A later draft", config: DEFAULT_PRICING_CONFIG }),
      version({ id: "v_8", version: 8, note: "Another draft", config: DEFAULT_PRICING_CONFIG }),
    ];
    const html = renderToStaticMarkup(
      <PricingEditor versions={newer} availability={ALL_SELLABLE} source={{ kind: "version", version: 3, config: activeConfig }} />,
    );
    expect(html).toContain("Version 3 is active.");
    expect(html).toContain("Loaded from version 3 (active)");
    expect(html).toContain('value="65.00"');
    expect(html).not.toContain("Loaded from the built-in defaults");
    // Both listed versions can be made active, each after its own confirmation.
    expect(html.match(/Make active/g)).toHaveLength(2);
  });

  it("asks before a version is made active, naming the version and what changes", () => {
    const html = renderToStaticMarkup(<ActivationConfirmation version={7} pending={false} onCancel={() => undefined} />);
    expect(html).toContain("Make version 7 active?");
    // The consequence: new quotes and unpinned clinics move to it; a pinned clinic does not.
    expect(html).toContain("every new quote, and every clinic not pinned to a version, uses version 7");
    expect(html).toContain("keeps the prices it signed up at");
    // The only submit button is the yes. No is a plain button that closes the question.
    expect(html.match(/type="submit"/g)).toHaveLength(1);
    expect(html).toContain("Yes, make version 7 active");
    expect(html).toContain("No, leave it as it is");
    expect(html).toContain('role="alertdialog"');
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
    const bad = version({ id: "v_9", version: 9, active: true, config: null, problem: "perSeatByCountCents.1: A whole number of cents" });
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
