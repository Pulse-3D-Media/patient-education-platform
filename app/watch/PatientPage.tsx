import type { ReactNode } from "react";
import type { Look } from "@/app/brand-look";
import { ClinicLogo } from "@/components/ui/ClinicLogo";
import { CalendarIcon, ClockIcon } from "@/components/ui/icons";
import { LOGO_HEIGHT, LOGO_URL, LOGO_WIDTH } from "@/lib/brand";
import { afterFirstPlaySentence, type PatientDeadline } from "@/lib/expiry";
import { describeDuration } from "@/lib/format";
import type { EarlyConnections } from "@/lib/playback-auth";
import { senderLines } from "@/lib/sender-name";
import { CallButton } from "./[code]/CallButton";
import { LinkDeadline } from "./LinkDeadline";
import { ShareLinkButton } from "./ShareLinkButton";

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
 * The page around the video: who it is from, what it is, the player (with
 * the "for education only" box above the video), and how long it takes. The
 * box is the page's one "for education only" statement: the sentence that
 * used to sit under the video said the same thing, and was taken off the
 * patient page when the box arrived (option B, chosen by Evan on 2026-10-10).
 * The printed pamphlet still carries it (EDUCATION_ONLY).
 *
 * Under the video's length, one quiet line says when the link stops working
 * (decided by Evan and Van on 2026-10-08, so a patient knows to ask for more
 * time before it runs out): "Once you start watching, this link works for 10
 * days." before the first play, "This link works until Friday, October 18."
 * after it, or for an older link with a fixed date (patientDeadline() in
 * lib/expiry.ts). When the "stops working in a few minutes" note is showing,
 * that note says it and this line is left out.
 *
 * Under those lines, one quiet button, "Save or share this link" (decided on
 * 2026-11-16; ShareLinkButton), on a patient link's page from the
 * start and on a printed code's page once the Play tap has made the visit's
 * own link (`share`). It is below the player, so it never moves the video.
 *
 * Without JavaScript (switched off, or a browser too old to run the page)
 * the box would tick and nothing would happen. A <noscript> sentence above
 * the player says so in plain words, with the clinic's number when one is on
 * file. A browser that runs scripts never shows it.
 */
