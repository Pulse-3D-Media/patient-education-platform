import type { CSSProperties } from "react";
import { patientTheme, themeVars } from "@/lib/branding";
import { DISCLAIMER } from "@/lib/education-note";
import { senderLines } from "@/lib/sender-name";
import { ClinicLogo } from "./ClinicLogo";
import { ClinicMark } from "./ClinicMark";
import { CalendarIcon, PlayIcon } from "./icons";

/**
 * A small phone showing the patient page as a patient would see it, beside
 * the admin pages that change what is on it (Overview, People, Clinic
 * branding, from the approved design, screens 08, 10 and 11).
 *
 * An honest picture, not a sketch: it is drawn at the patient page's own
 * width (375px, a common phone) with the patient page's own sizes, words and
 * order (app/watch/PatientPage.tsx and the player's box), and then shrunk to
 * fit, so what changes here changes there. In particular, the "for education
 * only" box sits ABOVE the video, as it does on the real page (the mock-up
 * drew it below), and a working link's page has no call button (the call
 * button belongs to the paused, expired and "will not load" pages).
 *
 * Decoration for the person looking: screen readers skip it, since it
 * repeats what the form or the details beside it already say. It plays
 * nothing and loads no video. No hooks and no server imports, so a server
 * page and the branding form (a client component) can both use it.
 */

/** The patient page's width inside the picture, and the picture's screen width (the phone is 240px with an 8px frame). */
const PAGE_WIDTH = 375;
const SCREEN_WIDTH = 224;

export function PatientPhonePreview({
  clinicName,
  logoUrl,
  color,
  fontClass,
  senderName,
  title,
  deadline,
  posterUrl = null,
}: {
  clinicName: string;
  /** The clinic's checked logo address, or null. */
  logoUrl: string | null;
  /** The clinic's checked brand colour, or null for the Pulse colour. Adjusted for white the way the patient page adjusts it. */
  color: string | null;
  /** The clinic's font class, or empty for the patient page's default (Inter). */
  fontClass: string;
  /** "Dr. Jane Smith, DO", or null for a link that names only the clinic. */
  senderName: string | null;
  title: string;
  /** The quiet line about when the link stops working, in the patient page's words, or null. */
  deadline: string | null;
  /**
   * A still of the video for the box, as the patient page shows before the tick (a picture, never a player), or
   * null for the plain dark box. Worked out on the server (the setup steps use posterForVideo); a picture that does
   * not load leaves the dark box.
   */
  posterUrl?: string | null;
}) {
  return (
    <div
      aria-hidden="true"
      className="w-[240px] shrink-0 select-none overflow-hidden rounded-[36px] border-[8px] border-[#1d2328] bg-white shadow-[0_24px_48px_-20px_rgba(18,32,42,.45)]"
    >
      {/* zoom shrinks the real-size page to the screen, text and all. */}
      <div style={{ zoom: SCREEN_WIDTH / PAGE_WIDTH }}>
        <div
          className={`bg-white text-[#12202a] ${fontClass || "patient-type"}`}
          style={{ ...(themeVars(patientTheme(color)) as CSSProperties), width: PAGE_WIDTH }}
        >
          <div className="h-1.5 bg-brand" />
          <div className="px-4 pb-8 pt-4">
            {logoUrl && (
              <div className="mb-3">
                <ClinicLogo key={logoUrl} src={logoUrl} name={clinicName} boxClassName="h-9 w-[180px] max-w-full" fallback="blank" />
              </div>
            )}
            <p className="text-[15px] font-semibold tracking-[.01em] break-words text-[#46555e]">
              {senderLines(senderName, clinicName).map((line, i) => (
                <span key={i} className="block">
                  {line}
                </span>
              ))}
            </p>
            <p className="mt-2 text-[24px] leading-[1.15] font-bold tracking-[-.022em] break-words">{title}</p>
            <p className="mt-3 text-[18px] leading-[1.5] text-[#3a4c56]">Your surgeon shared this so you can see what happens during your operation.</p>

            <div className="mt-5 mb-4 rounded-2xl border-2 border-[#e3e7eb] bg-white px-3.5 py-2">
              <div className="flex min-h-12 items-start gap-3 py-1">
                <span className="mt-0.5 h-7 w-7 shrink-0 rounded-md border-2 border-[#737b83] bg-white" />
                <span className="min-w-0 text-[18px] leading-[1.45] text-[#12202a]">{DISCLAIMER.text}</span>
              </div>
            </div>

            <div className="@container relative aspect-video w-full overflow-hidden rounded-[18px] bg-[#10181d] shadow-[0_10px_30px_-14px_rgba(18,32,42,.4)]">
              {posterUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- one small still, already sized by the box; no player is loaded
                <img src={posterUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
              )}
              <div className="absolute left-3 top-3 right-3">
                <ClinicMark key={logoUrl ?? "no-logo"} logoUrl={logoUrl} name={clinicName} senderName={senderName} />
              </div>
              <span className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white/80 text-white">
                <PlayIcon className="ml-1 h-7 w-7" />
              </span>
            </div>

            {deadline && (
              <p className="mt-6 flex items-start gap-2 text-[15px] leading-6 font-medium text-[#46555e]">
                <CalendarIcon className="mt-0.5 h-5 w-5 shrink-0" />
                <span>{deadline}</span>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
