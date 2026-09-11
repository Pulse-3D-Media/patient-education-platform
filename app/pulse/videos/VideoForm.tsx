"use client";

import type { Category } from "@prisma/client";
import { useActionState, type FormEvent } from "react";
import { INPUT, LABEL, TEXTAREA } from "@/components/ui/styles";
import { CATEGORIES } from "@/lib/categories";
import { formatDuration } from "@/lib/format";
import { saveVideoAction } from "../actions";
import { Outcome, SaveButton } from "../FormBits";

/** What the form starts from when it is editing. Absent when adding. */
export type VideoValues = {
  id: string;
  title: string;
  category: Category;
  videoUrl: string;
  durationSeconds: number | null;
  posterUrl: string | null;
  isPlaceholder: boolean;
  isPublished: boolean;
  notes: string | null;
  /** Share links already pointing at this video. */
  shareCount: number;
};

/** The sentence a staff member confirms before a placeholder becomes the finished animation. */
export const REPLACE_PLACEHOLDER_CONFIRM = "Links already sent will now play the real animation.";

/**
 * The one form for adding and editing a video, saving through
 * saveVideoAction. Editing carries the video's id in a hidden field, so the
 * row is changed in place and every link already sent keeps working.
 *
 * Replacing a placeholder with the finished file is: paste the new address,
 * untick "Placeholder", save. Because links already sent will start playing
 * the new file at once, unticking the box asks for a yes before the form is
 * sent.
 */
export function VideoForm({ video }: { video?: VideoValues }) {
  const [state, action, pending] = useActionState(saveVideoAction, null);

  function confirmBeforeSend(event: FormEvent<HTMLFormElement>) {
    if (!video?.isPlaceholder) return;
    const box = event.currentTarget.elements.namedItem("isPlaceholder") as HTMLInputElement | null;
    if (box && !box.checked && !window.confirm(REPLACE_PLACEHOLDER_CONFIRM)) {
      event.preventDefault();
    }
  }

  return (
    <form action={action} onSubmit={confirmBeforeSend} className="flex flex-col gap-4">
      {video && <input type="hidden" name="id" value={video.id} />}

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
          <p className="mt-1 text-xs text-[#667085]">Minutes and seconds, like 4:12. Patients see it as &ldquo;About 4 minutes&rdquo;.</p>
        </div>

        <div className="md:col-span-2">
          <label htmlFor="videoUrl" className={LABEL}>
            Video address
          </label>
          <input id="videoUrl" name="videoUrl" type="url" required defaultValue={video?.videoUrl ?? ""} placeholder="https://" className={INPUT} />
          <p className="mt-1 text-xs text-[#667085]">The MP4 on the CDN. Must start with https://. Paste a new address here to swap the file behind this video.</p>
        </div>

        <div className="md:col-span-2">
          <label htmlFor="posterUrl" className={LABEL}>
            Poster address (optional)
          </label>
          <input id="posterUrl" name="posterUrl" type="url" defaultValue={video?.posterUrl ?? ""} placeholder="https://" className={INPUT} />
          <p className="mt-1 text-xs text-[#667085]">A still shown on the library card. Empty means the branded fallback.</p>
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
            <span className="block text-sm text-[#bfbfbf]">Off keeps it out of the library and the admin console, and no new links can be made for it. Links already sent keep playing it.</span>
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
        <SaveButton pending={pending} label={video ? "Save video" : "Add video"} />
        <Outcome state={state} />
      </div>
    </form>
  );
}
