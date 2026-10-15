import type { CSSProperties, ReactNode } from "react";
import { VIDEO_STRIP_ALPHA } from "@/lib/branding";
import { ClinicLogo } from "./ClinicLogo";
import { PLACEHOLDER_CHIP } from "./styles";

/**
 * The strip on the video, like a TV "lower third" but along the top: the
 * clinic's logo and the name of the doctor who sent it ("Dr. Jane Smith,
 * DO") laid across the TOP EDGE OF THE PICTURE, in both players (decided by
 * Evan on 2026-10-02, after Van asked for the doctor and the clinic on the
 * video itself on the September 28 call). It works like a watermark: it
 * shows the clinic stands behind the video (kept at the 2026-10-08 huddle).
 *
 * HOW IT LOOKS (2026-10-08 huddle, built in the player-overlay PR):
 *
 *   - See-through, not a solid bar. Behind the words is a soft dark wash
 *     that fades out under them (black at VIDEO_STRIP_ALPHA, 0.5, where the
 *     words are, then nothing; lib/branding.ts), and the words carry a soft
 *     shadow. Van asked for it to look transparent; the wash is the least
 *     that keeps the words readable on a white frame (3.9:1, and the words
 *     are all large text, whose floor is 3:1).
 *   - The doctor's name is about twice the old 15px: 26px on a phone, up
 *     to 32px on a tablet, a computer or in full screen (it grows with the
 *     picture's width). A name longer than 28 characters is a step smaller,
 *     so a 48-character name still fits in full on two lines on a phone;
 *     anything longer ends in "...". The page always writes it in full.
 *   - On a narrow picture (a phone) the logo is on one line and the name on
 *     the line under it; on a wider one they share a line. The sizes and the
 *     two layouts are CSS (.video-strip in app/globals.css), measured from
 *     the strip's own width, so the server's HTML is already right.
 *   - The logo sits straight on the wash: no chip, box, border or shadow.
 *     It keeps its fixed box and loads at low priority (ClinicLogo), so it
 *     never moves anything and never holds up the first frame. No logo, or
 *     one that does not load: the clinic's name in white in its place.
 *   - The doctor's name, exactly as patients see it on their links
 *     ("Dr. Jane Smith, DO", Share.senderName), with no "Sent by" in front
 *     (decided by Evan on 2026-10-05). No sender recorded: just the
 *     clinic.
 *   - The amber "Placeholder animation" chip, when the video is a sample,
 *     rides at the right end, so it stays in view for as long as the picture
 *     does.
 *   - `action`: one of OUR controls that belongs on the picture's top edge
 *     (the patient player's full-screen button) sits at the right end, in
 *     the strip's own layout, so the strip is never on top of it and it is
 *     the one thing here that takes a tap.
 *
 * Apart from `action`, it never takes a tap (pointer-events-none), so
 * whatever is under it still works. Screen readers skip the logo and the
 * name (both are already written on the page); the placeholder chip and the
 * action are read.
 *
 * WHAT IT CAN COVER. The top of the picture: about the top third on a phone
 * (the wash fades out over the last part of that), about a sixth on a tablet
 * or in full screen. An anatomy label or a caption up there is under it,
 * dimmed. Safari (iPhone, iPad, Mac) also draws its OWN buttons in the
 * picture's top corners once the video has started (its full screen and
 * picture-in-picture top left, its sound button top right); the strip lies
 * over them. They still work through it, because it takes no taps, but
 * they are harder to see. That is a layering fact: the browser draws its
 * buttons as part of the video, and anything the page lays over the picture
 * is on top of them. The strip is not moved off the picture without asking
 * Evan.
 *
 * WHAT IT IS NOT: protection. It is drawn by the web page over the video,
 * not burned into the file. A screenshot or a screen recording still works,
 * and when the phone's own full-screen player or picture-in-picture takes
 * the video over, the browser shows the video alone and the strip is gone
 * (see the players for where that can still happen). It tells a patient who
 * sent this. It does not stop copying.
 *
 * WHY A DARK LOGO IS HARD TO SEE HERE. The wash is dark, so a logo drawn
 * for a white page can disappear on it. The chip is not coming back; the
 * Branding form says a white or light version of the logo works best on the
 * video, and its preview shows the logo on this wash.
 */
export function ClinicMark({
  logoUrl,
  name,
  senderName = null,
  placeholder = false,
  inFlow = false,
  action = null,
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
  /** One of our own controls for the strip's right end (the patient player's full-screen button). The only thing on it that takes a tap. */
  action?: ReactNode;
}) {
  return (
    <div
      data-video-strip=""
      className={`video-strip pointer-events-none z-10 w-full select-none ${inFlow ? "relative shrink-0" : "absolute inset-x-0 top-0"}`}
      style={{ "--strip-alpha": VIDEO_STRIP_ALPHA } as CSSProperties}
    >
      <div className="video-strip-row">
        <span aria-hidden="true" className="video-strip-brand">
          {logoUrl ? (
            // A fixed box, so the strip looks the same before, during and after the logo loads, and if it never does.
            <ClinicLogo src={logoUrl} name={name} boxClassName="video-strip-logo shrink-0" nameClassName="video-strip-clinic" />
          ) : (
            <span className="video-strip-clinic block truncate">{name}</span>
          )}
        </span>
        {senderName && (
          <span aria-hidden="true" data-long={senderName.length > LONG_NAME || undefined} className="video-strip-sender">
            {senderName}
          </span>
        )}
        {(placeholder || action) && (
          <span className="video-strip-end">
            {placeholder && <span className={PLACEHOLDER_CHIP}>Placeholder animation</span>}
            {action && <span className="pointer-events-auto">{action}</span>}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * A doctor's name longer than this is drawn a step smaller (data-long, see
 * .video-strip-sender in app/globals.css), so the longest name the rules
 * promise (48 characters) still fits in full on two lines on a phone.
 * "Dr. Jane Smith, DO" is 18.
 */
export const LONG_NAME = 28;

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
