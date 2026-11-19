import { auth } from "@clerk/nextjs/server";
import { SignIn } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { BOX_APPEARANCE } from "@/components/landing/clerk-look";
import { LandingFrame, LandingProviders } from "@/components/landing/LandingFrame";
import { SignInExtras } from "@/components/landing/SignInExtras";

/**
 * The bare address.
 *
 * Signed in: straight on to /onboarding, exactly as before this page existed.
 * /onboarding sends each person on to the right place: the account owner of
 * a clinic that is not paid for yet to Billing, everyone else to the
 * library, and someone with no clinic to the "Set up your clinic" form.
 * (Why not straight to the library: a new clinic's owner who signed up from
 * here must come back to a page that routes them to Billing.)
 *
 * Signed out: the landing page (the approved design, screen 01), with
 * Clerk's own sign-in form in the box and the "Set up a clinic" tab beside
 * it. Patients never come here; they arrive by link at /watch or /q.
 *
 * auth() only reads the session cookie that proxy.ts has already checked;
 * it asks Clerk's servers nothing. A session that still has a Clerk step to
 * finish (choosing a clinic) counts as signed out here, as everywhere, and
 * Clerk's sign-in form in the box then shows that step.
 *
 * The sign-in form here keeps its steps after a "#" in the address (Clerk's
 * hash routing), because its usual steps live under /sign-in and this page
 * is the bare address. /sign-in draws the same page with the steps in the path.
 */
export default async function Home() {
  const { userId } = await auth();
  if (userId) redirect("/onboarding");

  return (
    <LandingProviders>
      <LandingFrame tab="sign-in">
        <SignIn routing="hash" appearance={BOX_APPEARANCE} />
        <SignInExtras />
      </LandingFrame>
    </LandingProviders>
  );
}
