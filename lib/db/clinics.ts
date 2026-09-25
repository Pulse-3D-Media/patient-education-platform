import type { Category, ClinicStatus, PracticeType, Prisma, StaffAccess } from "@prisma/client";
import { PRACTICE_TYPE_WORDS, STAFF_ACCESS_WORDS, effectiveAccess, hasLiveSubscription } from "../billing-state";
import { DEFAULT_BRAND_FONT, DEFAULT_BRAND_THEME, brandFontLabel, brandThemeLabel, parseBrandFont, parseBrandTheme } from "../branding";
import { CATEGORIES } from "../categories";
import { clinicIsOpen } from "../clinic-status";
import { formatUsPhone } from "../phone";
import { checkSeatReduction, isClerkUserId, overAllocatedWords, seatSummary } from "../seats";
import { readBillingFacts } from "./billing";
import { readClinicLocked } from "./clinic-lock";
import { prisma } from "./client";
import { countSeatsInUseIn } from "./seats";

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
  graceEndsAt: true,
  practiceType: true,
  logoUrl: true,
  noticeText: true,
  showPlaceholders: true,
  phone: true,
  brandColor: true,
  brandFont: true,
  brandTheme: true,
  ownerClerkUserId: true,
} as const;

/** What Clerk tells us about an organization that we keep a copy of. */
export type ClerkOrgDetails = {
  name: string;
  /** The organization's logo address, or null when it has none (Clerk's default avatar does not count). */
  logoUrl: string | null;
  /**
   * The account owner to record IF this is the visit that creates the
   * clinic: the person who created the Clerk organization. Never used to
   * change the owner of a clinic that already exists.
   */
  creatorClerkUserId?: string | null;
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
 * status PENDING (it has not chosen a plan yet) and the person who created
 * the organization as its account owner. After that, the name and
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
    // The owner is written on create only. An existing clinic's owner is
    // moved by a handoff or by Pulse staff (setClinicOwner below), never here.
    create: {
      clerkOrgId,
      name: details.name,
      logoUrl,
      status: "PENDING",
      ownerClerkUserId: isClerkUserId(details.creatorClerkUserId) ? details.creatorClerkUserId : null,
    },
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
  /** What kind of practice the clinic said it is. A hospital is always priced by agreement. */
  practiceType: PracticeType;
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
    select: { categories: true, surgeonSeats: true, managedByPulse: true, practiceType: true },
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
  staffAccess: true,
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
  /** False when the clinic has no account owner on record: made before owners existed, or its owner left. Pulse staff set one on the clinic's page. */
  hasOwner: boolean;
  /** Seats taken: held by people plus held by open invitations. From our own tables. */
  seatsInUse: number;
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
      ownerClerkUserId: true,
      createdAt: true,
      _count: { select: { shares: { where: { createdAt: { gte: since } } }, seatAllocations: true, seatInvitations: true } },
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
    hasOwner: clinic.ownerClerkUserId !== null,
    seatsInUse: clinic._count.seatAllocations + clinic._count.seatInvitations,
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
  data: Prisma.ClinicUncheckedUpdateInput | ((before: PulseClinic, tx: Prisma.TransactionClient) => Promise<Prisma.ClinicUncheckedUpdateInput>),
  describe: (before: PulseClinic, data: Prisma.ClinicUncheckedUpdateInput) => string | null,
  changedBy: string,
) {
  return prisma.$transaction(async (tx) => {
    const before = await readClinicLocked(tx, clinicId, PULSE_CLINIC_FIELDS);
    if (!before) throw new Error(`No clinic has the id "${clinicId}".`);

    // Most changes know their new values up front. A change to access has to
    // work them out from what is there now (the clinic and its billing
    // record), so it gives a function instead, run here, under the lock.
    const values = typeof data === "function" ? await data(before, tx) : data;

    const body = describe(before, values);
    if (body === null) return { clinic: before, logged: null };

    const clinic = await tx.clinic.update({ where: { id: clinicId }, data: values, select: PULSE_CLINIC_FIELDS });
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

// ---------------------------------------------------------------------------
// Access set by hand. Clinic.status is never written on its own: it is
// worked out by effectiveAccess() (lib/billing-state.ts) from what staff set
// by hand, whether Pulse manages the clinic, and the billing record, and
// written together with whichever of those changed, under the clinic's lock.
// ---------------------------------------------------------------------------

/** What a hand change to access came to, for the screen to say. */
export type AccessChange = {
  clinic: PulseClinic;
  /** The sentence that went in the log, or null when nothing changed. */
  logged: string | null;
  /**
   * True when the clinic is now closed (or managed) by hand while Stripe may
   * still be charging its card. Nothing here cancels a subscription; the
   * screen must say so.
   */
  stillCharging: boolean;
};

/** Work the clinic's status out again from a new hand setting and managed flag, plus its billing record. */
async function accessData(tx: Prisma.TransactionClient, clinicId: string, staffAccess: StaffAccess | null, managedByPulse: boolean) {
  const billing = await readBillingFacts(tx, clinicId);
  const access = effectiveAccess({ staffAccess, managedByPulse, billingStatus: billing.status, billingGraceEndsAt: billing.graceEndsAt });
  return { access, billing };
}

/**
 * A staff member sets a clinic's access by hand, with the reason why and who
 * did it: OPEN, PAUSED or CANCELED, or null to remove the hand setting so
 * the clinic follows its billing again. What is set by hand always wins
 * over billing (the state table in lib/billing-state.ts), so a payment
 * arriving later never reopens a clinic paused here.
 *
 * The hand setting, the status it works out to, who, why and when, and the
 * log entry are written together. Setting the same thing again with a new
 * reason still counts as a change, since the reason is new. Throws if the
 * clinic does not exist.
 *
 * Pausing or cancelling here does NOT cancel a card subscription in Stripe.
 */
export async function setClinicStatusByStaff(clinicId: string, staffAccess: StaffAccess | null, reason: string, changedBy: string): Promise<AccessChange> {
  let stillCharging = false;
  const { clinic, logged } = await changeClinicWithLog(
    clinicId,
    async (before, tx) => {
      const { access, billing } = await accessData(tx, clinicId, staffAccess, before.managedByPulse);
      stillCharging = (staffAccess === "PAUSED" || staffAccess === "CANCELED") && hasLiveSubscription(billing.status);
      return {
        staffAccess,
        status: access.status,
        graceEndsAt: access.graceEndsAt,
        statusReason: reason,
        statusChangedBy: changedBy,
        statusChangedAt: new Date(),
      };
    },
    (_before, data) => {
      const status = STATUS_WORDS[data.status as ClinicStatus];
      return staffAccess
        ? `Access set by hand to ${STAFF_ACCESS_WORDS[staffAccess]}: ${reason} Status is now ${status}.`
        : `Hand setting removed, so access follows billing: ${reason} Status is now ${status}.`;
    },
    changedBy,
  );
  return { clinic, logged, stillCharging };
}

/**
 * Record what kind of practice a clinic is, and log it. Asked of the
 * clinic's own admin on /admin/billing (once), and editable by Pulse staff.
 * A hospital is always Enterprise and never offered card checkout.
 */
export async function setClinicPracticeType(
  clinicId: string,
  practiceType: PracticeType,
  changedBy: string,
  // The clinic's own admin may only answer while it is unanswered. Checked
  // here, under the lock, so two admins answering at once cannot both win.
  options: { onlyIfUnknown?: boolean } = {},
) {
  return changeClinicWithLog(
    clinicId,
    { practiceType },
    (before) =>
      before.practiceType === practiceType || (options.onlyIfUnknown && before.practiceType !== "UNKNOWN")
        ? null
        : `Practice type changed from "${PRACTICE_TYPE_WORDS[before.practiceType]}" to "${PRACTICE_TYPE_WORDS[practiceType]}".`,
    changedBy,
  );
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
 * Thrown when a plan would be lowered below the surgeon seats in use and the
 * staff member did not say, in as many words, that they mean it. The message
 * is a plain sentence, safe to show to Pulse staff.
 */
export class PlanSeatsRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanSeatsRefusedError";
  }
}

/**
 * Set the categories on a clinic's plan and how many surgeon seats it pays
 * for, and log what changed under the name given. Used by /pulse and by npm
 * run db:set-plan. Duplicate categories are dropped and the rest kept in
 * the order given. Throws if the clinic does not exist.
 *
 * LOWERING THE SEATS BELOW THE NUMBER IN USE is refused with a
 * PlanSeatsRefusedError unless `allowFewerSeatsThanInUse` is set, which the
 * form only sends when the staff member ticked the box that says so. The
 * count is read here, under the clinic's lock, so a seat being given at the
 * same moment is either counted or has to wait. When it is allowed, nobody
 * is relabelled, no seat is taken away and no charge is changed: the clinic
 * is simply over its plan, the log says by how much, and nobody new can be
 * given a seat until that is settled (lib/seats.ts).
 */
export async function setClinicPlan(
  clinicId: string,
  categories: Category[],
  surgeonSeats: number,
  changedBy: string,
  options: { allowFewerSeatsThanInUse?: boolean } = {},
) {
  const wanted = Array.from(new Set(categories));
  let over: string | null = null;
  return changeClinicWithLog(
    clinicId,
    async (before, tx) => {
      const inUse = await countSeatsInUseIn(tx, clinicId);
      const lowering = surgeonSeats < before.surgeonSeats;
      if (lowering && !checkSeatReduction(inUse, surgeonSeats).ok && !options.allowFewerSeatsThanInUse) {
        throw new PlanSeatsRefusedError(
          `${inUse} ${inUse === 1 ? "seat is" : "seats are"} taken at this clinic (people and open invitations), so ${surgeonSeats} ${surgeonSeats === 1 ? "seat" : "seats"} would leave it ${inUse - surgeonSeats} over. Nothing was saved. To save it anyway, tick "Allow fewer seats than are in use": nobody is removed and no charge is changed, but nobody new can be given a seat until it is settled.`,
        );
      }
      over = overAllocatedWords(seatSummary(surgeonSeats, inUse));
      return { categories: wanted, surgeonSeats };
    },
    (before) => {
      const parts: string[] = [];
      if (!sameCategories(before.categories, wanted)) {
        parts.push(`categories set to ${categoryWords(wanted)} (was ${categoryWords(before.categories)})`);
      }
      if (before.surgeonSeats !== surgeonSeats) {
        parts.push(`surgeon seats set to ${surgeonSeats} (was ${before.surgeonSeats})`);
      }
      if (parts.length === 0) return null;
      // Said only when the seats changed: an over-the-plan clinic whose categories are edited does not need telling again.
      const overWords = before.surgeonSeats !== surgeonSeats && over ? ` ${over}` : "";
      return `Plan changed: ${parts.join("; ")}.${overWords}`;
    },
    changedBy,
  );
}

/**
 * Mark a clinic as managed by Pulse (enterprise or comped), or not, and log it.
 *
 * A managed clinic's access is only what staff set by hand; billing never
 * changes it. So that turning this ON does not shut a clinic that is open
 * right now because it pays by card, an open clinic with no hand setting is
 * given OPEN in the same write. Turning it OFF leaves the hand setting as it
 * is; remove it on the Status form to have the clinic follow billing.
 *
 * Turning this on does NOT cancel a card subscription in Stripe.
 */
export async function setClinicManagedByPulse(clinicId: string, managedByPulse: boolean, changedBy: string): Promise<AccessChange> {
  let stillCharging = false;
  let keptOpen = false;
  const { clinic, logged } = await changeClinicWithLog(
    clinicId,
    async (before, tx) => {
      keptOpen = managedByPulse && !before.managedByPulse && before.staffAccess === null && clinicIsOpen(before);
      const staffAccess = keptOpen ? "OPEN" : before.staffAccess;
      const { access, billing } = await accessData(tx, clinicId, staffAccess, managedByPulse);
      stillCharging = managedByPulse && hasLiveSubscription(billing.status);
      return { managedByPulse, staffAccess, status: access.status, graceEndsAt: access.graceEndsAt };
    },
    (before, data) => {
      if (before.managedByPulse === managedByPulse) return null;
      const parts = [`Managed by Pulse turned ${managedByPulse ? "on" : "off"}.`];
      if (keptOpen) parts.push("The clinic was open, so it was set to Open by hand to keep it open.");
      if (data.status !== before.status) parts.push(`Status is now ${STATUS_WORDS[data.status as ClinicStatus]}.`);
      return parts.join(" ");
    },
    changedBy,
  );
  return { clinic, logged, stillCharging };
}

/** A change of account owner that was refused because the owner had already changed. The message is safe to show. */
export class OwnerChangeRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnerChangeRefusedError";
  }
}

