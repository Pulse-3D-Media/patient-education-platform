"use client";

import type { Category } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { INPUT, LABEL, PRIMARY_BUTTON, SECONDARY_BUTTON } from "@/components/ui/styles";
import { CATEGORIES, availabilityLabel, type CategoryAvailability } from "@/lib/categories";
import {
  CATEGORY_COUNT,
  CATEGORY_VALUES,
  DEFAULT_PRICING_CONFIG,
  bpToPercentText,
  centsToDollarsText,
  formatBp,
  formatCents,
  parseDollarsToCents,
  parsePercentToBp,
  quote,
  validatePricingConfig,
  type FieldError,
  type Interval,
  type PracticeType,
  type PricingConfig,
} from "@/lib/pricing";
import { activatePricingVersionAction, savePricingVersionAction, type PricingSaveResult } from "../actions";
import { Outcome, SaveButton } from "../FormBits";

/**
 * The pricing editor, calculator and version history, all in one client
 * component because they share one thing: the draft.
 *
 * The draft is the numbers as typed, kept as text so nothing is rounded or
 * reformatted under the staff member's fingers. Every render turns the
 * draft into a config (or a list of what is wrong, shown beside the fields)
 * and the calculator quotes from that config live, using the very same
 * engine the server uses. Saving sends the config to the server, which
 * checks it again; a failed save leaves the draft exactly as it was.
 */

/** One saved version, as the page hands it over. */
export type EditorVersion = {
  id: string;
  version: number;
  note: string;
  createdText: string;
  createdByName: string;
  active: boolean;
  /** Null when the stored config fails the check; `problem` then says why. */
  config: PricingConfig | null;
  problem: string | null;
};

/**
 * Which prices a quote made right now would use. The active version comes
 * with its config, so the editor can open on it whether or not it is among
 * the versions the bounded history shows.
 */
export type EstimateSource =
  | { kind: "version"; version: number; config: PricingConfig }
  | { kind: "estimate" }
  | { kind: "problem"; message: string };

/** The numbers as typed. Text, so "59." and "59.0" stay as they are while typing. */
type Draft = {
  /** The ladder, one price per number of categories, as dollars text. */
  perSeatByCount: string[];
  fullLibraryFrom: string;
  yearlyMonths: string;
  foundingDiscount: string;
  soloMax: string;
  clinicMax: string;
};

/** What the calculator is asked. */
type Calc = {
  seats: string;
  categories: Category[];
  interval: Interval;
  founding: boolean;
  practiceType: PracticeType;
};

function draftFromConfig(config: PricingConfig): Draft {
  return {
    perSeatByCount: config.perSeatByCountCents.map(centsToDollarsText),
    fullLibraryFrom: config.fullLibraryFrom === null ? "" : String(config.fullLibraryFrom),
    yearlyMonths: String(config.yearlyMonths),
    foundingDiscount: bpToPercentText(config.foundingDiscountBp),
    soloMax: String(config.seats.soloMax),
    clinicMax: String(config.seats.clinicMax),
  };
}

/** A whole number from an input box, or NaN so the validator reports it. */
function wholeNumberOrNaN(text: string): number {
  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : Number.NaN;
}

/**
 * The draft as a config, plus everything wrong with it. A field that
 * cannot be read at all ("abc" for a price) gets a reading error here and
 * is handed to the validator as NaN; the validator's own message for that
 * field is then dropped in favour of the reading error, so each field shows
 * one sentence.
 */
