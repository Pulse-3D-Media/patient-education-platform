import { pickTrustedOrigin, type OriginEnv } from "./trusted-origin";

/**
 * Permanent (printed) QR codes: the plain facts both sides share. Pure, no
 * database, safe for the browser.
 *
 * WHAT A PRINTED CODE IS. A clinic prints it on pamphlets, posters or its own
 * handouts and keeps it. It is not a patient link. Scanning it opens
 * /q/<code>, the same calm page a patient link opens; the patient's tap on
 * Play makes a NEW patient link (a Share) for that one patient, with the
 * usual rules (lib/expiry.ts), and the address bar then shows that link. The
 * printed code itself never runs out. It stops only when an office admin
 * retires it (or replaces it with a new one), and a retired code never works
 * again.
 *
 * WHY IT IS SAFE TO PRINT. The code is long and random (QR_CODE_LENGTH
 * characters, about 128 bits, from Node's cryptographic generator in
 * lib/db/qr-codes.ts), so nobody finds one by guessing. Every tap is checked
 * on the server: the code is live, and the clinic may use the video right
 * now (open, on its plan, published, placeholders only while shown). What it
 * cannot do: stop someone who holds the paper from watching that one
 * procedure. That is what a printed code is for.
 *
 * Opening the page makes nothing. Only the Play tap does (POST
 * /q/<code>/issue), so a text message previewing the address, an email
 * scanner, or a browser asking for the page's headers leaves no trail of
 * patient links behind it.
 */

/** How long a printed code is: 25 characters from 36 is about 129 bits. */
export const QR_CODE_LENGTH = 25;

/** True for something shaped like a printed code: 25 lowercase letters and digits. Anything else is refused before the database is asked. */
export function isQrCodeShape(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9]{25}$/.test(value);
}

/**
 * The one-time key the patient's page makes for one visit (one page load),
 * sent with every try of that visit's Play tap. A network retry of the same
 * tap sends the same key and gets the same link back; a new visit makes a new
 * key and gets a new link. It is random and says nothing about the person
 * or the phone, and the server never stores it (see childShareCode in
 * lib/db/shares.ts).
 */
export function isAttemptKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9-]{16,64}$/.test(value);
}

/** "https://learn.pulse3dmedia.com" and a code become "https://learn.pulse3dmedia.com/q/<code>". */
export function qrLink(origin: string, code: string): string {
  return `${origin}/q/${code}`;
}

/**
 * THE ADDRESS EVERY PRINTED CODE CARRIES ON PRODUCTION. Fixed here in the
 * code, never read from the request, because paper cannot be updated: a code
 * printed today must open the same address in five years. The app moved to
 * this address on 2026-10-05; changing it means every code ever printed
 * stops working, so it is changed only on Evan's say-so.
 */
export const PERMANENT_QR_ORIGIN = "https://learn.pulse3dmedia.com";

/** Where a printed code points, and whether the paper must say it is a test. */
export type QrOrigin = { origin: string; testOnly: boolean };

/**
 * The address to put in a printed code. On the production deployment it is
 * always PERMANENT_QR_ORIGIN. Anywhere else (a preview, a developer's
 * computer) it is that deployment's own address, picked the same careful way
 * as a Stripe return address (pickTrustedOrigin: the Host header only chooses
 * among addresses the deployment knows are its own), and `testOnly` is true:
 * the pamphlet says "Test only" across it and the code is never to be handed
 * to a patient. Null when no address can be trusted; the page then says so
 * and draws no code.
 */
export function qrOriginFor(host: string | null, env: OriginEnv & { VERCEL_ENV?: string }): QrOrigin | null {
  if (env.VERCEL_ENV === "production") return { origin: PERMANENT_QR_ORIGIN, testOnly: false };
  const origin = pickTrustedOrigin(host, env);
  return origin ? { origin, testOnly: true } : null;
}

/**
 * "<clinicId>:<videoId>:<senderUserId>": the value of QrCode.liveKey while a
 * code is live. The column is unique, so the database itself refuses a second
 * live code for the same procedure from the same surgeon at the same clinic,
 * even when two admins press at the same moment. Retiring empties it.
 */
export function liveKeyFor(clinicId: string, videoId: string, senderUserId: string): string {
  return `${clinicId}:${videoId}:${senderUserId}`;
}

/** The start of the day, in UTC, that `now` falls in. The daily flag counts links handed out since this moment. */
export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** How far back the "last 30 days" count on the Pulse clinic page looks: exactly 30 times 24 hours before now. */
export const QR_RECENT_DAYS = 30;

/** "Total Knee Replacement" and a code's id become "total-knee-replacement-printed-qr-<last 6 of id>.png". The code itself is never in a file name. */
export function printedQrFileName(title: string, id: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "procedure"}-printed-qr-${id.slice(-6).toLowerCase()}.png`;
}
