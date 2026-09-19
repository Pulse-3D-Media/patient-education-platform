import type { Category, ClinicStatus, Prisma } from "@prisma/client";
import { DEFAULT_BRAND_FONT, DEFAULT_BRAND_THEME, brandFontLabel, brandThemeLabel, parseBrandFont, parseBrandTheme } from "../branding";
import { CATEGORIES } from "../categories";
import { formatUsPhone } from "../phone";
import { readClinicLocked } from "./clinic-lock";
import { prisma } from "./client";

/**
 * Queries for the Clinic table.
 *
 * A Clinic row is our side of a Clerk organization (the thing a person signs
 * in to). The two ids are different: a Clerk organization id starts with
 * "org_" and a clinic id is the cuid in our own database. Nothing else in the
 * app should ever hold an organization id; getCurrentClinic() in
 * lib/clinic.ts turns it into a clinic and the rest of the app only sees
 * that.
 *
 * These functions do not take a clinicId first, unlike the share queries,
 * because they are how a clinicId is found in the first place.
 */

/**
 * The fields the clinic side of the app reads about a clinic. noticeText and
 * showPlaceholders are set by Pulse staff and change what the clinic sees.
 * The phone, brand colour, brand font and light-or-dark mode are the clinic's branding, which
 * its own admin can edit too (/admin/branding). Nothing internal (notes,
 * status reasons, the pricing pin) is in here.
 */
const CLINIC_FIELDS = {
  id: true,
  name: true,
  clerkOrgId: true,
  status: true,
  logoUrl: true,
  noticeText: true,
  showPlaceholders: true,
  phone: true,
  brandColor: true,
  brandFont: true,
  brandTheme: true,
} as const;

/** What Clerk tells us about an organization that we keep a copy of. */
export type ClerkOrgDetails = {
  name: string;
  /** The organization's logo address, or null when it has none (Clerk's default avatar does not count). */
  logoUrl: string | null;
};

/**
 * The clinic linked to one Clerk organization, or null if no clinic exists
 * for that organization yet. clerkOrgId is unique, so at most one clinic can
 * match.
 */
export async function getClinicByClerkOrgId(clerkOrgId: string) {
  return prisma.clinic.findUnique({
    where: { clerkOrgId },
    select: CLINIC_FIELDS,
  });
}

/**
 * Make sure a Clinic row exists for one Clerk organization, and keep its
 * name and logo in step with Clerk. Called on every signed-in visit.
 *
 * The first time an organization is seen, a clinic is created for it with
 * status PENDING (it has not chosen a plan yet). After that, the name and
 * logo are updated only when Clerk's copy has changed; an unchanged visit
 * writes nothing.
 *
 * This is an upsert keyed on clerkOrgId, which is unique, so two requests
 * arriving at the same moment for a brand-new organization cannot make two
 * rows: the database lets one insert through and turns the other into the
 * update. Neither request fails.
 *
 * Returns the row as it now is.
 */
export async function upsertClinicForClerkOrg(clerkOrgId: string, details: ClerkOrgDetails) {
  const existing = await getClinicByClerkOrgId(clerkOrgId);

  // The logo is copied only when Clerk has one. When the organization has no
  // logo of its own, a logo Pulse staff set on /pulse is left in place rather
  // than wiped on the clinic's next sign-in.
  const logoUrl = details.logoUrl ?? existing?.logoUrl ?? null;

  if (existing && existing.name === details.name && existing.logoUrl === logoUrl) {
    return existing;
  }

  return prisma.clinic.upsert({
    where: { clerkOrgId },
    create: { clerkOrgId, name: details.name, logoUrl, status: "PENDING" },
    // When Clerk has no image, omit the column entirely. Writing the logo
    // from the earlier read could overwrite a concurrent Pulse branding save.
    update: { name: details.name, ...(details.logoUrl !== null ? { logoUrl: details.logoUrl } : {}) },
    select: CLINIC_FIELDS,
  });
}

/** What /admin/billing shows a clinic about its own plan. */
export type ClinicPlan = {
  categories: Category[];
  surgeonSeats: number;
  managedByPulse: boolean;
};

/**
 * One clinic's plan as Pulse staff set it: the categories, the surgeon
 * seats, and whether Pulse manages the plan (invoiced by agreement, no
 * self-serve billing). Read by /admin/billing, which is the only clinic-side
 * page that shows plan information. Null for an unknown id. Nothing internal
 * (notes, status reasons, the pricing pin) is in here.
 */
export async function getClinicPlan(clinicId: string): Promise<ClinicPlan | null> {
  return prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { categories: true, surgeonSeats: true, managedByPulse: true },
  });
}

/**
 * Change one clinic's status. Used by the db:set-status script now, and by
 * billing later. Throws if the clinic does not exist.
 */
