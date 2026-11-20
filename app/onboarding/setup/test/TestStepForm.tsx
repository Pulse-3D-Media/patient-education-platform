"use client";

import { useState, useTransition } from "react";
import { CopyButton } from "@/components/ui/CopyButton";
import { PatientPhonePreview } from "@/components/ui/PatientPhonePreview";
import { INPUT, LABEL } from "@/components/ui/styles";
import { SAVE_NOT_CONFIRMED, safeSave } from "@/lib/form-save";
import { finishTestStepAction, makeTestLinkAction } from "../actions";
import { SETUP_PRIMARY, StepProblem } from "../SetupButtons";
import { StepBody, StepHeading } from "../SetupFrame";
import type { PreviewFacts } from "../setup-view";

/**
 * Step 4's form: a procedure to pick, "Generate QR code", and the link it
 * made, as a QR code to scan, its address and Copy. The box above it says
 * "Test link", so nobody takes it for a patient's. Finish ends setup whether
 * or not a link was made (making one is the point, but never required).
 */
export function TestStepForm({
  procedures,
  blocked,
  preview,
  welcomeBack,
}: {
  procedures: { id: string; title: string }[];
  /** Why no link can be made here right now, or null. */
  blocked: string | null;
  preview: PreviewFacts;
  welcomeBack: boolean;
}) {
  const [videoId, setVideoId] = useState(procedures[0]?.id ?? "");
  const [made, setMade] = useState<{ url: string; qr: string; title: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const title = procedures.find((procedure) => procedure.id === videoId)?.title ?? preview.title;

  function generate() {
    setError(null);
    start(async () => {
      // A lost connection or a server fault becomes the plain sentence, never an error page.
      const answer = await makeTestLinkAction(videoId).catch(() => null);
      if (answer?.ok) setMade({ url: answer.url, qr: answer.qr, title });
      else setError(answer?.error ?? SAVE_NOT_CONFIRMED);
    });
  }

  function finish() {
    setError(null);
    start(async () => {
      const outcome = await safeSave(() => finishTestStepAction());
      if (outcome?.error) setError(outcome.error);
    });
  }

  return (
    <StepBody
      step="test"
      welcomeBack={welcomeBack}
      // The still belongs to one video, so it is shown only while that video is the one picked.
      preview={<PatientPhonePreview {...preview} title={made?.title ?? title} posterUrl={videoId === preview.videoId ? preview.posterUrl : null} />}
      actions={
        <button type="button" onClick={finish} disabled={pending} className={SETUP_PRIMARY}>
          Finish
        </button>
      }
    >
      <StepHeading sub="This is exactly what patients see.">Make a test link and try it</StepHeading>

      {blocked ? (
        <StepProblem message={blocked} />
      ) : (
        <div className="mt-8">
          <label htmlFor="setup-procedure" className={`${LABEL} text-[15px] font-semibold text-ink`}>
            Procedure
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <select id="setup-procedure" value={videoId} onChange={(event) => setVideoId(event.target.value)} className={`${INPUT} h-12 flex-1 text-base`}>
              {procedures.map((procedure) => (
                <option key={procedure.id} value={procedure.id}>
                  {procedure.title}
                </option>
              ))}
            </select>
            <button type="button" onClick={generate} disabled={pending || !videoId} className={SETUP_PRIMARY}>
              {pending ? "Making..." : "Generate QR code"}
            </button>
          </div>
        </div>
      )}

      {made && (
        <>
          <div className="mt-6 flex flex-col items-start gap-5 rounded-2xl border border-line bg-surface p-5 sm:flex-row sm:items-center">
            {/* The QR code is drawn on the server from the link alone (lib/qr.ts), never from anything typed. */}
            <div aria-hidden="true" className="h-[120px] w-[120px] shrink-0 bg-white [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: made.qr }} />
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold text-ink-soft">
                <span aria-hidden="true" className="h-2 w-2 rounded-sm bg-warn" />
                Test link · {made.title}
              </p>
              <p className="mt-1 break-all text-[17px] font-semibold text-ink">{made.url.replace(/^https?:\/\//, "")}</p>
              <div className="mt-3">
                <CopyButton text={made.url} />
              </div>
            </div>
          </div>
          <p className="mt-2 text-sm text-ink-soft">Scan the code with your phone.</p>
        </>
      )}

      <StepProblem message={error} />
    </StepBody>
  );
}
