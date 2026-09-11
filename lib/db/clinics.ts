import type { Category, ClinicStatus } from "@prisma/client";
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
 */
const CLINIC_FIELDS = {
  id: true,
  name: true,
  clerkOrgId: true,
  status: true,
  logoUrl: true,
  noticeText: true,
  showPlaceholders: true,
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
    update: { name: details.name, logoUrl },
    select: CLINIC_FIELDS,
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
  phone: true,
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
 * who did it. Two things are written together, so neither can happen
 * without the other: the clinic's status fields (what it is now, and the
 * last change), and a STATUS entry in the clinic's log (the history). Later,
 * billing writes the same pair with its own name. Throws if the clinic does
 * not exist.
 */
export async function setClinicStatusByStaff(clinicId: string, status: ClinicStatus, reason: string, changedBy: string) {
  const [clinic] = await prisma.$transaction([
    prisma.clinic.update({
      where: { id: clinicId },
      data: { status, statusReason: reason, statusChangedBy: changedBy, statusChangedAt: new Date() },
      select: PULSE_CLINIC_FIELDS,
    }),
    prisma.clinicNote.create({
      data: { clinicId, kind: "STATUS", body: `Status set to ${STATUS_WORDS[status]}: ${reason}`, authorName: changedBy },
      select: { id: true },
    }),
  ]);
  return clinic;
}

/**
 * Set the categories on a clinic's plan and how many surgeon seats it pays
 * for. Used by /pulse and by npm run db:set-plan. Duplicate categories are
 * dropped and the rest kept in the order given. Throws if the clinic does
 * not exist.
 */
export async function setClinicPlan(clinicId: string, categories: Category[], surgeonSeats: number) {
  return prisma.clinic.update({
    where: { id: clinicId },
    data: { categories: Array.from(new Set(categories)), surgeonSeats },
    select: PULSE_CLINIC_FIELDS,
  });
}

/** Mark a clinic as managed by Pulse (enterprise or comped), or not. */
export async function setClinicManagedByPulse(clinicId: string, managedByPulse: boolean) {
  return prisma.clinic.update({
    where: { id: clinicId },
    data: { managedByPulse },
    select: PULSE_CLINIC_FIELDS,
  });
}

/** The details a staff member can edit on one clinic. Phone is digits only (see lib/phone.ts). */
export type ClinicDetails = {
  name: string;
  logoUrl: string | null;
  phone: string | null;
  noticeText: string | null;
  showPlaceholders: boolean;
  viewDaysOverride: number | null;
};

/** Save the editable details of one clinic. Callers check the values first. */
export async function updateClinicDetails(clinicId: string, details: ClinicDetails) {
  return prisma.clinic.update({
    where: { id: clinicId },
    data: details,
    select: PULSE_CLINIC_FIELDS,
  });
}
