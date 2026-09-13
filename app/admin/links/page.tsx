import type { Category } from "@prisma/client";
import { AdminsOnly } from "@/components/ui/AdminsOnly";
import { AppShell } from "@/components/ui/AppShell";
import { ClinicClosed } from "@/components/ui/ClinicClosed";
import { getBaseUrl } from "@/lib/base-url";
import { CATEGORIES } from "@/lib/categories";
import { requireClinicPage } from "@/lib/clinic";
import { clinicIsOpen } from "@/lib/clinic-status";
import { SHARE_EXPIRY_DAYS } from "@/lib/expiry";
import { formatDuration } from "@/lib/format";
import { getClinicAccess } from "@/lib/db/access";
import { listSharesForClinic } from "@/lib/db/shares";
import { listUsableVideos } from "@/lib/db/videos";
import { AdminFrame } from "../AdminFrame";
import { ShareLists } from "./ShareLists";

/**
 * Shared links, at /admin/links: the office manager's complete workspace
 * for patient links. (It used to be the whole of /admin; /admin is now the
 * overview, and this page is what it links to.)
 *
 * Two things on the page, both drawn by ShareLists:
 *   1. Every video this clinic may share (published, in a category on its
 *      plan, placeholders only while the clinic is shown them), each with a
 *      "Create share link" form.
 *   2. Every share link this clinic has made, with its expiry and view count,
 *      and buttons to copy the link, download its QR code as a picture,
 *      open a printable pamphlet, or cancel it (after a yes/no popup).
 *
 * Above both lists sit category pills and a search box, so the desk can find
 * one procedure (or its links) without reading the whole list.
 *
 * A placeholder video (a sample animation under a real procedure name) is
 * marked with an amber "Placeholder" badge in both lists, so whoever is at
 * the desk can see at a glance which links play a sample.
 *
 * This file fetches the data on the server (rule 1) and turns it into plain
 * text for the browser: dates become the words the page shows, so the
 * client side has no date maths and no time zone to get wrong.
 *
 * Admins only (org:admin, see lib/roles.ts). A member who opens it sees a
 * short note saying so; the check is on the server, not a hidden icon.
 *
 * Always rendered fresh (never cached): someone who just made a link needs
 * to see it in the list straight away.
 */
export const dynamic = "force-dynamic";

export default async function LinksPage() {
  // Signed out, no clinic, or the surgeon question unanswered: sent to the
  // right step (proxy.ts already sends signed-out visitors away, but Clerk's
  // guidance is that every page reading protected data keeps its own check).
  const clinic = await requireClinicPage();

  // A member, not an admin: say so. The shell hides the admin icon for them
  // too, but this is the check that counts.
  if (!clinic.isAdmin) {
    return (
      <AppShell>
        <AdminsOnly />
      </AppShell>
    );
  }

  // A clinic that is not open (not on a plan yet): no links can be made or
  // managed. The frame and its navigation stay, so Billing is one tap away.
  if (!clinicIsOpen(clinic.status)) {
    return (
      <AdminFrame clinicName={clinic.name} title="Shared links">
        <div className="mt-6">
          <ClinicClosed status={clinic.status} clinicName={clinic.name} billingLink inFrame />
        </div>
      </AdminFrame>
    );
  }

  // The procedure picker lists only what this clinic may share: published,
  // in a category on its plan, and placeholders only while the clinic is
  // shown them. The same rule createShare() applies when the form is sent
  // (lib/access.ts), so the list and the button can never disagree.
  const access = await getClinicAccess(clinic.id);
  const [videos, shares, baseUrl] = await Promise.all([
    access ? listUsableVideos(access) : [],
    listSharesForClinic(clinic.id),
    getBaseUrl(),
  ]);

  // What the Procedures list says when there is nothing to pick from.
  const emptyProceduresText =
    !access || access.categories.length === 0
      ? "No procedures to list yet: your clinic's plan has no categories on it. See Billing."
      : "Nothing to list right now: the categories on your clinic's plan have no animations you can share yet.";

  const now = new Date();

  const procedures = videos.map((video) => ({
    id: video.id,
    title: video.title,
    category: video.category,
    categoryLabel: categoryLabel(video.category),
    durationText: video.durationSeconds == null ? null : formatDuration(video.durationSeconds),
    isPlaceholder: video.isPlaceholder,
  }));

  const links = shares.map((share) => {
    const expired = share.expiresAt < now;
    // A link to a video that has been unpublished (on /pulse/videos) does not
    // work either. It is shown greyed like an expired one, and the words say
    // why. It starts working again if the video is published again.
    const takenDown = !share.video.isPublished;
    return {
      id: share.id,
      code: share.code,
      title: share.video.title,
      category: share.video.category,
      categoryLabel: categoryLabel(share.video.category),
      isPlaceholder: share.video.isPlaceholder,
      expired: expired || takenDown,
      whenText: expired
        ? `Expired ${formatDate(share.expiresAt)}`
        : takenDown
          ? "Not working: this video is not published right now"
          : `Expires ${formatDate(share.expiresAt)} · ${daysLeft(share.expiresAt, now)}`,
      viewCount: share.viewCount,
    };
  });

  return (
    <AdminFrame
      clinicName={clinic.name}
      title="Shared links"
      intro={
        <>
          Create a link for a procedure and copy it to send to a patient. Only the procedures in the categories on your clinic&rsquo;s
          plan are listed. The link stops working after {SHARE_EXPIRY_DAYS} days.
        </>
      }
      wide
    >
      <ShareLists procedures={procedures} links={links} baseUrl={baseUrl} emptyProceduresText={emptyProceduresText} />
    </AdminFrame>
  );
}

/** "KNEE" becomes "Knee". */
function categoryLabel(value: Category) {
  return CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

/** Shown in Utah time for now, since the one Phase 1 clinic is ours. */
function formatDate(date: Date) {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Denver",
  });
}

/** "14 days left", "1 day left", or "Less than a day left". Rounded to the nearest day. */
function daysLeft(expiresAt: Date, now: Date) {
  const days = Math.round((expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  if (days < 1) return "Less than a day left";
  return `${days} ${days === 1 ? "day" : "days"} left`;
}
