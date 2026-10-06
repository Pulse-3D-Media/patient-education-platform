"use client";

import type { Category } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { INPUT, LABEL, TEXTAREA } from "@/components/ui/styles";
import { CATEGORIES } from "@/lib/categories";
import { formatDuration } from "@/lib/format";
import { ACCEPTED_UPLOAD_TYPES } from "@/lib/mux-upload";
import { saveVideoAction } from "../actions";
import { Outcome, SaveButton, useKeptForm } from "../FormBits";
import { describePhase, refuseFile, useMuxUpload } from "./useMuxUpload";

/** What the form starts from when it is editing. Absent when adding. */
export type VideoValues = {
  id: string;
  title: string;
  category: Category;
  /** The MP4 on the CDN, or null for a video that lives in Mux only. */
  videoUrl: string | null;
  durationSeconds: number | null;
  posterUrl: string | null;
  isPlaceholder: boolean;
  isPublished: boolean;
  notes: string | null;
  /** The signed Mux playback id once the video has moved to Mux, and the asset it belongs to. Null while it plays from the CDN. */
  muxPlaybackId: string | null;
  muxAssetId: string | null;
  /** Share links already pointing at this video. */
  shareCount: number;
};

/** The sentence a staff member confirms before a placeholder becomes the finished animation. */
export const REPLACE_PLACEHOLDER_CONFIRM = "Links already sent will now play the real animation.";

/** The sentence a staff member confirms before clearing the Mux id of a video that has no CDN address to fall back to. */
export const CLEAR_ONLY_SOURCE_CONFIRM =
  "This video has no CDN address. Clearing the Mux playback id leaves nothing to play, and it cannot be published until a file is uploaded. Clear it anyway?";

/**
 * The one form for adding and editing a video, saving through
 * saveVideoAction. Editing carries the video's id in a hidden field, so the
 * row is changed in place and every link already sent keeps working.
 *
 * Replacing a placeholder with the finished file is: upload the file (or
 * paste a new address), untick "Placeholder", save. Because links already
 * sent will start playing the new file at once, unticking the box asks for
 * a yes before the form is sent. So does clearing the Mux id of a video
 * with no address, which would leave it nothing to play.
 *
 * When adding, a file to upload to Mux may be chosen at the same time. The
 * file box sits OUTSIDE the form, so the file is never posted to our server:
 * the server makes the row and hands back its id, and this browser then
 * sends the file straight to Mux for that row (useMuxUpload) before going to
 * the video's page. Uploading to a video that already exists is the card on
 * its page (MuxUploader).
 *
 * A refused or failed save leaves every box as typed (useKeptForm), so a
 * long address or a note is never typed twice.
 */
