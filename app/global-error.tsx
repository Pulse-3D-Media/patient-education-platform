"use client";

import "./globals.css";
import { CalmError } from "@/components/ui/CalmError";

/**
 * The very last resort: shown when the root layout itself (app/layout.tsx)
 * fails. Next.js then replaces the whole page with this file, so it has to
 * draw its own <html> and <body> and bring its own stylesheet; the fonts
 * the root layout loads are not here either, so the stylesheet's fallback
 * (Inter if the device has it, else its own sans-serif) is what shows.
 *
 * It cannot know who is looking, a patient or a staff member, so it is the
 * calm neutral page: one sentence, one button, nothing else. Never the
 * error: Next.js hands the browser only a digest, and not even that is
 * shown. The detail is in the server log.
 *
 * Every other failure is caught closer to where it happened: app/error.tsx
 * for a page or a layout below the root, and the error.tsx next to each
 * surface for its own pages.
 */
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <CalmError heading="Something went wrong" body="Try again in a moment." retry={retry} />
      </body>
    </html>
  );
}
