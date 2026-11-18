import { clinicInitials } from "./player-rules";
import { ClinicLogo } from "./ClinicLogo";

/**
 * The clinic and the doctor on the video, top left of the picture. It works
 * like a watermark: it shows the clinic stands behind the video.
 *
 * The 2026-10-15 huddle laid it out the way Vimeo shows a video's owner. The
 * November 2026 player refresh (after Evan's screenshots from a Samsung S22,
 * where the old title and doctor chips sat on the animation's own title card)
 * made it smaller:
 *
 *   - The clinic's logo in a round frame, cropped to fill the circle (Evan,
 *     2026-10-15, kept after the refresh on 2026-11-17: "I want the circle
 *     logo"). A square icon version of a clinic's logo works best, and the
 *     Branding form says so. It sits on white, so a logo with a see-through
 *     background still shows. It keeps its fixed box and loads at low
 *     priority (ClinicLogo), so it never moves anything and never holds up
 *     the first frame. No logo, or one that does not load: the clinic's
 *     initials on dark grey.
 *   - One slim chip beside it: the doctor's name ("Dr. Jane Smith, DO",
 *     Share.senderName, with no "Sent by"), or the clinic's name for a link
 *     with no doctor recorded. Its corners are slightly rounded (6px), not a
 *     full pill (Evan, 2026-11-17).
 *   - The video's title is NOT on the picture: the patient page writes it
 *     right above the player and the library's watch page right under it. It
 *     comes back, on a chip of its own above the doctor's, only in full
 *     screen, where the page is out of sight (PlayerOverlay passes it then).
 *
 * The chips are black at VIDEO_CHIP_ALPHA (0.7, lib/branding.ts) with white
 * words at 15px or more, so they read over any frame, white or black. One
 * line each: a long name ends in "...".
 *
 * Screen readers skip all of it (the page already says the clinic, the
 * doctor and the title in words). It fades with the controls (PlayerOverlay
 * decides; this only draws).
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
  return (
    <div data-video-strip="" aria-hidden="true" className="flex min-w-0 select-none items-center gap-2">
      <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full shadow-[0_1px_5px_rgba(0,0,0,.35)] @xl:h-12 @xl:w-12">
        {/* Initials underneath; the logo, once loaded, covers them. A logo that never loads leaves them showing. */}
        <span className="absolute inset-0 flex items-center justify-center bg-[#26323a] text-[15px] font-bold text-white @xl:text-[17px]">{clinicInitials(name)}</span>
        {logoUrl && <ClinicLogo src={logoUrl} name={name} fit="cover" fallback="blank" boxClassName="h-full w-full" imageClassName="bg-white" />}
      </span>
      <span className="flex min-w-0 flex-col items-start gap-1">
        {title && <span className="video-chip max-w-full truncate rounded-md px-2.5 py-0.5 text-[16px] font-semibold leading-snug text-white @xl:text-[18px]">{title}</span>}
        <span className="video-chip max-w-full truncate rounded-md px-2.5 py-0.5 text-[15px] font-medium leading-snug text-white @xl:text-[16px]">{senderName ?? name}</span>
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
