import { getCategoryAvailability } from "@/lib/db/category-config";
import { PricingError, getActivePricing, listPricingVersions } from "@/lib/db/pricing";
import { requirePulseStaff } from "@/lib/pulse";
import { formatDateTime } from "../ui";
import { PricingEditor, type EditorVersion, type EstimateSource } from "./PricingEditor";

/**
 * Pricing: the numbers behind every quote, edited here and saved as
 * versions.
 *
 * The page loads every saved version (newest first), which categories can
 * be bought right now, and which version is active. The editor
 * (PricingEditor.tsx) does the rest in the browser: a live calculator
 * quoting from the unsaved numbers, a note and "Save as a new version",
 * and the history with "Make active" on each row.
 *
 * Staff only. Rendered fresh on every request so a save is seen at once.
 */
export const dynamic = "force-dynamic";

export default async function PulsePricingPage() {
  await requirePulseStaff();

  const [versions, availability] = await Promise.all([listPricingVersions(), getCategoryAvailability()]);

  // Which prices a quote made right now would use, with the active config
  // itself so the editor opens on it even when the active version is older
  // than the bounded history shows. A damaged active version is shown as a
  // problem on the page rather than crashing it.
  let source: EstimateSource;
  try {
    const active = await getActivePricing();
    source =
      active.source.kind === "version"
        ? { kind: "version", version: active.source.version.version, config: active.config }
        : { kind: "estimate" };
  } catch (error) {
    if (!(error instanceof PricingError)) throw error;
    source = { kind: "problem", message: error.message };
  }

  const rows: EditorVersion[] = versions.map((version) => ({
    id: version.id,
    version: version.version,
    note: version.note,
    createdText: formatDateTime(version.createdAt),
    createdByName: version.createdByName,
    active: version.active,
    config: version.config,
    problem: version.problem,
  }));

  return (
    <main className="px-5 py-6 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <header>
          <h1 className="text-2xl font-semibold sm:text-3xl">Pricing</h1>
          <p className="mt-1 max-w-3xl text-[#bfbfbf]">
            The price ladder: one monthly price per surgeon seat for each number of categories a clinic takes, whichever
            categories they are, plus the full-library offer, the yearly rate and the seat limits. Change the numbers, check
            them in the calculator, then save them as a new version and make it active. Saving never changes an earlier
            version. Internal only: nothing here is shown to a clinic.
          </p>
        </header>
        <div className="mt-8">
          <PricingEditor versions={rows} availability={availability} source={source} />
        </div>
      </div>
    </main>
  );
}
