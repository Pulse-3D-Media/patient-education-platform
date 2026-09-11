import { SignUp } from "@clerk/nextjs";
import { LOGO_URL } from "@/lib/brand";

/**
 * The sign-up page, at /sign-up, built from Clerk's prebuilt component. The
 * sign-in page links here. A new account lands on the library, which sends
 * anyone without a clinic to /onboarding to set one up.
 *
 * The folder is a catch-all ([[...sign-up]]) for the same reason as
 * sign-in: Clerk's component moves between steps on its own sub-paths.
 */
export default function SignUpPage() {
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
