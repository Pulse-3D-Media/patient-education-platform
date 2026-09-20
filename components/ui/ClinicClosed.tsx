import type { ClinicStatus } from "@prisma/client";
import { SignOutButton } from "@clerk/nextjs";
import Link from "next/link";

/**
 * What a signed-in person sees on /library or /admin when their clinic is
 * not open (clinicIsOpen() in lib/clinic-status.ts said no).
 *
 * A PENDING clinic has just been set up and has not chosen a plan. The
 * other statuses come from billing or from Pulse staff. Each gets a short
 * line so nobody is left staring at a blank page.
 *
 * The words do not promise that a plan can be bought on the Billing page:
 * whether it can depends on the deployment and the clinic (the Billing page
 * itself says). They only say where to go, and who can go there.
 *
 * Calm on purpose: nothing is broken on their side. The sign-out button is
 * here so someone who signed in with the wrong account is not stuck.
 *
 * `billingLink` is true when the person is an admin of the clinic: they get
 * a button to /admin/billing, the one admin page that stays open for a
 * closed clinic, because that is where a plan is chosen, paid for and
 * fixed. Members do not get it; billing is an admin page, so they are told
 * to ask an admin instead.
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
        {!inFrame && <p className="text-sm font-medium uppercase tracking-wider text-ink-muted">{clinicName}</p>}
        {inFrame ? (
          <h2 className="text-xl font-semibold">{heading}</h2>
        ) : (
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">{heading}</h1>
        )}
        <p className="mt-3 text-ink-soft">{body}</p>
        {!billingLink && <p className="mt-3 text-ink-soft">Plans and payments are handled by your clinic&rsquo;s office admins. Ask one of them to open Billing.</p>}
        {billingLink && (
          <Link
            href="/admin/billing"
            className="mt-5 inline-flex h-11 items-center rounded-lg bg-brand px-5 text-sm font-medium text-on-brand transition hover:bg-brand-hover"
          >
            Go to billing
          </Link>
        )}
        <p className="mt-6 text-ink-soft">Signed in with the wrong account? Sign out and try the other one.</p>
        <SignOutButton>
          <button
            type="button"
            className="mt-6 inline-flex h-11 items-center rounded-lg border border-line-strong px-5 text-sm font-medium text-ink-soft transition hover:border-brand hover:text-ink"
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
    body: "The library opens once your clinic is on a plan. Billing is where a plan is chosen, and it says what to do if plans are not open for your clinic yet.",
  },
  ACTIVE: {
    // Never shown: an ACTIVE clinic is open. Here only so every status has copy.
    heading: "Your clinic is active.",
    body: "Open the library to get started.",
  },
  PAUSED: {
    heading: "Your clinic's plan is paused.",
    body: "The library and share links are off while the plan is paused. Billing says where things stand.",
  },
  PAST_DUE: {
    heading: "Your clinic's last payment did not go through.",
    body: "The library and share links are off until it is sorted out. Billing says where things stand and what to do.",
  },
  CANCELED: {
    heading: "Your clinic's plan has ended.",
    body: "Your clinic's people and settings are kept. Billing is where a plan is started again.",
  },
};