function configFromDraft(draft: Draft): { config: PricingConfig | null; errors: FieldError[] } {
  const readingErrors: FieldError[] = [];

  const perSeatByCountCents = draft.perSeatByCount.map((text, index) => {
    const cents = parseDollarsToCents(text);
    if (cents === null) readingErrors.push({ field: `perSeatByCountCents.${index}`, message: "Enter a dollar amount, like 89 or 89.00." });
    return cents ?? Number.NaN;
  });

  const foundingBp = parsePercentToBp(draft.foundingDiscount);
  if (foundingBp === null) readingErrors.push({ field: "foundingDiscountBp", message: "Enter a percentage, like 10, or 0 for no offer." });

  const candidate = {
    currency: "usd",
    perSeatByCountCents,
    fullLibraryFrom: draft.fullLibraryFrom.trim() === "" ? null : wholeNumberOrNaN(draft.fullLibraryFrom),
    yearlyMonths: wholeNumberOrNaN(draft.yearlyMonths),
    foundingDiscountBp: foundingBp ?? Number.NaN,
    seats: { soloMax: wholeNumberOrNaN(draft.soloMax), clinicMax: wholeNumberOrNaN(draft.clinicMax) },
  };

  const checked = validatePricingConfig(candidate);
  if (checked.ok && readingErrors.length === 0) return { config: checked.config, errors: [] };

  const alreadyReported = new Set(readingErrors.map((error) => error.field));
  const validatorErrors = checked.ok ? [] : checked.errors.filter((error) => !alreadyReported.has(error.field));
  return { config: null, errors: [...readingErrors, ...validatorErrors] };
}

const BAND_WORDS = { solo: "Solo", clinic: "Clinic", enterprise: "Enterprise" } as const;

/** The name of a version in the "quoting from" line. */
function versionWords(version: EditorVersion) {
  return `version ${version.version}${version.active ? " (active)" : ""}`;
}

/** "1 category" or "3 categories". */
function countWords(count: number) {
  return `${count} ${count === 1 ? "category" : "categories"}`;
}

