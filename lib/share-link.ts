/**
 * The shape of a patient link and its QR file name, in one place, so the
 * admin page, the QR image and the printable pamphlet can never disagree.
 *
 * Plain functions with no server code in them, so the browser-side form can
 * use them too.
 */

/** "k7m2xq" becomes "https://example.com/watch/k7m2xq". */
export function watchLink(baseUrl: string, code: string) {
  return `${baseUrl}/watch/${code}`;
}

/** "Total Knee Replacement" and "k7m2xq" become "total-knee-replacement-k7m2xq.png". */
export function qrFileName(title: string, code: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug}-${code}.png`;
}

/**
 * Could this be a patient link's code? Letters and digits, at most 20. Only
 * for refusing junk before the database is asked (the accept route): the
 * length is not checked further, because links made before October 2026
 * have 6 characters, new ones 10 and a printed code's 16.
 */
export function isShareCodeShape(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9]{1,20}$/.test(value);
}
