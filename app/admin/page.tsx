import Link from "next/link";
import type { Category } from "@prisma/client";
import { CopyButton } from "@/components/ui/CopyButton";
import { getBaseUrl } from "@/lib/base-url";
import { CATEGORIES } from "@/lib/categories";
import { getCurrentClinicId } from "@/lib/clinic";
import { listSharesForClinic } from "@/lib/db/shares";
import { listPublishedVideos } from "@/lib/db/videos";
import { qrFileName, watchLink } from "@/lib/share-link";
import { CreateShareForm } from "./CreateShareForm";

/**
 * The office-manager console. Desktop, sitting down, no hurry.
 *
 * Two things on the page:
 *   1. Every published video, each with a "Create share link" form.
 *   2. Every share link this clinic has made, with its expiry, view count,
 *      QR code, and buttons to copy the link, download the QR code as a
 *      picture, or open a printable pamphlet.
 *
 * Always rendered fresh (never cached): someone who just made a link needs
 * to see it in the list straight away.
 */
export const dynamic = "force-dynamic";

// Same logo as the library banner. Copied rather than imported because
// LibraryShell is a client component and this page is a server component.
const LOGO = "https://cdn.prod.website-files.com/69092ab4b2ae593d551bb95f/6a394f4daad9a6c8cc1d16a4_pulse3dmedia-logo-p-500.png";

/** The look of the secondary buttons in the links table (Copy uses the same look). */
const SECONDARY_BUTTON =
  "inline-flex h-10 shrink-0 items-center rounded-lg border border-white/15 px-4 text-sm font-medium text-[#bfbfbf] transition hover:border-[#2a829b] hover:text-white";

export default async function AdminPage() {
  const clinicId = getCurrentClinicId();
  if (!clinicId) {
    return (
      <Frame>
        <h1 className="text-2xl font-semibold">Set-up needed</h1>
        <p className="mt-2 max-w-xl text-[#bfbfbf]">
          CLINIC_ID is not set. Run <span className="text-white">npm run db:seed</span>, copy the id it prints into
          .env (and into Vercel&rsquo;s environment variables), then reload this page.
        </p>
      </Frame>
    );
  }

  const [videos, shares, baseUrl] = await Promise.all([
    listPublishedVideos(),
    listSharesForClinic(clinicId),
    getBaseUrl(),
  ]);

  const now = new Date();

  return (
    <Frame>
      <header>
        <h1 className="text-2xl font-semibold sm:text-3xl">Share links</h1>
        <p className="mt-1 max-w-2xl text-[#bfbfbf]">
          Create a link for a procedure and copy it to send to a patient. The link stops working after the number of
          days you choose.
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
          <div className="mt-3 overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#0d1113] text-xs uppercase tracking-wider text-[#667085]">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Procedure
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Link
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Expires
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Views
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    QR code
                  </th>
                  <th scope="col" className="px-4 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {shares.map((share) => {
                  const link = watchLink(baseUrl, share.code);
                  const qrUrl = `/admin/qr/${share.code}`;
                  const expired = share.expiresAt < now;
                  return (
                    <tr key={share.id} className={expired ? "text-[#667085]" : ""}>
                      <td className="px-4 py-3 font-medium text-white">{share.video.title}</td>
                      <td className="px-4 py-3">
                        <span className="text-[#bfbfbf]">{link}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {formatDate(share.expiresAt)}
                        <span className="block text-xs text-[#667085]">
                          {expired ? "Expired" : daysLeft(share.expiresAt, now)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{share.viewCount}</td>
                      <td className="px-4 py-3">
                        {/* eslint-disable-next-line @next/next/no-img-element -- drawn by /admin/qr, not a photo to resize */}
                        <img
                          src={qrUrl}
                          alt={`QR code for ${link}`}
                          width={64}
                          height={64}
                          className="h-16 w-16 rounded-md bg-white"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <CopyButton text={link} label="Copy link" />
                          {/* A plain link with a download name: the browser saves the picture instead of opening it */}
                          <a href={qrUrl} download={qrFileName(share.video.title, share.code)} className={SECONDARY_BUTTON}>
                            Download QR
                          </a>
                          <Link href={`/admin/print/${share.code}`} className={SECONDARY_BUTTON}>
                            Print
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Frame>
  );
}

/** The page's outer frame: banner with the logo, then the content. */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-black text-white">
      <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-white/10 bg-black px-4 sm:px-6">
        <Link href="/library" className="flex items-center" aria-label="Pulse 3D, library home">
          {/* eslint-disable-next-line @next/next/no-img-element -- small static logo from the CDN */}
          <img src={LOGO} alt="Pulse 3D" className="h-7 w-auto" />
        </Link>
        <span className="ml-auto text-sm text-[#667085]">Admin</span>
      </header>
      <main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8">{children}</main>
    </div>
  );
}

/** "KNEE" becomes "Knee". */
function categoryLabel(value: Category) {
  return CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

/** 110 seconds becomes "1:50". */
function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
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
