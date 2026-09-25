import { auth, clerkClient } from "@clerk/nextjs/server";
import { CreateOrganization, OrganizationList } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { LOGO_URL } from "@/lib/brand";
import { getCurrentClinic } from "@/lib/clinic";
import { clinicIsOpen } from "@/lib/clinic-status";

/**
 * Step one of onboarding: "Set up your clinic".
 *
 * A signed-in person with no clinic lands here (requireClinicPage() sends
 * them). A clinic is a Clerk organization, so this page is Clerk's
 * CreateOrganization form: clinic name and an optional logo. The Clinic row
 * in our database is created the first time the new organization is used
 * (getCurrentClinic() in lib/clinic.ts), so nothing here writes to the
 * database.
 *
 * Someone who was invited to an existing clinic, or already belongs to
 * one, sees Clerk's organization list instead: their clinics to pick from,
 * any invitation waiting to be accepted, and a create form for the rare
 * person who wants a new one anyway.
 *
 * Whoever creates a clinic becomes its account owner (recorded when the
 * clinic's row is made, in lib/clinic.ts) and goes straight to Billing to
 * choose a plan: nothing else works until the clinic is paid for. Whoever
 * joins through an invitation, or picks a clinic they already belong to,
 * goes to the library (a clinic that is not open yet shows them its "ask
 * your office admin" note there).
 */
export const dynamic = "force-dynamic";

/** Where a new clinic's creator goes. */
const AFTER_CREATE = "/admin/billing";
/** Where someone goes after picking a clinic or accepting an invitation. This page then sends them on. */
const AFTER_SELECT = "/onboarding";

export default async function OnboardingPage() {
  const { userId, orgId } = await auth.protect();

  if (orgId) {
    const clinic = await getCurrentClinic();
    if (clinic) redirect(clinic.isOwner && !clinicIsOpen(clinic) ? AFTER_CREATE : "/library");
  }

  // Does this person already have a clinic, or an invitation to one? Two
  // small Clerk lookups, only on this page, only for people with no active
  // organization.
  const client = await clerkClient();
  const [memberships, invitations] = await Promise.all([
    client.users.getOrganizationMembershipList({ userId, limit: 1 }),
    client.users.getOrganizationInvitationList({ userId, status: "pending", limit: 1 }),
  ]);
  const belongsSomewhere = memberships.totalCount > 0 || invitations.totalCount > 0;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-[#e4ebf3] px-4 py-10">
      {/* eslint-disable-next-line @next/next/no-img-element -- small static logo from the CDN */}
      <img src={LOGO_URL} alt="Pulse 3D" className="h-9 w-auto" />

      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold text-black sm:text-3xl">
          {belongsSomewhere ? "Join your clinic" : "Set up your clinic"}
        </h1>
        <p className="mt-2 text-[#667085]">
          {belongsSomewhere
            ? "Pick the clinic you are working with, or accept the invitation waiting for you. You can create a new one here too."
            : "Your clinic is where your team signs in and your patients' links come from. Give it a name, and a logo if you have one handy (it can be added later)."}
        </p>
      </div>

      {belongsSomewhere ? (
        <OrganizationList hidePersonal afterSelectOrganizationUrl={AFTER_SELECT} afterCreateOrganizationUrl={AFTER_CREATE} skipInvitationScreen />
      ) : (
        <CreateOrganization afterCreateOrganizationUrl={AFTER_CREATE} skipInvitationScreen />
      )}
    </main>
  );
}
