"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { INPUT, LABEL, PRIMARY_BUTTON, SECONDARY_BUTTON } from "@/components/ui/styles";
import { ACCEPTED_UPLOAD_TYPES, UPLOAD_STATE_WORDS, type UploadState } from "@/lib/mux-upload";
import { cancelMuxUploadAction, checkMuxUploadAction, dismissUploadFailureAction, type FormState } from "../actions";
import { Outcome } from "../FormBits";
import { describePhase, refuseFile, useMuxUpload } from "./useMuxUpload";

/** What the card needs to know about the video, worked out on the server. */
export type MuxUploaderProps = {
  videoId: string;
  /** Whether this deployment can upload at all (the Mux access token and signing key are set). */
  configured: boolean;
  /** Where the upload in flight stands, or the word "failed" left by the last one, or nothing. */
  uploadState: UploadState | null;
  /** True while the row waits for an upload (so Check with Mux has something to ask about). */
  inFlight: boolean;
  /** The Videos table's word for where the file lives today. */
  source: "Mux" | "CDN" | "Other" | "No file";
};

const SOURCE_WORDS: Record<MuxUploaderProps["source"], string> = {
  Mux: "Plays from Mux through a signed address.",
  CDN: "Plays the MP4 on the Webflow CDN.",
  Other: "Plays the file at the address below.",
  "No file": "Nothing to play yet. It cannot be published until a file is uploaded or an address is given.",
};

/**
 * The card on a video's page for putting a new file into Mux: where the
 * file lives today, where an upload in flight stands (with Check with Mux
 * and Cancel upload), and the control for choosing and sending a new file.
 *
 * The file goes straight from this browser to Mux, never through our
 * server (see useMuxUpload). Nothing about the video changes until Mux says
 * the new asset is ready and the server writes the new ids on the row; the
 * page is refreshed after each step so it shows what the row says.
 */
export function MuxUploader({ videoId, configured, uploadState, inFlight, source }: MuxUploaderProps) {
  const router = useRouter();
  const { phase, busy, upload, reset } = useMuxUpload();
  const [file, setFile] = useState<File | null>(null);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<FormState>(null);
  const [pending, startTransition] = useTransition();

  function chooseFile(chosen: File | null) {
    setFile(chosen);
    setFileProblem(chosen ? refuseFile(chosen) : null);
    reset();
  }

  async function send() {
    if (!file || fileProblem) return;
    setOutcome(null);
    const result = await upload(videoId, file);
    if (result.ok) setFile(null);
    router.refresh();
  }

  function run(action: (videoId: string) => Promise<FormState>) {
    startTransition(async () => {
      setOutcome(await action(videoId));
      router.refresh();
    });
  }

  const phaseLine = describePhase(phase);

  return (
    <section className="rounded-2xl border border-white/10 bg-[#0d1113] p-5 sm:p-6" aria-labelledby="file-heading">
      <h2 id="file-heading" className="text-lg font-semibold">
        File
      </h2>
      <p className="mt-1 text-[15px] text-[#bfbfbf]">{SOURCE_WORDS[source]}</p>

      {uploadState && (
        <div className="mt-4 rounded-xl border border-[#2a829b]/50 bg-[#2a829b]/15 px-4 py-3">
          <p role="status" className="text-[15px] text-white">
            {uploadState === "waiting" && <strong className="font-medium">Uploading. </strong>}
            {uploadState === "preparing" && <strong className="font-medium">Mux is preparing it. </strong>}
            {uploadState === "failed" && <strong className="font-medium">Upload failed. </strong>}
            {UPLOAD_STATE_WORDS[uploadState]}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {inFlight && (
              <button type="button" disabled={pending || busy} onClick={() => run(checkMuxUploadAction)} className={`${SECONDARY_BUTTON} h-10`}>
                {pending ? "Asking Mux..." : "Check with Mux"}
              </button>
            )}
            {inFlight && uploadState === "waiting" && (
              <button type="button" disabled={pending || busy} onClick={() => run(cancelMuxUploadAction)} className={`${SECONDARY_BUTTON} h-10`}>
                Cancel upload
              </button>
            )}
            {uploadState === "failed" && !inFlight && (
              <button type="button" disabled={pending} onClick={() => run(dismissUploadFailureAction)} className={`${SECONDARY_BUTTON} h-10`}>
                Dismiss
              </button>
            )}
          </div>
        </div>
      )}

      {configured ? (
        <div className="mt-5">
          <label htmlFor="muxFile" className={LABEL}>
            {source === "No file" ? "Upload the video file" : "Upload a new file"}
          </label>
          <input
            id="muxFile"
            type="file"
            accept={ACCEPTED_UPLOAD_TYPES}
            disabled={busy}
            onChange={(event) => chooseFile(event.currentTarget.files?.[0] ?? null)}
            className={`${INPUT} file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-3 file:py-1 file:text-white`}
          />
          <p className="mt-1 text-xs text-[#667085]">
            MP4 or QuickTime. It is sent straight from this browser to Mux, never through our server, and prepared with the signed playback
            policy. The video keeps playing what it has until the new file is ready; then every link that points at it plays the new file.
            For a placeholder: upload, and untick Placeholder below once it is ready.
          </p>
          {fileProblem && (
            <p role="alert" className="mt-2 text-sm text-[#f3b94d]">
              {fileProblem}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" disabled={!file || Boolean(fileProblem) || busy} onClick={send} className={`${PRIMARY_BUTTON} h-11`}>
              {busy ? "Uploading..." : "Upload to Mux"}
            </button>
            {phaseLine && (
              <p role="status" className={`text-sm ${phase.step === "done" && !phase.ok ? "text-[#f3b94d]" : "text-[#5fb8d4]"}`}>
                {phaseLine}
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-[#bfbfbf]">
          Mux uploads are not set up on this deployment (the Mux access token or the signing key is missing). Pasting a playback id below still works.
        </p>
      )}

      <div className="mt-3">
        <Outcome state={outcome} />
      </div>
    </section>
  );
}
