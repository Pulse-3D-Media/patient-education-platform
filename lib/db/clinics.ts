import type { ClinicStatus } from "@prisma/client";
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

/** The fields the app reads about a clinic. */
const CLINIC_FIELDS = { id: true, name: true, clerkOrgId: true, status: true, logoUrl: true } as const;

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
  if (existing && existing.name === details.name && existing.logoUrl === details.logoUrl) {
    return existing;
  }

  return prisma.clinic.upsert({
    where: { clerkOrgId },
    create: { clerkOrgId, name: details.name, logoUrl: details.logoUrl, status: "PENDING" },
    update: { name: details.name, logoUrl: details.logoUrl },
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