export function PricingEditor({
  versions,
  availability,
  source,
}: {
  versions: EditorVersion[];
  availability: Record<Category, CategoryAvailability>;
  source: EstimateSource;
}) {
  const router = useRouter();

  // The editor opens on the active version's numbers, or the built-in
  // defaults when nothing is active yet. The active config comes with the
  // source line, not out of the history list: the history is bounded, and
  // an active version older than what it shows must still be what the
  // editor starts from, so the page never says one version is active while
  // the editor holds another.
  const opening =
    source.kind === "version"
      ? { config: source.config, from: `version ${source.version} (active)` }
      : { config: DEFAULT_PRICING_CONFIG, from: "the built-in defaults" };
  const [draft, setDraft] = useState<Draft>(() => draftFromConfig(opening.config));
  const [loadedFrom, setLoadedFrom] = useState(opening.from);
  const [note, setNote] = useState("");
  const [saveState, setSaveState] = useState<PricingSaveResult | null>(null);
  const [saving, startSaving] = useTransition();

  const sellable = CATEGORY_VALUES.filter((category) => availability[category] === "sellable");
  const [calc, setCalc] = useState<Calc>({
    seats: "1",
    categories: sellable.slice(0, 1),
    interval: "month",
    founding: false,
    practiceType: "clinic",
  });

  const parsed = configFromDraft(draft);
  // Errors the server sent back stay beside the fields until the draft is edited again.
  const serverErrors = saveState && "fieldErrors" in saveState ? (saveState.fieldErrors ?? []) : [];
  const errors = [...parsed.errors, ...serverErrors.filter((server) => !parsed.errors.some((own) => own.field === server.field))];
  const errorFor = (field: string) => errors.find((error) => error.field === field)?.message;

  const seats = /^\d+$/.test(calc.seats.trim()) ? Number(calc.seats.trim()) : Number.NaN;
  const result = parsed.config
    ? quote(parsed.config, { seats, categories: calc.categories, interval: calc.interval, founding: calc.founding, practiceType: calc.practiceType, sellable })
    : null;

  /** Change one field of the draft, and forget what the server said about the last save. */
  function edit(change: (draft: Draft) => Draft) {
    setDraft(change);
    setSaveState(null);
    setLoadedFrom((from) => (from.endsWith(", edited") ? from : `${from}, edited`));
  }

  function load(config: PricingConfig, from: string) {
    setDraft(draftFromConfig(config));
    setLoadedFrom(from);
    setSaveState(null);
  }

  function save() {
    if (!parsed.config) {
      setSaveState({ error: "Some of the numbers are not right. See the fields marked below." });
      return;
    }
    const config = parsed.config;
    startSaving(async () => {
      const outcome = await savePricingVersionAction({ config, note });
      setSaveState(outcome);
      if ("ok" in outcome) {
        setNote("");
        setLoadedFrom(`version ${outcome.version}`);
        router.refresh();
      }
    });
  }

  function toggleCategory(category: Category) {
    setCalc((current) => ({
      ...current,
      categories: current.categories.includes(category)
        ? current.categories.filter((c) => c !== category)
        : [...current.categories, category],
    }));
  }

  const saveOutcome = saveState === null ? null : "ok" in saveState ? { ok: saveState.ok } : { error: saveState.error };

  return (
    <div className="flex flex-col gap-8">
      <SourceLine source={source} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        {/* The editor */}
        <div className="flex flex-col gap-6">
          <section className="rounded-2xl border border-white/10 bg-[#0d1113] p-5 sm:p-6">
            <h2 className="text-lg font-semibold">Price per surgeon seat, per month, by number of categories</h2>
            <p className="mt-1 text-sm text-[#bfbfbf]">
              Loaded from {loadedFrom}. One price for each number of categories, whichever categories they are. The example
              column is one seat for one month, treating every category as for sale, so it shows where the full library
              starts.
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[420px] text-left text-[15px]">
                <thead className="text-xs uppercase tracking-wider text-[#667085]">
                  <tr className="border-b border-white/10">
                    <th className="py-2 pr-3 font-medium">Categories</th>
                    <th className="py-2 pr-3 font-medium">Price per seat</th>
                    <th className="py-2 font-medium">Example, per seat per month</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.perSeatByCount.map((text, index) => {
                    const field = `perSeatByCountCents.${index}`;
                    const count = index + 1;
                    const example = parsed.config
                      ? quote(parsed.config, {
                          seats: 1,
                          categories: CATEGORY_VALUES.slice(0, count),
                          interval: "month",
                          founding: false,
                          practiceType: "clinic",
                          sellable: CATEGORY_VALUES,
                        })
                      : null;
                    return (
                      <tr key={field} className="border-b border-white/5 last:border-b-0">
                        <td className="py-2 pr-3">{countWords(count)}</td>
                        <td className="py-2 pr-3">
                          <div className="relative w-36">
                            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[#667085]">$</span>
                            <input
                              id={field}
                              inputMode="decimal"
                              aria-label={`Price per seat for ${countWords(count)}`}
                              value={text}
                              onChange={(event) =>
                                edit((d) => ({ ...d, perSeatByCount: d.perSeatByCount.map((t, i) => (i === index ? event.target.value : t)) }))
                              }
                              aria-invalid={Boolean(errorFor(field))}
                              className={`${INPUT} pl-7 text-right`}
                            />
                          </div>
                          <FieldNote message={errorFor(field)} />
                        </td>
                        <td className="py-2 text-[#bfbfbf]">
                          {example?.ok && example.quote.amounts
                            ? `${formatCents(example.quote.amounts.perSeatCents)}${example.quote.fullLibrary ? " (full library)" : ""}`
                            : "–"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-[#0d1113] p-5 sm:p-6">
            <h2 className="text-lg font-semibold">Offers and limits</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="fullLibraryFrom" className={LABEL}>
                  Full library from this many categories
                </label>
                <select
                  id="fullLibraryFrom"
                  value={draft.fullLibraryFrom}
                  onChange={(event) => edit((d) => ({ ...d, fullLibraryFrom: event.target.value }))}
                  className={INPUT}
                >
                  <option value="">No full-library offer</option>
                  {Array.from({ length: CATEGORY_COUNT - 1 }, (_, i) => i + 2).map((count) => (
                    <option key={count} value={String(count)}>
                      {count} categories
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-[#667085]">
                  Taking this many buys every category at that count&rsquo;s price. Only offered while every category is for
                  sale.
                </p>
                <FieldNote message={errorFor("fullLibraryFrom")} />
              </div>
              <div>
                <label htmlFor="yearlyMonths" className={LABEL}>
                  A year costs this many months
                </label>
                <input
                  id="yearlyMonths"
                  inputMode="numeric"
                  value={draft.yearlyMonths}
                  onChange={(event) => edit((d) => ({ ...d, yearlyMonths: event.target.value }))}
                  aria-invalid={Boolean(errorFor("yearlyMonths"))}
                  className={INPUT}
                />
                <p className="mt-1 text-xs text-[#667085]">10 means two months free on a yearly plan.</p>
                <FieldNote message={errorFor("yearlyMonths")} />
              </div>
              <div>
                <label htmlFor="foundingDiscountBp" className={LABEL}>
                  Founding offer
                </label>
                <div className="relative">
                  <input
                    id="foundingDiscountBp"
                    inputMode="decimal"
                    value={draft.foundingDiscount}
                    onChange={(event) => edit((d) => ({ ...d, foundingDiscount: event.target.value }))}
                    aria-invalid={Boolean(errorFor("foundingDiscountBp"))}
                    className={`${INPUT} pr-8`}
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[#667085]">%</span>
                </div>
                <p className="mt-1 text-xs text-[#667085]">
                  0 means no offer. A number here is for modelling: giving it to a customer needs a written rule for who
                  qualifies and for how long, before checkout is built.
                </p>
                <FieldNote message={errorFor("foundingDiscountBp")} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="seats.soloMax" className={LABEL}>
                    Solo up to
                  </label>
                  <input
                    id="seats.soloMax"
                    inputMode="numeric"
                    value={draft.soloMax}
                    onChange={(event) => edit((d) => ({ ...d, soloMax: event.target.value }))}
                    aria-invalid={Boolean(errorFor("seats.soloMax"))}
                    className={INPUT}
                  />
                  <FieldNote message={errorFor("seats.soloMax")} />
                </div>
                <div>
                  <label htmlFor="seats.clinicMax" className={LABEL}>
                    Clinic up to
                  </label>
                  <input
                    id="seats.clinicMax"
                    inputMode="numeric"
                    value={draft.clinicMax}
                    onChange={(event) => edit((d) => ({ ...d, clinicMax: event.target.value }))}
                    aria-invalid={Boolean(errorFor("seats.clinicMax"))}
                    className={INPUT}
                  />
                  <FieldNote message={errorFor("seats.clinicMax")} />
                </div>
                <p className="col-span-2 text-xs text-[#667085]">Surgeon seats. Above the Clinic limit, or any hospital, is Enterprise.</p>
              </div>
            </div>
            <FieldNote message={errorFor("currency") ?? errorFor("config") ?? errorFor("perSeatByCountCents") ?? errorFor("seats")} />
          </section>

          <section className="rounded-2xl border border-[#2a829b]/40 bg-[#0d1113] p-5 sm:p-6">
            <h2 className="text-lg font-semibold">Save as a new version</h2>
            <p className="mt-1 text-sm text-[#bfbfbf]">
              Saving keeps every earlier version as it was. The new version does nothing until you make it active in the
              history below.
            </p>
            <div className="mt-4">
              <label htmlFor="note" className={LABEL}>
                What changed and why (required, kept with the version)
              </label>
              <input
                id="note"
                value={note}
                maxLength={300}
                onChange={(event) => {
                  setNote(event.target.value);
                  setSaveState(null);
                }}
                placeholder="Two categories up to $95 after the Britz meeting"
                className={INPUT}
              />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button type="button" onClick={save} disabled={saving} className={`${PRIMARY_BUTTON} h-11`}>
                {saving ? "Saving..." : "Save as a new version"}
              </button>
              <button
                type="button"
                onClick={() => load(DEFAULT_PRICING_CONFIG, "the built-in defaults")}
                className={`${SECONDARY_BUTTON} h-11`}
              >
                Reset to the built-in defaults
              </button>
              <Outcome state={saveOutcome} />
            </div>
          </section>
        </div>

        {/* The calculator */}
        <aside className="rounded-2xl border border-white/10 bg-[#0d1113] p-5 sm:p-6 lg:sticky lg:top-16">
          <h2 className="text-lg font-semibold">Calculator</h2>
          <p className="mt-1 text-sm text-[#bfbfbf]">
            Quoting from {loadedFrom.endsWith(", edited") ? "the unsaved numbers in the editor" : loadedFrom}.
          </p>

          <div className="mt-4 flex flex-col gap-4">
            <div>
              <span className={LABEL}>Practice</span>
              <div className="flex gap-2">
                <Choice on={calc.practiceType === "clinic"} onClick={() => setCalc((c) => ({ ...c, practiceType: "clinic" }))}>
                  Clinic
                </Choice>
                <Choice on={calc.practiceType === "hospital"} onClick={() => setCalc((c) => ({ ...c, practiceType: "hospital" }))}>
                  Hospital
                </Choice>
              </div>
            </div>
            <div>
              <label htmlFor="calcSeats" className={LABEL}>
                Surgeon seats
              </label>
              <input
                id="calcSeats"
                inputMode="numeric"
                value={calc.seats}
                onChange={(event) => setCalc((c) => ({ ...c, seats: event.target.value }))}
                className={`${INPUT} w-28`}
              />
            </div>
            <div>
              <span className={LABEL}>Categories</span>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((category) => {
                  const forSale = availability[category.value] === "sellable";
                  const label = availabilityLabel(availability[category.value]);
                  return (
                    <Choice
                      key={category.value}
                      on={calc.categories.includes(category.value)}
                      disabled={!forSale}
                      onClick={() => toggleCategory(category.value)}
                    >
                      {category.label}
                      {label && <span className="ml-1 text-xs opacity-70">({label})</span>}
                    </Choice>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-wrap gap-4">
              <div>
                <span className={LABEL}>Billed</span>
                <div className="flex gap-2">
                  <Choice on={calc.interval === "month"} onClick={() => setCalc((c) => ({ ...c, interval: "month" }))}>
                    Monthly
                  </Choice>
                  <Choice on={calc.interval === "year"} onClick={() => setCalc((c) => ({ ...c, interval: "year" }))}>
                    Yearly
                  </Choice>
                </div>
              </div>
              <label className="flex min-h-11 cursor-pointer items-center gap-2 self-end">
                <input
                  type="checkbox"
                  checked={calc.founding}
                  onChange={(event) => setCalc((c) => ({ ...c, founding: event.target.checked }))}
                  className="h-5 w-5 accent-[#2a829b]"
                />
                <span className="text-[15px]">Model the founding offer</span>
              </label>
            </div>
          </div>

          <div className="mt-5 border-t border-white/10 pt-4">
            {!parsed.config ? (
              <p className="text-sm text-[#f3b94d]">Fix the numbers marked in the editor to see a quote.</p>
            ) : !result || !result.ok ? (
              <p className="text-sm text-[#f3b94d]">{result?.ok === false ? result.error : "Choose a category."}</p>
            ) : (
              <QuoteView quote={result.quote} />
            )}
          </div>
        </aside>
      </div>

      {/* The history */}
      <section>
        <h2 className="text-xl font-semibold">Versions</h2>
        <p className="mt-1 max-w-2xl text-[#bfbfbf]">
          Every set of prices ever saved, newest first. One is active at a time. Making an older one active does not change
          what any clinic already on a version pays.
        </p>
        {versions.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-dashed border-white/15 p-6 text-[#bfbfbf]">
            No versions saved yet. Quotes use the built-in defaults until one is saved and made active.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-[#0d1113]">
            <table className="w-full min-w-[760px] text-left text-[15px]">
              <thead className="text-xs uppercase tracking-wider text-[#667085]">
                <tr className="border-b border-white/10">
                  <th className="px-4 py-3 font-medium">Version</th>
                  <th className="px-4 py-3 font-medium">Note</th>
                  <th className="px-4 py-3 font-medium">Saved</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((version) => (
                  <tr key={version.id} className="border-b border-white/5 last:border-b-0">
                    <td className="px-4 py-3 font-medium">{version.version}</td>
                    <td className="px-4 py-3 text-[#bfbfbf]">{version.note}</td>
                    <td className="px-4 py-3 text-[#bfbfbf]">
                      {version.createdText}
                      <span className="block text-sm text-[#667085]">{version.createdByName}</span>
                    </td>
                    <td className="px-4 py-3">
                      {/* A damaged config is said first, even on the active row: that is the one that matters most. */}
                      <div className="flex flex-wrap items-center gap-2">
                        {version.active && (
                          <span className="rounded-md bg-[#2a829b]/20 px-2 py-0.5 text-[13px] font-medium uppercase tracking-wide text-[#5fb8d4]">
                            Active
                          </span>
                        )}
                        {version.problem ? (
                          <span className="text-sm text-[#f3b94d]" title={version.problem}>
                            Stored config is not valid
                          </span>
                        ) : (
                          !version.active && <span className="text-[#667085]">Saved</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {version.config && (
                          <button
                            type="button"
                            onClick={() => load(version.config as PricingConfig, versionWords(version))}
                            className={SECONDARY_BUTTON}
                          >
                            Load into editor
                          </button>
                        )}
                        {version.config && !version.active && <ActivateForm version={version} />}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** The line at the top saying which prices a quote made right now would use. */
function SourceLine({ source }: { source: EstimateSource }) {
  if (source.kind === "problem") {
    return (
      <p role="alert" className="rounded-xl border border-[#f3b94d]/50 bg-[#f3b94d]/10 px-4 py-3 text-[15px] text-[#f3b94d]">
        {source.message}
      </p>
    );
  }
  return (
    <p className="rounded-xl border border-white/10 bg-[#0d1113] px-4 py-3 text-[15px] text-[#bfbfbf]">
      {source.kind === "version" ? (
        <>
          <span className="font-medium text-white">Version {source.version} is active.</span> New quotes use it.
        </>
      ) : (
        <>
          <span className="font-medium text-white">No version is active yet.</span> Quotes use the built-in defaults, which
          are an estimate until a version is saved and made active.
        </>
      )}
    </p>
  );
}

/**
 * One small form per history row, so each "Make active" reports under its
 * own button. Making a version active changes the prices every new quote,
 * and every clinic not pinned to a version, will get, so the button does
 * not send on the first click: it opens the confirmation below, which
 * names the version and says what happens, and only the "Yes" button in
 * it submits. That is a courtesy against a slip of the hand. The real
 * protection is on the server (Pulse staff only) and in the database (at
 * most one active row).
 */
function ActivateForm({ version }: { version: EditorVersion }) {
  const [state, action, pending] = useActionState(activatePricingVersionAction, null);
  const [confirming, setConfirming] = useState(false);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="versionId" value={version.id} />
      {confirming ? (
        <ActivationConfirmation version={version.version} pending={pending} onCancel={() => setConfirming(false)} />
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className={SECONDARY_BUTTON}>
          Make active
        </button>
      )}
      <Outcome state={state} />
    </form>
  );
}

/**
 * The question asked before a version is made active. Rendered inside the
 * row's form, so "Yes" is that form's submit button. Exported so the
 * wording can be tested on its own.
 */
export function ActivationConfirmation({ version, pending, onCancel }: { version: number; pending: boolean; onCancel: () => void }) {
  const titleId = `activate-${version}-title`;
  return (
    <div role="alertdialog" aria-labelledby={titleId} className="max-w-md rounded-xl border border-[#2a829b]/50 bg-[#2a829b]/10 p-4">
      <p id={titleId} className="font-medium text-white">
        Make version {version} active?
      </p>
      <p className="mt-1 text-sm text-[#bfbfbf]">
        From then on every new quote, and every clinic not pinned to a version, uses version {version}&rsquo;s prices. A
        clinic pinned to a version keeps the prices it signed up at.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <SaveButton pending={pending} label={`Yes, make version ${version} active`} />
        <button type="button" onClick={onCancel} disabled={pending} className={SECONDARY_BUTTON}>
          No, leave it as it is
        </button>
      </div>
    </div>
  );
}

/** A tappable option in the calculator: a chip that is either on or off. */
function Choice({
  on,
  disabled,
  onClick,
  children,
}: {
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={`inline-flex h-11 items-center rounded-lg border px-3 text-[15px] transition disabled:cursor-not-allowed disabled:opacity-40 ${
        on ? "border-[#2a829b] bg-[#2a829b]/20 text-white" : "border-white/15 text-[#bfbfbf] hover:border-[#2a829b] hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

/** The one sentence under a field when something is wrong with it. */
function FieldNote({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-1 text-sm text-[#f3b94d]">
      {message}
    </p>
  );
}

/** The quote, laid out like a receipt. */
function QuoteView({ quote: q }: { quote: NonNullable<ReturnType<typeof quote> extends infer R ? (R extends { ok: true; quote: infer Q } ? Q : never) : never> }) {
  const per = q.amounts?.interval === "year" ? "year" : "month";
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        <span className="rounded-md bg-white/10 px-2 py-0.5 text-[13px] font-medium uppercase tracking-wide text-[#bfbfbf]">
          {BAND_WORDS[q.band]}
        </span>
      </p>

      {q.amounts ? (
        <>
          <ul className="flex flex-col gap-1 text-[15px]">
            {q.amounts.lines.map((line) => (
              <li key={line.label} className="flex justify-between gap-3">
                <span className="text-[#bfbfbf]">{line.label}</span>
                <span>{formatCents(line.cents)}</span>
              </li>
            ))}
            {q.amounts.foundingDiscountBp > 0 && (
              <li className="flex justify-between gap-3 text-[#bfbfbf]">
                <span>Founding offer: {formatBp(q.amounts.foundingDiscountBp)} off</span>
              </li>
            )}
            <li className="flex justify-between gap-3 border-t border-white/10 pt-1 font-medium">
              <span>Per seat, per {per}</span>
              <span>{formatCents(q.amounts.perSeatCents)}</span>
            </li>
            <li className="flex justify-between gap-3 text-lg font-semibold">
              <span>
                {q.amounts.seats} {q.amounts.seats === 1 ? "seat" : "seats"}, per {per}
              </span>
              <span className="text-[#5fb8d4]">{formatCents(q.amounts.totalCents)}</span>
            </li>
          </ul>
          {q.amounts.monthlyEquivalentCents !== null && (
            <p className="text-sm text-[#667085]">
              About {formatCents(q.amounts.monthlyEquivalentCents)} a month, for comparison only. The year is charged as one
              amount.
            </p>
          )}
          {q.amounts.savingsCents > 0 && (
            <p className="text-sm text-[#667085]">The founding offer saves {formatCents(q.amounts.savingsCents)}.</p>
          )}
          <p className="text-sm text-[#bfbfbf]">
            Includes: {q.entitledCategories.map((category) => CATEGORIES.find((c) => c.value === category)?.label ?? category).join(", ")}.
          </p>
        </>
      ) : null}

      {q.notes.map((note) => (
        <p key={note} className="text-sm text-[#bfbfbf]">
          {note}
        </p>
      ))}
    </div>
  );
}
