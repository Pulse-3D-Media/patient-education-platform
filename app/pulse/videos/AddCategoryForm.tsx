"use client";

import { useState } from "react";
import { INPUT, SECONDARY_BUTTON } from "@/components/ui/styles";
import { CATEGORY_LABEL_MAX, CATEGORY_ORDER_MAX, CATEGORY_SLUG_MAX, suggestSlug } from "@/lib/categories";
import { addCategoryAction } from "../actions";
import { Outcome, SaveButton, useKeptForm } from "../FormBits";

/**
 * The "+" at the foot of the Categories panel on /pulse/videos: a button that
 * opens a small form for a new category's name, web address, tile picture and
 * place in the list. The web address is suggested from the name as it is
 * typed, until someone types in that box themselves. A new category starts
 * not for sale and shows as Coming soon until a video in it is published.
 *
 * A refused or failed save keeps every box as typed (useKeptForm). The server
 * checks everything again (readNewCategory(), then addCategory() under a lock
 * on every category row).
 */
export function AddCategoryForm({ nextOrder }: { nextOrder: number }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const { state, pending, form } = useKeptForm(addCategoryAction, () => {
    // Added: the new category is in the list above now, so the boxes start empty for the next one.
    setLabel("");
    setSlug("");
    setSlugTouched(false);
  });

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${SECONDARY_BUTTON} h-11`}>
        + Add a category
      </button>
    );
  }

  return (
    <form {...form} className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[#0d1113] p-5">
      <h3 className="text-lg font-semibold">Add a category</h3>
      <p className="text-sm text-[#bfbfbf]">
        It starts not for sale, and the library shows it as Coming soon until a video in it is published. A category is never
        deleted once added.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="new-label" className="mb-1 block text-sm font-medium text-[#bfbfbf]">
            Name
          </label>
          <input
            id="new-label"
            name="label"
            value={label}
            onChange={(event) => {
              setLabel(event.target.value);
              if (!slugTouched) setSlug(suggestSlug(event.target.value));
            }}
            maxLength={CATEGORY_LABEL_MAX}
            placeholder="Hand & Wrist"
            className={INPUT}
          />
          <p className="mt-1 text-xs text-[#667085]">What surgeons, office staff and plans read.</p>
        </div>
        <div>
          <label htmlFor="new-slug" className="mb-1 block text-sm font-medium text-[#bfbfbf]">
            Web address
          </label>
          <input
            id="new-slug"
            name="slug"
            value={slug}
            onChange={(event) => {
              setSlug(event.target.value);
              setSlugTouched(true);
            }}
            maxLength={CATEGORY_SLUG_MAX}
            placeholder="hand-wrist"
            className={INPUT}
          />
          <p className="mt-1 text-xs text-[#667085]">/library/{slug || "..."}. Suggested from the name; lowercase letters, numbers and hyphens.</p>
        </div>
        <div>
          <label htmlFor="new-image" className="mb-1 block text-sm font-medium text-[#bfbfbf]">
            Tile picture
          </label>
          <input id="new-image" name="imageUrl" type="url" placeholder="https://" className={INPUT} />
          <p className="mt-1 text-xs text-[#667085]">Optional. A full https:// address; without one the tile shows the name&apos;s first letter.</p>
        </div>
        <div>
          <label htmlFor="new-order" className="mb-1 block text-sm font-medium text-[#bfbfbf]">
            Place in the list
          </label>
          <input id="new-order" name="sortOrder" inputMode="numeric" placeholder={String(nextOrder)} className={INPUT} />
          <p className="mt-1 text-xs text-[#667085]">Optional, 1 to {CATEGORY_ORDER_MAX}. Empty puts it last.</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SaveButton pending={pending} />
        <button type="button" onClick={() => setOpen(false)} className={`${SECONDARY_BUTTON} h-11`}>
          Close
        </button>
        <Outcome state={state} />
      </div>
    </form>
  );
}
