import type { Metadata } from "next";
import { patientLook } from "@/app/brand-look";
import { ClockIcon, PauseIcon, SearchIcon } from "@/components/ui/icons";
import { getSettings } from "@/lib/db/settings";
import { getShareByCode } from "@/lib/db/shares";
import { canRequestRenewal, isExpired, renewalState } from "@/lib/expiry";
import { playbackForShare } from "@/lib/playback-auth";
import { windowCoversVideo } from "@/lib/playback-source";
import { AskClinic } from "./AskClinic";
import { PatientViewer, Unavailable } from "../PatientPage";
import { WatchPlayer } from "./WatchPlayer";

/**
 * The patient viewer. Phone-first, no login, nothing to click except play.
 *
 * Who reads it: a patient in their sixties or seventies, on their own phone,
 * on cellular data, often anxious. Everything about the look follows from
 * that, and none of it is taste:
 *
 * - Dark text on a plain white ground. The National Institute on Aging's
 *   guidance for older readers, which is why this page is light when the rest
 *   of the product is near-black.
 * - Body text is 20px with a 1.5 line height. Nothing on the page is under
 *   15px. Body text and the practice name clear a 7:1 contrast ratio; nothing
 *   falls under 4.5:1. Do not go bigger either: past a point, bigger reads worse.
 * - Every tap target is at least 48px. Pinch-to-zoom is left on.
 *
 * Top to bottom it answers the questions an anxious person has, in order: who
 * sent me this ("Dr. Jane Smith, DO" and "Summit Orthopedics" under it: the
 * surgeon's name was copied onto the link when it was made; a link made
 * before that says "From Summit Orthopedics"), what is it, why, how long will it take. Under the video, one
 * quiet sentence says it is for education only, not medical advice (lib/education-note.ts): plain
 * text, never a step before the video. The Pulse 3D logo sits
 * at the very bottom, small, because the practice sent this, not us.
 *
 * THE CLINIC'S OWN LOOK. The page belongs to the practice that sent it, so
 * it carries the practice's branding (lib/branding.ts), within limits that
 * protect the reader:
 *
 *   - the logo, in a row of fixed height at the top, so a logo that is slow,
 *     broken or missing moves nothing (see ClinicLogo). The practice's name
 *     is always written out right under it, so the name never depends on a
 *     picture loading;
 *   - one brand colour, as a thin band across the very top and as the call
 *     button. Never as text colour or background: the page's dark-on-light
 *     text is the same for every clinic, and the band and button colours are
 *     adjusted until they are readable, whatever the clinic picked;
 *   - the clinic's font from the short list, which shows the moment it
 *     arrives and never holds up the text or the video (app/brand-fonts.ts).
 *
 * A clinic that set nothing gets the page exactly as it was.
 *
 * When the link cannot be played (expired, or the video taken down) and the
 * clinic has a valid phone number on file, the page offers one large
 * tap-to-call button, because "ask the office for a new link" is the only
 * thing left to do and a phone is already in their hand.
 *
 * A placeholder link (a sample animation standing in for the named
 * procedure) gets an amber bar above everything else saying so. The patient
 * must never be able to watch one without seeing that.
 *
 * The code in the address is looked up. If no link has that code, the link
 * has expired, or the video behind it has been taken out of the library
 * (unpublished on /pulse/videos), the patient sees a calm page asking them
 * to get a new link from the practice.
 *
 * Opening the page changes nothing about the link. Its deadline can only
 * move when the video actually starts playing (WatchPlayer, recordPlay),
 * and only once, so a text message previewing the link, a browser
 * fetching the poster, or a page left open does not start the clock.
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
    // No link, so no clinic: the page keeps the Pulse look and offers no number to call.
    return (
      <Unavailable
        look={patientLook(null)}
        icon={<SearchIcon className="h-8 w-8" />}
        heading="We couldn't find this link"
        body="Please check the address you were given, or ask your doctor's office for a new link."
      />
    );
  }

  // The clinic's logo, colour, font and phone, each checked on the way in (app/brand-look.ts).
  const look = patientLook(share.clinic);

  // At the deadline itself the link is over (lib/expiry.ts draws that line, and the play recording draws it in the same place).
  const now = new Date();
  if (isExpired(share, now)) {
    // A first-play link that was played is not finished when its days run out:
    // it has PAUSED, and the patient can ask the clinic to turn it back on, as
    // long as renewals are left (renewalState in lib/expiry.ts). The settings
    // row is read only here, on a link that has already run out, so the
    // working path pays nothing for it. A link nobody ever played, a legacy
    // link, and a link out of renewals are finished: the calm page, no button.
    const settings = await getSettings();
    const state = renewalState(share, settings.maxRenewals, now);
    if (state.kind === "paused" && share.video.isPublished) {
      return (
        <Unavailable look={look} icon={<PauseIcon className="h-8 w-8" />}>
          <AskClinic code={share.code} alreadyAsked={!canRequestRenewal(share, now)} call={look.call} />
        </Unavailable>
      );
    }
    return (
      <Unavailable
        look={look}
        icon={<ClockIcon className="h-8 w-8" />}
        heading="This link has expired"
        body={`Links stay open for a set time. ${share.clinic.name} can send you a fresh one whenever you need it.`}
        note={`Call the office and ask for your ${share.video.title} video.`}
      />
    );
  }

  // Unpublishing a video on /pulse/videos stops every link to it, old ones
  // included, until it is published again. Same calm page as an expired link.
  if (!share.video.isPublished) {
    return (
      <Unavailable
        look={look}
        icon={<ClockIcon className="h-8 w-8" />}
        heading="This video isn't available right now"
        body={`It has been taken down for now. ${share.clinic.name} can send you a new link when it is back.`}
        note={`Call the office and ask for your ${share.video.title} video.`}
      />
    );
  }

  // What the player loads, made here on the server for this link
  // (lib/playback-auth.ts): the plain file for a video still on the CDN, or
  // a signed Mux address that lives no longer than the link does. A link
  // that has only minutes left, which the first play will not extend (it
  // was played already, or is a legacy link), is told so in plain words
  // rather than letting the video stop part-way with no explanation.
  const source = playbackForShare(share, now);
  const willNotExtend = share.expiryPolicy !== "FIRST_PLAY" || share.firstPlayedAt !== null;
  const endsSoon = willNotExtend && !windowCoversVideo(now, share.expiresAt, share.video.durationSeconds);

  return (
    <PatientViewer
      look={look}
      clinicName={share.clinic.name}
      senderName={share.senderName}
      video={share.video}
      endsSoon={endsSoon}
      player={
        <WatchPlayer
          source={source}
          title={share.video.title}
          code={share.code}
          clinicName={share.clinic.name}
          logoUrl={look.logoUrl}
          senderName={share.senderName}
          call={look.call}
        />
      }
    />
  );
}
