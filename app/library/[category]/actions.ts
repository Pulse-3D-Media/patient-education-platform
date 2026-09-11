"use server";

import { getBaseUrl } from "@/lib/base-url";
import { getCurrentClinicId } from "@/lib/clinic";
import { createShare } from "@/lib/db/shares";
import { SHARE_EXPIRY_DAYS } from "@/lib/expiry";
import { qrSvg } from "@/lib/qr";
import { watchLink } from "@/lib/share-link";

/**
 * The Server Action behind the library's Send button.
 *
 * A Server Action is a function that runs on the server but can be called
 * from a button in the browser, so the database work stays on the server
 * (rule 1) while the surgeon just taps.
 *
 * It uses the very same createShare as the admin console, and the same
 * SHARE_EXPIRY_DAYS, so a link made in the exam room and a link made at the
 * front desk are the same kind of link, work for the same number of days,
 * and both show up in the admin list.
 */

/** What the Send panel gets back: everything it shows, or a message. */
export type SendResult =
  | {
      ok: true;
      code: string;
      /** The full patient link, e.g. https://example.com/watch/k7m2xq */
      link: string;
      /** The QR code as an image address the browser can show straight away. */
      qrImage: string;
      /** When the link stops working, as an ISO date string. */
      expiresAt: string;
      days: number;
    }
  | { ok: false; error: string };

/** Create a share link for one video and return it with its QR code. */
export async function sendShareAction(videoId: string): Promise<SendResult> {
  // The clinic comes from the signed-in user's organization, never from the
  // browser. Null means signed out, no organization, or a clinic that is not
  // open (not on a plan yet); none of those may create a link. Any member
  // may send, admin or not: sending is the surgeon's job.
  const clinicId = await getCurrentClinicId();
  if (!clinicId) {
    return {
      ok: false,
      error: "Your clinic can't send links right now. Sign in again, or ask your clinic's admin.",
    };
  }

  if (typeof videoId !== "string" || !videoId.trim()) {
    return { ok: false, error: "No video was selected." };
  }

  try {
    const share = await createShare(clinicId, videoId.trim(), SHARE_EXPIRY_DAYS);
    const link = watchLink(await getBaseUrl(), share.code);

    // The QR code as SVG, packed into a data address, the same way the
    // printable pamphlet does it. SVG stays sharp at any size on the tablet.
    const qrImage = "data:image/svg+xml;utf8," + encodeURIComponent(await qrSvg(link));

    return {
      ok: true,
      code: share.code,
      link,
      qrImage,
      expiresAt: share.expiresAt.toISOString(),
      days: SHARE_EXPIRY_DAYS,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not create the link." };
  }
}
