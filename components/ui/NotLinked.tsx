import { SignOutButton } from "@clerk/nextjs";

/**
 * What a signed-in person sees on /admin or /library when their account is
 * not connected to a clinic: either they have no active organization in
 * Clerk, or no Clinic row has been linked to that organization yet.
 *
 * Calm on purpose. Nothing is broken on their side; someone at Pulse 3D
 * has to finish the link. The sign-out button is here so they are not
 * stuck on this page if they signed in with the wrong account.
 */
export function NotLinked() {
  return (
    <main className="px-5 py-6 sm:px-8">
      <div className="mx-auto max-w-xl py-10">
        <h1 className="text-2xl font-semibold sm:text-3xl">Your account isn&rsquo;t linked to a clinic yet.</h1>
        <p className="mt-3 text-[#bfbfbf]">
          You are signed in, but this account is not connected to a clinic, so there is nothing to show.
          Ask Pulse 3D to link your clinic, then open this page again.
        </p>
        <p className="mt-2 text-[#bfbfbf]">
          Signed in with the wrong account? Sign out and try the other one.
        </p>
        <SignOutButton>
          <button
            type="button"
            className="mt-6 inline-flex h-11 items-center rounded-lg bg-[#2a829b] px-5 text-sm font-medium text-white transition hover:bg-[#1e5668]"
          >
            Sign out
          </button>
        </SignOutButton>
      </div>
    </main>
  );
}
