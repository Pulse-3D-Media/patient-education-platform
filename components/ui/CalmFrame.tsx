import type { CSSProperties, ReactNode } from "react";
import { LOGO_URL } from "@/lib/brand";
import { patientTheme, themeVars } from "@/lib/branding";

/**
 * The calm page frame, in the patient page's family: the warm light ground,
 * a thin band of colour across the top, a soft circular icon, one plain
 * heading, one sentence, whatever the page adds under them (a button, or
 * nothing), and the Pulse 3D mark at the bottom. It is the same frame the
 * patient page draws for an expired or missing link (app/watch/[code]);
 * here it serves the pages that stand in when a page could not be drawn at
 * all (app/error.tsx, app/global-error.tsx, app/watch/error.tsx) and the
 * root not-found page.
 *
 * Neutral on purpose: at that point the app does not know who is looking,
 * a patient or a staff member, and a page calm enough for an anxious
 * patient is right for everyone. The clinic's own look is not here, because
 * the page that would have read it is the one that failed; the Pulse
 * colours stand in, worked out the same way as on the patient page.
 *
 * Nothing red, and never the words "error", "invalid" or a number like 403
 * (the patient page's rules). No hooks, so a server page and a client
 * error page can both draw it.
 */
export function CalmFrame({ icon, heading, body, children }: { icon: ReactNode; heading: string; body: string; children?: ReactNode }) {
  const style = themeVars(patientTheme(null)) as CSSProperties;
  return (
    <main className="flex min-h-screen flex-col bg-[#fbfaf7] text-[#12202a]" style={style}>
      <div aria-hidden="true" className="h-1.5 shrink-0 bg-brand" />
      <div className="flex flex-1 flex-col items-center justify-center px-8 pb-10 pt-[46px] text-center">
        <div className="flex h-[66px] w-[66px] items-center justify-center rounded-full bg-[#f0ece3] text-[#74664c]">{icon}</div>
        <h1 className="mt-6 text-[26px] leading-[1.22] font-bold tracking-[-.02em]">{heading}</h1>
        <p className="mt-3.5 max-w-[30ch] text-[20px] leading-[1.52] break-words text-[#3a4c56]">{body}</p>
        {children}
        {/* eslint-disable-next-line @next/next/no-img-element -- small static logo from the CDN */}
        <img src={LOGO_URL} alt="Pulse 3D" className="mt-12 h-6 w-auto" />
      </div>
    </main>
  );
}
