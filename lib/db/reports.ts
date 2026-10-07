import { Prisma, type Category, type ClinicStatus, ClinicStatus as ClinicStatuses } from "@prisma/client";
import { CATEGORIES } from "../categories";
import { clinicIsOpen } from "../clinic-status";
import { isValidRenewalCount, MAX_LINK_DAYS, MIN_LINK_DAYS } from "../expiry";
import { clampPage } from "../paging";
import { NO_LINKS, type LinkCounts, type SeatSource } from "../reports";
import { prisma } from "./client";
import { getSettings } from "./settings";

/**
 * The Pulse reports (/pulse/reports): counts of links across the platform,
 * per clinic, per surgeon, per category and per procedure. For Pulse staff
 * only; nothing here is ever shown to a clinic (decided by Evan on
 * 2026-10-07: clinics do not see reports yet). What each number means, and
 * why a period is a group of links rather than a diary of activity, is at
 * the top of lib/reports.ts; read that first.
 *
 * Every number is counted or summed IN THE DATABASE (rule 8: no history is
 * loaded to be counted in memory), and every list is capped: the clinic
 * table is read a page at a time, the procedure and surgeon lists have a
 * limit and say when they hit it. Nothing here reads a share code, a
 * patient anything (there is none), or a playback address.
 *
 * The SQL is written by hand where Prisma's query builder cannot say it (a
 * count with a condition, a group by a joined column, a newest name per
 * surgeon). Every value is bound as a parameter, never pasted into the text.
 */

/** The links a report covers: made at or after `since` and before `until`. The pages pass the period ending now; the tests pass a window of their own. */
export type ReportWindow = { since: Date; until: Date };

/** The five counts every report row carries (LinkCounts in lib/reports.ts), over links aliased `s`. */
const COUNTS = Prisma.sql`
  COUNT(*)::int AS "made",
  COUNT(*) FILTER (WHERE s."viewCount" > 0)::int AS "played",
  COALESCE(SUM(s."viewCount"), 0)::int AS "playStarts",
  COALESCE(SUM(s."renewalRequests"), 0)::int AS "renewalRequests",
  COALESCE(SUM(s."renewalsUsed"), 0)::int AS "renewals"`;

/** "This link was made inside the window", for links aliased `s`. */
function madeIn(window: ReportWindow) {
  return Prisma.sql`s."createdAt" >= ${window.since} AND s."createdAt" < ${window.until}`;
}

/** The five counts off a raw row, as plain numbers. */
function countsOf(row: LinkCounts): LinkCounts {
  return {
    made: Number(row.made),
    played: Number(row.played),
    playStarts: Number(row.playStarts),
    renewalRequests: Number(row.renewalRequests),
    renewals: Number(row.renewals),
  };
}

/** A status read back from SQL as text, checked against the enum; anything else (there is nothing else) reads as PENDING. */
function statusOf(text: string): ClinicStatus {
  return (Object.values(ClinicStatuses) as string[]).includes(text) ? (text as ClinicStatus) : "PENDING";
}

/** How many procedures, and how many surgeons, a report lists at most. Far more than the catalogue or a clinic has today; the page says so if a list is cut. */
export const REPORT_PROCEDURE_LIMIT = 100;
export const REPORT_SURGEON_LIMIT = 100;
/** Clinics on one page of the report's clinic table. */
export const REPORT_CLINICS_PAGE_SIZE = 50;

export type CategoryReportRow = LinkCounts & { category: Category };
export type ProcedureReportRow = LinkCounts & { videoId: string; title: string; category: Category; isPlaceholder: boolean };
export type SurgeonReportRow = LinkCounts & {
  /** The surgeon's Clerk user id, or null for links made before surgeons were recorded. Never shown; it groups the rows. */
  userId: string | null;
  /** The name patients saw on their newest link in the period ("Dr. Jane Smith, DO"), or null. */
  name: string | null;
};

/** Open clinics, their seats on the plan and their seats in use, for one source of seats. */
export type SeatTotals = { clinics: number; seatsOnPlans: number; seatsInUse: number };

