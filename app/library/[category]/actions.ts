"use server";

import { getBaseUrl } from "@/lib/base-url";
import { getCurrentClinicId } from "@/lib/clinic";
import { createShare } from "@/lib/db/shares";
import { qrSvg } from "@/lib/qr";
import { watchLink } from "@/lib/share-link";

/**
 * The Server Action behind the library's Send button.
 *
 * A Server Action is a function that runs on the server but can be called
 * from a button in the browser, so the database work stays on the server
 * (rule 1) while the surgeon just taps.
 *
 * It uses the very same createShare as the admin console, so a link made in
 * the exam room and a link made at the front desk are the same kind of link
 * and both show up in the admin list.
 */

/**
 * How long a link made from the library works. Fixed, not chosen: there is
 * no dropdown in the exam room, because the Send button has to be one tap.
 * (The admin console still offers a choice of 3, 7, 14 or 30 days.)
 */
const SEND_EXPIRY_DAYS = 14;

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

/** Create a 14-day share link for one video and return it with its QR code. */
export async function sendShareAction(videoId: string): Promise<SendResult> {
  // The clinic comes from the server, never from the browser. In Phase 1 that
  // is the CLINIC_ID environment variable; in Phase 2 it will be the signed-in user.
  const clinicId = getCurrentClinicId();
  if (!clinicId) {
    return { ok: false, error: "CLINIC_ID is not set. Run npm run db:seed and copy the id into .env." };
  }

  if (typeof videoId !== "string" || !videoId.trim()) {
    return { ok: false, error: "No video was selected." };
  }

  try {
    const share = await createShare(clinicId, videoId.trim(), SEND_EXPIRY_DAYS);
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
      days: SEND_EXPIRY_DAYS,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not create the link." };
  }
}
