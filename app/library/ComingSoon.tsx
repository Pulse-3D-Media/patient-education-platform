import Link from "next/link";
import { comingSoonSentence, type CategoryConfig } from "@/lib/db/category-config";

/**
 * What the library shows for a category that has nothing published yet,
 * or nothing this clinic is shown (a clinic with placeholders switched
 * off sees a placeholder-only category as empty).
 *
 * The sentence is the one Pulse staff wrote for the category on
 * /pulse/videos, or the standard one. Calm and plain: this is not an
 * error, the animations are simply not finished.
 */

/** The dimmed tile on the library home. Not a link: there is nothing behind it to open. */
export function ComingSoonTile({ label, image, config }: { label: string; image: string; config: CategoryConfig | undefined }) {
  return (
    <div
      aria-disabled="true"
      className="relative block aspect-[16/9] overflow-hidden rounded-2xl border border-dashed border-white/15 bg-[#0d1113]"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- CDN still, no resizing needed */}
      <img src={image} alt="" className="absolute inset-0 h-full w-full object-cover opacity-25 grayscale" />
      <span className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />
      <span className="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-5">
        <span className="flex items-center justify-between gap-3">
          <span className="text-2xl font-semibold text-[#bfbfbf] sm:text-[26px]">{label}</span>
          <span className="shrink-0 rounded-full bg-black/50 px-3 py-1 text-sm text-[#bfbfbf] backdrop-blur">Coming soon</span>
        </span>
        <span className="text-sm text-[#9ca3af]">{comingSoonSentence(config)}</span>
      </span>
    </div>
  );
}

/** The same message on a category's own page, for someone who arrived by address or from the drawer. */
export function ComingSoon({ label, config }: { label: string; config: CategoryConfig | undefined }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/15 px-6 py-14 text-center">
      <p className="text-sm font-medium uppercase tracking-wider text-[#667085]">Coming soon</p>
      <p className="mt-2 text-xl font-medium">Nothing in {label} yet.</p>
      <p className="mx-auto mt-2 max-w-md text-base text-[#bfbfbf]">{comingSoonSentence(config)}</p>
      <Link href="/library" className="mt-6 inline-flex h-11 items-center rounded-lg border border-white/15 px-4 text-sm font-medium text-[#bfbfbf] hover:border-[#2a829b] hover:text-white">
        Back to the library
      </Link>
    </div>
  );
}
