/**
 * Shared button looks, as Tailwind class strings, so buttons and button-like
 * links match without each file repeating the same list.
 */

/** What every small button shares: size, shape, type. */
const BUTTON_BASE = "inline-flex h-10 shrink-0 items-center rounded-lg px-4 text-sm font-medium transition";

/** The quiet outlined button: Copy link, Download QR, Print. */
export const SECONDARY_BUTTON = `${BUTTON_BASE} border border-line-strong text-ink-soft hover:border-brand hover:text-ink`;

/** The filled teal button: the one action a form is for. Same height as the others. */
export const PRIMARY_BUTTON = `${BUTTON_BASE} bg-brand text-on-brand hover:bg-brand-hover disabled:opacity-60`;

/** A text box, number box or select on the staff screens, dark or light. 44px tall so it is easy to hit. */
export const INPUT =
  "h-11 w-full rounded-lg border border-line-strong bg-field px-3 text-[15px] text-ink placeholder:text-ink-muted focus:border-brand focus:outline-none";

/** A multi-line text box, same look as INPUT. */
export const TEXTAREA =
  "w-full rounded-lg border border-line-strong bg-field px-3 py-2 text-[15px] text-ink placeholder:text-ink-muted focus:border-brand focus:outline-none";

/** The label above a field. */
export const LABEL = "mb-1 block text-sm font-medium text-ink-soft";

/** The same button for a moment after it has done its job: "Copied". */
export const SECONDARY_BUTTON_DONE = `${BUTTON_BASE} border border-transparent bg-brand/20 text-brand-bright`;

/**
 * The amber "Placeholder" mark: a sample animation is standing in for the
 * procedure named on it. Amber rather than red, because nothing is broken.
 * One look everywhere a placeholder can appear on the dark staff screens
 * (library card, player, admin list), so it is always read as the same
 * thing. Dark text on amber measures 10.4:1. The patient page has its own
 * light-ground version of the same colour.
 */
const PLACEHOLDER_BASE = "inline-flex items-center bg-[#f3b94d] font-semibold text-[#1c1300]";

/** The small badge on a library card thumbnail and beside a title on the admin page. */
export const PLACEHOLDER_BADGE = `${PLACEHOLDER_BASE} rounded-md px-2 py-0.5 text-[13px] uppercase tracking-wide`;

/** The chip that rests over the picture in the player. */
export const PLACEHOLDER_CHIP = `${PLACEHOLDER_BASE} rounded-full px-3 py-1 text-sm shadow-[0_2px_10px_rgba(0,0,0,.5)]`;

/**
 * The keyboard's focus ring on anything laid over a video's picture (the
 * players' round buttons, and their progress bar): a white ring with a dark
 * band around it, so it can be seen over a white frame and a black one alike
 * (white on the near-black #12202a is 16:1; each of the two is at least 3:1
 * against whatever is behind it). Shown for the keyboard only, never for a tap.
 */
export const PLAYER_FOCUS =
  "focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-0 focus-visible:outline-white focus-visible:shadow-[0_0_0_6px_#12202a]";

/**
 * The same ring for a whole player that has the keyboard's focus (after the
 * first play, focus sits on the player so space and the arrows reach it). An
 * outline is drawn above the video, so it shows; the dark band inside it is
 * a layer of its own for the same reason. The player's box must be
 * positioned (relative or absolute) for the band to sit on it.
 */
export const PLAYER_BOX_FOCUS =
  "focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-[-3px] focus-visible:outline-white focus-visible:after:pointer-events-none focus-visible:after:absolute focus-visible:after:inset-[3px] focus-visible:after:z-30 focus-visible:after:rounded-[inherit] focus-visible:after:shadow-[inset_0_0_0_3px_#12202a] focus-visible:after:content-['']";
