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
