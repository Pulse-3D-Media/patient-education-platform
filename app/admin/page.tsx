import { auth } from "@clerk/nextjs/server";
import type { Category } from "@prisma/client";
import { AppShell } from "@/components/ui/AppShell";
import { NotLinked } from "@/components/ui/NotLinked";
import { getBaseUrl } from "@/lib/base-url";
import { CATEGORIES } from "@/lib/categories";
import { getCurrentClinicId } from "@/lib/clinic";
import { SHARE_EXPIRY_DAYS } from "@/lib/expiry";
import { formatDuration } from "@/lib/format";
import { listSharesForClinic } from "@/lib/db/shares";
import { listPublishedVideos } from "@/lib/db/videos";
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
 * Always rendered fresh (never cached): someone who just made a link needs
 * to see it in the list straight away.
 */
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  // Signed out? Clerk sends them to the sign-in page and back here after.
  // proxy.ts already does this for /admin, but Clerk's guidance is that every
  // page reading protected data keeps its own check.
  await auth.protect();

  // Signed in, but not a member of a linked clinic: a calm page, not an error.
  const clinicId = await getCurrentClinicId();
  if (!clinicId) {
    return (
      <AppShell>
        <NotLinked />
      </AppShell>
    );
  }

  const [videos, shares, baseUrl] = await Promise.all([
    listPublishedVideos(),
    listSharesForClinic(clinicId),
    getBaseUrl(),
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
    return {
      id: share.id,
      code: share.code,
      title: share.video.title,
      category: share.video.category,
      categoryLabel: categoryLabel(share.video.category),
      isPlaceholder: share.video.isPlaceholder,
      expired,
      whenText: expired
        ? `Expired ${formatDate(share.expiresAt)}`
        : `Expires ${formatDate(share.expiresAt)} · ${daysLeft(share.expiresAt, now)}`,
      viewCount: share.viewCount,
    };
  });

  return (
    <AppShell>
      <main className="px-5 py-6 sm:px-8">
        <div className="mx-auto max-w-6xl">
          <header>
            <h1 className="text-2xl font-semibold sm:text-3xl">Share links</h1>
            <p className="mt-1 max-w-2xl text-[#bfbfbf]">
              Create a link for a procedure and copy it to send to a patient. The link stops working after{" "}
              {SHARE_EXPIRY_DAYS} days.
            </p>
          </header>

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
