import { Prisma } from "@prisma/client";
import { DEFAULT_PRICING_CONFIG, validatePricingConfig, type FieldError, type PricingConfig } from "../pricing";
import { prisma } from "./client";

/**
 * The PricingVersion table: every set of prices ever saved, and which one is
 * active. Server-side only; the arithmetic itself lives in lib/pricing.ts,
 * which is pure and safe for the browser.
 *
 * Versions are only ever added. Saving writes a new row with the next
 * number (handed out by the database, so two saves at the same moment
 * cannot share one) and never touches an older row. Activating a version
 * is the one update that ever happens to this table, and the database
 * itself guarantees at most one active version (see the schema).
 *
 * A stored config is checked again every time it is read. A config that
 * fails the check (someone edited the row by hand) is reported loudly and
 * never quietly replaced with another version's prices.
 *
 * Prices belong to Pulse 3D, not to a clinic, so nothing here takes a
 * clinicId except getPricingForClinic, which looks the clinic's pin up.
 */

/** Something is wrong with pricing itself: a corrupt row, a bad pin. Never a customer's fault. */
export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PricingError";
  }
}

/** One version as the history list shows it. */
export type PricingVersionSummary = {
  id: string;
  version: number;
  note: string;
  createdAt: Date;
  createdBy: string;
  createdByName: string;
  active: boolean;
};

/** One version with its prices. `config` is null, and `problem` says why, when the stored config fails the check. */
export type PricingVersionRow = PricingVersionSummary & {
  config: PricingConfig | null;
  problem: string | null;
};

/** Where a set of prices came from: a saved version (pinned to the clinic, or the active one), or the built-in estimate. */
export type PricingSource = { kind: "version"; version: PricingVersionSummary; pinned: boolean } | { kind: "estimate" };

/** Prices to quote with, and where they came from. */
export type CurrentPricing = { source: PricingSource; config: PricingConfig };

const VERSION_FIELDS = {
  id: true,
  version: true,
  config: true,
  note: true,
  createdAt: true,
  createdBy: true,
  createdByName: true,
  active: true,
} as const;

type VersionRecord = Prisma.PricingVersionGetPayload<{ select: typeof VERSION_FIELDS }>;

/** The most versions the history list shows. */
const HISTORY_LIMIT = 100;

/** "perSeatCents.KNEE: A whole number of cents..." for an error message. */
function describeErrors(errors: FieldError[]) {
  return errors.map((error) => `${error.field}: ${error.message}`).join("; ");
}

function summarize(row: VersionRecord): PricingVersionSummary {
  return {
    id: row.id,
    version: row.version,
    note: row.note,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    createdByName: row.createdByName,
    active: row.active === true,
  };
}

/** A row as the history shows it: its config when that passes the check, or the reason it does not. */
function toRow(row: VersionRecord): PricingVersionRow {
  const checked = validatePricingConfig(row.config);
  return {
    ...summarize(row),
    config: checked.ok ? checked.config : null,
    problem: checked.ok ? null : describeErrors(checked.errors),
  };
}

/** A row's config, or a PricingError naming the version. For the places that cannot carry on without one. */
function configOf(row: VersionRecord, what: string): PricingConfig {
  const checked = validatePricingConfig(row.config);
  if (!checked.ok) {
    throw new PricingError(
      `${what}, pricing version ${row.version} (${row.id}), has a stored config that is not valid: ${describeErrors(checked.errors)}. Nothing is quoted from it until the row is fixed.`,
    );
  }
  return checked.config;
}

/** Every saved version, newest first, up to the history limit. */
export async function listPricingVersions(): Promise<PricingVersionRow[]> {
  const rows = await prisma.pricingVersion.findMany({
    select: VERSION_FIELDS,
    orderBy: { version: "desc" },
    take: HISTORY_LIMIT,
  });
  return rows.map(toRow);
}

/** One version by id, or null for an unknown id. */
export async function getPricingVersion(id: string): Promise<PricingVersionRow | null> {
  const row = await prisma.pricingVersion.findUnique({ where: { id }, select: VERSION_FIELDS });
  return row ? toRow(row) : null;
}

