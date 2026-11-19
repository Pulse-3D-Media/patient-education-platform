import { SignIn } from "@clerk/nextjs";
import { BOX_APPEARANCE } from "@/components/landing/clerk-look";
import { LandingFrame } from "@/components/landing/LandingFrame";
import { SignInExtras } from "@/components/landing/SignInExtras";

/**
 * The sign-in page, at /sign-in: the landing page with its Sign in tab open,
 * and Clerk's own prebuilt sign-in form in the box, styled to the design
 * (components/landing/clerk-look.ts).
 *
 * The folder is a catch-all ([[...sign-in]]) because Clerk's form moves
 * between steps on its own sub-paths (/sign-in/factor-one and so on) and
 * this one page has to answer all of them.
 *
 * Signed-out visitors of /admin, /library, /pulse or /onboarding are sent
 * here by proxy.ts with the page they wanted in the address (redirect_url).
 * After signing in, Clerk takes them back there, and the "Set up a clinic"
 * tab carries the same redirect_url, so a sign-up started here returns there
 * too. Someone who opens /sign-in directly goes to /onboarding, which routes
 * them.
 *
 * Clerk's form also does everything else a sign-in can need, with nothing
 * extra built for it: the email code, a second step if an account has one,
 * "Continue with Google", an invitation for someone who already has an
 * account (handed over from /sign-up), and choosing a clinic when Clerk asks
 * for one (a "session task" in Clerk's words).
 */
export default async function SignInPage({ searchParams }: PageProps<"/sign-in/[[...sign-in]]">) {
  const params = await searchParams;
  return (
    <LandingFrame tab="sign-in" redirectUrl={params.redirect_url}>
      <SignIn path="/sign-in" appearance={BOX_APPEARANCE} />
      <SignInExtras />
    </LandingFrame>
  );
}