export function PatientViewer({
  look,
  clinicName,
  senderName,
  video,
  endsSoon,
  deadline,
  now,
  player,
  early,
  share,
}: {
  look: Look;
  clinicName: string;
  /** "Dr. Jane Smith, DO", or null for a link that names only the clinic. */
  senderName: string | null;
  video: { title: string; isPlaceholder: boolean; durationSeconds: number | null };
  /** The link has only minutes left and the first play will not add any: say so, calmly. */
  endsSoon: boolean;
  /** When the link stops working, in the page's words (patientDeadline in lib/expiry.ts). Null says nothing. */
  deadline: PatientDeadline;
  /** The server's clock when the page was drawn: only decides whether a date's year is written. */
  now: Date;
  player: ReactNode;
  /** The hosts the video will come from, for early-connection hints (earlyConnectionsFor in lib/playback-auth.ts). Host names only. */
  early: EarlyConnections;
  /** When "Save or share this link" shows: "now" on a patient link's page, "once-own-link" on a printed code's page. */
  share: "now" | "once-own-link";
}) {
  const length = describeDuration(video.durationSeconds);
  return (
    <main className={`flex min-h-dvh flex-col bg-white text-[#12202a] ${look.fontClass}`} style={look.style}>
      {/* Open the connection to where the video will come from while the patient reads and ticks the box, so the
          tick's answer is not followed by a fresh look-up and handshake. React moves these into the page's head.
          A host name only: nothing here says which video, and nothing here plays. */}
      {early.origins.map(({ origin, anonymous }) => (
        <link key={`${origin}${anonymous ? " anonymous" : ""}`} rel="preconnect" href={origin} crossOrigin={anonymous ? "anonymous" : undefined} />
      ))}
      <BrandBand />
      {video.isPlaceholder && <PlaceholderBar />}

      {/* On a phone the page sits inside the browser, under its own address bar, so only a little room is left at the top
          and at the sides (16px), and the heading is a little smaller: on a 360 by 800 phone the player and its Play
          button are in view before the box is ticked (a Samsung S22 had the video below the fold). From 640px wide, the
          roomier page as before. With a phone on its side (short-landscape, app/globals.css) the logo and the line
          under the title step aside, the doctor and the clinic share one line, and the player is no taller than the
          screen, so the video is in view without scrolling past a screen of heading. When the placeholder bar is there,
          it carries the room at the top instead. */}
      <div
        className={`mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pb-10 sm:px-8 short-landscape:max-w-[calc((100dvh-4.5rem)*16/9+2rem)] short-landscape:px-4! ${
          video.isPlaceholder ? "pt-3 sm:pt-6 short-landscape:pt-2!" : "pt-4 sm:pt-[46px] short-landscape:pt-3!"
        }`}
      >
        {/* The logo's row is a fixed height (36px on a phone, 44px wider) whether the picture loads, loads late, or never loads, so nothing under it moves. */}
        {look.logoUrl && (
          <div className="mb-3 sm:mb-4 short-landscape:hidden">
            <ClinicLogo src={look.logoUrl} name={clinicName} boxClassName="h-9 w-[180px] max-w-full sm:h-11 sm:w-[220px]" fallback="blank" />
          </div>
        )}

        {/* Who sent it comes first: it is the first thing an anxious person wants to know. Always written out, so it never depends on the logo.
            "Dr. Jane Smith, DO" with "Summit Orthopedics" on the line under it, or "From Summit Orthopedics" when no surgeon is named. */}
        <p className="text-[15px] font-semibold tracking-[.01em] break-words text-[#46555e]">
          {senderLines(senderName, clinicName).map((line, i) => (
            <span key={i} className="block short-landscape:inline">
              {/* Sideways, the two lines become one: "Dr. Jane Smith, DO · Summit Orthopedics". */}
              {i > 0 && (
                <span aria-hidden="true" className="hidden px-1.5 short-landscape:inline">
                  ·
                </span>
              )}
              {line}
            </span>
          ))}
        </p>
        {/* A long word (a made-up name, or "Reconstruction" at 200% zoom on a phone) breaks rather than pushing the page sideways. */}
        <h1 className="mt-2 text-[24px] leading-[1.15] font-bold tracking-[-.022em] sm:mt-2.5 sm:text-[27px] short-landscape:text-[20px]! break-words">{video.title}</h1>
        <p className="mt-3 text-[18px] leading-[1.5] text-[#3a4c56] sm:mt-3.5 short-landscape:hidden">Your surgeon shared this so you can see what happens during your operation.</p>

        {/* Said only when the time left cannot hold one whole viewing and the first play will not add any: honest, calm, and the number to call. */}
        {endsSoon && (
          <p role="note" className="mt-5 rounded-xl bg-[#eef1f4] px-4 py-3 text-[15px] leading-[1.5] text-[#3a4c56]">
            This link stops working in a few minutes, so the video may stop before the end. {clinicName} can send you a fresh link.
          </p>
        )}

        {/* Only for a browser that cannot run the page: the box and Play need JavaScript. Calm, never "error". */}
        <noscript>
          {/* The share button needs JavaScript too: hide it rather than leave a button that does nothing. */}
          <style>{"[data-needs-script]{display:none}"}</style>
          <div className="mt-5 rounded-xl bg-[#eef1f4] px-4 py-3 text-[18px] leading-[1.5] text-[#3a4c56]">
            <p>To play this video, your browser needs JavaScript turned on. Turn it on in your browser&apos;s settings, or call {clinicName} and they can help.</p>
            {look.call && <CallButton call={look.call} />}
          </div>
        </noscript>

        {/* Sideways on a phone, the whole column is no wider than keeps the video's 16:9 picture inside the screen's height (above). */}
        <div className="mt-5 sm:mt-7 short-landscape:mt-3!">{player}</div>

        {/* "About 2 minutes", so nobody has to decide whether they have time to start it. */}
        {length && (
          <p className="mt-6 flex items-center gap-2 text-[15px] font-medium text-[#46555e]">
            <ClockIcon className="h-5 w-5 shrink-0" />
            {length}
          </p>
        )}

        {/* When the link stops working, so the patient can ask for more time before it does. The same size and colour as the length above: a fact, never a warning. */}
        {deadline && !endsSoon && (
          // On a narrow phone a long date wraps to a second line; the icon stays beside the first.
          <p className={`${length ? "mt-3" : "mt-6"} flex items-start gap-2 text-[15px] leading-6 font-medium text-[#46555e]`}>
            <CalendarIcon className="mt-0.5 h-5 w-5 shrink-0" />
            <span>
              {deadline.kind === "after-first-play" ? (
                afterFirstPlaySentence(deadline.days)
              ) : (
                <LinkDeadline deadlineMs={deadline.deadline.getTime()} nowMs={now.getTime()} />
              )}
            </span>
          </p>
        )}

        <ShareLinkButton title={video.title} when={share} />

        {/* The logo is a picture, not a link: the patient has nowhere else to go. */}
        <div className="mt-auto pt-10">
          {/* eslint-disable-next-line @next/next/no-img-element -- small fixed logo file, served from our own address */}
          <img src={LOGO_URL} width={LOGO_WIDTH} height={LOGO_HEIGHT} alt="Pulse 3D" className="h-8 w-auto" />
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
    <main className={`flex min-h-dvh flex-col bg-white text-[#12202a] ${look.fontClass}`} style={look.style}>
      <BrandBand />
      <div className="flex flex-1 flex-col items-center justify-center px-8 pb-10 pt-[46px] text-center">
        <div className="flex h-[66px] w-[66px] items-center justify-center rounded-full bg-[#eef1f4] text-[#52616a]">{icon}</div>
        {children ?? (
          <>
            <h1 className="mt-6 text-[24px] leading-[1.22] font-bold tracking-[-.02em]">{heading}</h1>
            <p className="mt-3.5 max-w-[30ch] text-[18px] leading-[1.52] break-words text-[#3a4c56]">{body}</p>
            {note && <p className="mt-3 max-w-[30ch] text-[16px] leading-[1.5] text-[#46555e]">{note}</p>}
            {look.call && <CallButton call={look.call} />}
          </>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element -- small fixed logo file, served from our own address */}
        <img src={LOGO_URL} width={LOGO_WIDTH} height={LOGO_HEIGHT} alt="Pulse 3D" className="mt-12 h-8 w-auto" />
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
 * It carries the room at the top of the page itself (12px on a phone, 46px
 * from 640px wide, 12px again on a phone held sideways), so the page below
 * drops its own.
 */
function PlaceholderBar() {
  return (
    <div role="note" className="border-b-2 border-[#e2a12a] bg-[#fff3d6] px-4 pb-3 pt-3 sm:px-8 sm:pb-3.5 sm:pt-[46px] short-landscape:pt-3!">
      <p className="mx-auto max-w-2xl text-[15px] leading-[1.45] text-[#5a3d00]">
        <strong className="font-bold">Placeholder.</strong> This plays a sample animation, not this procedure.
      </p>
    </div>
  );
}
