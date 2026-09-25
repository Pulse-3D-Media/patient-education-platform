import { auth } from "@clerk/nextjs/server";
import { OrganizationProfile } from "@clerk/nextjs";
import Link from "next/link";
import { AdminsOnly } from "@/components/ui/AdminsOnly";
import { ClinicShell } from "@/components/ui/ClinicShell";
import { requireClinicPage } from "@/lib/clinic";
import { clinicIsOpen } from "@/lib/clinic-status";
import { getSeatSummary } from "@/lib/db/seats";
import { ROLE_WORDS } from "@/lib/role-names";
import { checkSeats } from "@/lib/seat-changes";
import { seatCountWords, seatsFullMessage } from "@/lib/seats";
import { AdminFrame } from "../AdminFrame";
import { AdminSwitch, InviteForm, OwnerHandoff, RemoveButton, RevokeButton, SeatButton } from "./PeopleControls";

/**
 * The People section of the clinic admin area, at /admin/people. Admins only.
 *
 * THE SEAT MODEL (lib/seats.ts): the account owner is the one person who
 * does not need a seat; everyone else holds one of the seats the clinic pays
 * for, and an open invitation holds one too. Admin on or off is a separate
 * switch and never changes the seat count.
 *
 *   1. "2 of 3 seats in use" at the top, and in plain words anything that
 *      needs settling: people waiting for a seat, a plan that pays for fewer
 *      seats than are taken, a clinic with no account owner.
 *   2. Everyone in the clinic, each with Member / Member with admin, where
 *      they stand with a seat, and Remove. The owner's row cannot be switched
 *      to Member or removed; the owner decides whether to take a seat.
 *   3. Invite someone (holds a seat until accepted), and the open invitations
 *      with Revoke.
 *   4. For the owner: hand the account to another admin.
 *   5. Clerk's own organization panel, for the clinic's name and logo.
 *
 * Every button asks a Server Action (actions.ts), which checks on the server
 * who is asking and goes through lib/seat-changes.ts. Opening this page also
 * brings the seats into line with Clerk (checkSeats): an accepted invitation
 * becomes the person's seat, someone who left or an invitation revoked
 * elsewhere frees theirs, and a free seat goes to whoever has waited longest.
 *
 * Until the clinic is paid for (open), there is nothing to manage: the page
 * says "Choose a plan first" and offers no invitations.
 */
export const dynamic = "force-dynamic";

const LINK = "font-medium text-brand-bright underline underline-offset-2";
const NOTICE = "rounded-xl border border-line bg-surface p-4 text-[15px]";

