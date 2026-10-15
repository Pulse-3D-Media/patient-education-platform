import type { ReactNode } from "react";
import { ClinicLogo } from "./ClinicLogo";
import { PLACEHOLDER_CHIP } from "./styles";

/**
 * The strip on the video: the clinic's logo and the name of the doctor who
 * sent it ("Dr. Jane Smith, DO"), in both players (decided by Evan on
 * 2026-10-02, after Van asked for the doctor and the clinic on the video
 * itself on the September 28 call). It works like a watermark: it shows the
 * clinic stands behind the video.
 *
 * WHERE IT SITS: A SLIM ROW ABOVE THE PICTURE, NOT ON IT (option C, chosen
 * by Evan on 2026-10-15 after trying a bigger see-through strip laid over
 * the picture on a Samsung phone and an iPad). Nothing of ours is drawn over
 * the picture any more, so it can never cover the browser's own buttons:
 * Safari draws its full-screen and picture-in-picture buttons in the
 * picture's top-left corner and its sound button top right, and the strip
 * used to lie over them. The row is part of the player: in the library's
 * full screen it comes along; in the browser's own full screen (the patient
 * player's, and the iPhone's) the browser shows the video alone, without
 * it. That is accepted (Evan, 2026-10-15).
 *
 * HOW IT LOOKS (subtle, Evan, 2026-10-15: the twice-as-big name was "way too
 * big" on a phone):
 *
 *   - One line, a fixed 2.75rem (44px) tall, on the player's own black, so
 *     it reads as the top edge of the player. Light grey words (#e3e7eb,
 *     about 16:1 on black), 15px on a phone, growing a little with the
 *     player's width to 18px (.video-strip in app/globals.css, measured from
 *     the row's own width, so the server's HTML is already right).
 *   - The logo first, straight on the black: no chip, box, border or shadow.
 *     It keeps its fixed box and loads at low priority (ClinicLogo), so it
 *     never moves anything and never holds up the first frame. No logo, or
 *     one that does not load: the clinic's name in its place.
 *   - Then a thin rule and the doctor's name, exactly as patients see it on
 *     their links ("Dr. Jane Smith, DO", Share.senderName), with no "Sent
 *     by" in front (decided by Evan on 2026-10-05). No sender recorded: just
 *     the clinic. A name too long for the line ends in "..."; the patient
 *     page always writes it in full above the player.
 *   - At the right end: the amber "Placeholder animation" chip when the video
 *     is a sample, and `action`, one of our own controls that belongs there
 *     (the library player's Close).
 *
 * Screen readers skip the logo and the name (both are already written on
 * the page); the placeholder chip and the action are read.
 *
 * WHAT IT IS NOT: protection. It is drawn by the web page, not burned into
 * the file. A screenshot or a screen recording still works, and the
 * browser's own full screen and picture-in-picture show the video alone.
 *
 * WHY A DARK LOGO IS HARD TO SEE HERE. The row is black, so a logo drawn for
 * a white page can disappear on it. The Branding form says a white or light
 * version of the logo works best on the video, and its preview shows it.
 */
export function ClinicMark({
  logoUrl,
  name,
  senderName = null,
  placeholder = false,
  action = null,
}: {
  /** The clinic's checked logo address, or null to write its name instead. */
  logoUrl: string | null;
  /** The clinic's name: the stand-in for the logo, and what a screen reader already has from the page. */
  name: string;
  /** The name patients see ("Dr. Jane Smith, DO"), or null for a link with no sender recorded: then only the clinic. */
  senderName?: string | null;
  /** True for a sample animation standing in for the named procedure: the amber chip rides at the right end. */
  placeholder?: boolean;
  /** One of our own controls for the right end (the library player's Close). */
  action?: ReactNode;
}) {
  return (
    <div data-video-strip="" className="video-strip w-full shrink-0 select-none">
      <span aria-hidden="true" className="video-strip-brand">
        {logoUrl ? (
          // A fixed box, so the row looks the same before, during and after the logo loads, and if it never does.
          <ClinicLogo src={logoUrl} name={name} boxClassName="video-strip-logo shrink-0" nameClassName="video-strip-clinic" />
        ) : (
          <span className="video-strip-clinic block truncate">{name}</span>
        )}
      </span>
      {senderName && (
        <span aria-hidden="true" className="video-strip-sender">
          {senderName}
        </span>
      )}
      {(placeholder || action) && (
        <span className="video-strip-end">
          {placeholder && <span className={PLACEHOLDER_CHIP}>Placeholder animation</span>}
          {action}
        </span>
      )}
    </div>
  );
}

/** The usual shape of a video, until the file says otherwise. */
export const DEFAULT_PICTURE_RATIO = 16 / 9;

/** A video's shape from its own size, or the default when it is not known (yet). */
export function pictureRatio(width: number | undefined, height: number | undefined): number {
  return width && height && Number.isFinite(width / height) ? width / height : DEFAULT_PICTURE_RATIO;
}