export function VideoForm({ video, uploadsConfigured = false }: { video?: VideoValues; uploadsConfigured?: boolean }) {
  const router = useRouter();
  const { state, pending, form } = useKeptForm(saveVideoAction);
  const { phase, busy, upload } = useMuxUpload();
  const [file, setFile] = useState<File | null>(null);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [uploadFailed, setUploadFailed] = useState<string | null>(null);
  const uploadedFor = useRef<string | null>(null);

  // The add form came back with the new row's id and a file is waiting: send it, once, then go to the video's page.
  useEffect(() => {
    const videoId = state?.videoId;
    if (!videoId || !file || uploadedFor.current === videoId) return;
    uploadedFor.current = videoId;
    upload(videoId, file).then((result) => {
      if (result.ok) router.push(`/pulse/videos/${videoId}?added=1`);
      else setUploadFailed(result.message);
    });
  }, [state, file, upload, router]);

  function chooseFile(chosen: File | null) {
    setFile(chosen);
    setFileProblem(chosen ? refuseFile(chosen) : null);
  }

  function confirmBeforeSend(event: FormEvent<HTMLFormElement>) {
    const elements = event.currentTarget.elements;
    const placeholderBox = elements.namedItem("isPlaceholder") as HTMLInputElement | null;
    if (video?.isPlaceholder && placeholderBox && !placeholderBox.checked && !window.confirm(REPLACE_PLACEHOLDER_CONFIRM)) {
      event.preventDefault();
      return;
    }
    const muxBox = elements.namedItem("muxPlaybackId") as HTMLInputElement | null;
    const addressBox = elements.namedItem("videoUrl") as HTMLInputElement | null;
    if (video?.muxPlaybackId && muxBox && !muxBox.value.trim() && addressBox && !addressBox.value.trim() && !window.confirm(CLEAR_ONLY_SOURCE_CONFIRM)) {
      event.preventDefault();
    }
  }

  const phaseLine = describePhase(phase);
  const addingWithFile = !video && file && !fileProblem;

  return (
    <div className="flex flex-col gap-4">
      {/* The file box lives outside the form on purpose: a file in the form would be posted to our server, and the file goes to Mux instead. */}
      {!video && (
        <div className="border-b border-white/10 pb-4">
          <label htmlFor="muxFile" className={LABEL}>
            File to upload to Mux (optional)
          </label>
          {uploadsConfigured ? (
            <>
              <input
                id="muxFile"
                type="file"
                accept={ACCEPTED_UPLOAD_TYPES}
                disabled={busy}
                onChange={(event) => chooseFile(event.currentTarget.files?.[0] ?? null)}
                className={`${INPUT} file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-3 file:py-1 file:text-white`}
              />
              <p className="mt-1 text-xs text-[#667085]">
                MP4 or QuickTime. Once the video is added, the file is sent straight from this browser to Mux, never through our server, and
                the playback id is filled in by itself when Mux has prepared it. Leave &ldquo;Published&rdquo; off until then: a video with no
                file cannot be published.
              </p>
              {fileProblem && (
                <p role="alert" className="mt-2 text-sm text-[#f3b94d]">
                  {fileProblem}
                </p>
              )}
              {phaseLine && (
                <p role="status" className={`mt-2 text-sm ${uploadFailed ? "text-[#f3b94d]" : "text-[#5fb8d4]"}`}>
                  {phaseLine}
                </p>
              )}
              {uploadFailed && state?.videoId && (
                <p className="mt-2 text-sm text-[#bfbfbf]">
                  The video was added without its file.{" "}
                  <a href={`/pulse/videos/${state.videoId}`} className="text-[#5fb8d4] hover:text-white">
                    Open it
                  </a>{" "}
                  to upload again.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-[#bfbfbf]">
              Mux uploads are not set up on this deployment (the Mux access token or the signing key is missing). Give the video an address or
              paste a playback id instead.
            </p>
          )}
        </div>
      )}

      <form {...form} onSubmit={confirmBeforeSend} className="flex flex-col gap-4">
        {video && <input type="hidden" name="id" value={video.id} />}
        {addingWithFile && <input type="hidden" name="uploadPending" value="1" />}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label htmlFor="title" className={LABEL}>
              Title
            </label>
            <input id="title" name="title" required defaultValue={video?.title ?? ""} placeholder="Total Knee Replacement" className={INPUT} />
            <p className="mt-1 text-xs text-[#667085]">The procedure name a surgeon would look for. It is what patients see too.</p>
          </div>

          <div>
            <label htmlFor="category" className={LABEL}>
              Category
            </label>
            <select id="category" name="category" required defaultValue={video?.category ?? ""} className={INPUT}>
              <option value="" disabled>
                Choose a category
              </option>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="durationSeconds" className={LABEL}>
              Length
            </label>
            <input
              id="durationSeconds"
              name="durationSeconds"
              defaultValue={video?.durationSeconds == null ? "" : formatDuration(video.durationSeconds)}
              placeholder="4:12"
              className={INPUT}
            />
            <p className="mt-1 text-xs text-[#667085]">
              Minutes and seconds, like 4:12. Patients see it as &ldquo;About 4 minutes&rdquo;. Filled in from Mux after an upload if left empty.
            </p>
          </div>

          <div className="md:col-span-2">
            <label htmlFor="videoUrl" className={LABEL}>
              Video address (optional)
            </label>
            <input id="videoUrl" name="videoUrl" type="url" defaultValue={video?.videoUrl ?? ""} placeholder="https://" className={INPUT} />
            <p className="mt-1 text-xs text-[#667085]">
              The MP4 on the CDN, if the video has one; a video uploaded to Mux needs none. Must start with https://. Once a Mux playback id is
              on the video, this address is kept only as the record of where the file came from: nothing plays from it.
            </p>
          </div>

          <div>
            <label htmlFor="muxPlaybackId" className={LABEL}>
              Mux playback id (signed)
            </label>
            <input
              id="muxPlaybackId"
              name="muxPlaybackId"
              defaultValue={video?.muxPlaybackId ?? ""}
              placeholder={video ? "Filled in by an upload, or paste one" : "Paste one, or upload a file"}
              className={INPUT}
            />
            <p className="mt-1 text-xs text-[#667085]">
              Filled in by itself when a file uploaded {video ? "above" : "here"} is ready. To paste one instead, it must be a{" "}
              <strong className="font-medium text-[#bfbfbf]">signed</strong> playback id from the asset&apos;s page in Mux: saving asks Mux, and a public id, an
              unknown id, or a key that does not match is refused. With an id here the video plays only through a signed address that expires.
              Clearing the box goes back to the CDN file, if there is one.
            </p>
          </div>

          <div>
            <label htmlFor="muxAssetId" className={LABEL}>
              Mux asset id (optional)
            </label>
            <input id="muxAssetId" name="muxAssetId" defaultValue={video?.muxAssetId ?? ""} placeholder="For finding it in Mux" className={INPUT} />
            <p className="mt-1 text-xs text-[#667085]">A note for staff: which asset the playback id belongs to. Nothing plays from it.</p>
          </div>

          <div className="md:col-span-2">
            <label htmlFor="posterUrl" className={LABEL}>
              Poster address (optional)
            </label>
            <input id="posterUrl" name="posterUrl" type="url" defaultValue={video?.posterUrl ?? ""} placeholder="https://" className={INPUT} />
            <p className="mt-1 text-xs text-[#667085]">A still shown on the library card. Empty means the branded fallback, or a Mux video&apos;s own still.</p>
          </div>

          <label className="flex min-h-12 cursor-pointer items-start gap-3">
            <input type="checkbox" name="isPlaceholder" defaultChecked={video?.isPlaceholder ?? false} className="mt-1 h-5 w-5 accent-[#2a829b]" />
            <span>
              <span className="block text-[15px] font-medium">Placeholder</span>
              <span className="block text-sm text-[#bfbfbf]">
                A sample animation standing in for this procedure. Marked everywhere it appears.
                {video?.isPlaceholder && " Unticking it asks for a yes first."}
              </span>
            </span>
          </label>

          <label className="flex min-h-12 cursor-pointer items-start gap-3">
            <input type="checkbox" name="isPublished" defaultChecked={video?.isPublished ?? false} className="mt-1 h-5 w-5 accent-[#2a829b]" />
            <span>
              <span className="block text-[15px] font-medium">Published</span>
              <span className="block text-sm text-[#bfbfbf]">
                Off takes it out of the library and the admin console, and every link already sent stops working until it is published again. A
                video with no file yet cannot be published.
              </span>
            </span>
          </label>

          <div className="md:col-span-2">
            <label htmlFor="notes" className={LABEL}>
              Notes (internal)
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={3}
              defaultValue={video?.notes ?? ""}
              placeholder="What the file is, what is still to do. Never shown to a clinic."
              className={TEXTAREA}
            />
          </div>
        </div>

        {video && video.shareCount > 0 && (
          <p className="text-sm text-[#bfbfbf]">
            {video.shareCount} {video.shareCount === 1 ? "link points" : "links point"} at this video. They keep working after a save and
            play whatever it now says.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <SaveButton pending={pending || busy} label={video ? "Save video" : addingWithFile ? "Add video and upload" : "Add video"} />
          <Outcome state={state} />
        </div>
      </form>
    </div>
  );
}
