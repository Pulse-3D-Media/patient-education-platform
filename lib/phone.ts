/**
 * US phone numbers, stored as ten digits and shown formatted.
 *
 * A clinic's phone is typed in any of the usual ways ("801-555-0123",
 * "(801) 555 0123", "+1 801 555 0123") and stored as "8015550123". It is
 * shown back as "(801) 555-0123". Pure functions, no database, so they can
 * be tested on their own.
 */

/**
 * The ten digits of a US phone number typed in any format, or null if what
 * was typed is not one. A leading "1" (the country code) is dropped.
 * An empty string gives null too, which callers treat as "no phone".
 */
export function normalizeUsPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length === 10) return digits;
  return null;
}

/** "8015550123" becomes "(801) 555-0123". Anything else is shown as typed. */
export function formatUsPhone(digits: string | null | undefined): string {
  if (!digits) return "";
  if (!/^\d{10}$/.test(digits)) return digits;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * The address behind a tap-to-call link, "tel:+18015550123", or null when
 * the stored value is not exactly ten digits. The patient page only offers
 * a call link when this returns one, so a half-typed or hand-edited number
 * never becomes a link that dials the wrong place.
 */
export function telHref(digits: string | null | undefined): string | null {
  if (!digits || !/^\d{10}$/.test(digits)) return null;
  return `tel:+1${digits}`;
}

/**
 * What the phone box shows while someone types or pastes (the setup step and
 * Clinic branding): at most the ten digits of the number, shown as
 * "(801) 555-0123" as they arrive. Spaces, dashes, brackets and dots are
 * ignored, and a leading "+1" or "1" is taken as the country code and dropped
 * (no US area code starts with 1), so "+1 801 555 0123" pasted whole fits.
 * An eleventh digit of the number itself is simply not taken.
 *
 * Only a courtesy in the browser: the server checks what is sent with
 * normalizeUsPhone() above, whatever the box allowed.
 */
export function typedUsPhone(input: string): string {
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("1")) digits = digits.slice(1);
  digits = digits.slice(0, 10);
  if (digits.length === 0) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** The sentence beside the phone box before anything is sent, or null when it is empty or complete. */
export function typedPhoneProblem(shown: string): string | null {
  const count = shown.replace(/\D/g, "").length;
  return count === 0 || count === 10 ? null : `That is ${count} of the 10 digits. Enter the whole number, like (801) 555-0123.`;
}
