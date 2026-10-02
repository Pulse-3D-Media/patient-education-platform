"use client";

import { CalmError } from "@/components/ui/CalmError";

/**
 * What a patient sees if the video page could not be drawn at all: the
 * database did not answer, most likely. Light, large text, one sentence,
 * one button, nothing else, like every other state of the patient page.
 * Never the error, a code or the word "error" (the patient page's rules).
 *
 * The clinic's own look and its phone number are not here, on purpose: the
 * page that reads them is the page that failed, and this page fetches
 * nothing, so it can never fail the same way. A video that will not play
 * once the page is up is a different case, handled inside the player with
 * its own Try again and, there, the office's number (WatchPlayer.tsx).
 *
 * Try again fetches the page afresh. If the database is back, the video
 * page appears; if not, this page again.
 */
export default function WatchError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <CalmError heading="Something went wrong loading this video" body="Try again in a moment." retry={retry} />;
}
