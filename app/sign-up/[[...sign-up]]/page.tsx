import { auth } from "@clerk/nextjs/server";
import { AuthenticateWithRedirectCallback, SignUp } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { BOX_APPEARANCE } from "@/components/landing/clerk-look";
import { LandingFrame } from "@/components/landing/LandingFrame";
import { SetUpClinicForm } from "@/components/landing/SetUpClinicForm";
import { SignInExtras } from "@/components/landing/SignInExtras";
import { signInHandoffHref } from "@/lib/invitation-handoff";

/** The invited person's own screen (app/onboarding/join). */
const JOIN_PATH = "/onboarding/join";

/**
 * The sign-up page, at /sign-up: the landing page with its "Set up a
 * clinic" tab open. What the box holds depends on how the person arrived.
 *
 *   Nothing special (the usual case): our two-box form, "Your name" and
 *   "Work email", then the email code (SetUpClinicForm, which drives Clerk's
 *   own sign-up; see the top of that file for why it is not Clerk's
 *   ready-made form). A new account then goes on to /onboarding, or back to
 *   the page it started from.
 *
 *   An invitation: the email's link lands here (the invitation's return
 *   address, set in lib/people.ts). Clerk checks the link, then sends the
 *   person here with the invitation's ticket in the address, and says what
 *   they need:
 *
 *     __clerk_status=sign_up    a new person: Clerk's own ready-made sign-up
 *                               form, exactly as before, which creates their
 *                               account and accepts the invitation with it,
 *                               then opens the join screen (/onboarding/join),
 *                               where they enter their own name and credential.
 *     __clerk_status=sign_in    they already have an account: they are handed
 *                               to /sign-in with the same address, whose
 *                               form signs them in and accepts it.
 *     __clerk_status=complete   already accepted: on to the join screen, which
 *                               sends anyone with nothing to enter on to the
 *                               library.
 *
 *   /sign-up/sso-callback: where Google sends someone back to after "Continue
 *   with Google" on this tab; Clerk's own component finishes the sign-up (or
 *   the sign-in, for an account that already exists).
 *
 *   Any other /sign-up/... address: one of the steps of Clerk's ready-made
 *   form (an invitation's next step, or "continue" after Google when Clerk
 *   needs one more thing), so that form answers it, as before.
 *
 * Someone already signed in who opens /sign-up goes to /onboarding, which
 * routes them, rather than being offered a second account. An invitation
 * link is left to Clerk's own form, which knows what to do with it.
 *
 * The folder is a catch-all ([[...sign-up]]) for the same reason as sign-in:
 * Clerk's ready-made form moves between steps on its own sub-paths.
 */
export default async function SignUpPage({ params, searchParams }: PageProps<"/sign-up/[[...sign-up]]">) {
  const query = await searchParams;
  const status = typeof query.__clerk_status === "string" ? query.__clerk_status : null;
  if (status === "complete") redirect(JOIN_PATH);
  // The ticket and status travel with them unchanged; nothing else does (lib/invitation-handoff.ts).
  if (status === "sign_in") redirect(signInHandoffHref(query));

  const steps = (await params)["sign-up"] ?? [];
  const redirectUrl = typeof query.redirect_url === "string" ? query.redirect_url : undefined;
  const invited = typeof query.__clerk_ticket === "string" || status === "sign_up";

  if (steps[0] === "sso-callback") {
    return (
      <LandingFrame tab="set-up" redirectUrl={redirectUrl}>
        <AuthenticateWithRedirectCallback continueSignUpUrl="/sign-up/continue" />
        <SignInExtras patientLine={false} />
      </LandingFrame>
    );
  }

  if (invited || steps.length > 0) {
    return (
      <LandingFrame tab="set-up" redirectUrl={redirectUrl}>
        {/* After the account is made and the invitation accepted, the join screen asks for their own name and credential (05-join). */}
        <SignUp path="/sign-up" appearance={BOX_APPEARANCE} forceRedirectUrl={invited ? JOIN_PATH : undefined} />
        <SignInExtras patientLine={false} />
      </LandingFrame>
    );
  }

  const { userId } = await auth();
  if (userId) redirect("/onboarding");

  return (
    <LandingFrame tab="set-up" redirectUrl={redirectUrl}>
      <SetUpClinicForm redirectUrl={redirectUrl} />
    </LandingFrame>
  );
}
