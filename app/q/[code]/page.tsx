import type { Metadata } from "next";
import { patientLook } from "@/app/brand-look";
import { PatientViewer, Unavailable } from "@/app/watch/PatientPage";
import { WatchPlayer } from "@/app/watch/[code]/WatchPlayer";
import { ClockIcon, SearchIcon } from "@/components/ui/icons";
import { decideVideoAccess } from "@/lib/access";
import { getClinicAccess } from "@/lib/db/access";
import { getQrCodeByCode } from "@/lib/db/qr-codes";
import { playbackForVideo } from "@/lib/playback-auth";
import { isQrCodeShape } from "@/lib/qr-code";

/**
 * A printed QR code's page, /q/<code>: what a patient sees after scanning a
 * clinic's poster, pamphlet or handout. It looks exactly like a patient link's
 * page (app/watch/PatientPage.tsx): the clinic, the surgeon, the procedure and
 * one Play button. What a printed code is, and why it is safe to print, is at
 * the top of lib/qr-code.ts.
 *
 * OPENING THIS PAGE MAKES NOTHING. It reads the printed code and draws the
 * page. The patient's own link is made only when they tap Play (the player
 * posts to /q/<code>/issue), and the address bar then changes to that link.
 * So a text message previewing the address, an email scanner, a crawler or a
 * HEAD request never leave a trail of patient links.
 *
 * What it checks before offering Play: the code exists, it has not been
 * retired, and the clinic may show this video right now, by the same rule
 * every link obeys (decideVideoAccess: open, on its plan, published,
 * placeholders only while shown). The tap is checked again on the server,
 * under locks, so a change in between is caught there. A code that cannot
 * play gets the same calm page an expired link gets, with the clinic's
 * number to call, and never a reason a patient cannot act on.
 *
 * Who it is from: the surgeon on the code while they hold a seat at the
 * clinic, else only the clinic (decided by Evan on 2026-10-08).
 *
 * Always drawn fresh and never cached (force-dynamic: Next.js answers with
 * "private, no-store"), and search engines are told to stay away.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function PrintedCodePage({ params }: PageProps<"/q/[code]">) {
  const { code } = await params;
  // Anything not shaped like a printed code is not looked up at all.
  const qr = isQrCodeShape(code) ? await getQrCodeByCode(code) : null;

  if (!qr) {
    // No code, so no clinic: the Pulse look and no number to call.
    return (
      <Unavailable
        look={patientLook(null)}
        icon={<SearchIcon className="h-8 w-8" />}
        heading="We couldn't find this code"
        body="Please check the address, or ask your doctor's office for a new one."
      />
    );
  }

  const look = patientLook(qr.clinic);

  if (qr.retiredAt) {
    return (
      <Unavailable
        look={look}
        icon={<ClockIcon className="h-8 w-8" />}
        heading="This code is no longer in use"
        body={`${qr.clinic.name} has stopped using it.`}
        note={`Call the office and ask for your ${qr.video.title} video.`}
      />
    );
  }

  // The same rule a link obeys. One answer for every "no": the patient is not told about the clinic's plan or billing.
  const access = await getClinicAccess(qr.clinicId);
  const decision = access ? decideVideoAccess(access, qr.video) : { allowed: false };
  if (!decision.allowed) {
    return (
      <Unavailable
        look={look}
        icon={<ClockIcon className="h-8 w-8" />}
        heading="This video isn't available right now"
        body={`${qr.clinic.name} can tell you more.`}
        note={`Call the office and ask for your ${qr.video.title} video.`}
      />
    );
  }

  // What the player loads before the tap, so the tap can start it at once. A
  // video on the CDN is its plain address; a Mux video gets the usual
  // short-lived signed address, bounded by nothing but the token's own hour
  // (the printed code's permission is the clinic's access, checked above),
  // and from the first play on the player renews it through the patient's
  // own link.
  const source = playbackForVideo(qr.video, new Date(), null);

  return (
    <PatientViewer
      look={look}
      clinicName={qr.clinic.name}
      senderName={qr.senderName}
      video={qr.video}
      endsSoon={false}
      player={
        <WatchPlayer
          source={source}
          title={qr.video.title}
          code={null}
          qrCode={qr.code}
          clinicName={qr.clinic.name}
          logoUrl={look.logoUrl}
          senderName={qr.senderName}
          call={look.call}
        />
      }
    />
  );
}
