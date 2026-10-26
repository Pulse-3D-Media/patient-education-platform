"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { INPUT, SECONDARY_BUTTON } from "@/components/ui/styles";
import {
  CATEGORY_DEFAULTS,
  CATEGORY_LABEL_MAX,
  CATEGORY_ORDER_MAX,
  CATEGORY_SLUG_MAX,
  DEFAULT_COMING_SOON,
  defaultOrder,
  type CategoryDetails,
} from "@/lib/categories";
import { deleteCategoryAction, saveCategoryConfigAction, type FormState } from "../actions";
import { Outcome, SaveButton, useKeptForm } from "../FormBits";

/**
 * One row of the Categories panel on /pulse/videos: the category's name,
 * how many videos are published in it, its details (the name people read,
 * the web address, the tile picture and its place in the list), the "for
 * sale" switch and the optional coming-soon sentence. Each row is its own
 * small form, saving through saveCategoryConfigAction, so one category can
 * be changed without touching the others. A refused or failed save leaves
 * every box as typed (useKeptForm).
 *
 * Each detail box starts empty when the category uses its default, with the
 * default shown faintly, and empty again means "go back to the default".
 * The server checks everything again (readCategoryDetails() and, for the web
 * address, every other category's addresses).
 */
export function CategoryConfigForm({
  category,
  publishedCount,
  deletable = false,
}: {
  category: CategoryDetails;
  publishedCount: number;
  /** An added category nothing uses yet (listDeletableCategories()): offered a Delete. The server checks again. */
  deletable?: boolean;
}) {
  const { state, pending, form } = useKeptForm(saveCategoryConfigAction);
  const start = CATEGORY_DEFAULTS.find((entry) => entry.value === category.value);
  const id = (name: string) => `${name}-${category.value}`;
  const own = (value: string | number, fallback: string | number | undefined) => (value === fallback ? "" : String(value));

  return (
    <form {...form} className="flex flex-col gap-4">
      <input type="hidden" name="category" value={category.value} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{category.label}</h3>
          <p className="text-sm text-[#bfbfbf]">
            {publishedCount === 0
              ? "Nothing published yet. The library shows this category as coming soon."
              : `${publishedCount} published ${publishedCount === 1 ? "video" : "videos"}.`}
          </p>
        </div>
        <label className="flex h-12 cursor-pointer items-center gap-3 rounded-lg border border-white/15 px-3 has-[:checked]:border-[#2a829b] has-[:checked]:bg-[#2a829b]/15">
          <input type="checkbox" name="sellable" defaultChecked={category.sellable} className="h-5 w-5 accent-[#2a829b]" />
          <span className="text-[15px] font-medium">For sale</span>
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={id("label")} className="mb-1 block text-sm font-medium text-[#bfbfbf]">
            Name
          </label>
          <input
            id={id("label")}
            name="label"
            defaultValue={own(category.label, start?.label)}
            placeholder={start?.label}
            maxLength={CATEGORY_LABEL_MAX}
            className={INPUT}
          />
          <p className="mt-1 text-xs text-[#667085]">What surgeons, office staff and plans read.{start ? ` Empty means ${start.label}.` : ""}</p>
        </div>
        <div>
          <label htmlFor={id("slug")} className="mb-1 block text-sm font-medium text-[#bfbfbf]">
            Web address
          </label>
          <input
            id={id("slug")}
            name="slug"
            defaultValue={own(category.slug, start?.slug)}
            placeholder={start?.slug}
            maxLength={CATEGORY_SLUG_MAX}
            className={INPUT}
          />
          <p className="mt-1 text-xs text-[#667085]">
            /library/{category.slug}. Lowercase letters, numbers and hyphens. Every earlier address keeps working.
          </p>
        </div>
        <div>
          <label htmlFor={id("imageUrl")} className="mb-1 block text-sm font-medium text-[#bfbfbf]">
            Tile picture
          </label>
          <input
            id={id("imageUrl")}
            name="imageUrl"
            type="url"
            defaultValue={own(category.image, start?.image)}
            placeholder="https://"
            className={INPUT}
          />
          <p className="mt-1 text-xs text-[#667085]">A full https:// address. {start ? "Empty means the standard picture." : "Empty shows the name's first letter."}</p>
        </div>
        <div>
          <label htmlFor={id("sortOrder")} className="mb-1 block text-sm font-medium text-[#bfbfbf]">
            Place in the list
          </label>
          <input
            id={id("sortOrder")}
            name="sortOrder"
            inputMode="numeric"
            defaultValue={own(category.order, defaultOrder(category.value))}
            placeholder={String(defaultOrder(category.value))}
            className={INPUT}
          />
          <p className="mt-1 text-xs text-[#667085]">
            Smallest first, 1 to {CATEGORY_ORDER_MAX}. The standard places are 10, 20, 30, so 15 goes between the first two.
          </p>
        </div>
      </div>
      <div>
        <label htmlFor={id("coming")} className="mb-1 block text-sm font-medium text-[#bfbfbf]">
          Coming-soon sentence
        </label>
        <input
          id={id("coming")}
          name="comingSoonText"
          defaultValue={category.comingSoonText ?? ""}
          placeholder={DEFAULT_COMING_SOON}
          className={INPUT}
        />
        <p className="mt-1 text-xs text-[#667085]">Shown on the library tile while nothing is published. Empty means the standard sentence.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SaveButton pending={pending} />
        <Outcome state={state} />
        {deletable && <DeleteCategory category={category.value} label={category.label} />}
      </div>
    </form>
  );
}

/**
 * Delete, for an added category nothing uses yet. Two taps: Delete, then a
 * plain "Delete <name> for good?" with Yes and Cancel, so a slip of the finger
 * does nothing. A refusal (it came into use a moment ago) is one sentence.
 */
function DeleteCategory({ category, label }: { category: string; label: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [outcome, setOutcome] = useState<FormState>(null);
  const [pending, startTransition] = useTransition();

  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className={`${SECONDARY_BUTTON} h-11 sm:ml-auto`}>
        Delete
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 sm:ml-auto" role="group" aria-label={`Delete ${label}`}>
      <span className="text-sm text-[#bfbfbf]">Delete {label} for good? Nothing uses it yet.</span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result: FormState = await deleteCategoryAction(category).catch(() => ({ error: "We could not confirm the delete. Try again." }));
            setOutcome(result);
            if (result?.ok) router.refresh();
          })
        }
        className="h-11 rounded-lg bg-[#b42318] px-4 text-[15px] font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Deleting..." : "Yes, delete"}
      </button>
      <button type="button" onClick={() => setAsking(false)} className={`${SECONDARY_BUTTON} h-11`}>
        Cancel
      </button>
      {outcome?.error && <Outcome state={outcome} />}
    </div>
  );
}