/**
 * Make one person the clinic's account owner, and log it, together.
 *
 * Two callers, both in lib/seat-changes.ts, which have already checked with
 * Clerk that the new owner is in the clinic:
 *
 *   a handoff    the current owner gives it to another admin on
 *                /admin/people. `expectedOwner` is the person handing it
 *                over; if the owner is no longer them when the clinic's row
 *                is locked (two tabs, or Pulse staff changed it a moment
 *                ago), nothing is written and OwnerChangeRefusedError says so.
 *   Pulse staff  the backup on /pulse, for when an owner left without handing
 *                over. `expectedOwner` is undefined: whoever it was, it moves.
 *
 * THE SEAT MOVES WITH IT (decided by Evan on 2026-09-25). The owner is the
 * one person who needs no seat, so when `oldOwnerStays` is true (the old
 * owner is still in the clinic) and the new owner holds a seat that the old
 * owner does not, that seat passes from the new owner to the old one, in this
 * same transaction under the clinic's lock. The count never changes and
 * nobody else can take the seat in between. Otherwise seats are left alone:
 * an old owner who already has a seat keeps it (and so does the new owner),
 * and an old owner with no seat to receive waits for one like anyone else.
 *
 * `words` names the people for the log (staff names are fine there; it is
 * never shown to the clinic). Writes nothing when the owner is already that
 * person.
 */
