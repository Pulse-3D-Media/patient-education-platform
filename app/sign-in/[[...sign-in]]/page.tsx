import { SignIn } from "@clerk/nextjs";
import { LOGO_URL } from "@/lib/brand";

/**
 * The sign-in page, at /sign-in, built from Clerk's prebuilt component.
 *
 * The folder is a catch-all ([[...sign-in]]) because Clerk's component moves
 * between steps on its own sub-paths (/sign-in/factor-one and so on) and
 * this one page has to answer all of them.
 *
 * Signed-out visitors of /admin or /library are sent here by proxy.ts with
 * the page they wanted in the address (redirect_url). After signing in,
 * Clerk takes them back there. Someone who opens /sign-in directly lands on
 * the library.
 *
 * If a clinic requires the user to pick an organization after signing in
 * (a "session task" in Clerk's words), this same component shows that step
 * too. Nothing extra to build for it.
 */
export default function SignInPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-[#e4ebf3] px-4 py-10">
      {/* eslint-disable-next-line @next/next/no-img-element -- small static logo from the CDN */}
      <img src={LOGO_URL} alt="Pulse 3D" className="h-9 w-auto" />
      <SignIn path="/sign-in" />
      <p className="max-w-sm text-center text-sm text-[#667085]">
        Staff sign-in for the Pulse 3D Patient Education Library. Patients do not need an account:
        the link from your clinic opens on its own.
      </p>
    </main>
  );
}
