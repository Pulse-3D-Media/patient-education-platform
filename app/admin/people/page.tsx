import { auth } from "@clerk/nextjs/server";
import { OrganizationProfile } from "@clerk/nextjs";
import Link from "next/link";
import { AdminsOnly } from "@/components/ui/AdminsOnly";
import { ClinicShell } from "@/components/ui/ClinicShell";
import { ClinicClosed } from "@/components/ui/ClinicClosed";
import { requireClinicPage } from "@/lib/clinic";
import { clinicIsOpen } from "@/lib/clinic-status";
import { getSeatSummary } from "@/lib/db/seats";
import { checkSeats } from "@/lib/seat-changes";
import { seatCountWords } from "@/lib/seats";
import { AdminFrame } from "../AdminFrame";
import { KindControl } from "./KindControl";

/**
 * The People section of the clinic admin area, at /admin/people. Admins only.
 *
 * Two parts:
 *
 *   1. Our list of everyone in the clinic, with a Surgeon / Staff control
 *      on each row and "2 of 3 surgeon seats in use" at the top. Kind is
 *      what the clinic pays for (lib/roles.ts); the label lives on the Clerk
 *      membership, who holds a paid seat lives in our own table
 *      (lib/seats.ts), and both are changed through the Server Action in
 *      actions.ts, which holds every change to the clinic's seat limit.
 *
 *   2. Clerk's own organization panel, which handles inviting people by
 *      email, changing someone's role (admin or member) and removing them.
 *      Nothing to build for those; Clerk's component does it and enforces
 *      that only admins can. Its Members tab is the one that matters here.
 *
 * A clinic can have as many surgeons HOLDING A SEAT as its plan pays for,
 * and no more. Staff are free and never take one. Opening this page also
 * brings the seats into line with the people (checkSeats in
 * lib/seat-changes.ts): someone removed in the panel below has their seat
 * let go, and a surgeon who was waiting is given a seat that has come free.
 * Whatever is left over is said in plain words at the top: surgeons waiting
 * for a seat, a change that did not finish saving, a plan that pays for
 * fewer seats than are held. Nobody is ever relabelled to make the numbers fit.
 */
