import { SignUp } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { LOGO_URL } from "@/lib/brand";

/**
 * The sign-up page, at /sign-up, built from Clerk's prebuilt component. The
 * sign-in page links here. A new account goes on to /onboarding (the
 * fallback address set in StaffClerkProvider), which sends the creator of a
 * new clinic to Billing and anyone who joined one to the library.
 *
 * It is also where an invitation email lands (the invitation's return
 * address, set in lib/people.ts). Clerk checks the link, then sends the person
 * here with the invitation's ticket in the address, and says what they need:
 *
 *   __clerk_status=sign_up    a new person: the component below creates their
 *                             account and accepts the invitation with it.
 *   __clerk_status=sign_in    they already have an account: they are handed
 *                             to /sign-in with the same address, whose
 *                             component signs them in and accepts it.
 *   __clerk_status=complete   already accepted: on to /onboarding.
 *
 * The folder is a catch-all ([[...sign-up]]) for the same reason as
 * sign-in: Clerk's component moves between steps on its own sub-paths.
 */
export default async function SignUpPage({ searchParams }: PageProps<"/sign-up/[[...sign-up]]">) {
  const params = await searchParams;
  const status = typeof params.__clerk_status === "string" ? params.__clerk_status : null;
  if (status === "complete") redirect("/onboarding");
  if (status === "sign_in") {
    // The ticket and status travel with them unchanged; nothing else is added.
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (typeof value === "string") query.set(key, value);
    redirect(`/sign-in?${query.toString()}`);
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-[#e4ebf3] px-4 py-10">
      {/* eslint-disable-next-line @next/next/no-img-element -- small static logo from the CDN */}
      <img src={LOGO_URL} alt="Pulse 3D" className="h-9 w-auto" />
      <SignUp path="/sign-up" />
      <p className="max-w-sm text-center text-sm text-[#667085]">
        For clinic staff. Once you are in, you can set up your clinic or join one you were invited to. Patients never
        need an account.
      </p>
    </main>
  );
}
