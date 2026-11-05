/**
 * The shape of a patient link and its QR file name, in one place, so the
 * admin page, the QR image and the printable pamphlet can never disagree.
 *
 * Plain functions with no server code in them, so the browser-side form can
 * use them too.
 *
 * The address in front of the code comes from qrOriginFor() in lib/qr-code.ts,
 * on the server, never from the request's Host header on its own.
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
 * How long a patient link's code is. A link made by hand (Create link, Send)
 * gets exactly this many characters; a link a printed QR code hands out gets
 * 16 (childShareCode() in lib/db/shares.ts).
 */
export const SHARE_CODE_LENGTH = 10;

/**
 * Could this be a patient link's code? Letters and digits, at most 20. Only
 * for refusing junk before the database is asked (the patient routes answer
 * it with a 400). Whether a code of that shape is still honoured is
 * isAcceptedShareCode() below.
 */
export function isShareCodeShape(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9]{1,20}$/.test(value);
}

/**
 * Is this a code a patient link may still be opened with? The right shape,
 * and at least SHARE_CODE_LENGTH long. Links made before October 2026 had
 * six characters; codes that short are no longer accepted (none was still
 * working when this rule was added, in November 2026). A short code is
 * answered exactly like a code that does not exist: the calm not-found page,
 * and nothing written. Longer codes (a printed QR code's 16-character links)
 * are accepted.
 *
 * Asked first by every lookup behind the patient's page that is keyed by the
 * code alone (getShareByCode, recordSharePlay, acceptShareDisclaimer and
 * requestShareRenewal in lib/db/shares.ts), so no route can skip it.
 */
export function isAcceptedShareCode(value: unknown): value is string {
  return isShareCodeShape(value) && value.length >= SHARE_CODE_LENGTH;
}
