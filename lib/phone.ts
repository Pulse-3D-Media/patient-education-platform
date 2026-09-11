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
