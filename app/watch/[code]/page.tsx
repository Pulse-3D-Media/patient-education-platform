import type { Metadata } from "next";
import { getShareByCode } from "@/lib/db/shares";
import { getPlaybackUrl } from "@/lib/video";
import { WatchPlayer } from "./WatchPlayer";

/**
 * The patient viewer. Phone-first, no login, nothing to click except play.
 *
 * The code in the address is looked up. If no link has that code, or the
 * link has expired, the patient sees a calm page asking them to get a new
 * link from their doctor's office. Otherwise: the video, its name, and who
 * sent it. No navigation, no menu, no links out.
 *
 * Always rendered fresh, so the expiry check is never a stale, cached answer.
 */
export const dynamic = "force-dynamic";

/** Share links are private to the patient, so search engines are told to stay away. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

// Same logo as the library banner. Here it is a picture, not a link:
// the patient has nowhere else to go.
const LOGO = "https://cdn.prod.website-files.com/69092ab4b2ae593d551bb95f/6a394f4daad9a6c8cc1d16a4_pulse3dmedia-logo-p-500.png";

export default async function WatchPage({ params }: PageProps<"/watch/[code]">) {
  const { code } = await params;
  const share = await getShareByCode(code);

  if (!share) {
    return (
      <Unavailable
        heading="We couldn't find this link."
        body="Please check the address you were given, or ask your doctor's office for a new link."
      />
    );
  }

  if (share.expiresAt < new Date()) {
    return (
      <Unavailable
        heading="This link has expired."
        body="Links work for a limited time. Please ask your doctor's office for a new one."
      />
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-black text-white">
      <div className="mx-auto w-full max-w-3xl sm:px-6 sm:py-6">
        <div className="flex items-center justify-between gap-4 px-5 py-4 sm:px-0 sm:pt-0">
          {/* eslint-disable-next-line @next/next/no-img-element -- small static logo from the CDN */}
          <img src={LOGO} alt="Pulse 3D" className="h-6 w-auto" />
          <p className="truncate text-base text-[#bfbfbf]">Shared by {share.clinic.name}</p>
        </div>

        <WatchPlayer src={getPlaybackUrl(share.video)} title={share.video.title} code={share.code} />

        <div className="px-5 py-6 sm:px-0">
          <h1 className="text-2xl font-semibold sm:text-3xl">{share.video.title}</h1>
          <p className="mt-3 text-lg leading-relaxed text-[#bfbfbf]">
            Your doctor shared this animation to help explain your procedure. Watch it as many times as you like,
            and bring any questions to your next visit.
          </p>
        </div>
      </div>
    </main>
  );
}

/**
 * The calm page for a link that is expired or does not exist. Plain words,
 * no colour that reads as an alarm, and nothing to do but ask the clinic.
 */
function Unavailable({ heading, body }: { heading: string; body: string }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-black px-6 py-12 text-center text-white">
      {/* eslint-disable-next-line @next/next/no-img-element -- small static logo from the CDN */}
      <img src={LOGO} alt="Pulse 3D" className="mb-10 h-7 w-auto" />
      <h1 className="text-2xl font-semibold sm:text-3xl">{heading}</h1>
      <p className="mt-4 max-w-md text-lg leading-relaxed text-[#bfbfbf]">{body}</p>
    </main>
  );
}