export type PlatformReport = {
  links: LinkCounts;
  /** Paused links a patient has asked about that nobody has turned back on, right now, on every link whenever it was made. */
  waitingNow: number;
  /** Every clinic, by its status right now. */
  clinicsByStatus: Record<ClinicStatus, number>;
  /** OPEN clinics only, split by who provides the seats (seatSourceOf in lib/reports.ts). */
  openSeats: Record<SeatSource, SeatTotals>;
  /** Every category, in screen order, with zeros where nothing was made. */
  categories: CategoryReportRow[];
  /** The procedures with links in the period, most links first. */
  procedures: ProcedureReportRow[];
  /** True when there were more procedures than REPORT_PROCEDURE_LIMIT and the rest were left off. */
  proceduresCapped: boolean;
};

/**
 * The platform's numbers: links made in the window across every clinic,
 * clinics by status, the seats of open clinics, the categories and the
 * procedures. Managed clinics, closed clinics and test clinics are all in
 * the link numbers (a link is a link, whoever made it); only open clinics
 * are in the seat totals.
 */
export async function getPlatformReport(window: ReportWindow, now: Date = new Date()): Promise<PlatformReport> {
  const [linkRows, waitingNow, statusGroups, seatRows, categoryRows, procedures] = await Promise.all([
    prisma.$queryRaw<LinkCounts[]>`SELECT ${COUNTS} FROM "Share" s WHERE ${madeIn(window)}`,
    countWaitingNow(null, now),
    prisma.clinic.groupBy({ by: ["status"], _count: { _all: true } }),
    // The open rule is clinicIsOpen() in lib/clinic-status.ts, said again in
    // SQL so the seats are summed in the database: ACTIVE, or PAST_DUE before
    // its grace deadline (a missing deadline is closed). The source of the
    // seats is seatSourceOf() in lib/reports.ts, said again the same way.
    // lib/db/reports.test.ts checks both against the functions.
    prisma.$queryRaw<{ source: SeatSource; clinics: number; seatsOnPlans: number; seatsInUse: number }[]>`
      SELECT
        CASE WHEN c."managedByPulse" OR c."staffAccess"::text = 'OPEN' THEN 'pulse' ELSE 'card' END AS "source",
        COUNT(*)::int AS "clinics",
        COALESCE(SUM(c."surgeonSeats"), 0)::int AS "seatsOnPlans",
        COALESCE(SUM(COALESCE(a."n", 0) + COALESCE(i."n", 0)), 0)::int AS "seatsInUse"
      FROM "Clinic" c
      LEFT JOIN (SELECT "clinicId", COUNT(*)::int AS "n" FROM "SeatAllocation" GROUP BY "clinicId") a ON a."clinicId" = c."id"
      LEFT JOIN (SELECT "clinicId", COUNT(*)::int AS "n" FROM "SeatInvitation" GROUP BY "clinicId") i ON i."clinicId" = c."id"
      WHERE c."status"::text = 'ACTIVE' OR (c."status"::text = 'PAST_DUE' AND c."graceEndsAt" > ${now})
      GROUP BY 1`,
    prisma.$queryRaw<(LinkCounts & { category: string })[]>`
      SELECT v."category"::text AS "category", ${COUNTS}
      FROM "Share" s JOIN "Video" v ON v."id" = s."videoId"
      WHERE ${madeIn(window)}
      GROUP BY v."category"`,
    listProcedures(null, window),
  ]);

  const clinicsByStatus = Object.fromEntries(Object.values(ClinicStatuses).map((status) => [status, 0])) as Record<ClinicStatus, number>;
  for (const group of statusGroups) clinicsByStatus[group.status] = group._count._all;

  const openSeats: Record<SeatSource, SeatTotals> = { card: { clinics: 0, seatsOnPlans: 0, seatsInUse: 0 }, pulse: { clinics: 0, seatsOnPlans: 0, seatsInUse: 0 } };
  for (const row of seatRows) {
    openSeats[row.source] = { clinics: Number(row.clinics), seatsOnPlans: Number(row.seatsOnPlans), seatsInUse: Number(row.seatsInUse) };
  }

  const byCategory = new Map(categoryRows.map((row) => [row.category, countsOf(row)]));
  const categories = CATEGORIES.map(({ value }) => ({ category: value, ...(byCategory.get(value) ?? NO_LINKS) }));

  return {
    links: linkRows[0] ? countsOf(linkRows[0]) : NO_LINKS,
    waitingNow,
    clinicsByStatus,
    openSeats,
    categories,
    procedures: procedures.rows,
    proceduresCapped: procedures.capped,
  };
}

