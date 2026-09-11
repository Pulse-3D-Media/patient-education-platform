import type { ClinicStatus } from "@prisma/client";
import { SignOutButton } from "@clerk/nextjs";

/**
 * What a signed-in person sees on /library or /admin when their clinic is
 * not open (clinicIsOpen() in lib/clinic-status.ts said no).
 *
 * A PENDING clinic has just been set up and has not chosen a plan; that is
 * the normal case today. The other statuses are set by billing later and
 * get a short line each so nobody is left staring at a blank page.
 *
 * Calm on purpose: nothing is broken on their side. The sign-out button is
 * here so someone who signed in with the wrong account is not stuck.
 */
export function ClinicClosed({ status, clinicName }: { status: ClinicStatus; clinicName: string }) {
  const { heading, body } = COPY[status];
  return (
    <main className="px-5 py-6 sm:px-8">
      <div className="mx-auto max-w-xl py-10">
        <p className="text-sm font-medium uppercase tracking-wider text-[#667085]">{clinicName}</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">{heading}</h1>
        <p className="mt-3 text-[#bfbfbf]">{body}</p>
        <p className="mt-2 text-[#bfbfbf]">Signed in with the wrong account? Sign out and try the other one.</p>
        <SignOutButton>
          <button
            type="button"
            className="mt-6 inline-flex h-11 items-center rounded-lg border border-white/15 px-5 text-sm font-medium text-[#bfbfbf] transition hover:border-[#2a829b] hover:text-white"
          >
            Sign out
          </button>
        </SignOutButton>
      </div>
    </main>
  );
}

const COPY: Record<ClinicStatus, { heading: string; body: string }> = {
  PENDING: {
    heading: "Your clinic is set up. Choose a plan to start.",
    body: "Plans are coming soon. Until they open, Pulse 3D switches clinics on by hand: get in touch and we will turn yours on.",
  },
  ACTIVE: {
    // Never shown: an ACTIVE clinic is open. Here only so every status has copy.
    heading: "Your clinic is active.",
    body: "Open the library to get started.",
  },
  PAUSED: {
    heading: "Your clinic's plan is paused.",
    body: "The library and share links are off while the plan is paused. Your clinic's admin can start it again from billing.",
  },
  PAST_DUE: {
    heading: "Your clinic's last payment did not go through.",
    body: "Update the payment method in billing and the library opens again straight away.",
  },
  CANCELED: {
    heading: "Your clinic's plan has ended.",
    body: "Choose a plan to start again. Your clinic's people and settings are kept.",
  },
};