export async function setClinicOwner(
  clinicId: string,
  newOwner: string,
  words: { newOwnerName: string; oldOwnerName: string | null; how: string },
  changedBy: string,
  options: { expectedOwner?: string; oldOwnerStays?: boolean } = {},
) {
  if (!isClerkUserId(newOwner)) throw new OwnerChangeRefusedError("That person is not in the clinic.");
  let seatMoved = false;
  const result = await changeClinicWithLog(
    clinicId,
    async (before, tx) => {
      if (options.expectedOwner !== undefined && before.ownerClerkUserId !== options.expectedOwner) {
        throw new OwnerChangeRefusedError("You are no longer the account owner, so nothing was changed. Reload the page to see who is.");
      }
      const oldOwner = before.ownerClerkUserId;
      if (options.oldOwnerStays && oldOwner && oldOwner !== newOwner) {
        const newHolds = await tx.seatAllocation.findUnique({ where: { clinicId_clerkUserId: { clinicId, clerkUserId: newOwner } }, select: { id: true } });
        const oldHolds = await tx.seatAllocation.findUnique({ where: { clinicId_clerkUserId: { clinicId, clerkUserId: oldOwner } }, select: { id: true } });
        if (newHolds && !oldHolds) {
          await tx.seatAllocation.delete({ where: { clinicId_clerkUserId: { clinicId, clerkUserId: newOwner } }, select: { id: true } });
          await tx.seatAllocation.create({ data: { clinicId, clerkUserId: oldOwner, syncState: "SYNCED" }, select: { id: true } });
          seatMoved = true;
        }
      }
      return { ownerClerkUserId: newOwner };
    },
    (before) => {
      if (before.ownerClerkUserId === newOwner) return null;
      const from = before.ownerClerkUserId === null ? "nobody" : (words.oldOwnerName ?? "someone no longer in the clinic");
      const seats = seatMoved ? `${words.newOwnerName}'s seat passed to ${from}, so the seat count did not change.` : "Seats were not changed.";
      return `Account owner changed from ${from} to ${words.newOwnerName} (${words.how}). ${seats}`;
    },
    changedBy,
  );
  return { ...result, seatMoved };
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
