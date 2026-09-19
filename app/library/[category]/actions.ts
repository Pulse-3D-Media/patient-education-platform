"use server";

import { getBaseUrl } from "@/lib/base-url";
import { getCurrentClinicId } from "@/lib/clinic";
import { createShare, ShareRefusedError } from "@/lib/db/shares";
import { ShareTermsError } from "@/lib/expiry";
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
 *
 * WHEN SOMETHING GOES WRONG the surgeon, who may be standing in front of a
 * patient, gets a plain sentence and a Try again button, never the
 * technical detail. Two kinds of "no" are already written for a person and
 * are shown as they are: createShare refusing (not on the plan, not
 * published, gone) and the platform's day settings being out of range.
 * Anything else (the database slow to wake, a dropped connection) is
 * written to the server log, where Pulse 3D can read it, and the panel gets
 * the sentence below. The whole body is inside the try, so a failure while
 * finding the clinic is caught the same way.
 */

/** What the panel says when the link could not be made for a reason the person cannot do anything about. */
const COULD_NOT_MAKE_LINK = "The link could not be made just now. Nothing was sent to anyone. Try again in a moment.";

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
  try {
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
    // The platform's day settings are out of range. Also a sentence written for a person: it says to ask Pulse 3D.
    if (error instanceof ShareTermsError) return { ok: false, error: error.message };

    // Anything else is ours to read, not the surgeon's. The detail goes to the
    // server log (it holds no patient information and no link), never to the screen.
    console.error("Making a share link from the library failed", error);
    return { ok: false, error: COULD_NOT_MAKE_LINK };
  }
}
