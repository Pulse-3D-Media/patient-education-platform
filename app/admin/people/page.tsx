import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { staffLook } from "@/app/brand-look";
import { AdminsOnly } from "@/components/ui/AdminsOnly";
import { ClinicShell } from "@/components/ui/ClinicShell";
import { PatientPhonePreview } from "@/components/ui/PatientPhonePreview";
import { requireClinicPage } from "@/lib/clinic";
import { clinicIsOpen } from "@/lib/clinic-status";
import { getSeatSummary } from "@/lib/db/seats";
import { getShareTerms } from "@/lib/db/shares";
import { afterFirstPlaySentence } from "@/lib/expiry";
import { ROLE_WORDS } from "@/lib/role-names";
import { checkSeats, listRemovablePeople, type SeatedPerson } from "@/lib/seat-changes";
import { seatCountWords, seatsFullMessage, type SeatSummary } from "@/lib/seats";
import { AdminFrame } from "../AdminFrame";
import { DetailHeader, Rule, WithPreview, daysAgo, longDate } from "../DetailParts";
import { SplitView, type SplitItem } from "../SplitView";
import { AdminSwitch, InviteForm, OwnerHandoff, PatientNameEditor, RemoveButton, RevokeButton, SeatButton } from "./PeopleControls";

/**
 * The People section of the clinic admin area, at /admin/people (the
 * approved design, screen 10). Admins only.
 *
 * THE SEAT MODEL (lib/seats.ts): the account owner is the one person who
 * does not need a seat; everyone else holds one of the seats the clinic pays
 * for, and an open invitation holds one too. Admin on or off is a separate
 * switch and never changes the seat count.
 *
 * A list on the left, the chosen item's detail on the right (SplitView):
 *
 *   - At the top, the seats bar ("4 of 4") and, in plain words, anything
 *     that needs settling: people waiting for a seat, a plan that pays for
 *     fewer seats than are taken, a clinic with no account owner.
 *   - Everyone in the clinic. A person's detail: where they stand with a
 *     seat, the name patients see on their links with Change (only someone
 *     holding a seat sends links), the Admin switch, the seat buttons that
 *     apply (Give a seat, Take a seat, Give up my seat), Remove from clinic
 *     (asks first), and for the owner looking at themself, handing the
 *     account to another admin. A picture of the patient page shows the name
 *     a seated person's patients see.
 *   - "Waiting to join": the open invitations, each with Revoke (asks first).
 *   - "Invite" at the top: an email and Member or Member with admin.
 *
 * Clerk's own organization panel is NOT on this page (taken off in October
 * 2026). The clinic's name and logo are changed on Clinic branding.
 *
 * Every control asks a Server Action (actions.ts), which checks on the
 * server who is asking and goes through lib/seat-changes.ts. Opening this
 * page also brings the seats into line with Clerk (checkSeats).
 *
 * Until the clinic is paid for (open), the page says "Choose a plan first",
 * offers no invitations, and lists the other people with Remove only.
 */
export const dynamic = "force-dynamic";

const LINK = "font-medium text-brand-bright underline underline-offset-2";

type PeopleProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

