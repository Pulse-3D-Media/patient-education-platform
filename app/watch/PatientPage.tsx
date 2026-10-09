import type { ReactNode } from "react";
import type { Look } from "@/app/brand-look";
import { ClinicLogo } from "@/components/ui/ClinicLogo";
import { ClockIcon } from "@/components/ui/icons";
import { LOGO_URL } from "@/lib/brand";
import { EDUCATION_ONLY } from "@/lib/education-note";
import { describeDuration } from "@/lib/format";
import { senderLines } from "@/lib/sender-name";
import { CallButton } from "./[code]/CallButton";

/**
 * The patient's page, drawn the same way for a patient link (/watch/<code>)
 * and for a printed QR code (/q/<code>), so a patient who scans a poster sees
 * exactly what a patient sent a link sees. Why it looks the way it does (the
 * reader, the sizes, the clinic's own look) is at the top of
 * app/watch/[code]/page.tsx.
 *
 * Server components only: the one piece that runs in the browser is the
 * player, which each page makes and hands in as `player`.
 */

/**
 * The page around the video: who it is from, what it is, the player, how long
 * it takes, and the one "for education only" sentence.
 */
export function PatientViewer({
  look,
  clinicName,
  senderName,
  video,
  endsSoon,
  player,
}: {
  look: Look;
  clinicName: string;
  /** "Dr. Jane Smith, DO", or null for a link that names only the clinic. */
  senderName: string | null;
  video: { title: string; isPlaceholder: boolean; durationSeconds: number | null };
  /** The link has only minutes left and the first play will not add any: say so, calmly. */
  endsSoon: boolean;
  player: ReactNode;
}) {
  const length = describeDuration(video.durationSeconds);
  return (
    <main className={`flex min-h-screen flex-col bg-white text-[#12202a] ${look.fontClass}`} style={look.style}>
      <BrandBand />
      {video.isPlaceholder && <PlaceholderBar />}

      {/* 46px at the top keeps the first line clear of a phone's notch and status bar. When the placeholder bar is there, it carries that clearance instead. */}
      <div className={`mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 pb-10 sm:px-8 ${video.isPlaceholder ? "pt-6" : "pt-[46px]"}`}>
        {/* The logo's row is a fixed 44px tall whether the picture loads, loads late, or never loads, so nothing under it moves. */}
        {look.logoUrl && (
          <div className="mb-3">
            <ClinicLogo src={look.logoUrl} name={clinicName} boxClassName="h-11 w-[220px] max-w-full" fallback="blank" />
          </div>
        )}

        {/* Who sent it comes first: it is the first thing an anxious person wants to know. Always written out, so it never depends on the logo.
            "Dr. Jane Smith, DO" with "Summit Orthopedics" on the line under it, or "From Summit Orthopedics" when no surgeon is named. */}
        <p className="text-[15px] font-semibold tracking-[.01em] break-words text-[#46555e]">
          {senderLines(senderName, clinicName).map((line, i) => (
            <span key={i} className="block">
              {line}
            </span>
          ))}
        </p>
        <h1 className="mt-1.5 text-[29px] leading-[1.15] font-bold tracking-[-.022em]">{video.title}</h1>
        <p className="mt-2.5 text-[20px] leading-[1.5] text-[#3a4c56]">Your surgeon shared this so you can see what happens during your operation.</p>

        {/* Said only when the time left cannot hold one whole viewing and the first play will not add any: honest, calm, and the number to call. */}
        {endsSoon && (
          <p role="note" className="mt-5 rounded-xl bg-[#eef1f4] px-4 py-3 text-[16px] leading-[1.5] text-[#3a4c56]">
            This link stops working in a few minutes, so the video may stop before the end. {clinicName} can send you a fresh link.
          </p>
        )}

        <div className="mt-6">{player}</div>

        {/* "About 2 minutes", so nobody has to decide whether they have time to start it. */}
        {length && (
          <p className="mt-5 flex items-center gap-2 text-[16px] font-medium text-[#46555e]">
            <ClockIcon className="h-5 w-5 shrink-0" />
            {length}
          </p>
        )}

        {/* The second half is for the spouse or adult child who was never in the room. */}
        <p className="mt-4 border-t border-[#e3e7eb] pt-4 text-[19px] leading-[1.52] text-[#3a4c56]">
          Watch it as many times as you like, and show it to anyone coming with you.
        </p>

        {/* The same thing as the box above the video, as plain words under it (the box itself is in the player). The wording is Van's, approved by Evan; ask before changing it. */}
        <p className="mt-4 text-[16px] leading-[1.5] text-[#46555e]">{EDUCATION_ONLY}</p>

        {/* The logo is a picture, not a link: the patient has nowhere else to go. */}
        <div className="mt-auto pt-10">
          {/* eslint-disable-next-line @next/next/no-img-element -- small static logo from the CDN */}
          <img src={LOGO_URL} alt="Pulse 3D" className="h-6 w-auto" />
        </div>
      </div>
    </main>
  );
}

