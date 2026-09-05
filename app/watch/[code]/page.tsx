import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ClockIcon, SearchIcon } from "@/components/ui/icons";
import { LOGO_URL } from "@/lib/brand";
import { getShareByCode } from "@/lib/db/shares";
import { describeDuration } from "@/lib/format";
import { getPlaybackUrl } from "@/lib/video";
import { WatchPlayer } from "./WatchPlayer";

/**
 * The patient viewer. Phone-first, no login, nothing to click except play.
 *
 * Who reads it: a patient in their sixties or seventies, on their own phone,
 * on cellular data, often anxious. Everything about the look follows from
 * that, and none of it is taste:
 *
 * - Dark text on a warm, light ground. The National Institute on Aging's
 *   guidance for older readers, which is why this page is light when the rest
 *   of the product is near-black.
 * - Body text is 20px with a 1.5 line height. Nothing on the page is under
 *   15px. Body text and the practice name clear a 7:1 contrast ratio; nothing
 *   falls under 4.5:1. Do not go bigger either: past a point, bigger reads worse.
 * - Every tap target is at least 48px. Pinch-to-zoom is left on.
 *
 * Top to bottom it answers the questions an anxious person has, in order: who
 * sent me this, what is it, why, how long will it take. The Pulse 3D logo sits
 * at the very bottom, small, because the practice sent this, not us.
 *
 * The code in the address is looked up. If no link has that code, or the
 * link has expired, the patient sees a calm page asking them to get a new
 * link from the practice.
 *
 * Always rendered fresh, so the expiry check is never a stale, cached answer.
 */
export const dynamic = "force-dynamic";

/** Share links are private to the patient, so search engines are told to stay away. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function WatchPage({ params }: PageProps<"/watch/[code]">) {
  const { code } = await params;
  const share = await getShareByCode(code);

  if (!share) {
    return (
      <Unavailable
        icon={<SearchIcon className="h-8 w-8" />}
        heading="We couldn't find this link"
        body="Please check the address you were given, or ask your doctor's office for a new link."
      />
    );
  }

  if (share.expiresAt < new Date()) {
    return (
      <Unavailable
        icon={<ClockIcon className="h-8 w-8" />}
        heading="This link has expired"
        body={`Links stay open for a set time. ${share.clinic.name} can send you a fresh one whenever you need it.`}
        note={`Call the office and ask for your ${share.video.title} video.`}
      />
    );
  }

  const length = describeDuration(share.video.durationSeconds);

  return (
    <main className="flex min-h-screen flex-col bg-[#fbfaf7] text-[#12202a]">
      {/* 46px at the top keeps the first line clear of a phone's notch and status bar. */}
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 pb-10 pt-[46px] sm:px-8">
        {/* Who sent it comes first: it is the first thing an anxious person wants to know. */}
        <p className="text-[15px] font-semibold tracking-[.01em] text-[#46555e]">From {share.clinic.name}</p>
        <h1 className="mt-1.5 text-[29px] leading-[1.15] font-bold tracking-[-.022em]">{share.video.title}</h1>
        <p className="mt-2.5 text-[20px] leading-[1.5] text-[#3a4c56]">
          Your surgeon shared this so you can see what happens during your operation.
        </p>

        <div className="mt-6">
          <WatchPlayer src={getPlaybackUrl(share.video)} title={share.video.title} code={share.code} />
        </div>

        {/* "About 2 minutes", so nobody has to decide whether they have time to start it. */}
        {length && (
          <p className="mt-5 flex items-center gap-2 text-[16px] font-medium text-[#46555e]">
            <ClockIcon className="h-5 w-5 shrink-0" />
            {length}
          </p>
        )}

        {/* The second half is for the spouse or adult child who was never in the room. */}
        <p className="mt-4 border-t border-[#e6e2da] pt-4 text-[19px] leading-[1.52] text-[#3a4c56]">
          Watch it as many times as you like, and show it to anyone coming with you.
        </p>

        {/* The logo is a picture, not a link: the patient has nowhere else to go. */}
        <div className="mt-auto pt-10">
          {/* eslint-disable-next-line @next/next/no-img-element -- small static logo from the CDN */}
          <img src={LOGO_URL} alt="Pulse 3D" className="h-6 w-auto" />
        </div>
      </div>
    </main>
  );
}

/**
 * The calm page for a link that is expired or does not exist. Same warm
 * ground, a soft circular icon, plain words, nothing that reads as an alarm,
 * and nothing to do but ask the practice. Never the words "error" or
 * "invalid", and nothing red.
 */
function Unavailable({ icon, heading, body, note }: { icon: ReactNode; heading: string; body: string; note?: string }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#fbfaf7] px-8 pb-10 pt-[46px] text-center text-[#12202a]">
      <div className="flex h-[66px] w-[66px] items-center justify-center rounded-full bg-[#f0ece3] text-[#74664c]">{icon}</div>
      <h1 className="mt-6 text-[26px] leading-[1.22] font-bold tracking-[-.02em]">{heading}</h1>
      <p className="mt-3.5 max-w-[30ch] text-[20px] leading-[1.52] text-[#3a4c56]">{body}</p>
      {note && <p className="mt-3 max-w-[30ch] text-[17px] leading-[1.5] text-[#46555e]">{note}</p>}
      {/* eslint-disable-next-line @next/next/no-img-element -- small static logo from the CDN */}
      <img src={LOGO_URL} alt="Pulse 3D" className="mt-12 h-6 w-auto" />
    </main>
  );
}
