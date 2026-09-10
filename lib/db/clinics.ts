import { prisma } from "./client";

/**
 * Queries for the Clinic table.
 *
 * These are the two functions that connect a Clerk organization (the thing
 * a person signs in to) with a Clinic row (the thing share links belong to).
 * The two ids are different: a Clerk organization id starts with "org_" and
 * a clinic id is the cuid in our own database. Nothing else in the app
 * should ever hold an organization id; getCurrentClinicId() in lib/clinic.ts
 * turns it into a clinic id and the rest of the app only sees that.
 *
 * Neither function takes a clinicId first, unlike the share queries, because
 * they are how a clinicId is found in the first place.
 */

/**
 * The clinic linked to one Clerk organization, or null if no clinic has been
 * linked to that organization yet. clerkOrgId is unique, so at most one
 * clinic can match.
 */
export async function getClinicByClerkOrgId(clerkOrgId: string) {
  return prisma.clinic.findUnique({
    where: { clerkOrgId },
    select: { id: true, name: true },
  });
}

/**
 * Link one clinic to one Clerk organization by setting its clerkOrgId.
 * Returns the row as it now is. Used by the db:link-clinic script; in Phase 2
 * the clinic-orgs work will do this automatically when a clinic signs up.
 *
 * Throws if the clinic does not exist, or if that organization is already
 * linked to a different clinic (clerkOrgId is unique).
 */
export async function linkClinicToClerkOrg(clinicId: string, clerkOrgId: string) {
  return prisma.clinic.update({
    where: { id: clinicId },
    data: { clerkOrgId },
    select: { id: true, name: true, clerkOrgId: true },
  });
}