export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const clinic = await requireClinicPage();

  if (!clinic.isAdmin) {
    return (
      <ClinicShell clinic={clinic}>
        <AdminsOnly />
      </ClinicShell>
    );
  }

  // A clinic that is not open: the frame and its navigation stay, so Billing
  // is one tap away, but there is nothing to manage here until it opens.
  if (!clinicIsOpen(clinic)) {
    return (
      <AdminFrame clinic={clinic} title="People">
        <div className="mt-6">
          <ClinicClosed status={clinic.status} clinicName={clinic.name} billingLink inFrame />
        </div>
      </AdminFrame>
    );
  }

  // The organization id is needed to list its people. It is read from the
  // session here and handed to lib/people; it never goes to the browser or
  // to lib/db.
  // Who is looking, for the "(you)" beside their own name. The people come
  // from the clinic's own organization, which checkSeats() reads from the
  // clinic's row; no organization id is handled here.
  const { userId } = await auth();
  const board = await checkSeats(clinic.id).catch((error) => {
    console.error("People: the clinic's people could not be read", error instanceof Error ? error.name : "unknown error");
    return null;
  });

  if (!board) {
    // Clerk could not be read. The seats are in our own table, so those are still known.
    const stored = await getSeatSummary(clinic.id);
    return (
      <AdminFrame clinic={clinic} title="People">
        <p role="alert" className="mt-8 max-w-2xl rounded-2xl border border-line bg-surface p-5 text-ink-soft">
          We could not read your clinic&apos;s people just now. Nothing has been changed. Reload this page in a moment.
          {stored && <> From our own records: {seatCountWords(stored)}.</>}
        </p>
      </AdminFrame>
    );
  }

  const { people, summary } = board;
  const unanswered = people.filter((person) => person.kind === null).length;

  return (
    <AdminFrame
      clinic={clinic}
      title="People"
      intro={
        <>
          Everyone who can sign in to {clinic.name}. Surgeons are what your clinic pays for, one seat each; staff are free and
          never take a seat. Neither changes what a person can do: that is their role, set in the panel further down.
        </>
      }
    >
      <section aria-labelledby="people-heading" className="mt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="people-heading" className="text-lg font-semibold">
            {summary.inUse} of {summary.seats} surgeon {summary.seats === 1 ? "seat" : "seats"} in use
            <span className="ml-3 text-base font-normal text-ink-muted">
              {people.length} {people.length === 1 ? "person" : "people"} in the clinic
            </span>
          </h2>
          {unanswered > 0 && (
            <p className="text-sm text-warn">
              {unanswered} {unanswered === 1 ? "person has" : "people have"} not said yet. Mark them here, or they
              will be asked next time they sign in.
            </p>
          )}
        </div>

        <div className="mt-3 flex flex-col gap-2 empty:hidden">
          {summary.overBy > 0 && (
            <p className="rounded-xl border border-line bg-surface p-4 text-[15px] text-warn">
              {summary.inUse} people hold a surgeon seat and your plan pays for {summary.seats}. Nobody has been changed and nothing extra is being
              charged. Nobody else can be given a seat until a surgeon is marked as Staff, or a seat is added: get in touch with Pulse 3D for that.
            </p>
          )}
          {summary.seats === 0 && (
            <p className="rounded-xl border border-line bg-surface p-4 text-[15px] text-ink-soft">
              Your clinic has no surgeon seats yet, so nobody holds one. Seats come with your plan, on the{" "}
              <Link href="/admin/billing" className="font-medium text-brand-bright underline underline-offset-2">
                Billing page
              </Link>
              .
            </p>
          )}
          {board.waiting > 0 && (
            <p className="rounded-xl border border-line bg-surface p-4 text-[15px] text-ink-soft">
              {board.waiting} {board.waiting === 1 ? "person is marked as a surgeon and has" : "people are marked as surgeons and have"} no seat, because
              none is free. They can use the library as usual. {board.waiting === 1 ? "They get" : "Each gets"} a seat as soon as one is free, whoever
              joined first going first. To settle it now, mark someone as Staff, or get in touch with Pulse 3D to add a seat.
            </p>
          )}
          {board.pending > 0 && (
            <p className="rounded-xl border border-line bg-surface p-4 text-[15px] text-warn">
              A change for {board.pending} {board.pending === 1 ? "person" : "people"} did not finish saving. Press Try again beside their name. Left
              alone, it undoes itself in a few minutes and the seat comes free again.
            </p>
          )}
        </div>

        <ul className="mt-3 flex flex-col gap-3">
          {people.map((person) => (
            <li
              key={person.userId}
              className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-center gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element -- Clerk serves the avatar already sized */}
                <img src={person.imageUrl} alt="" className="h-11 w-11 shrink-0 rounded-full bg-wash-strong" />
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-lg font-semibold">
                    <span className="truncate">{person.name}</span>
                    {person.userId === userId && <span className="text-sm font-normal text-ink-muted">(you)</span>}
                    <span
                      className={`rounded-md px-2 py-0.5 text-[13px] font-medium uppercase tracking-wide ${
                        person.role === "admin" ? "bg-brand/20 text-brand-bright" : "bg-wash-strong text-ink-soft"
                      }`}
                    >
                      {person.role}
                    </span>
                  </p>
                  <p className="mt-0.5 truncate text-sm text-ink-muted">{person.email}</p>
                </div>
              </div>
              {/* The key changes whenever the server's answer for this person does, so the control starts again from it. */}
              <KindControl
                key={`${person.userId}:${person.kind}:${person.seat}`}
                userId={person.userId}
                name={person.name}
                kind={person.kind}
                seat={person.seat}
              />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="clerk-heading" className="mt-12">
        <h2 id="clerk-heading" className="text-lg font-semibold">
          Invite, change roles, remove
        </h2>
        <p className="mt-1 mb-4 max-w-2xl text-ink-soft">
          Open the Members tab to invite someone by email, make them an admin or a member, or remove them. New
          people are asked the surgeon question when they first sign in.
        </p>
        {/* Hash routing keeps the panel on this one page instead of needing its own routes. */}
        <OrganizationProfile routing="hash" />
      </section>
    </AdminFrame>
  );
}