/** The thin band of the clinic's colour across the very top of the page. Decoration only. */
function BrandBand() {
  return <div aria-hidden="true" className="h-1.5 shrink-0 bg-brand" />;
}

/**
 * The calm page for a link or a printed code that cannot play: expired,
 * taken down, retired, or not found. Same white ground, a soft circular
 * icon, plain words, nothing that reads as an alarm, and nothing to do but
 * ask the practice. Never the words "error" or "invalid", and nothing red.
 *
 * When the clinic is known and has a valid phone number, the one thing left
 * to do gets one large button: call the office. It is a plain tel: link, so
 * the phone asks before it dials.
 *
 * The paused page is the same frame with its own middle (`children`): the
 * "ask my clinic" piece, which changes its own words after the tap.
 */
export function Unavailable({
  look,
  icon,
  heading,
  body,
  note,
  children,
}: {
  look: Look;
  icon: ReactNode;
  heading?: string;
  body?: string;
  note?: string;
  children?: ReactNode;
}) {
  return (
    <main className={`flex min-h-screen flex-col bg-white text-[#12202a] ${look.fontClass}`} style={look.style}>
      <BrandBand />
      <div className="flex flex-1 flex-col items-center justify-center px-8 pb-10 pt-[46px] text-center">
        <div className="flex h-[66px] w-[66px] items-center justify-center rounded-full bg-[#eef1f4] text-[#52616a]">{icon}</div>
        {children ?? (
          <>
            <h1 className="mt-6 text-[26px] leading-[1.22] font-bold tracking-[-.02em]">{heading}</h1>
            <p className="mt-3.5 max-w-[30ch] text-[20px] leading-[1.52] break-words text-[#3a4c56]">{body}</p>
            {note && <p className="mt-3 max-w-[30ch] text-[17px] leading-[1.5] text-[#46555e]">{note}</p>}
            {look.call && <CallButton call={look.call} />}
          </>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element -- small static logo from the CDN */}
        <img src={LOGO_URL} alt="Pulse 3D" className="mt-12 h-6 w-auto" />
      </div>
    </main>
  );
}

/**
 * The bar across the top of a placeholder video. The video below it carries a
 * real procedure name but plays a sample animation, so the patient is told
 * before anything else on the page. It keeps to the page's own rules: 16px
 * text, and #5a3d00 on #fff3d6 measures 9.1:1 against a 4.5:1 floor. Amber,
 * not red, because nothing has gone wrong.
 *
 * It carries the 46px notch clearance itself, so the page below drops its own.
 */
function PlaceholderBar() {
  return (
    <div role="note" className="border-b-2 border-[#e2a12a] bg-[#fff3d6] px-6 pb-3.5 pt-[46px] sm:px-8">
      <p className="mx-auto max-w-2xl text-[16px] leading-[1.45] text-[#5a3d00]">
        <strong className="font-bold">Placeholder.</strong> This plays a sample animation, not this procedure.
      </p>
    </div>
  );
}
