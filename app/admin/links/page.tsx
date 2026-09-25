import { auth } from "@clerk/nextjs/server";
import type { Category } from "@prisma/client";
import { AdminsOnly } from "@/components/ui/AdminsOnly";
import { ClinicShell } from "@/components/ui/ClinicShell";
import { ClinicClosed } from "@/components/ui/ClinicClosed";
import { getBaseUrl } from "@/lib/base-url";
import { CATEGORIES } from "@/lib/categories";
import { requireClinicPage } from "@/lib/clinic";
import { clinicIsOpen } from "@/lib/clinic-status";
import { ShareTermsError, type ShareTerms } from "@/lib/expiry";
import { formatDuration } from "@/lib/format";
import { getClinicAccess } from "@/lib/db/access";
import { getShareTerms } from "@/lib/db/shares";
import { listUsableVideos } from "@/lib/db/videos";
import { listSenders, type Sender } from "@/lib/senders";
import { AdminFrame } from "../AdminFrame";
import { LinkRows } from "./LinkRows";

/**
 * Shared links, at /admin/links: where the office makes a link for a
 * patient.
 *
 * One row per video this clinic may share (published, in a category on its
 * plan, placeholders only while the clinic is shown them), and on each row
 * one button, Create link. Pressing it makes one new link and opens a small
 * menu for it: Copy link, Download QR code, Print QR code (the pamphlet).
 * Category pills and a search box narrow the rows.
 *
 * Every link is from a surgeon, picked once at the top of the page from the
 * people in this clinic who hold a seat (the signed-in admin, when they hold
 * one, is picked already). The patient page and the pamphlet then say "Sent
 * by Dr. Jane Smith, <clinic>". The server checks the pick again when the
 * link is made (rule 8).
 *
 * THERE IS NO LIST OF PAST LINKS, on purpose (Evan's build plan of 2026-09-21, Prompt 4):
 * the app does not know which patient got which link, so the office never
 * needs to find one again. Links already sent keep working on their own
 * rules (lib/expiry.ts). The overview (/admin) still shows the newest few
 * and a handful of counts.
 *
 * How long a link works is described in the words it is made with: the page
 * reads the clinic's share terms (getShareTerms) from the same settings
 * createShare copies onto a new link.
 *
 * Admins only (org:admin, see lib/roles.ts). A member who opens it sees a
 * short note saying so; the check is on the server, not a hidden icon.
 */
export const dynamic = "force-dynamic";

export default async function LinksPage() {
  // Signed out, or no clinic: sent to the right step (proxy.ts already sends
  // signed-out visitors away, but every page reading protected data keeps its own check).
  const clinic = await requireClinicPage();

  // A member, not an admin: say so. The shell hides the admin icon for them
  // too, but this is the check that counts.
  if (!clinic.isAdmin) {
    return (
      <ClinicShell clinic={clinic}>
        <AdminsOnly />
      </ClinicShell>
    );
  }

  // A clinic that is not open (not on a plan yet): no links can be made.
  // The frame and its navigation stay, so Billing is one tap away.
  if (!clinicIsOpen(clinic)) {
    return (
      <AdminFrame clinic={clinic} title="Shared links">
        <div className="mt-6">
          <ClinicClosed status={clinic.status} clinicName={clinic.name} billingLink inFrame />
        </div>
      </AdminFrame>
    );
  }

  // The rows list only what this clinic may share, by the same rule
  // createShare() applies when a link is made (lib/access.ts), so a row and
  // its button can never disagree.
  const access = await getClinicAccess(clinic.id);
  const [videos, baseUrl, terms, senders, { userId }] = await Promise.all([
    access ? listUsableVideos(access) : [],
    getBaseUrl(),
    readShareTerms(clinic.id),
    readSenders(clinic.id),
    auth(),
  ]);

  // What the page says when there is nothing to list.
  const emptyProceduresText =
    !access || access.categories.length === 0
      ? "No procedures to list yet: your clinic's plan has no categories on it. See Billing."
      : "Nothing to list right now: the categories on your clinic's plan have no animations you can share yet.";

  const procedures = videos.map((video) => ({
    id: video.id,
    title: video.title,
    category: video.category,
    categoryLabel: categoryLabel(video.category),
    durationText: video.durationSeconds == null ? null : formatDuration(video.durationSeconds),
    isPlaceholder: video.isPlaceholder,
  }));

  const afterFirstPlay = terms ? `${terms.daysAfterFirstPlay} ${terms.daysAfterFirstPlay === 1 ? "day" : "days"}` : null;

  return (
    <AdminFrame
      clinic={clinic}
      title="Shared links"
      intro={
        <>
          Choose who the link is from, then press Create link on a procedure. Copy the link, download its QR code, or print it. Only the
          procedures in the categories on your clinic&rsquo;s plan are listed.{" "}
          {terms ? (
            <>
              A link works for {afterFirstPlay} after the patient first plays it. If nobody plays it, it stops on its own after{" "}
              {terms.unclaimedDays} days.
            </>
          ) : (
            TERMS_PROBLEM
          )}
        </>
      }
      wide
    >
      <LinkRows
        procedures={procedures}
        baseUrl={baseUrl}
        emptyProceduresText={emptyProceduresText}
        linksCanBeMade={terms !== null}
        senders={senders}
        // The signed-in admin is picked already when they hold a seat; otherwise nobody is, and they choose.
        defaultSenderId={senders?.some((sender) => sender.userId === userId) ? userId : null}
        clinicName={clinic.name}
      />
    </AdminFrame>
  );
}

/** What the page says instead of the numbers when a link setting is out of range. createShare refuses for the same reason, so no link can be made. */
const TERMS_PROBLEM = "Links cannot be made right now: a link setting is out of range. Ask Pulse 3D to check the platform settings.";

/**
 * The clinic's share terms, or null when they cannot be worked out: a
 * setting outside the limits in lib/expiry.ts (only a hand edit can do
 * that). The page then says so in place of the numbers instead of failing,
 * and the detail goes to the server log.
 */
async function readShareTerms(clinicId: string): Promise<ShareTerms | null> {
  try {
    return await getShareTerms(clinicId);
  } catch (error) {
    if (!(error instanceof ShareTermsError)) throw error;
    console.error("Shared links could not read the clinic's share terms.", error);
    return null;
  }
}

/**
 * The people a link can be from, or null when Clerk could not be read just
 * now. The page then says so and offers no Create button, rather than
 * failing; the detail (the kind of error only) goes to the server log.
 */
async function readSenders(clinicId: string): Promise<Sender[] | null> {
  try {
    return await listSenders(clinicId);
  } catch (error) {
    console.error("Shared links could not read the clinic's people", error instanceof Error ? error.name : "unknown error");
    return null;
  }
}

/** "KNEE" becomes "Knee". */
function categoryLabel(value: Category) {
  return CATEGORIES.find((c) => c.value === value)?.label ?? value;
}
