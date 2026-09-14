"use server";

import { getBaseUrl } from "@/lib/base-url";
import { getCurrentClinicId } from "@/lib/clinic";
import { createShare, ShareRefusedError } from "@/lib/db/shares";
import { qrSvg } from "@/lib/qr";
import { watchLink } from "@/lib/share-link";

/**
 * The Server Action behind the library's Send button.
 *
 * A Server Action is a function that runs on the server but can be called
 * from a button in the browser, so the database work stays on the server
 * (rule 1) while the surgeon just taps.
 *
 * It uses the very same createShare as the admin console, which reads the
 * settings (and the clinic's own number, when Pulse staff have set one) and
 * copies them onto the link. So a link made in the exam room and a link
 * made at the front desk are the same kind of link, work for the same
 * number of days, and both show up in the admin list.
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
      /** When the link stops working if nobody ever plays it, as an ISO date string. */
      unclaimedUntil: string;
      /** How many days the link works after the patient first plays it. Copied onto the link, so this is what it will do. */
      daysAfterFirstPlay: number;
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
    const share = await createShare(clinicId, videoId.trim());
    const link = watchLink(await getBaseUrl(), share.code);

    // The QR code as SVG, packed into a data address, the same way the
    // printable pamphlet does it. SVG stays sharp at any size on the tablet.
    const qrImage = "data:image/svg+xml;utf8," + encodeURIComponent(await qrSvg(link));

    return {
      ok: true,
      code: share.code,
      link,
      qrImage,
      unclaimedUntil: share.expiresAt.toISOString(),
      // createShare always copies a number onto a new link; the fallback is only for the type.
      daysAfterFirstPlay: share.daysAfterFirstPlay ?? 0,
    };
  } catch (error) {
    // createShare said no: the video is not on the clinic's plan, is a
    // placeholder this clinic is not shown, is unpublished, or is gone. Its
    // message is written for the person who tapped, so it is shown as is.
    if (error instanceof ShareRefusedError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : "Could not create the link." };
  }
}