/** One clinic in the report's clinic table. */
export type ClinicReportRow = LinkCounts & {
  id: string;
  name: string;
  status: ClinicStatus;
  managedByPulse: boolean;
  /** What Pulse staff set by hand (OPEN, PAUSED, CANCELED), or null. */
  staffAccess: string | null;
  categoryCount: number;
  surgeonSeats: number;
  /** Seats held by people plus seats held by open invitations, as everywhere else. */
  seatsInUse: number;
};

/**
 * One page of the clinic table: every clinic, those that made the most links
 * in the window first, then by name. Counted, sorted and paged in the
 * database (the index on Share's clinic and creation date is what keeps the
 * per-clinic count quick), so the page never loads every clinic or every
 * link. `total` is the number of clinics; `page` is pulled back inside the
 * list.
 */
export async function listClinicReportRows(
  window: ReportWindow,
  requestedPage: number,
  pageSize: number = REPORT_CLINICS_PAGE_SIZE,
): Promise<{ rows: ClinicReportRow[]; total: number; page: number }> {
  const total = await prisma.clinic.count();
  const page = clampPage(requestedPage, total, pageSize);
  const rows = await prisma.$queryRaw<(ClinicReportRow & { status: string })[]>`
    SELECT
      c."id", c."name", c."status"::text AS "status", c."managedByPulse", c."staffAccess"::text AS "staffAccess",
      c."surgeonSeats", cardinality(c."categories")::int AS "categoryCount",
      ((SELECT COUNT(*) FROM "SeatAllocation" a WHERE a."clinicId" = c."id") + (SELECT COUNT(*) FROM "SeatInvitation" i WHERE i."clinicId" = c."id"))::int AS "seatsInUse",
      k."made", k."played", k."playStarts", k."renewalRequests", k."renewals"
    FROM "Clinic" c
    CROSS JOIN LATERAL (SELECT ${COUNTS} FROM "Share" s WHERE s."clinicId" = c."id" AND ${madeIn(window)}) k
    ORDER BY k."made" DESC, c."name" ASC, c."id" ASC
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;

  return {
    rows: rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: statusOf(row.status),
      managedByPulse: row.managedByPulse,
      staffAccess: row.staffAccess,
      categoryCount: Number(row.categoryCount),
      surgeonSeats: Number(row.surgeonSeats),
      seatsInUse: Number(row.seatsInUse),
      ...countsOf(row),
    })),
    total,
    page,
  };
}

export type ClinicReport = {
  clinic: {
    id: string;
    name: string;
    status: ClinicStatus;
    open: boolean;
    managedByPulse: boolean;
    staffAccess: string | null;
    categories: Category[];
    surgeonSeats: number;
    seatsInUse: number;
  };
  links: LinkCounts;
  /** This clinic's paused links a patient has asked about that nobody has turned back on, right now, whenever they were made. */
  waitingNow: number;
  /** One row per surgeon who sent links in the period, most links first. */
  surgeons: SurgeonReportRow[];
  surgeonsCapped: boolean;
  procedures: ProcedureReportRow[];
  proceduresCapped: boolean;
};

/**
 * One clinic's report: what it has right now (its plan's categories, its
 * seats) and the links it made in the window, in total, by surgeon and by
 * procedure. Null for an unknown clinic id. Takes the clinic id first
 * (rule 1) and filters every query by it, so it can only ever count that
 * clinic's links.
 */
export async function getClinicReport(clinicId: string, window: ReportWindow, now: Date = new Date()): Promise<ClinicReport | null> {
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: {
      id: true,
      name: true,
      status: true,
      graceEndsAt: true,
      managedByPulse: true,
      staffAccess: true,
      categories: true,
      surgeonSeats: true,
      _count: { select: { seatAllocations: true, seatInvitations: true } },
    },
  });
  if (!clinic) return null;

  const [linkRows, waitingNow, surgeonRows, procedures] = await Promise.all([
    prisma.$queryRaw<LinkCounts[]>`SELECT ${COUNTS} FROM "Share" s WHERE s."clinicId" = ${clinicId} AND ${madeIn(window)}`,
    countWaitingNow(clinicId, now),
    // One row per surgeon. The name is the one on their newest link in the
    // window that has a name (it was copied onto each link when it was made,
    // so it can differ between links after a change); a link with no
    // surgeon recorded is grouped under null.
    prisma.$queryRaw<(LinkCounts & { userId: string | null; name: string | null })[]>`
      SELECT
        s."senderUserId" AS "userId",
        (array_agg(s."senderName" ORDER BY s."createdAt" DESC) FILTER (WHERE s."senderName" IS NOT NULL))[1] AS "name",
        ${COUNTS}
      FROM "Share" s
      WHERE s."clinicId" = ${clinicId} AND ${madeIn(window)}
      GROUP BY s."senderUserId"
      ORDER BY "made" DESC, "name" ASC NULLS LAST
      LIMIT ${REPORT_SURGEON_LIMIT + 1}`,
    listProcedures(clinicId, window),
  ]);

  return {
    clinic: {
      id: clinic.id,
      name: clinic.name,
      status: clinic.status,
      open: clinicIsOpen(clinic, now),
      managedByPulse: clinic.managedByPulse,
      staffAccess: clinic.staffAccess,
      categories: clinic.categories,
      surgeonSeats: clinic.surgeonSeats,
      seatsInUse: clinic._count.seatAllocations + clinic._count.seatInvitations,
    },
    links: linkRows[0] ? countsOf(linkRows[0]) : NO_LINKS,
    waitingNow,
    surgeons: surgeonRows.slice(0, REPORT_SURGEON_LIMIT).map((row) => ({ userId: row.userId, name: row.name, ...countsOf(row) })),
    surgeonsCapped: surgeonRows.length > REPORT_SURGEON_LIMIT,
    procedures: procedures.rows,
    proceduresCapped: procedures.capped,
  };
}

/** The procedures with links made in the window, most links first, for the whole platform (clinicId null) or one clinic. Capped at REPORT_PROCEDURE_LIMIT. */
async function listProcedures(clinicId: string | null, window: ReportWindow): Promise<{ rows: ProcedureReportRow[]; capped: boolean }> {
  const onlyClinic = clinicId === null ? Prisma.empty : Prisma.sql`AND s."clinicId" = ${clinicId}`;
  const rows = await prisma.$queryRaw<(LinkCounts & { videoId: string; title: string; category: Category; isPlaceholder: boolean })[]>`
    SELECT v."id" AS "videoId", v."title", v."category"::text AS "category", v."isPlaceholder", ${COUNTS}
    FROM "Share" s JOIN "Video" v ON v."id" = s."videoId"
    WHERE ${madeIn(window)} ${onlyClinic}
    GROUP BY v."id"
    ORDER BY "made" DESC, v."title" ASC, v."id" ASC
    LIMIT ${REPORT_PROCEDURE_LIMIT + 1}`;
  return {
    rows: rows
      .slice(0, REPORT_PROCEDURE_LIMIT)
      .map((row) => ({ videoId: row.videoId, title: row.title, category: row.category, isPlaceholder: row.isPlaceholder, ...countsOf(row) })),
    capped: rows.length > REPORT_PROCEDURE_LIMIT,
  };
}

/**
 * Paused links a patient has asked about and nobody has turned back on yet,
 * right now: the same conditions as renewalState() "paused" in
 * lib/expiry.ts, plus a request on record and the video published, which is
 * what the admin overview's waiting list asks (listRenewalRequestsForClinic
 * in lib/db/shares.ts). Counted in the database. For the whole platform
 * (clinicId null) or one clinic.
 */
async function countWaitingNow(clinicId: string | null, now: Date): Promise<number> {
  const settings = await getSettings();
  const allowed = isValidRenewalCount(settings.maxRenewals) ? settings.maxRenewals : 0;
  return prisma.share.count({
    where: {
      ...(clinicId === null ? {} : { clinicId }),
      expiryPolicy: "FIRST_PLAY",
      firstPlayedAt: { not: null },
      expiresAt: { lte: now },
      daysAfterFirstPlay: { gte: MIN_LINK_DAYS, lte: MAX_LINK_DAYS },
      renewalsUsed: { lt: allowed },
      renewalRequestedAt: { not: null },
      video: { isPublished: true },
    },
  });
}