export default async function PeoplePage(props: PeopleProps = {}) {
  const clinic = await requireClinicPage();

  if (!clinic.isAdmin) {
    return (
      <ClinicShell clinic={clinic}>
        <AdminsOnly />
      </ClinicShell>
    );
  }

  // Nobody is invited before the clinic is paid for. The frame and its
  // navigation stay, so Billing is one tap away. Removing someone is the one
  // thing that still works while closed (removePersonAction), so a departed
  // admin can be taken out of a paused or unpaid clinic.
  if (!clinicIsOpen(clinic)) {
    const { userId: viewerId } = await auth();
    const removable = await listRemovablePeople(clinic.id, viewerId ?? null);
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

        {removable === null ? (
          <p role="alert" className="mt-6 max-w-2xl text-ink-soft">
            We could not read your clinic&apos;s people just now. Reload this page in a moment.
          </p>
        ) : (
          removable.length > 0 && (
            <section aria-labelledby="remove-heading" className="mt-10 max-w-2xl">
              <h2 id="remove-heading" className="text-lg font-semibold">
                Remove someone who has left
              </h2>
              <ul className="mt-3 flex flex-col gap-3">
                {removable.map((person) => (
                  <li key={person.userId} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{person.name}</p>
                      <p className="truncate text-sm text-ink-muted">
                        {person.email} · {ROLE_WORDS[person.role]}
                      </p>
                    </div>
                    <RemoveButton userId={person.userId} name={person.name} holdsSeat={false} label="Remove from clinic" />
                  </li>
                ))}
              </ul>
            </section>
          )
        )}
      </AdminFrame>
    );
  }

  // Who is looking, for "(you)" and for what the owner alone may do. The
  // people come from the clinic's own organization, which checkSeats() reads
  // from the clinic's row; no organization id is handled here.
  const { userId } = await auth();
  const [board, terms, params] = await Promise.all([
    checkSeats(clinic.id).catch((error) => {
      console.error("People: the clinic's people could not be read", error instanceof Error ? error.name : "unknown error");
      return null;
    }),
    // Only for the line under the video in the picture of the patient page. A setting out of range leaves the line out.
    getShareTerms(clinic.id).catch(() => null),
    props.searchParams ?? Promise.resolve({} as Record<string, string | string[] | undefined>),
  ]);

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
  const look = staffLook(clinic);
  const now = new Date();

  const personItems: SplitItem[] = people.map((person) => {
    const me = person.userId === userId;
    const roleWord = person.isOwner ? "Owner" : person.role === "admin" ? "Admin" : "Member";
    const seatWord = person.seat === "held" ? "sends videos" : person.seat === "waiting" ? "waiting for a seat" : null;
    return {
      key: `person-${person.userId}`,
      dot: person.seat === "waiting",
      title: (
        <>
          {person.name}
          {me && <span className="ml-1.5 text-sm font-normal text-ink-muted">(you)</span>}
        </>
      ),
      sub: seatWord ? `${roleWord} · ${seatWord}` : roleWord,
      detail: (
        <PersonDetail
          person={person}
          me={me}
          summary={summary}
          iAmOwner={iAmOwner}
          otherAdmins={otherAdmins}
          preview={
            person.seat === "held" ? (
              <PatientPhonePreview
                clinicName={clinic.name}
                logoUrl={look.logoUrl}
                color={clinic.branding.color}
                fontClass={look.fontClass}
                senderName={person.patientName}
                title="Total Knee Replacement"
                deadline={terms ? afterFirstPlaySentence(terms.daysAfterFirstPlay) : null}
              />
            ) : null
          }
        />
      ),
    };
  });

  const invitationItems: SplitItem[] = (invitations ?? []).map((invitation) => {
    const sent = new Date(invitation.createdAt);
    return {
      key: `invitation-${invitation.id}`,
      dot: true,
      title: invitation.email,
      sub: `Sent ${daysAgo(sent, now)}`,
      detail: (
        <>
          <DetailHeader title={invitation.email} sub={`Invited ${longDate(sent)} · ${ROLE_WORDS[invitation.role]}`} />
          <div className="mt-8 max-w-xl">
            <p className={`text-[16px] ${invitation.holdsSeat ? "text-ink" : "text-warn"}`}>
              {invitation.holdsSeat
                ? "Holds a seat until it is accepted, revoked or expires."
                : "Sent from outside this page, so it holds no seat: they will arrive waiting for one. Please invite people from this page."}
            </p>
            <Rule />
            <RevokeButton invitationId={invitation.id} email={invitation.email} holdsSeat={invitation.holdsSeat} label="Revoke invitation" />
          </div>
        </>
      ),
    };
  });

  const asked = typeof params.person === "string" ? params.person : null;

  return (
    <AdminFrame clinic={clinic} title="People" bare>
      <SplitView
        title="People"
        param="person"
        initialKey={asked}
        headerAction={{
          key: "invite",
          label: "Invite",
          primary: true,
          detail: (
            <>
              <DetailHeader title="Invite someone" sub="They get an email to join. An invitation holds a seat until it is accepted." />
              {summary.free > 0 ? (
                <InviteForm />
              ) : (
                <p className="mt-8 max-w-2xl rounded-xl border border-line-strong bg-surface p-4 text-[15px] text-ink-soft">
                  {seatsFullMessage(summary)}{" "}
                  <Link href="/admin/billing" className={LINK}>
                    Billing
                  </Link>
                </p>
              )}
            </>
          ),
        }}
        above={<SeatsBar summary={summary} board={board} invitationsUnread={invitations === null} />}
        groups={[
          { items: personItems },
          { heading: "Waiting to join", items: invitationItems },
        ]}
      />
    </AdminFrame>
  );
}

