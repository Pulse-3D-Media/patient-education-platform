import { redirect } from "next/navigation";
import { staffLook } from "@/app/brand-look";
import { getShareTerms } from "@/lib/db/shares";
import { getClinicAccess } from "@/lib/db/access";
import { listUsableVideos } from "@/lib/db/videos";
import { errorKind } from "@/lib/error-kind";
import { afterFirstPlaySentence } from "@/lib/expiry";
import { posterForVideo } from "@/lib/playback-auth";
import { requireClinicPage, type CurrentClinic } from "@/lib/clinic";
import { clinicIsOpen } from "@/lib/clinic-status";
import { SETUP_PATH, stepIsOpen, type SetupProgress, type SetupStepKey } from "@/lib/setup";

/**
 * Who may see the setup steps, decided on the server for every request
 * (rule 8). SERVER ONLY.
 *
 *   - signed out: sent to sign in by requireClinicPage(), and back here after;
 *   - a member who is not an office admin: the library (setup is for admins
 *     only, and members are never shown the reminder either);
 *   - a clinic that is not open: Billing, which says why (every step's
 *     change needs an open clinic, as on the admin pages);
 *   - a clinic made before setup existed: the admin overview. It counts as
 *     set up, so there is nothing to walk through;
 *   - a step further ahead than the progress list links (stepIsOpen() in
 *     lib/setup.ts): the step the clinic is on.
 */
export type SetupPage = { clinic: CurrentClinic; progress: SetupProgress };

export async function requireSetup(step?: SetupStepKey): Promise<SetupPage> {
  const clinic = await requireClinicPage();
  if (!clinic.isAdmin) redirect("/library");
  if (!clinicIsOpen(clinic)) redirect("/admin/billing");
  if (!clinic.setup) redirect("/admin");
  if (step && !stepIsOpen(clinic.setup, step)) redirect(SETUP_PATH);
  return { clinic, progress: clinic.setup };
}

/** What the phone on the right of a step needs to draw the patient page, worked out on the server. */
export type PreviewFacts = {
  clinicName: string;
  logoUrl: string | null;
  color: string | null;
  fontClass: string;
  senderName: string | null;
  deadline: string | null;
  /** The video the picture shows: its title, its still (a picture, never a player) and its id, or a plain box with the usual title. */
  title: string;
  posterUrl: string | null;
  videoId: string | null;
};

/** The procedure the picture shows when it can (Evan, 2026-11-19: "just use the total knee replacement image for now"). */
const PREVIEW_TITLE = "Total Knee Replacement";

/**
 * Which video the phone picture shows, and its still: the clinic's Total Knee
 * Replacement if it has a still, else another Total Knee video with one, else
 * any video the clinic may open that has one, else the plain dark box with the
 * usual title. The still is found exactly as the patient page finds the one it
 * shows before the tick (posterForVideo: a signed Mux still, or the poster set
 * on /pulse), so nothing that plays is ever loaded. A failure leaves the box.
 */
async function previewVideo(clinicId: string): Promise<{ title: string; posterUrl: string | null; videoId: string | null }> {
  try {
    const access = await getClinicAccess(clinicId);
    const videos = access ? await listUsableVideos(access) : [];
    const now = new Date();
    const rank = (title: string) => (title.toLowerCase() === PREVIEW_TITLE.toLowerCase() ? 0 : title.toLowerCase().includes("total knee") ? 1 : 2);
    const ordered = [...videos].sort((a, b) => rank(a.title) - rank(b.title));
    for (const video of ordered) {
      const posterUrl = posterForVideo(video, now, null);
      if (posterUrl) return { title: video.title, posterUrl, videoId: video.id };
    }
  } catch (error) {
    console.error("Setup: the picture's video could not be read", errorKind(error));
  }
  return { title: PREVIEW_TITLE, posterUrl: null, videoId: null };
}

export async function previewFacts(clinic: CurrentClinic): Promise<PreviewFacts> {
  const look = staffLook(clinic);
  // Only for the line under the video in the picture. A setting out of range leaves the line out.
  const [terms, video] = await Promise.all([getShareTerms(clinic.id).catch(() => null), previewVideo(clinic.id)]);
  return {
    ...video,
    clinicName: clinic.name,
    logoUrl: look.logoUrl,
    color: clinic.branding.color,
    fontClass: look.fontClass,
    senderName: clinic.defaultPatientName,
    deadline: terms ? afterFirstPlaySentence(terms.daysAfterFirstPlay) : null,
  };
}

/** True when the address says the admin has just come back into setup (the entry page adds it), for "Welcome back." */
export async function cameBack(searchParams: Promise<Record<string, string | string[] | undefined>> | undefined): Promise<boolean> {
  return (await searchParams)?.back === "1";
}
