import Link from "next/link";
import type { Category } from "@prisma/client";
import { AppShell } from "@/components/ui/AppShell";
import { CopyButton } from "@/components/ui/CopyButton";
import { SECONDARY_BUTTON } from "@/components/ui/styles";
import { getBaseUrl } from "@/lib/base-url";
import { CATEGORIES } from "@/lib/categories";
import { getCurrentClinicId } from "@/lib/clinic";
import { formatDuration } from "@/lib/format";
import { listSharesForClinic } from "@/lib/db/shares";
import { listPublishedVideos } from "@/lib/db/videos";
import { qrFileName, watchLink } from "@/lib/share-link";
import { CreateShareForm } from "./CreateShareForm";

/**
 * The office-manager console, inside the same shell (banner, icon rail,
 * category drawer) as the library, so a surgeon can reach it from the rail.
 *
 * Two things on the page:
 *   1. Every published video, each with a "Create share link" form.
 *   2. Every share link this clinic has made, with its expiry and view count,
 *      and buttons to copy the link, download its QR code as a picture, or
 *      open a printable pamphlet.
 *
 * Everything wraps to the width it is given. Long links break across lines
 * and the buttons drop to a second row, so the page never scrolls sideways.
 *
 * Always rendered fresh (never cached): someone who just made a link needs
 * to see it in the list straight away.
 */
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const clinicId = getCurrentClinicId();
  if (!clinicId) {
    return (
      <AppShell>
        <main className="px-5 py-6 sm:px-8">
          <h1 className="text-2xl font-semibold">Set-up needed</h1>
          <p className="mt-2 max-w-xl text-[#bfbfbf]">
            CLINIC_ID is not set. Run <span className="text-white">npm run db:seed</span>, copy the id it prints
            into .env (and into Vercel&rsquo;s environment variables), then reload this page.
          </p>
        </main>
      </AppShell>
    );
  }

  const [videos, shares, baseUrl] = await Promise.all([
    listPublishedVideos(),
    listSharesForClinic(clinicId),
    getBaseUrl(),
  ]);

  const now = new Date();

  return (
    <AppShell>
      <main className="px-5 py-6 sm:px-8">
        <div className="mx-auto max-w-6xl">
          <header>
            <h1 className="text-2xl font-semibold sm:text-3xl">Share links</h1>
            <p className="mt-1 max-w-2xl text-[#bfbfbf]">
              Create a link for a procedure and copy it to send to a patient. The link stops working after the
              number of days you choose.
            </p>
          </header>

          {/* 1. Published videos, each with its create form */}
          <section aria-labelledby="videos-heading" className="mt-10">
            <h2 id="videos-heading" className="text-lg font-semibold">
              Procedures
            </h2>

            {videos.length === 0 ? (
              <p className="mt-3 text-[#bfbfbf]">No published videos yet.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {videos.map((video) => (
                  <li
                    key={video.id}
                    className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[#0d1113] p-5 lg:flex-row lg:items-start lg:justify-between"
                  >
                    <div>
                      <p className="text-xl font-semibold">{video.title}</p>
                      <p className="mt-1 text-sm text-[#667085]">
                        {categoryLabel(video.category)}
                        {video.durationSeconds != null && <> &middot; {formatDuration(video.durationSeconds)}</>}
                      </p>
                    </div>
                    <CreateShareForm videoId={video.id} baseUrl={baseUrl} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 2. Existing share links for this clinic */}
          <section aria-labelledby="links-heading" className="mt-12">
            <h2 id="links-heading" className="text-lg font-semibold">
              Existing links
            </h2>

            {shares.length === 0 ? (
              <p className="mt-3 text-[#bfbfbf]">No links yet. Create one above.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {shares.map((share) => {
                  const link = watchLink(baseUrl, share.code);
                  const qrUrl = `/admin/qr/${share.code}`;
                  const expired = share.expiresAt < now;
                  return (
                    <li
                      key={share.id}
                      className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[#0d1113] p-5 lg:flex-row lg:items-center lg:justify-between"
                    >
                      <div className="min-w-0 flex-1">
                        <p className={`text-lg font-semibold ${expired ? "text-[#667085]" : ""}`}>{share.video.title}</p>
                        {/* break-all lets a long address wrap anywhere instead of widening the page */}
                        <p className="mt-1 break-all text-sm text-[#bfbfbf]">{link}</p>
                        <p className="mt-2 text-sm text-[#667085]">
                          {expired ? (
                            <>Expired {formatDate(share.expiresAt)}</>
                          ) : (
                            <>
                              Expires {formatDate(share.expiresAt)} &middot; {daysLeft(share.expiresAt, now)}
                            </>
                          )}
                          &nbsp;&middot; {share.viewCount} {share.viewCount === 1 ? "view" : "views"}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2 lg:shrink-0 lg:justify-end">
                        <CopyButton text={link} label="Copy link" />
                        {/* A plain link with a download name: the browser saves the picture instead of opening it */}
                        <a href={qrUrl} download={qrFileName(share.video.title, share.code)} className={SECONDARY_BUTTON}>
                          Download QR
                        </a>
                        <Link href={`/admin/print/${share.code}`} className={SECONDARY_BUTTON}>
                          Print
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
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