export async function setClinicStatus(clinicId: string, status: ClinicStatus) {
  return prisma.clinic.update({
    where: { id: clinicId },
    data: { status },
    select: CLINIC_FIELDS,
  });
}

/**
 * Link one clinic to one Clerk organization by setting its clerkOrgId.
 * Returns the row as it now is. Used by the db:link-clinic script for a
 * clinic that was created before its organization existed (the test clinic
 * was); clinics that sign themselves up are linked by upsertClinicForClerkOrg
 * and never need this.
 *
 * Throws if the clinic does not exist, or if that organization is already
 * linked to a different clinic (clerkOrgId is unique).
 */
export async function linkClinicToClerkOrg(clinicId: string, clerkOrgId: string) {
  return prisma.clinic.update({
    where: { id: clinicId },
    data: { clerkOrgId },
    select: CLINIC_FIELDS,
  });
}

// ---------------------------------------------------------------------------
// The Pulse 3D master dashboard (app/pulse). Staff only: every caller has
// already passed requirePulseStaff() in lib/pulse.ts. These see across all
// clinics, which is exactly what no clinic-side function may do.
// ---------------------------------------------------------------------------

/** Everything /pulse shows about one clinic. */
const PULSE_CLINIC_FIELDS = {
  ...CLINIC_FIELDS,
  createdAt: true,
  managedByPulse: true,
  statusReason: true,
  statusChangedBy: true,
  statusChangedAt: true,
  viewDaysOverride: true,
  categories: true,
  surgeonSeats: true,
} as const;

/** How far back "links in the last 30 days" looks. */
const RECENT_DAYS = 30;

/** One row of the clinics table on /pulse. */
export type PulseClinicRow = {
  id: string;
  name: string;
  clerkOrgId: string | null;
  status: ClinicStatus;
  managedByPulse: boolean;
  categories: Category[];
  surgeonSeats: number;
  createdAt: Date;
  /** Share links made in the last 30 days. */
  recentLinks: number;
  /** When the newest share link was made, or null if the clinic has never made one. */
  lastLinkAt: Date | null;
};

/**
 * Every clinic, for the clinics table on /pulse, with its link activity.
 * Sorted by last activity: the clinic that most recently made a link comes
 * first, clinics that never made one last, newest of those first.
 *
 * Optionally narrowed by a name search (any part of the name, any case) and
 * by one status. The search happens in the database, so the list stays
 * quick as clinics accumulate.
 */
