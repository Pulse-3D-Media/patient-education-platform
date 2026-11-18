import { prisma } from "./client";
import { readClinicLocked } from "./clinic-lock";

/**
 * The database side of the demo clean-up (prisma/clear-demo-clinics.ts, with
 * its rules in lib/demo-cleanup.ts). ONLY that script uses these. It runs on
 * the demo site's database (the Neon testing branch) and never on production:
 * the script refuses production before it gets here.
 *
 * What belongs to one clinic, worked out from prisma/schema.prisma, and the
 * order it is deleted in (each step removes what points at the next):
 *
 *   1. Share           its patient links (they point at its QR codes)
 *   2. QrCode          its printed codes
 *   3. ClinicBilling   its Stripe record (it points at its plans)
 *   4. BillingPlan     the plans it accepted
 *   5. BillingEvent    the Stripe notifications recorded as being about it
 *   6. PersonalVideo, ClinicNote, SeatAllocation, SeatInvitation
 *                      hearts and plays, the clinic log, seats, seat holds
 *   7. Clinic          the clinic itself
 *
 * Never touched, because they are shared by every clinic: Video,
 * CategoryConfig, PricingVersion (a clinic only points at one) and
 * AppSettings. If another clinic's row ever pointed at one of this clinic's
 * rows, the database refuses the delete and the whole transaction is undone,
 * so nothing is half deleted.
 */

/** One clinic as the clean-up lists it. Names and ids only, plus counts. */
export type CleanupClinic = {
  id: string;
  name: string;
  createdAt: Date;
  clerkOrgId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  seats: number;
  seatInvitations: number;
  links: number;
  qrCodes: number;
  notes: number;
};

/** The most clinics one run looks at. A run that finds more says so, and the next run takes the rest. */
export const CLEANUP_CLINIC_LIMIT = 500;

const CLEANUP_SELECT = {
  id: true,
  name: true,
  createdAt: true,
  clerkOrgId: true,
  billing: { select: { stripeCustomerId: true, stripeSubscriptionId: true } },
  _count: { select: { seatAllocations: true, seatInvitations: true, shares: true, qrCodes: true, clinicNotes: true } },
} as const;

type CleanupRow = {
  id: string;
  name: string;
  createdAt: Date;
  clerkOrgId: string | null;
  billing: { stripeCustomerId: string | null; stripeSubscriptionId: string | null } | null;
  _count: { seatAllocations: number; seatInvitations: number; shares: number; qrCodes: number; clinicNotes: number };
};

function toCleanupClinic(row: CleanupRow): CleanupClinic {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    clerkOrgId: row.clerkOrgId,
    stripeCustomerId: row.billing?.stripeCustomerId ?? null,
    stripeSubscriptionId: row.billing?.stripeSubscriptionId ?? null,
    seats: row._count.seatAllocations,
    seatInvitations: row._count.seatInvitations,
    links: row._count.shares,
    qrCodes: row._count.qrCodes,
    notes: row._count.clinicNotes,
  };
}

/** Every clinic, oldest first, up to the limit, and how many there are in all. */
export async function listClinicsForCleanup(limit: number = CLEANUP_CLINIC_LIMIT): Promise<{ clinics: CleanupClinic[]; total: number }> {
  const [rows, total] = await Promise.all([
    prisma.clinic.findMany({ select: CLEANUP_SELECT, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit }),
    prisma.clinic.count(),
  ]);
  return { clinics: rows.map(toCleanupClinic), total };
}

/** Which of these ids are clinics. For the keep list: a name that is not a clinic is a typo, and the run stops. */
export async function existingClinicIds(ids: string[]): Promise<Set<string>> {
  const rows = await prisma.clinic.findMany({ where: { id: { in: ids } }, select: { id: true }, take: ids.length });
  return new Set(rows.map((row) => row.id));
}

/** One clinic as it stands right now, or null when it is gone. Read again just before it is cleared. */
export async function getClinicForCleanup(clinicId: string): Promise<CleanupClinic | null> {
  const row = await prisma.clinic.findUnique({ where: { id: clinicId }, select: CLEANUP_SELECT });
  return row ? toCleanupClinic(row) : null;
}

/** The most people ids read from one clinic's rows. A demo clinic has a handful. */
const PEOPLE_LIMIT = 200;

/**
 * The Clerk user ids our rows know for this clinic: its account owner, the
 * people holding seats, and the people with hearts or plays. Ids only. The
 * clean-up adds these to the organization's members in Clerk, so a second
 * run, after the organization is already gone, still finds them.
 */
export async function clinicUserIdsForCleanup(clinicId: string): Promise<string[]> {
  const [clinic, seats, personal] = await Promise.all([
    prisma.clinic.findUnique({ where: { id: clinicId }, select: { ownerClerkUserId: true } }),
    prisma.seatAllocation.findMany({ where: { clinicId }, select: { clerkUserId: true }, take: PEOPLE_LIMIT }),
    prisma.personalVideo.findMany({ where: { clinicId }, select: { clerkUserId: true }, distinct: ["clerkUserId"], take: PEOPLE_LIMIT }),
  ]);
  const ids = new Set<string>();
  if (clinic?.ownerClerkUserId) ids.add(clinic.ownerClerkUserId);
  for (const row of [...seats, ...personal]) ids.add(row.clerkUserId);
  return [...ids];
}

export type DeleteClinicOutcome =
  | { outcome: "deleted"; rows: Record<string, number> }
  | { outcome: "gone" }
  | { outcome: "refused"; reason: string };

/**
 * Delete one clinic and every row that belongs to it, in one transaction,
 * holding the clinic's row so nothing else changes it meanwhile (a new link
 * for it waits, then finds the clinic gone).
 *
 * The keep list and the "too new" time are checked again inside, on the row
 * as it is now, so a clinic that is kept or was just made is never deleted,
 * whatever the caller worked out earlier.
 */
export async function deleteClinicForCleanup(
  clinicId: string,
  guard: { keepClinicIds: string[]; createdBefore: Date },
): Promise<DeleteClinicOutcome> {
  return prisma.$transaction(async (tx) => {
    const clinic = await readClinicLocked(tx, clinicId, { id: true, createdAt: true });
    if (!clinic) return { outcome: "gone" } as const;
    if (guard.keepClinicIds.includes(clinic.id)) return { outcome: "refused", reason: "it is on the keep list" } as const;
    if (clinic.createdAt >= guard.createdBefore) return { outcome: "refused", reason: "it was made too recently" } as const;

    const where = { clinicId };
    const rows: Record<string, number> = {};
    rows.Share = (await tx.share.deleteMany({ where })).count;
    rows.QrCode = (await tx.qrCode.deleteMany({ where })).count;
    rows.ClinicBilling = (await tx.clinicBilling.deleteMany({ where })).count;
    rows.BillingPlan = (await tx.billingPlan.deleteMany({ where })).count;
    rows.BillingEvent = (await tx.billingEvent.deleteMany({ where })).count;
    rows.PersonalVideo = (await tx.personalVideo.deleteMany({ where })).count;
    rows.ClinicNote = (await tx.clinicNote.deleteMany({ where })).count;
    rows.SeatAllocation = (await tx.seatAllocation.deleteMany({ where })).count;
    rows.SeatInvitation = (await tx.seatInvitation.deleteMany({ where })).count;
    rows.Clinic = (await tx.clinic.deleteMany({ where: { id: clinicId } })).count;
    return { outcome: "deleted", rows } as const;
  });
}
