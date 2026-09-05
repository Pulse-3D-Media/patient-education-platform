/**
 * Shared button looks, as Tailwind class strings, so buttons and button-like
 * links match without each file repeating the same list.
 */

/** What every small button shares: size, shape, type. */
const BUTTON_BASE = "inline-flex h-10 shrink-0 items-center rounded-lg px-4 text-sm font-medium transition";

/** The quiet outlined button: Copy link, Download QR, Print. */
export const SECONDARY_BUTTON = `${BUTTON_BASE} border border-white/15 text-[#bfbfbf] hover:border-[#2a829b] hover:text-white`;

/** The same button for a moment after it has done its job: "Copied". */
export const SECONDARY_BUTTON_DONE = `${BUTTON_BASE} border border-transparent bg-[#2a829b]/20 text-[#5fb8d4]`;
