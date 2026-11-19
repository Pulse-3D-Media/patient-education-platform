import Link from "next/link";
import { staffLook } from "@/app/brand-look";
import { AdminsOnly } from "@/components/ui/AdminsOnly";
import { ClinicShell } from "@/components/ui/ClinicShell";
import { ClinicClosed } from "@/components/ui/ClinicClosed";
import { PatientPhonePreview } from "@/components/ui/PatientPhonePreview";
import { PLACEHOLDER_BADGE, SECONDARY_BUTTON } from "@/components/ui/styles";
import { requireClinicPage, type CurrentClinic } from "@/lib/clinic";
import { clinicIsOpen } from "@/lib/clinic-status";
import { listLiveQrCodesForClinic } from "@/lib/db/qr-codes";
import { listRenewalRequestsForClinic, summarizeSharesForClinic, type RenewalRequestRow } from "@/lib/db/shares";
import { addDays } from "@/lib/expiry";
import { describeLinkDate } from "@/lib/format";
import { ROLE_WORDS } from "@/lib/role-names";
import { listOpenInvitationsForClinic } from "@/lib/seat-changes";
import { AdminFrame } from "./AdminFrame";
import { DetailHeader, Facts, Rule, WithPreview, daysAgo, longDate, shortDate } from "./DetailParts";
import { ReactivateForm } from "./reactivate/[id]/ReactivateForm";
import { SplitView, type SplitItem } from "./SplitView";

/**
 * The clinic admin overview, at /admin: the first thing an office manager
 * sees. Called Overview, never "Inbox" (the approved design, screen 08).
 *
 * A list on the left, the chosen item's detail on the right (SplitView):
 *
 *   NEW, each with a dot, is what wants a look:
 *     - a paused link a patient has asked to have turned back on, with the
 *       link's details and the Confirm button right there (the same form
 *       and Server Action as /admin/reactivate/<id>, which every check runs
 *       again), beside a picture of the patient page it would bring back;
 *     - an invitation nobody has accepted yet, with a way to it on People;
 *     - a printed code that needs a look (its surgeon no longer holds a
 *       seat, or its video is not available), with a way to it on Shared
 *       links;
 *     - links that point at a video that is not available, so they do not
 *       work (one sentence, no list).
 *   EARLIER: printed codes made in the last 30 days (at most three).
 *
 * NOT HERE, on purpose: a list of past patient links (there is none
 * anywhere on the clinic side), play starts or any other usage number
 * (clinics get none, Van 2026-10-08 and the user 2026-11-16), and plan or
 * price information (that lives on /admin/billing and nowhere else). Every
 * read is bounded: at most ten waiting links, one count of links that do not
 * work, the clinic's live printed codes (at most a hundred, read once), and
 * Clerk's list of open invitations.
 *
 * Admins only (org:admin). A member sees the plain admins-only note. An
 * admin of a clinic that is not open sees why, with a way to Billing, which
 * is the one page that stays open for them.
 */
export const dynamic = "force-dynamic";

/** How many paused links a patient has asked about the overview lists at once (the most recently asked first). */
const WAITING_LINKS = 10;

/** How far back "Printed code made" reaches, and how many it shows. */
const RECENT_CODE_DAYS = 30;
const RECENT_CODES = 3;

type OverviewProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminOverviewPage(props: OverviewProps = {}) {
  const clinic = await requireClinicPage();

  if (!clinic.isAdmin) {
    return (
      <ClinicShell clinic={clinic}>
        <AdminsOnly />
      </ClinicShell>
    );
  }

  if (!clinicIsOpen(clinic)) {
    return (
      <AdminFrame clinic={clinic} title="Overview">
        <Notice text={clinic.noticeText} />
        <div className="mt-6">
          <ClinicClosed status={clinic.status} clinicName={clinic.name} billingLink inFrame />
        </div>
      </AdminFrame>
    );
  }

  const now = new Date();
  const [summary, waiting, invitations, printed, params] = await Promise.all([
    summarizeSharesForClinic(clinic.id),
    listRenewalRequestsForClinic(clinic.id, WAITING_LINKS, now),
    listOpenInvitationsForClinic(clinic.id),
    listLiveQrCodesForClinic(clinic.id),
    props.searchParams ?? Promise.resolve({} as Record<string, string | string[] | undefined>),
  ]);

  const look = staffLook(clinic);
  const fresh: SplitItem[] = [];

  for (const request of waiting) fresh.push(renewalItem(request, clinic, look, now));

  for (const invitation of invitations ?? []) {
    const sent = new Date(invitation.createdAt);
    fresh.push({
      key: `invitation-${invitation.id}`,
      dot: true,
      title: "Invitation not accepted yet",
      sub: `${invitation.email} · sent ${daysAgo(sent, now)}`,
      meta: shortDate(sent, now),
      detail: (
        <>
          <DetailHeader title="Invitation not accepted yet" sub={`Sent ${daysAgo(sent, now)}`} />
          <div className="mt-8 max-w-xl">
            <Facts
              rows={[
                { label: "Email", value: invitation.email },
                { label: "Can do", value: ROLE_WORDS[invitation.role] },
                { label: "Sent", value: longDate(sent) },
              ]}
            />
            <Rule />
            <Link href={`/admin/people?person=invitation-${invitation.id}`} className={`${SECONDARY_BUTTON} h-11 px-5 text-[15px]`}>
              Open on People
            </Link>
          </div>
        </>
      ),
    });
  }

  for (const code of printed.rows) {
    const problem = !code.surgeonSeated
      ? `${code.surgeonName ?? "Its surgeon"} no longer holds a seat. The code still works, but the links it gives patients now name only the clinic. Retire it, and make a new one from a surgeon who holds a seat.`
      : !code.isPublished
        ? "Its video is not available right now, so the code gives patients nothing until it is back."
        : null;
    if (!problem) continue;
    fresh.push({
      key: `code-${code.id}`,
      dot: true,
      title: "A printed code needs a look",
      sub: `${code.videoTitle} · ${code.surgeonName ?? "no surgeon name"}`,
      meta: shortDate(code.createdAt, now),
      detail: (
        <>
          <DetailHeader title="A printed code needs a look" sub={code.videoTitle} />
          <div className="mt-8 max-w-xl">
            <p className="text-[16px] text-ink">{problem}</p>
            <Rule />
            <Link href={`/admin/links?code=${code.id}`} className={`${SECONDARY_BUTTON} h-11 px-5 text-[15px]`}>
              Open in Shared links
            </Link>
          </div>
        </>
      ),
    });
  }

  if (summary.notWorking > 0) {
    const words = `${summary.notWorking} ${summary.notWorking === 1 ? "link points" : "links point"} at a video that is not available right now, so ${summary.notWorking === 1 ? "it does" : "they do"} not work.`;
    fresh.push({
      key: "not-working",
      dot: true,
      title: summary.notWorking === 1 ? "A link does not work right now" : "Some links do not work right now",
      sub: "Its video is not available",
      detail: (
        <>
          <DetailHeader title={summary.notWorking === 1 ? "A link does not work right now" : "Some links do not work right now"} />
          <p className="mt-8 max-w-xl text-[16px] text-ink">{words} Ask Pulse 3D about the video, or make a new link to another procedure on Shared links.</p>
        </>
      ),
    });
  }

  const recentSince = addDays(now, -RECENT_CODE_DAYS);
  const earlier: SplitItem[] = printed.rows
    .filter((code) => code.createdAt >= recentSince)
    .slice(0, RECENT_CODES)
    .map((code) => ({
      key: `made-${code.id}`,
      title: "Printed code made",
      sub: `${code.videoTitle} · ${code.surgeonName ?? "no surgeon name"}`,
      meta: shortDate(code.createdAt, now),
      detail: (
        <>
          <DetailHeader title="Printed code made" sub={longDate(code.createdAt)} />
          <div className="mt-8 max-w-xl">
            <Facts
              rows={[
                { label: "Procedure", value: code.videoTitle },
                { label: "From", value: code.surgeonName ?? "No surgeon name set" },
                { label: "Made", value: longDate(code.createdAt) },
              ]}
            />
            <Rule />
            <Link href={`/admin/links?code=${code.id}`} className={`${SECONDARY_BUTTON} h-11 px-5 text-[15px]`}>
              Open in Shared links
            </Link>
          </div>
        </>
      ),
    }));

  const asked = typeof params.item === "string" ? params.item : null;

  return (
    <AdminFrame clinic={clinic} title="Overview" bare>
      <SplitView
        title="Overview"
        param="item"
        initialKey={asked}
        groups={[
          { heading: "New", items: fresh },
          { heading: "Earlier", items: earlier },
        ]}
        above={
          <>
            <Notice text={clinic.noticeText} />
            {invitations === null && (
              <p role="alert" className="mt-4 px-2 text-sm text-ink-soft">
                We could not check for open invitations just now. Reload this page in a moment.
              </p>
            )}
          </>
        }
        empty={<p className="mt-4 px-2 text-[15px] text-ink-soft">Nothing needs a look right now.</p>}
        emptyDetail={
          <>
            <DetailHeader title="Nothing needs a look" />
            <p className="mt-8 max-w-xl text-[16px] text-ink-soft">
              Paused links a patient asks about, and invitations nobody has accepted, show up here. To send a patient a video, make a link on{" "}
              <Link href="/admin/links" className="font-medium text-brand-bright underline underline-offset-2">
                Shared links
              </Link>
              .
            </p>
          </>
        }
      />
    </AdminFrame>
  );
}

