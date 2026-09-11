"use client";

import type { Category } from "@prisma/client";
import { useActionState } from "react";
import { INPUT } from "@/components/ui/styles";
import { DEFAULT_COMING_SOON, type CategoryConfig } from "@/lib/db/category-config";
import { saveCategoryConfigAction } from "../actions";
import { Outcome, SaveButton } from "../FormBits";

/**
 * One row of the Categories panel on /pulse/videos: the category's name,
 * how many videos are published in it, the "for sale" switch and the
 * optional coming-soon sentence. Each row is its own small form, saving
 * through saveCategoryConfigAction, so one category can be changed
 * without touching the others.
 */
export function CategoryConfigForm({
  category,
  label,
  publishedCount,
  config,
}: {
  category: Category;
  label: string;
  publishedCount: number;
  config: CategoryConfig;
}) {
  const [state, action, pending] = useActionState(saveCategoryConfigAction, null);
  const textId = `coming-${category}`;

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="category" value={category} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{label}</h3>
          <p className="text-sm text-[#bfbfbf]">
            {publishedCount === 0
              ? "Nothing published yet. The library shows this category as coming soon."
              : `${publishedCount} published ${publishedCount === 1 ? "video" : "videos"}.`}
          </p>
        </div>
        <label className="flex h-12 cursor-pointer items-center gap-3 rounded-lg border border-white/15 px-3 has-[:checked]:border-[#2a829b] has-[:checked]:bg-[#2a829b]/15">
          <input type="checkbox" name="sellable" defaultChecked={config.sellable} className="h-5 w-5 accent-[#2a829b]" />
          <span className="text-[15px] font-medium">For sale</span>
        </label>
      </div>
      <div>
        <label htmlFor={textId} className="mb-1 block text-sm font-medium text-[#bfbfbf]">
          Coming-soon sentence
        </label>
        <input
          id={textId}
          name="comingSoonText"
          defaultValue={config.comingSoonText ?? ""}
          placeholder={DEFAULT_COMING_SOON}
          className={INPUT}
        />
        <p className="mt-1 text-xs text-[#667085]">Shown on the library tile while nothing is published. Empty means the standard sentence.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SaveButton pending={pending} />
        <Outcome state={state} />
      </div>
    </form>
  );
}
