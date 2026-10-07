"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ACCEPTED_UPLOAD_TYPES, MAX_UPLOAD_BYTES, describeBytes } from "@/lib/mux-upload";
import { checkMuxUploadAction, startMuxUploadAction } from "../actions";

/**
 * The browser's side of an upload to Mux, shared by the upload card on a
 * video's page (MuxUploader) and the add-video form (VideoForm).
 *
 * Three steps, each said in plain words on the page:
 *
 *   1. Ask our server for a one-time upload address (startMuxUploadAction).
 *      The server asks Mux, remembers the upload on the video's row, and
 *      hands the address back. It is used once, here, and never shown.
 *   2. Send the file STRAIGHT to that address with one PUT request. The
 *      file never touches our server. The line on the page counts the
 *      megabytes sent, which the browser knows exactly; no percentage is
 *      made up for what Mux does afterwards.
 *   3. Tell our server the file has gone (checkMuxUploadAction), which asks
 *      Mux where the upload stands and writes that on the row: usually
 *      "preparing", and the page then says so.
 *
 * Closing the tab in step 2 abandons the upload: Mux never gets the whole
 * file, the row says "waiting" until Check with Mux or the webhook learns
 * the address ran out, and the video keeps playing what it had. The browser
 * is asked to warn before the tab closes while a file is on its way.
 */

export type UploadPhase =
  | { step: "idle" }
  | { step: "starting" }
  | { step: "uploading"; sent: number; total: number }
  | { step: "checking" }
  | { step: "done"; ok: boolean; message: string };

/** The line the page shows for a phase, or null when there is nothing to say. */
export function describePhase(phase: UploadPhase): string | null {
  switch (phase.step) {
    case "idle":
      return null;
    case "starting":
      return "Asking Mux for an upload address...";
    case "uploading":
      return `Uploading: ${describeBytes(phase.sent)} of ${describeBytes(phase.total)} sent. Keep this page open.`;
    case "checking":
      return "Sent. Asking Mux where it stands...";
    case "done":
      return phase.message;
  }
}

/** Is this file one the control takes? A sentence when not. Checked here for a quick answer; Mux decides for real. */
export function refuseFile(file: File): string | null {
  const accepted = ACCEPTED_UPLOAD_TYPES.split(",");
  const extension = file.name.includes(".") ? `.${file.name.split(".").pop()!.toLowerCase()}` : "";
  if (!accepted.includes(file.type) && !accepted.includes(extension)) return "Choose an MP4 or QuickTime (.mov) video file.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_UPLOAD_BYTES) return `That file is ${describeBytes(file.size)}; the largest the control takes is ${describeBytes(MAX_UPLOAD_BYTES)}.`;
  return null;
}

/** One PUT of the whole file to Mux's one-time address, reporting bytes sent. Rejects on a network failure or a refusal. */
function sendFile(url: string, file: File, onProgress: (sent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.upload.onprogress = (event) => onProgress(event.loaded);
    request.onload = () => (request.status >= 200 && request.status < 300 ? resolve() : reject(new Error(`status ${request.status}`)));
    request.onerror = () => reject(new Error("network"));
    request.onabort = () => reject(new Error("aborted"));
    request.send(file);
  });
}

export function useMuxUpload() {
  const [phase, setPhase] = useState<UploadPhase>({ step: "idle" });
  const busy = phase.step === "starting" || phase.step === "uploading" || phase.step === "checking";
  const busyRef = useRef(false);

  // Warn before the tab closes while a file is on its way.
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const upload = useCallback(async (videoId: string, file: File): Promise<{ ok: boolean; message: string }> => {
    if (busyRef.current) return { ok: false, message: "An upload is already running in this tab." };
    busyRef.current = true;
    const finish = (ok: boolean, message: string) => {
      busyRef.current = false;
      setPhase({ step: "done", ok, message });
      return { ok, message };
    };
    try {
      setPhase({ step: "starting" });
      const started = await startMuxUploadAction(videoId);
      if (!started.ok) return finish(false, started.error);

      setPhase({ step: "uploading", sent: 0, total: file.size });
      try {
        await sendFile(started.url, file, (sent) => setPhase({ step: "uploading", sent, total: file.size }));
      } catch {
        return finish(false, "The file could not be sent to Mux (the connection dropped, or Mux refused it). The video was left as it was. Press Check with Mux, or choose the file and try again.");
      }

      setPhase({ step: "checking" });
      const checked = await checkMuxUploadAction(videoId);
      if (checked?.error) return finish(false, checked.error);
      return finish(true, checked?.ok ?? "Sent.");
    } catch {
      return finish(false, "Something went wrong while uploading. The video was left as it was. Press Check with Mux to see where the upload stands.");
    }
  }, []);

  const reset = useCallback(() => setPhase({ step: "idle" }), []);

  return { phase, busy, upload, reset };
}