export async function listClinicsForPulse(filter: { query?: string; status?: ClinicStatus } = {}): Promise<PulseClinicRow[]> {
  const since = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);
  const query = filter.query?.trim();

  const clinics = await prisma.clinic.findMany({
    where: {
      ...(query ? { name: { contains: query, mode: "insensitive" } } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    },
    select: {
      id: true,
      name: true,
      clerkOrgId: true,
      status: true,
      managedByPulse: true,
      categories: true,
      surgeonSeats: true,
      createdAt: true,
      _count: { select: { shares: { where: { createdAt: { gte: since } } } } },
      shares: { select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const rows: PulseClinicRow[] = clinics.map((clinic) => ({
    id: clinic.id,
    name: clinic.name,
    clerkOrgId: clinic.clerkOrgId,
    status: clinic.status,
    managedByPulse: clinic.managedByPulse,
    categories: clinic.categories,
    surgeonSeats: clinic.surgeonSeats,
    createdAt: clinic.createdAt,
    recentLinks: clinic._count.shares,
    lastLinkAt: clinic.shares[0]?.createdAt ?? null,
  }));

  return rows.sort((a, b) => {
    const activityA = a.lastLinkAt?.getTime() ?? 0;
    const activityB = b.lastLinkAt?.getTime() ?? 0;
    if (activityA !== activityB) return activityB - activityA;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}

/** One clinic with every field /pulse shows, or null if the id is unknown. */
export async function getClinicForPulse(clinicId: string) {
  return prisma.clinic.findUnique({
    where: { id: clinicId },
    select: PULSE_CLINIC_FIELDS,
  });
}

/** One clinic as /pulse sees it. */
type PulseClinic = NonNullable<Awaited<ReturnType<typeof getClinicForPulse>>>;

// ---------------------------------------------------------------------------
// Changes to a clinic, by Pulse staff on /pulse or by the clinic's own admin
// on /admin/branding. Every one of them is written together with an entry
// in the clinic's log (a ClinicNote of kind STATUS, the kind for entries the
// app writes itself), in one transaction, so the change and its history
// cannot disagree. A save that changes nothing writes nothing.
// ---------------------------------------------------------------------------

/**
 * Change one clinic and log it, together.
 *
 * `describe` is given the clinic as it is now and returns the sentence for
 * the log, or null when the new values are the same as the old ones, in
 * which case nothing at all is written. Throws if the clinic does not exist.
 *
 * The read, the decision and the two writes are one transaction, and the
 * read takes a lock on the clinic's row first (readClinicLocked). So when two
 * people save at the same moment, the second one waits for the first, then
 * reads what the first one wrote: its log entry says "changed from" the
 * value that was really there, never a value that had already been
 * replaced.
 *
 * Returns the clinic as it now is, and the sentence that went in the log
 * (null when nothing changed) so the caller can tell the person who saved.
 */
async function changeClinicWithLog(
  clinicId: string,
  data: Prisma.ClinicUncheckedUpdateInput,
  describe: (before: PulseClinic) => string | null,
  changedBy: string,
) {
  return prisma.$transaction(async (tx) => {
    const before = await readClinicLocked(tx, clinicId, PULSE_CLINIC_FIELDS);
    if (!before) throw new Error(`No clinic has the id "${clinicId}".`);

    const body = describe(before);
    if (body === null) return { clinic: before, logged: null };

    const clinic = await tx.clinic.update({ where: { id: clinicId }, data, select: PULSE_CLINIC_FIELDS });
    await tx.clinicNote.create({ data: { clinicId, kind: "STATUS", body, authorName: changedBy }, select: { id: true } });
    return { clinic, logged: body };
  });
}

/** How each status reads in a log entry. */
const STATUS_WORDS: Record<ClinicStatus, string> = {
  PENDING: "Pending",
  ACTIVE: "Active",
  PAUSED: "Paused",
  PAST_DUE: "Past due",
  CANCELED: "Canceled",
};

/**
 * A staff member sets a clinic's status by hand, with the reason why and
 * who did it. The status fields (what it is now, and the last change) and
 * the log entry are written together. Setting the same status again with a
 * new reason still counts as a change, since the reason is new. Later,
 * billing writes the same pair with its own name. Throws if the clinic does
 * not exist.
 */
export async function setClinicStatusByStaff(clinicId: string, status: ClinicStatus, reason: string, changedBy: string) {
  const { clinic } = await changeClinicWithLog(
    clinicId,
    { status, statusReason: reason, statusChangedBy: changedBy, statusChangedAt: new Date() },
    () => `Status set to ${STATUS_WORDS[status]}: ${reason}`,
    changedBy,
  );
  return clinic;
}

/** "Knee, Hip" as a person reads it, in the order the library shows them; "none" for an empty plan. */
function categoryWords(categories: Category[]) {
  const labels = CATEGORIES.filter((category) => categories.includes(category.value)).map((category) => category.label);
  return labels.length > 0 ? labels.join(", ") : "none";
}

/** True when two lists hold the same categories, in any order. */
function sameCategories(a: Category[], b: Category[]) {
  return a.length === b.length && a.every((category) => b.includes(category));
}

/**
 * Set the categories on a clinic's plan and how many surgeon seats it pays
 * for, and log what changed under the name given. Used by /pulse and by npm
 * run db:set-plan. Duplicate categories are dropped and the rest kept in
 * the order given. Throws if the clinic does not exist.
 */
export async function setClinicPlan(clinicId: string, categories: Category[], surgeonSeats: number, changedBy: string) {
  const wanted = Array.from(new Set(categories));
  return changeClinicWithLog(
    clinicId,
    { categories: wanted, surgeonSeats },
    (before) => {
      const parts: string[] = [];
      if (!sameCategories(before.categories, wanted)) {
        parts.push(`categories set to ${categoryWords(wanted)} (was ${categoryWords(before.categories)})`);
      }
      if (before.surgeonSeats !== surgeonSeats) {
        parts.push(`surgeon seats set to ${surgeonSeats} (was ${before.surgeonSeats})`);
      }
      return parts.length > 0 ? `Plan changed: ${parts.join("; ")}.` : null;
    },
    changedBy,
  );
}

/** Mark a clinic as managed by Pulse (enterprise or comped), or not, and log it. */
export async function setClinicManagedByPulse(clinicId: string, managedByPulse: boolean, changedBy: string) {
  return changeClinicWithLog(
    clinicId,
    { managedByPulse },
    (before) => (before.managedByPulse === managedByPulse ? null : `Managed by Pulse turned ${managedByPulse ? "on" : "off"}.`),
    changedBy,
  );
}

/**
 * The details a staff member can edit on one clinic. The logo and the phone
 * are not here: they are part of the clinic's branding (see below), so one
 * form, and only one, saves each of them.
 */
export type ClinicDetails = {
  name: string;
  noticeText: string | null;
  showPlaceholders: boolean;
  viewDaysOverride: number | null;
};

/**
 * One part of a "Details changed" entry: how a value went from one thing to
 * another, or null when it did not change. A null value is "not set".
 */
function changeWords(label: string, before: string | null, after: string | null): string | null {
  if (before === after) return null;
  if (before === null) return `${label} set to ${after}`;
  if (after === null) return `${label} removed (was ${before})`;
  return `${label} changed from ${before} to ${after}`;
}

/** Quoted for the log, so a notice or a name with a comma in it still reads as one thing. */
function quoted(text: string | null) {
  return text === null ? null : `"${text}"`;
}

/**
 * Save the editable details of one clinic and log every field that changed,
 * under the name given. Callers check the values first.
 */
export async function updateClinicDetails(clinicId: string, details: ClinicDetails, changedBy: string) {
  return changeClinicWithLog(
    clinicId,
    details,
    (before) => {
      const platform = "the platform setting";
      const parts = [
        changeWords("name", quoted(before.name), quoted(details.name)),
        changeWords("notice", quoted(before.noticeText), quoted(details.noticeText)),
        before.showPlaceholders === details.showPlaceholders
          ? null
          : `placeholder videos ${details.showPlaceholders ? "shown" : "hidden"}`,
        changeWords(
          "days a link works after the first play",
          before.viewDaysOverride === null ? platform : String(before.viewDaysOverride),
          details.viewDaysOverride === null ? platform : String(details.viewDaysOverride),
        ),
      ].filter((part): part is string => part !== null);
      return parts.length > 0 ? `Details changed: ${parts.join("; ")}.` : null;
    },
    changedBy,
  );
}

// ---------------------------------------------------------------------------
// Branding: the clinic's logo, phone, brand colour, font and mode. Edited by the
// clinic's own admin on /admin/branding and by Pulse staff on the Branding
// tab of /pulse. Both go through the one function below, so both are logged
// the same way and the last save wins.
// ---------------------------------------------------------------------------

/**
 * What a branding save carries. Callers check every value first (the
 * actions use lib/branding.ts and lib/phone.ts).
 *
 * `logoUrl` is optional on purpose. Pulse staff can set a logo address;
 * the clinic's own admin cannot (their logo is the one they upload to
 * their Clerk organization), so the admin's save leaves it out and the
 * stored logo is not touched. There is one logo column and no second store:
 * a logo uploaded in Clerk is copied over it on the clinic's next sign-in
 * (upsertClinicForClerkOrg above), and a Pulse-set one stays only while the
 * organization has none of its own.
 */
export type ClinicBrandingInput = {
  /** Ten digits, or null for no phone. */
  phone: string | null;
  /** "#rrggbb", or null for the Pulse colour. */
  brandColor: string | null;
  /** A font key from lib/branding.ts, or null for the default. */
  brandFont: string | null;
  /** "light", or null for the default (dark staff screens). */
  brandTheme: string | null;
  /** A full https address, null to remove it, or left out to leave the logo alone. */
  logoUrl?: string | null;
};

/** "Inter" for nothing stored, otherwise the font's name as the forms show it. */
function fontWords(key: string | null) {
  return brandFontLabel(parseBrandFont(key) ?? DEFAULT_BRAND_FONT);
}

/** "Dark" for nothing stored, otherwise "Dark" or "Light" as the forms show it. */
function themeWords(key: string | null) {
  return brandThemeLabel(parseBrandTheme(key) ?? DEFAULT_BRAND_THEME);
}

/**
 * Save one clinic's branding and log every part that changed, under the
 * name given (a Pulse staff member, or "<name> (clinic admin)"). A save
 * that changes nothing writes nothing. Throws if the clinic does not exist.
 */
export async function updateClinicBranding(clinicId: string, branding: ClinicBrandingInput, changedBy: string) {
  const data: Prisma.ClinicUncheckedUpdateInput = {
    phone: branding.phone,
    brandColor: branding.brandColor,
    brandFont: branding.brandFont,
    brandTheme: branding.brandTheme,
    ...(branding.logoUrl !== undefined ? { logoUrl: branding.logoUrl } : {}),
  };

  return changeClinicWithLog(
    clinicId,
    data,
    (before) => {
      const parts = [
        branding.logoUrl !== undefined ? changeWords("logo", before.logoUrl, branding.logoUrl) : null,
        changeWords("colour", before.brandColor, branding.brandColor),
        fontWords(before.brandFont) === fontWords(branding.brandFont)
          ? null
          : `font changed from ${fontWords(before.brandFont)} to ${fontWords(branding.brandFont)}`,
        themeWords(before.brandTheme) === themeWords(branding.brandTheme)
          ? null
          : `mode changed from ${themeWords(before.brandTheme)} to ${themeWords(branding.brandTheme)}`,
        changeWords("phone", formatUsPhone(before.phone) || null, formatUsPhone(branding.phone) || null),
      ].filter((part): part is string => part !== null);
      return parts.length > 0 ? `Branding changed: ${parts.join("; ")}.` : null;
    },
    changedBy,
  );
}
