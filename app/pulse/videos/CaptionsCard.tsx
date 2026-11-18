"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { SECONDARY_BUTTON } from "@/components/ui/styles";
import { CAPTION_STATE_WORDS, canAskForCaptions, type CaptionState } from "@/lib/caption-state";
import { addCaptionsAction, type FormState } from "../actions";
import { Outcome } from "../FormBits";

/**
 * The Captions card on a video's page on /pulse: where the video's English
 * captions stand (read from Mux just after the page is drawn, streamed in, so
 * the page shows "Checking with Mux..." for a moment; lib/mux-captions.ts),
 * "Add captions" when there are none, and, once they are ready, a link to
 * their text so a Pulse staff member can read them through.
 *
 * The link is an address the server signed for an hour; it opens the
 * caption file itself (plain text with times) in a new tab. Nothing on this
 * card is shown to clinics or patients.
 */
export function CaptionsCard({ videoId, state }: { videoId: string; state: CaptionState }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<FormState>(null);
  const [pending, startTransition] = useTransition();
  const [checking, startCheck] = useTransition();

  // Check again: draw the page again on the server, which asks Mux again. The rest of the page stays as it is.
  function checkAgain() {
    startCheck(() => router.refresh());
  }

  function ask() {
    startTransition(async () => {
      try {
        setOutcome(await addCaptionsAction(videoId));
      } catch {
        // The action answers its own failures in words; this is only a connection that dropped on the way.
        setOutcome({ error: "We could not confirm the request reached Mux. Try again in a moment." });
      }
      router.refresh();
    });
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-[#0d1113] p-5 sm:p-6" aria-labelledby="captions-heading">
      <h2 id="captions-heading" className="text-lg font-semibold">
        Captions
      </h2>
      <p className="mt-1 text-[15px] text-[#bfbfbf]">{CAPTION_STATE_WORDS[state.kind]}</p>

      {state.kind === "ready" && (
        <div className="mt-4 rounded-xl border border-[#f3b94d]/40 bg-[#f3b94d]/10 px-4 py-3 text-[15px] text-white">
          <p>
            <strong className="font-medium">Read them through.</strong> Mux writes captions by machine from the narration, and it often gets
            medical words wrong. Patients can already turn these on, so check them now.
          </p>
          {state.reviewUrl ? (
            <p className="mt-2">
              <a href={state.reviewUrl} target="_blank" rel="noreferrer noopener" className="font-medium text-[#5fb8d4] underline underline-offset-2 hover:text-white">
                Open the caption text ({state.name})
              </a>
              <span className="text-[#bfbfbf]"> opens in a new tab and works for an hour; reload this page for a new link.</span>
            </p>
          ) : (
            <p className="mt-2 text-[#bfbfbf]">The link to the caption text could not be made here (the signing key could not sign it).</p>
          )}
          <p className="mt-2 text-[#bfbfbf]">
            To correct a line: save the file, fix the words in any text editor (keep the times as they are), then on the asset&apos;s page in
            the Mux dashboard remove the generated English track and add your corrected file as a new English subtitles track. Patients see
            the new words from their next play.
          </p>
        </div>
      )}

      {state.kind === "unreachable" && (
        <div className="mt-3">
          <button type="button" disabled={checking} onClick={checkAgain} className={`${SECONDARY_BUTTON} h-11`}>
            {checking ? "Checking..." : "Check again"}
          </button>
        </div>
      )}

      {canAskForCaptions(state) && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" disabled={pending} onClick={ask} className={`${SECONDARY_BUTTON} h-11`}>
            {pending ? "Asking Mux..." : "Add captions"}
          </button>
          <p className="text-xs text-[#667085]">Mux writes English captions from the narration in a few minutes, at no extra charge. The video keeps playing as it is meanwhile.</p>
        </div>
      )}

      <div className="mt-3">
        <Outcome state={outcome} />
      </div>
    </section>
  );
}
