import { auth } from "@clerk/nextjs/server";
import { getClinicAccess } from "@/lib/db/access";
import { getSeatFor } from "@/lib/db/seats";
import { listUsableVideos } from "@/lib/db/videos";
import { errorKind } from "@/lib/error-kind";
import { posterForVideo } from "@/lib/playback-auth";
import { effectiveSenderName } from "@/lib/sender-name";
import { SetupFrame } from "../SetupFrame";
import { cameBack, previewFacts, requireSetup } from "../setup-view";
import { TestStepForm } from "./TestStepForm";

/**
 * Setup step 4 of 4: "Make a test link and try it" (screen 04-setup-4-test).
 * Pick a procedure, then "Generate QR code": an ordinary patient link from
 * the person setting up, made exactly as Shared links makes one, shown as a
 * QR code to scan with their own phone. Only procedures the clinic's plan
 * includes are listed, and the server checks again when the link is made.
 * A link names the surgeon it is from, so the person setting up needs a seat
 * (they were given one when the clinic opened, if one was free); without
 * one the page says so instead of offering the button.
 */
export const dynamic = "force-dynamic";

export default async function SetupTestPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const { clinic, progress } = await requireSetup("test");
  const { userId } = await auth();
  const [preview, welcomeBack, procedures, seat] = await Promise.all([
    previewFacts(clinic),
    cameBack(searchParams),
    readProcedures(clinic.id),
    userId ? getSeatFor(clinic.id, userId) : null,
  ]);

  const blocked = !seat
    ? "Links name the surgeon they are from, and you do not hold a seat, so you cannot make one yet. Give yourself a seat on People, or skip this step."
    : procedures.length === 0
      ? "Nothing to list right now: the categories on your plan have no animations you can share yet. Skip this step and try it later."
      : null;

  return (
    <SetupFrame clinic={clinic} progress={progress} step="test">
      <TestStepForm
        procedures={procedures}
        blocked={blocked}
        preview={{ ...preview, senderName: seat ? effectiveSenderName(seat.displayName, clinic.defaultPatientName) : preview.senderName }}
        welcomeBack={welcomeBack}
      />
    </SetupFrame>
  );
}

/**
 * The procedures this clinic may send, by name, each with its still for the
 * phone picture (found exactly as the patient page finds the one it shows
 * before the tick: a picture, never a player), or null when it has none.
 * An empty list when they cannot be read (the page says there is nothing to list).
 */
async function readProcedures(clinicId: string): Promise<{ id: string; title: string; posterUrl: string | null }[]> {
  try {
    const access = await getClinicAccess(clinicId);
    const videos = access ? await listUsableVideos(access) : [];
    const now = new Date();
    return videos.map((video) => ({ id: video.id, title: video.title, posterUrl: posterForVideo(video, now, null) }));
  } catch (error) {
    console.error("Setup: the procedures could not be read", errorKind(error));
    return [];
  }
}
