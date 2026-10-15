import { clinicInitials } from "./player-rules";
import { ClinicLogo } from "./ClinicLogo";

/**
 * The clinic and the doctor on the video, the way Vimeo shows a video's
 * owner (decided by Evan and Van at the 2026-10-15 huddle, with a Vimeo
 * screenshot): top left of the picture, the clinic's logo in a round frame,
 * and beside it the video's title on a dark chip with the doctor's name on a
 * smaller chip under it ("Dr. Jane Smith, DO", Share.senderName, with no
 * "Sent by"; the clinic's name for a link with no doctor recorded). It works
 * like a watermark: it shows the clinic stands behind the video.
 *
 * It fades away with the rest of the controls a moment after the video
 * starts, and comes back when the video is paused, on a tap, or when the
 * mouse moves over the player (PlayerOverlay decides; this only draws).
 *
 *   - The round frame is filled by the logo, cropped to the circle
 *     (Evan, 2026-10-15): a square icon version of a clinic's logo works
 *     best. It sits on white, so a logo with a see-through background still
 *     shows. It keeps its fixed box and loads at low priority (ClinicLogo),
 *     so it never moves anything and never holds up the first frame. No
 *     logo, or one that does not load: the clinic's initials on dark grey.
 *   - The chips are black at VIDEO_CHIP_ALPHA (0.7, lib/branding.ts) with
 *     white words, so they read over any frame, white or black.
 *   - One line each: a long title or name ends in "..." (the patient page
 *     writes both in full above the player).
 *
 * Screen readers skip all of it (the page already says the clinic, the
 * doctor and the title in words).
 *
 * WHAT IT IS NOT: protection. It is drawn by the web page, not burned into
 * the file. A screenshot or a screen recording still works, and an iPhone's
 * own full-screen player and picture-in-picture show the video alone.
 */
export function ClinicMark({
  logoUrl,
  name,
  title,
  senderName = null,
}: {
  /** The clinic's checked logo address, or null for its initials. */
  logoUrl: string | null;
  /** The clinic's name: its initials stand in for a missing logo, and it is the second line when no doctor is recorded. */
  name: string;
  /** The video's title, on the first chip. */
  title: string;
  /** The name patients see ("Dr. Jane Smith, DO"), or null to show the clinic's name instead. */
  senderName?: string | null;
}) {
  return (
    <div data-video-strip="" aria-hidden="true" className="flex min-w-0 select-none items-center gap-2.5">
      <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full shadow-[0_1px_6px_rgba(0,0,0,.45)] @xl:h-14 @xl:w-14">
        {/* Initials underneath; the logo, once loaded, covers them. A logo that never loads leaves them showing. */}
        <span className="absolute inset-0 flex items-center justify-center bg-[#26323a] text-[15px] font-bold text-white @xl:text-[18px]">{clinicInitials(name)}</span>
        {logoUrl && <ClinicLogo src={logoUrl} name={name} fit="cover" fallback="blank" boxClassName="h-full w-full" imageClassName="bg-white" />}
      </span>
      <span className="flex min-w-0 flex-col items-start gap-1">
        <span className="video-chip max-w-full truncate rounded px-2 py-px text-[16px] font-semibold leading-snug text-white @xl:py-0.5 @xl:text-[18px]">{title}</span>
        <span className="video-chip max-w-full truncate rounded px-2 py-px text-[15px] font-medium leading-snug text-white @xl:py-0.5">{senderName ?? name}</span>
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
