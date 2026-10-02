import { redirect } from "next/navigation";

/**
 * The root address sends you to /onboarding, which sends each person on to
 * the right place: the account owner of a clinic that is not paid for yet to
 * Billing, everyone else to the library, and someone with no clinic to the
 * "Set up your clinic" form. There is no home page of its own, and patients
 * arrive by share link at /watch/[code], never at the root.
 *
 * Why not straight to the library: a signed-out visitor to the root is sent
 * to sign in (or sign up) and brought back to the address they asked for.
 * When that address was the library, a brand-new clinic's owner finished
 * signing up on the library's "choose a plan" page instead of on Billing.
 * Coming back to /onboarding routes them properly. A surgeon who opens
 * /library directly (a bookmark) goes straight there, as before.
 */
export default function Home() {
  redirect("/onboarding");
}
