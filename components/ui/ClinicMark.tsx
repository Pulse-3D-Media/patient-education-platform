"use client";

import { useState, type CSSProperties } from "react";
import { clinicInitials, logoShape, type LogoShape } from "./player-rules";
import { ClinicLogo } from "./ClinicLogo";

/**
 * The clinic and the doctor on the video, top left of the picture. It works
 * like a watermark: it shows the clinic stands behind the video.
 *
 * Refreshed in November 2026, after Evan's screenshots from a Samsung S22
 * showed the cost of the October design (a big round logo, the title and the
 * doctor on two chips) on a phone-sized picture: a wide wordmark cropped to
 * nonsense ("PULSE 3D MEDIA" read "ULSE 3 / MEDIA"), and the chips sitting on
 * the animation's own title card. Now:
 *
 *   - The logo is shown by its own shape, once it has loaded (logoShape() in
 *     player-rules.ts). A roughly square logo fills a round frame, as before.
 *     A wide wordmark is shown WHOLE on a small white rounded tag (32px tall
 *     on a phone, .mark-wide in app/globals.css), so its words read. A tall logo is shown whole inside the
 *     circle. This reverses the 2026-10-15 decision to crop every logo to the
 *     circle, and is in the pull request for Evan's approval.
 *   - One slim chip beside it: the doctor's name ("Dr. Jane Smith, DO",
 *     Share.senderName, with no "Sent by"), or the clinic's name for a link
 *     with no doctor recorded. The video's title is no longer on the picture
 *     (the patient page and the library's watch page both write it in full
 *     right above or under the player); it comes back, on a chip of its own,
 *     only in full screen, where the page is out of sight.
 *   - Before the logo has loaded, and if it never does, the clinic's
 *     initials on dark grey in the round frame. The frame is drawn at once,
 *     so nothing on the page moves when the picture arrives (the mark is laid
 *     over the picture, so a wide tag replacing the circle moves only the
 *     chip beside it, inside the overlay).
 *
 * The chips are black at VIDEO_CHIP_ALPHA (0.7, lib/branding.ts) with white
 * words at 15px or more, so they read over any frame, white or black. One
 * line each: a long name ends in "...".
 *
 * Screen readers skip all of it (the page already says the clinic, the
 * doctor and the title in words). It fades with the controls
 * (PlayerOverlay decides; this only draws).
 *
 * WHAT IT IS NOT: protection. It is drawn by the web page, not burned into
 * the file. A screenshot or a screen recording still works, and an iPhone's
 * own full-screen player and picture-in-picture show the video alone.
 */
export function ClinicMark({
  logoUrl,
  name,
  title = null,
  senderName = null,
}: {
  /** The clinic's checked logo address, or null for its initials. */
  logoUrl: string | null;
  /** The clinic's name: its initials stand in for a missing logo, and it is on the chip when no doctor is recorded. */
  name: string;
  /** The video's title, on a chip of its own above the doctor's: only in full screen, where the page's own title is out of sight. */
  title?: string | null;
  /** The name patients see ("Dr. Jane Smith, DO"), or null to show the clinic's name instead. */
  senderName?: string | null;
}) {
  // "round" until the logo has loaded and said what shape it is.
  const [shape, setShape] = useState<LogoShape>("round");
  const [ratio, setRatio] = useState(1);
  const wide = Boolean(logoUrl) && shape === "wide";

  return (
    <div data-video-strip="" aria-hidden="true" data-logo-shape={logoUrl ? shape : "initials"} className="flex min-w-0 select-none items-center gap-2">
      <span
        className={`relative flex shrink-0 items-center justify-center overflow-hidden shadow-[0_1px_5px_rgba(0,0,0,.35)] ${
          wide ? "mark-wide rounded-md bg-white px-[7px] py-1" : "h-10 w-10 rounded-full @xl:h-12 @xl:w-12"
        }`}
        style={wide ? ({ "--logo-ratio": ratio } as CSSProperties) : undefined}
      >
        {/* Initials underneath; the logo, once loaded, covers them. A logo that never loads leaves them showing. */}
        {!wide && <span className="absolute inset-0 flex items-center justify-center bg-[#26323a] text-[15px] font-bold text-white @xl:text-[17px]">{clinicInitials(name)}</span>}
        {logoUrl && (
          <ClinicLogo
            src={logoUrl}
            name={name}
            fit={shape === "round" ? "cover" : "contain"}
            position="center"
            fallback="blank"
            boxClassName={wide ? "relative h-full w-full" : "h-full w-full"}
            imageClassName={shape === "tall" ? "bg-white p-1" : "bg-white"}
            onLoadSize={(width, height) => {
              setShape(logoShape(width, height));
              setRatio(width / height);
            }}
          />
        )}
      </span>
      <span className="flex min-w-0 flex-col items-start gap-1">
        {title && <span className="video-chip max-w-full truncate rounded-full px-2.5 py-0.5 text-[16px] font-semibold leading-snug text-white @xl:text-[18px]">{title}</span>}
        <span className="video-chip max-w-full truncate rounded-full px-2.5 py-0.5 text-[15px] font-medium leading-snug text-white @xl:text-[16px]">{senderName ?? name}</span>
      </span>
    </div>
  );
}

/** The usual shape of a video, until the file says otherwise. */
export const DEFAULT_PICTURE_RATIO = 16 / 9;

/** A video's shape from its own size, or the default when it is not known (yet). */
export function pictureRatio(width: number | undefined, height: number | undefined): number {
  return width && height && Number.isFinite(width / height) ? width / height : DEFAULT_PICTURE_RATIO;
}