/**
 * A paused link a patient has asked about: its details, the Confirm button
 * (or why it cannot be turned back on), and the patient page it would bring
 * back. The form is the reactivate page's own (ReactivateForm), so the
 * Server Action and every check behind it are the same.
 */
function renewalItem(request: RenewalRequestRow, clinic: CurrentClinic, look: ReturnType<typeof staffLook>, now: Date): SplitItem {
  const sameDay = shortDate(request.requestedAt, now) === shortDate(now, now);
  const askedTime = request.requestedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Denver" });
  const from = request.senderName ?? clinic.name;
  return {
    key: `request-${request.id}`,
    dot: true,
    title: "A paused link asks to come back",
    sub: `${request.videoTitle} · ${from}`,
    meta: sameDay ? askedTime : shortDate(request.requestedAt, now),
    detail: (
      <>
        <DetailHeader title="A paused link asks to come back" sub={`${sameDay ? "Today" : shortDate(request.requestedAt, now)}, ${askedTime}`} />
        <WithPreview
          preview={
            <PatientPhonePreview
              clinicName={clinic.name}
              logoUrl={look.logoUrl}
              color={clinic.branding.color}
              fontClass={look.fontClass}
              senderName={request.senderName}
              title={request.videoTitle}
              deadline={`This link works until ${describeLinkDate(addDays(now, request.daysPerRenewal), now, "America/Denver")}.`}
            />
          }
        >
          <Facts
            rows={[
              {
                label: "Procedure",
                value: (
                  <span className="inline-flex flex-wrap items-center gap-2">
                    {request.videoTitle}
                    {request.isPlaceholder && <span className={PLACEHOLDER_BADGE}>Placeholder</span>}
                  </span>
                ),
              },
              { label: "From", value: request.senderName ?? "No surgeon recorded" },
              { label: "Paused", value: longDate(request.pausedAt) },
              { label: "Asked", value: `${sameDay ? "Today" : longDate(request.requestedAt)}, from the patient's link` },
            ]}
          />
          <Rule />
          {request.planBlock ? (
            // The plan no longer allows this video, so the link is marked, not offered. The page behind it says why and what would change that.
            <div className="flex flex-col items-start gap-3">
              <p className="text-[15px] text-warn">
                {request.planBlock === "not-on-plan" ? "This procedure is not on your plan, so the link cannot be turned back on." : "Placeholder videos are hidden for your clinic, so the link cannot be turned back on."}
              </p>
              <Link href={`/admin/reactivate/${request.id}`} className={`${SECONDARY_BUTTON} h-11 px-5 text-[15px]`}>
                See why
              </Link>
            </div>
          ) : (
            <ReactivateForm shareId={request.id} paused days={request.daysPerRenewal} renewalsLeft={request.renewalsLeft} whyNot="" />
          )}
        </WithPreview>
      </>
    ),
  };
}

/** A line from Pulse 3D for this clinic, set on /pulse. Nothing shows when there is none. */
function Notice({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="status" className="mt-4 rounded-xl border border-brand/50 bg-brand/15 px-4 py-3 text-[15px] text-ink">
      <span className="mr-2 font-semibold text-brand-bright">From Pulse 3D:</span>
      {text}
    </p>
  );
}
