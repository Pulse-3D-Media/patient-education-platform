import type { Category } from "@prisma/client";
import Link from "next/link";
import { AdminsOnly } from "@/components/ui/AdminsOnly";
import { AppShell } from "@/components/ui/AppShell";
import { ClinicClosed } from "@/components/ui/ClinicClosed";
import { SECONDARY_BUTTON } from "@/components/ui/styles";
import { getBaseUrl } from "@/lib/base-url";
import { CATEGORIES } from "@/lib/categories";
import { requireClinicPage } from "@/lib/clinic";
import { clinicIsOpen } from "@/lib/clinic-status";
import { SHARE_EXPIRY_DAYS } from "@/lib/expiry";
import { formatDuration } from "@/lib/format";
import { getClinicPlan } from "@/lib/db/clinics";
import { getPricingForClinic } from "@/lib/db/pricing";
import { listSharesForClinic } from "@/lib/db/shares";
import { listPublishedVideos } from "@/lib/db/videos";
import { PlanCard } from "./PlanCard";
import { ShareLists } from "./ShareLists";

/**
 * The office-manager console, inside the same shell (banner, icon rail,
 * category drawer) as the library, so a surgeon can reach it from the rail.
 *
 * Two things on the page, both drawn by ShareLists:
 *   1. Every published video, each with a "Create share link" form.
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

export default async function AdminPage() {
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

  // A clinic that is not open (not on a plan yet): a calm page, not the console.
  if (!clinicIsOpen(clinic.status)) {
    return (
      <AppShell showAdmin>
        <ClinicClosed status={clinic.status} clinicName={clinic.name} />
      </AppShell>
    );
  }

  const [videos, shares, baseUrl, plan, pricingConfig] = await Promise.all([
    listPublishedVideos(),
    listSharesForClinic(clinic.id),
    getBaseUrl(),
    getClinicPlan(clinic.id),
    // The prices this clinic is on, for the estimate on the plan card. A
    // pricing problem (a damaged version, a bad pin) is logged for Pulse and
    // shown to the clinic as "could not work out an estimate", never as a
    // broken page: the console is still needed for links.
    getPricingForClinic(clinic.id)
      .then((pricing) => pricing.config)
      .catch((error: unknown) => {
        console.error(`Could not read pricing for clinic ${clinic.id}:`, error);
        return null;
      }),
  ]);

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
    <AppShell showAdmin>
      <main className="px-5 py-6 sm:px-8">
        <div className="mx-auto max-w-6xl">
          {/* A line from Pulse 3D for this clinic, set on /pulse. Nothing shows when there is none. */}
          {clinic.noticeText && (
            <p
              role="status"
              className="mb-5 rounded-xl border border-[#2a829b]/50 bg-[#2a829b]/15 px-4 py-3 text-[15px] text-white"
            >
              <span className="mr-2 font-semibold text-[#5fb8d4]">From Pulse 3D:</span>
              {clinic.noticeText}
            </p>
          )}
          <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-wider text-[#667085]">{clinic.name}</p>
              <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Share links</h1>
              <p className="mt-1 max-w-2xl text-[#bfbfbf]">
                Create a link for a procedure and copy it to send to a patient. The link stops working after{" "}
                {SHARE_EXPIRY_DAYS} days.
              </p>
            </div>
            {/* The other admin page: who is in the clinic, and who is a surgeon. */}
            <Link href="/admin/people" className={SECONDARY_BUTTON}>
              People
            </Link>
          </header>

          {/* The plan on file and an estimate of its monthly amount. Read-only, labelled Estimated. */}
          {plan && <PlanCard plan={plan} config={pricingConfig} />}

          <ShareLists procedures={procedures} links={links} baseUrl={baseUrl} />
        </div>
      </main>
    </AppShell>
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