export default async function PeoplePage() {
  const clinic = await requireClinicPage();

  if (!clinic.isAdmin) {
    return (
      <ClinicShell clinic={clinic}>
        <AdminsOnly />
      </ClinicShell>
    );
  }

  // Nobody is invited before the clinic is paid for. The frame and its
  // navigation stay, so Billing is one tap away.
  if (!clinicIsOpen(clinic)) {
    return (
      <AdminFrame clinic={clinic} title="People">
        <div className="mt-8 max-w-2xl rounded-2xl border border-line bg-surface p-6">
          <h2 className="text-lg font-semibold">Choose a plan first</h2>
          <p className="mt-2 text-ink-soft">
            Once your clinic&apos;s plan is paid for, you can invite your team here, one seat each. Your plan and its seats are on the{" "}
            <Link href="/admin/billing" className={LINK}>
              Billing page
            </Link>
            .
          </p>
        </div>
      </AdminFrame>
    );
  }

  // Who is looking, for "(you)" and for what the owner alone may do. The
  // people come from the clinic's own organization, which checkSeats() reads
  // from the clinic's row; no organization id is handled here.
  const { userId } = await auth();
  const board = await checkSeats(clinic.id).catch((error) => {
    console.error("People: the clinic's people could not be read", error instanceof Error ? error.name : "unknown error");
    return null;
  });

  if (!board) {
    // Clerk could not be read. The seats are in our own tables, so those are still known.
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

  const { people, summary, invitations } = board;
  const iAmOwner = board.ownerUserId !== null && board.ownerUserId === userId;
  const otherAdmins = people.filter((person) => person.role === "admin" && person.userId !== userId).map(({ userId, name }) => ({ userId, name }));
  const outsideInvites = invitations?.filter((invitation) => !invitation.holdsSeat).length ?? 0;

  return (
    <AdminFrame
      clinic={clinic}
      title="People"
      intro={
        <>
          Everyone who can sign in to {clinic.name}. Each person uses one of your clinic&apos;s seats, except the account owner, who can take one or not.
          Admin is a separate switch: it adds the admin pages and never changes the seat count.
        </>
      }
    >
      <section aria-labelledby="people-heading" className="mt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="people-heading" className="text-lg font-semibold">
            {seatCountWords(summary)}
            <span className="ml-3 text-base font-normal text-ink-muted">
              {people.length} {people.length === 1 ? "person" : "people"} in the clinic
            </span>
          </h2>
          <Link href="/admin/billing" className={`text-sm ${LINK}`}>
            Seats and plan on Billing
          </Link>
        </div>

        <div className="mt-3 flex flex-col gap-2 empty:hidden">
          {board.ownerUserId === null && (
            <p className={`${NOTICE} text-warn`}>
              Your clinic has no account owner on record. Get in touch with Pulse 3D and we will set one for you.
            </p>
          )}
          {board.ownerNotAdmin && (
            <p className={`${NOTICE} text-warn`}>
              The account owner&apos;s admin was switched off in the organization panel. The owner should always have admin: switch it back on below.
            </p>
          )}
          {summary.overBy > 0 && (
            <p className={`${NOTICE} text-warn`}>
              {summary.inUse} seats are taken and your plan pays for {summary.seats}. Nobody has been removed and nothing extra is being charged. Nobody
              else can be given a seat until someone is removed, an invitation is revoked, or seats are added.
            </p>
          )}
          {board.waiting > 0 && (
            <p className={`${NOTICE} text-ink-soft`}>
              {board.waiting} {board.waiting === 1 ? "person is" : "people are"} waiting for a seat, because none was free. They can use the library as
              usual. {board.waiting === 1 ? "They get" : "Each gets"} a seat as soon as one is free, whoever joined first going first. To settle it now,
              remove someone, revoke an invitation, or add seats on the Billing page.
            </p>
          )}
        </div>

        <ul className="mt-3 flex flex-col gap-3">
          {people.map((person) => {
            const me = person.userId === userId;
            return (
              <li key={person.userId} className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 items-center gap-4">
                  {/* eslint-disable-next-line @next/next/no-img-element -- Clerk serves the avatar already sized */}
                  <img src={person.imageUrl} alt="" className="h-11 w-11 shrink-0 rounded-full bg-wash-strong" />
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-lg font-semibold">
                      <span className="truncate">{person.name}</span>
                      {me && <span className="text-sm font-normal text-ink-muted">(you)</span>}
                      {person.isOwner && (
                        <span className="rounded-md bg-brand/20 px-2 py-0.5 text-[13px] font-medium uppercase tracking-wide text-brand-bright">
                          Account owner
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 truncate text-sm text-ink-muted">{person.email}</p>
                    <p className={`mt-1 text-sm ${person.seat === "waiting" ? "text-warn" : "text-ink-soft"}`}>
                      {person.seat === "held" ? "Holds a seat" : person.seat === "waiting" ? "Waiting for a seat" : "No seat (the account owner does not need one)"}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-start gap-3 lg:justify-end">
                  {/* The key changes whenever the server's answer does, so the control starts again from it. */}
                  <AdminSwitch key={`${person.userId}:${person.role}`} userId={person.userId} name={person.name} role={person.role} isOwner={person.isOwner} />
                  {person.seat === "waiting" && summary.free > 0 && <SeatButton key={`${person.userId}:give`} userId={person.userId} mode="give" />}
                  {person.isOwner && me && person.seat === "none" && summary.free > 0 && <SeatButton key={`${person.userId}:take`} userId={person.userId} mode="take" />}
                  {person.isOwner && me && person.seat === "held" && <SeatButton key={`${person.userId}:release`} userId={person.userId} mode="release" />}
                  {!person.isOwner && !me && <RemoveButton userId={person.userId} name={person.name} holdsSeat={person.seat === "held"} />}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="invite-heading" className="mt-12">
        <h2 id="invite-heading" className="text-lg font-semibold">
          Invite someone
        </h2>
        <p className="mt-1 max-w-2xl text-ink-soft">
          They get an email to join {clinic.name}. An invitation holds a seat until it is accepted, revoked or expires, so you can send as many as you
          have free seats.
        </p>
        {summary.free > 0 ? (
          <InviteForm />
        ) : (
          <p className={`mt-4 max-w-2xl ${NOTICE} text-ink-soft`}>
            {seatsFullMessage(summary)}{" "}
            <Link href="/admin/billing" className={LINK}>
              Billing
            </Link>
          </p>
        )}

        <h3 className="mt-8 text-base font-semibold">Open invitations</h3>
        {invitations === null ? (
          <p className="mt-2 text-ink-soft">We could not read your open invitations just now. Reload this page in a moment.</p>
        ) : invitations.length === 0 ? (
          <p className="mt-2 text-ink-soft">None.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {invitations.map((invitation) => (
              <li key={invitation.id} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate font-medium">{invitation.email}</p>
                  <p className={`text-sm ${invitation.holdsSeat ? "text-ink-muted" : "text-warn"}`}>
                    {ROLE_WORDS[invitation.role]}. {invitation.holdsSeat ? "Holds a seat." : "Sent from outside this page, so it holds no seat: they will arrive waiting for one."}
                  </p>
                </div>
                <RevokeButton invitationId={invitation.id} email={invitation.email} holdsSeat={invitation.holdsSeat} />
              </li>
            ))}
          </ul>
        )}
        {outsideInvites > 0 && (
          <p className="mt-3 max-w-2xl text-sm text-ink-muted">Please invite people from this page: an invitation sent from anywhere else does not hold a seat.</p>
        )}
      </section>

      {iAmOwner && (
        <section aria-labelledby="owner-heading" className="mt-12">
          <h2 id="owner-heading" className="text-lg font-semibold">
            Make someone else the account owner
          </h2>
          <p className="mt-1 max-w-2xl text-ink-soft">
            You are the account owner. The owner cannot be removed or have admin switched off, so hand the account over first if you are leaving. Only
            people with admin on can take it.
          </p>
          <OwnerHandoff admins={otherAdmins} />
        </section>
      )}

      <section aria-labelledby="clerk-heading" className="mt-12">
        <h2 id="clerk-heading" className="text-lg font-semibold">
          Clinic name and logo
        </h2>
        <p className="mt-1 mb-4 max-w-2xl text-ink-soft">
          Change your clinic&apos;s name or logo under General. Invite, remove and admin changes belong in the sections above: those look after your seats
          and the account owner, and this panel does not.
        </p>
        {/* Hash routing keeps the panel on this one page. General first, since it is what this panel is here for. */}
        <OrganizationProfile routing="hash">
          <OrganizationProfile.Page label="general" />
          <OrganizationProfile.Page label="members" />
        </OrganizationProfile>
      </section>
    </AdminFrame>
  );
}