/** "Seats ▬▬▬ 4 of 4", and, in plain words, anything about the seats or the owner that needs settling. */
function SeatsBar({ summary, board, invitationsUnread }: { summary: SeatSummary; board: { ownerUserId: string | null; ownerNotAdmin: boolean; waiting: number }; invitationsUnread: boolean }) {
  const share = summary.seats > 0 ? Math.min(1, summary.inUse / summary.seats) : 0;
  const warn = "mt-3 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-ink";
  return (
    <div className="md:px-2">
      <div className="mt-3 flex items-center gap-3" title={seatCountWords(summary)}>
        <span className="text-sm font-semibold text-ink-soft">Seats</span>
        <span aria-hidden="true" className="h-1.5 w-24 overflow-hidden rounded-full bg-wash-strong">
          <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.round(share * 100)}%` }} />
        </span>
        <span className="text-sm font-semibold text-ink-soft">
          {summary.inUse} of {summary.seats}
          <span className="sr-only"> seats in use</span>
        </span>
      </div>
      {board.ownerUserId === null && <p className={warn}>Your clinic has no account owner on record. Get in touch with Pulse 3D and we will set one for you.</p>}
      {board.ownerNotAdmin && <p className={warn}>The account owner&apos;s admin was switched off outside this page. Switch it back on in their details.</p>}
      {summary.overBy > 0 && (
        <p className={warn}>
          {summary.inUse} seats are taken and your plan pays for {summary.seats}. Nobody has been removed and nothing extra is being charged. Nobody else can be given a seat until someone is
          removed, an invitation is revoked, or seats are added.
        </p>
      )}
      {board.waiting > 0 && (
        <p className={warn}>
          {board.waiting} {board.waiting === 1 ? "person is" : "people are"} waiting for a seat. To settle it, remove someone, revoke an invitation, or add seats on the Billing page.
        </p>
      )}
      {invitationsUnread && <p className="mt-3 text-sm text-ink-soft">We could not read your open invitations just now. Reload this page in a moment.</p>}
    </div>
  );
}

/** One person's detail: their seat, the name patients see, Admin, the seat buttons, Remove, and for the owner, the handoff. */
function PersonDetail({
  person,
  me,
  summary,
  iAmOwner,
  otherAdmins,
  preview,
}: {
  person: SeatedPerson;
  me: boolean;
  summary: SeatSummary;
  iAmOwner: boolean;
  otherAdmins: { userId: string; name: string }[];
  preview: React.ReactNode;
}) {
  const seatLine =
    person.seat === "held"
      ? "Sends videos to patients (uses a seat)"
      : person.seat === "waiting"
        ? "Waiting for a seat. They can watch videos in the library, and can send links once they hold a seat."
        : "No seat. The account owner does not need one to use the admin pages.";
  const showSeatButton =
    (person.seat === "waiting" && summary.free > 0) || (person.isOwner && me && person.seat === "none" && summary.free > 0) || (person.isOwner && me && person.seat === "held");
  const seatMode = person.seat === "waiting" ? "give" : person.seat === "none" ? "take" : "release";
  return (
    <>
      <DetailHeader
        title={person.name}
        sub={`${person.email} · joined ${longDate(new Date(person.joinedAt))}`}
        end={
          person.isOwner ? (
            <span className="rounded-md bg-brand/20 px-2 py-1 text-[13px] font-semibold uppercase tracking-wide text-brand-bright">Account owner</span>
          ) : undefined
        }
      />
      <WithPreview preview={preview}>
        <p className={`text-[16px] ${person.seat === "waiting" ? "text-warn" : "text-ink"}`}>{seatLine}</p>
        {showSeatButton && (
          <div className="mt-3">
            {/* The key changes whenever the server's answer does, so the control starts again from it. */}
            <SeatButton key={`${person.userId}:${seatMode}`} userId={person.userId} mode={seatMode} />
          </div>
        )}

        {/* Only people with a seat send links, so only they have a name for patients. */}
        {person.seat === "held" && (
          <div className="mt-6">
            <p className="text-sm font-semibold text-ink-soft">Name patients see</p>
            <PatientNameEditor userId={person.userId} personName={person.name} patientName={person.patientName} />
          </div>
        )}

        <div className="mt-6">
          <AdminSwitch key={`${person.userId}:${person.role}`} userId={person.userId} name={person.name} role={person.role} isOwner={person.isOwner} />
        </div>

        {!person.isOwner && !me && (
          <>
            <Rule />
            <RemoveButton userId={person.userId} name={person.name} holdsSeat={person.seat === "held"} label="Remove from clinic" />
          </>
        )}

        {person.isOwner && me && iAmOwner && (
          <>
            <Rule />
            <h3 className="text-base font-semibold">Make someone else the account owner</h3>
            <p className="mt-1 max-w-xl text-[15px] text-ink-soft">The owner cannot be removed or have admin switched off, so hand the account over first if you are leaving.</p>
            <OwnerHandoff admins={otherAdmins} />
          </>
        )}
      </WithPreview>
    </>
  );
}
