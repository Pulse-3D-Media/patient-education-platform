import type { CSSProperties, ReactNode } from "react";
import { VIDEO_STRIP_ALPHA } from "@/lib/branding";
import { ClinicLogo } from "./ClinicLogo";
import { PLACEHOLDER_CHIP } from "./styles";

/**
 * The strip on the video, like a TV "lower third" but along the top: one
 * thin band laid across the TOP EDGE OF THE PICTURE, with the clinic's logo
 * and the name of the doctor who sent it ("Dr. Jane Smith, DO"), in both players
 * (decided by Evan on 2026-10-02, after Van asked for the doctor and the
 * clinic on the video itself on the September 28 call). It replaced a small
 * white chip that sat in a strip of its own ABOVE the picture.
 *
 *   - The band is black at VIDEO_STRIP_ALPHA (0.6, lib/branding.ts): just
 *     dark enough that the white words read on a white frame (5.7:1), and
 *     see-through enough that the picture still shows under it. 32px tall
 *     (decided by Evan on 2026-10-05: a little thinner than the 40px strip
 *     that used to sit above the picture).
 *   - The logo sits straight on the band: no chip, box, border or shadow.
 *     It keeps its fixed box and loads at low priority (ClinicLogo), so it
 *     never moves anything and never holds up the first frame. No logo, or
 *     one that does not load: the clinic's name in white in its place.
 *   - The doctor's name, exactly as patients see it on their links
 *     ("Dr. Jane Smith, DO", Share.senderName), with no "Sent by" in front
 *     (decided by Evan on 2026-10-05). No sender recorded: just the
 *     clinic.
 *   - The amber "Placeholder animation" chip, when the video is a sample,
 *     rides at the right end of the same band, so it stays in view for as
 *     long as the picture does.
 *
 * It never takes a tap (pointer-events-none), so whatever is under it still
 * works, and it is never placed over one of our own controls. Screen readers
 * skip the logo and the name (both are already written on the page); the
 * placeholder chip is read.
 *
 * WHAT IT CAN COVER. It sits over the top 32px of the picture, so an anatomy
 * label or a caption in that band of a frame is under it, dimmed. That was
 * accepted when it was decided; if a video turns out to put something that
 * matters up there, the strip is not moved without asking Evan.
 *
 * WHAT IT IS NOT: protection. It is drawn by the web page over the video,
 * not burned into the file. A screenshot or a screen recording still works,
 * and when the phone's own full-screen player or picture-in-picture takes
 * the video over, the browser shows the video alone and the strip is gone
 * (see the players for where that can still happen). It tells a patient who
 * sent this. It does not stop copying.
 *
 * WHY A DARK LOGO IS HARD TO SEE HERE. The band is dark, so a logo drawn for
 * a white page can disappear on it. The chip is not coming back; the
 * Branding form says a white or light version of the logo works best on the
 * video, and its preview shows the logo on this band.
 */
export function ClinicMark({
  logoUrl,
  name,
  senderName = null,
  placeholder = false,
  inFlow = false,
}: {
  /** The clinic's checked logo address, or null to write its name instead. */
  logoUrl: string | null;
  /** The clinic's name: the stand-in for the logo, and what a screen reader already has from the page. */
  name: string;
  /** The name patients see ("Dr. Jane Smith, DO"), or null for a link with no sender recorded: then only the clinic. */
  senderName?: string | null;
  /** True for a sample animation standing in for the named procedure: the amber chip rides on the band. */
  placeholder?: boolean;
  /** True where there is no picture to lay it over (the patient player's "did not load" panel): it becomes a row of its own. */
  inFlow?: boolean;
}) {
  return (
    <div
      data-video-strip=""
      className={`pointer-events-none z-10 flex h-8 w-full select-none items-center gap-3 px-3 ${
        inFlow ? "relative shrink-0" : "absolute inset-x-0 top-0"
      }`}
      style={{ backgroundColor: `rgba(0, 0, 0, ${VIDEO_STRIP_ALPHA})` }}
    >
      <span aria-hidden="true" className="flex min-w-0 flex-1 items-center gap-3">
        {logoUrl ? (
          // A fixed box, so the band looks the same before, during and after the logo loads, and if it never does.
          <ClinicLogo src={logoUrl} name={name} boxClassName="h-6 w-24 shrink-0" nameClassName={`${WORDS} leading-none`} />
        ) : (
          <span className={`max-w-[45%] shrink-0 truncate leading-none ${WORDS}`}>{name}</span>
        )}
        {senderName && (
          <>
            <span className="h-4 w-px shrink-0 bg-white/50" />
            <span className={`line-clamp-2 min-w-0 break-words leading-none ${WORDS}`}>{senderName}</span>
          </>
        )}
      </span>
      {placeholder && <span className={`${PLACEHOLDER_CHIP} shrink-0`}>Placeholder animation</span>}
    </div>
  );
}

/**
 * White, 15px (the smallest text the patient page allows), on the band. The
 * clinic's name stays on one line and is cut short if it must be; the
 * doctor's name may take two tight lines (two 15px lines are 30px,
 * inside the 32px band), so a long name on a phone is still read in full
 * rather than cut off. Most names fit on one.
 */
const WORDS = "text-[15px] font-semibold text-white";

/**
 * A box laid exactly over the PICTURE inside a video's box, for the strip
 * to sit on. A video is drawn as large as fits and centred (object-contain),
 * so on a screen of another shape there are black bars above and below it,
 * and the top of the video's box is not the top of the picture. This box is
 * the picture's shape (`ratio`, width over height, read from the file once
 * it is known; 16:9 until then), as large as fits, centred the same way, so
 * the strip lands on the picture's top edge. The arithmetic is CSS
 * (.picture-area and .picture-fit in app/globals.css). A browser too old for
 * it puts the strip at the top of the video's box instead.
 *
 * It never takes a tap.
 */
export function OnPicture({ ratio, children }: { ratio: number; children: ReactNode }) {
  return (
    <div className="picture-area pointer-events-none absolute inset-0 z-10" style={{ "--picture-ratio": ratio } as CSSProperties}>
      <div className="picture-fit">{children}</div>
    </div>
  );
}

/** The usual shape of a video, until the file says otherwise. */
export const DEFAULT_PICTURE_RATIO = 16 / 9;

/** A video's shape from its own size, or the default when it is not known (yet). */
export function pictureRatio(width: number | undefined, height: number | undefined): number {
  return width && height && Number.isFinite(width / height) ? width / height : DEFAULT_PICTURE_RATIO;
}
