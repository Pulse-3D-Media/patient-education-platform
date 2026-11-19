import { auth, clerkClient } from "@clerk/nextjs/server";
import { CreateOrganization, OrganizationList } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { LOGO_HEIGHT, LOGO_URL, LOGO_WIDTH } from "@/lib/brand";
import { askClerk } from "@/lib/clerk-timeout";
import { getCurrentClinic } from "@/lib/clinic";
import { clinicIsOpen } from "@/lib/clinic-status";
import { SIGN_UP_PATHS } from "@/lib/sign-up-steps";

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
 * one, sees Clerk's organization list instead: their clinics to pick from
 * and any invitation waiting to be accepted, and nothing else. Clerk's list
 * also offers "Create organization", which let an invited person make a
 * second, empty clinic by accident (audit C4, 2026-11-16). Clerk has no
 * setting to turn that off (its OrganizationList takes no such prop, checked
 * in Clerk's documentation on 2026-11-17), so the button is hidden through
 * Clerk's own styling hook for it (appearance.elements,
 * organizationListCreateOrganizationActionButton), and creating a new clinic
 * is behind one quiet link under the list, which opens this page with
 * ?create=1 and shows the create form on its own.
 *
 * Whoever creates a clinic becomes its account owner (recorded when the
 * clinic's row is made, in lib/clinic.ts) and goes straight to the sign-up
 * plan step (/onboarding/plan): nothing else works until the clinic is paid
 * for. Where checkout is not open (the production deployment, or a preview
 * without the settings), that step sends them on to Billing, whose "not open
 * yet" card is where a new clinic always landed before. Whoever
 * joins through an invitation, or picks a clinic they already belong to,
 * goes to the library (a clinic that is not open yet shows them its "ask
 * your office admin" note there).
 */
export const dynamic = "force-dynamic";

/** Where a new clinic's creator goes: the plan step, which sends them to Billing when checkout is not open here. */
const AFTER_CREATE = SIGN_UP_PATHS.plan;
/** Where someone goes after picking a clinic or accepting an invitation. This page then sends them on. */
const AFTER_SELECT = "/onboarding";

/** The quiet link's address, and the one value of ?create that shows the create form. */
const CREATE_HREF = "/onboarding?create=1";

/** Hides the create button inside Clerk's list (see the top of this file). */
const LIST_WITHOUT_CREATE = { elements: { organizationListCreateOrganizationActionButton: { display: "none" } } };

export default async function OnboardingPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const { userId, orgId } = await auth.protect();

  if (orgId) {
    const clinic = await getCurrentClinic();
    if (clinic) redirect(clinic.isOwner && !clinicIsOpen(clinic) ? AFTER_CREATE : "/library");
  }

  // Does this person already have a clinic, or an invitation to one? Two
  // small Clerk lookups, only on this page, only for people with no active
  // organization. Each has the time limit from lib/clerk-timeout.ts, so a
  // slow Clerk ends in the calm error page rather than a page that never loads.
  const client = await clerkClient();
  const [memberships, invitations] = await Promise.all([
    askClerk(client.users.getOrganizationMembershipList({ userId, limit: 1 }), "the person's clinics"),
    askClerk(client.users.getOrganizationInvitationList({ userId, status: "pending", limit: 1 }), "the person's invitations"),
  ]);
  // Someone with a clinic or an invitation who asked, on purpose, to make a new one (the quiet link) gets the create form.
  const askedToCreate = (await searchParams)?.create === "1";
  const belongsSomewhere = (memberships.totalCount > 0 || invitations.totalCount > 0) && !askedToCreate;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-[#e4ebf3] px-4 py-10">
      {/* eslint-disable-next-line @next/next/no-img-element -- small fixed logo file, served from our own address */}
      <img src={LOGO_URL} width={LOGO_WIDTH} height={LOGO_HEIGHT} alt="Pulse 3D" className="h-12 w-auto" />

      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold text-black sm:text-3xl">
          {belongsSomewhere ? "Join your clinic" : "Set up your clinic"}
        </h1>
        <p className="mt-2 text-[#667085]">
          {belongsSomewhere
            ? "Pick the clinic you are working with, or accept the invitation waiting for you."
            : "Your clinic is where your team signs in and your patients' links come from. Give it a name, and a logo if you have one handy (it can be added later)."}
        </p>
      </div>

      {belongsSomewhere ? (
        <>
          <OrganizationList
            hidePersonal
            afterSelectOrganizationUrl={AFTER_SELECT}
            afterCreateOrganizationUrl={AFTER_CREATE}
            skipInvitationScreen
            appearance={LIST_WITHOUT_CREATE}
          />
          <a href={CREATE_HREF} className="text-sm text-[#52616a] underline underline-offset-2 hover:text-black">
            Setting up a different clinic of your own? Create a new one
          </a>
        </>
      ) : (
        <CreateOrganization afterCreateOrganizationUrl={AFTER_CREATE} skipInvitationScreen />
      )}
    </main>
  );
}