/**
 * Save a new version. The config is checked first and refused with a
 * PricingError if it fails, so nothing invalid is ever stored. The new
 * version is not active; that is a separate step. Returns the row as saved.
 */
export async function createPricingVersion(
  config: unknown,
  note: string,
  staff: { userId: string; name: string },
): Promise<PricingVersionRow> {
  const checked = validatePricingConfig(config);
  if (!checked.ok) {
    throw new PricingError(`The config cannot be saved: ${describeErrors(checked.errors)}`);
  }
  const trimmedNote = note.trim();
  if (!trimmedNote) {
    throw new PricingError("A version needs a note saying what changed and why.");
  }

  const row = await prisma.pricingVersion.create({
    data: {
      config: checked.config as Prisma.InputJsonObject,
      note: trimmedNote,
      createdBy: staff.userId,
      createdByName: staff.name,
    },
    select: VERSION_FIELDS,
  });
  return toRow(row);
}

/** True for the "unique constraint failed" error Prisma raises when two rows would both hold active = true. */
function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Make one version the active one. The version's stored config is checked
 * first: a version that fails the check cannot be activated.
 *
 * The switch is one transaction: clear the active mark from whichever row
 * has it, then set it on this one. If two activations run at the same
 * moment, the unique constraint on the mark refuses the second one to
 * finish, and it is simply retried, so the end state is always exactly one
 * active version. Nothing about any clinic changes: a clinic pinned to an
 * older version keeps its pin.
 *
 * Throws a PricingError for an unknown id or an invalid config.
 */
export async function activatePricingVersion(id: string): Promise<PricingVersionRow> {
  const row = await prisma.pricingVersion.findUnique({ where: { id }, select: VERSION_FIELDS });
  if (!row) throw new PricingError(`No pricing version has the id "${id}".`);
  configOf(row, "The version to activate");

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const [, activated] = await prisma.$transaction([
        prisma.pricingVersion.updateMany({ where: { active: true }, data: { active: null } }),
        prisma.pricingVersion.update({ where: { id }, data: { active: true }, select: VERSION_FIELDS }),
      ]);
      return toRow(activated);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * The prices to quote with right now: the active version, or, while no
 * version has been made active, the built-in defaults marked as an
 * estimate. Checkout must refuse the estimate and insist on a saved
 * version; the calculator may show it.
 *
 * Throws a PricingError if the active version's stored config fails the
 * check, rather than silently quoting from the defaults.
 */
export async function getActivePricing(): Promise<CurrentPricing> {
  const row = await prisma.pricingVersion.findFirst({ where: { active: true }, select: VERSION_FIELDS });
  if (!row) return { source: { kind: "estimate" }, config: DEFAULT_PRICING_CONFIG };
  return { source: { kind: "version", version: summarize(row), pinned: false }, config: configOf(row, "The active version") };
}

/**
 * The prices one clinic is quoted with: the version it is pinned to when it
 * has one, otherwise whatever getActivePricing() says.
 *
 * A pin that points nowhere, or at a version whose config fails the check,
 * is a PricingError that names the clinic and the version. The clinic is
 * never quietly moved to different prices.
 */
export async function getPricingForClinic(clinicId: string): Promise<CurrentPricing> {
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { id: true, pricingVersionId: true, pricingVersion: { select: VERSION_FIELDS } },
  });
  if (!clinic) throw new PricingError(`No clinic has the id "${clinicId}".`);

  if (clinic.pricingVersionId === null) return getActivePricing();

  if (!clinic.pricingVersion) {
    throw new PricingError(
      `Clinic ${clinicId} is pinned to pricing version "${clinic.pricingVersionId}", which does not exist. Nothing is quoted for it until the pin is fixed.`,
    );
  }
  return {
    source: { kind: "version", version: summarize(clinic.pricingVersion), pinned: true },
    config: configOf(clinic.pricingVersion, `Clinic ${clinicId}'s pinned version`),
  };
}
