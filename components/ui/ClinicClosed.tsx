import type { ClinicStatus } from "@prisma/client";
import { SignOutButton } from "@clerk/nextjs";
import Link from "next/link";

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
 *
 * `billingLink` is true when the person is an admin of the clinic: they get
 * a button to /admin/billing, the one admin page that stays open for a
 * closed clinic, because that is where the plan is seen and, once billing
 * exists, fixed. Members do not get it; billing is an admin page.
 *
 * `inFrame` is true when the caller has already drawn the clinic name and
 * a page title around this (the admin pages do), so they are not repeated.
 */
export function ClinicClosed({
  status,
  clinicName,
  billingLink = false,
  inFrame = false,
}: {
  status: ClinicStatus;
  clinicName: string;
  billingLink?: boolean;
  inFrame?: boolean;
}) {
  const { heading, body } = COPY[status];
  // On its own this is the page's main landmark. Inside an admin page the
  // frame already has one, and a page must not have two, so a plain div.
  const Wrapper = inFrame ? "div" : "main";
  return (
    <Wrapper className={inFrame ? "" : "px-5 py-6 sm:px-8"}>
      <div className={inFrame ? "max-w-xl py-4" : "mx-auto max-w-xl py-10"}>
        {!inFrame && <p className="text-sm font-medium uppercase tracking-wider text-[#667085]">{clinicName}</p>}
        {inFrame ? (
          <h2 className="text-xl font-semibold">{heading}</h2>
        ) : (
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">{heading}</h1>
        )}
        <p className="mt-3 text-[#bfbfbf]">{body}</p>
        {billingLink && (
          <Link
            href="/admin/billing"
            className="mt-5 inline-flex h-11 items-center rounded-lg bg-[#2a829b] px-5 text-sm font-medium text-white transition hover:bg-[#1e5668]"
          >
            Go to billing
          </Link>
        )}
        <p className="mt-6 text-[#bfbfbf]">Signed in with the wrong account? Sign out and try the other one.</p>
        <SignOutButton>
          <button
            type="button"
            className="mt-6 inline-flex h-11 items-center rounded-lg border border-white/15 px-5 text-sm font-medium text-[#bfbfbf] transition hover:border-[#2a829b] hover:text-white"
          >
            Sign out
          </button>
        </SignOutButton>
      </div>
    </Wrapper>
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
