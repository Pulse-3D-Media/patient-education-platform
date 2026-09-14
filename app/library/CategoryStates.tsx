import Link from "next/link";
import { LockIcon } from "@/components/ui/icons";

/**
 * What the library shows for a category a clinic cannot open right now,
 * other than "Coming soon" (which has its own file, ComingSoon.tsx):
 *
 *   Locked   something is published in it, but the category is not on
 *            this clinic's plan. The tile is dimmed and carries a lock;
 *            the page says so and points at Billing. Nothing playable is
 *            sent to the browser for a locked category, whether it was
 *            reached from a tile or by typing the address.
 *
 *   Empty    the category is on the plan, but every published video in it
 *            is a placeholder and this clinic is shown finished animations
 *            only. An honest empty state: not "coming soon", because the
 *            animations exist, just not the finished ones yet.
 *
 * The four states and how they are decided live in lib/access.ts
 * (categoryState). This file only draws them.
 *
 * Calm and plain, like the rest of the library: nothing here is an error.
 */

/** The dimmed tile on the library home for a category that is not on the plan. Not a link. */
export function LockedTile({ label, image }: { label: string; image: string }) {
  return (
    <QuietTile label={label} image={image} badge="Not on your plan" sentence={`Your clinic's admin can see the plan under Billing, and ask Pulse 3D about adding ${label}.`} lock />
  );
}

/** The same message on the category's own page, for someone who typed the address or tapped it in the drawer. */
export function LockedCategory({ label }: { label: string }) {
  return (
    <QuietBlock eyebrow="Not on your plan" heading={`${label} is not on your clinic's plan.`}>
      Your clinic&rsquo;s admin can see the plan under Billing, and talk to Pulse 3D about adding it.
    </QuietBlock>
  );
}

/** The dimmed tile for a category on the plan whose only videos are placeholders this clinic is not shown. Not a link. */
export function EmptyTile({ label, image }: { label: string; image: string }) {
  return (
    <QuietTile
      label={label}
      image={image}
      badge="Nothing yet"
      sentence="Only placeholder animations so far, and your clinic sees finished animations only."
    />
  );
}

/** The same message on the category's own page. */
export function EmptyCategory({ label }: { label: string }) {
  return (
    <QuietBlock eyebrow="Nothing to show yet" heading={`Nothing in ${label} yet.`}>
      Its animations are placeholders for now, and your clinic is set to see finished animations only. They will appear here as each one is
      finished.
    </QuietBlock>
  );
}

/** A dimmed, non-link tile: the picture faded and grey, the label, a badge, and one sentence. */
function QuietTile({ label, image, badge, sentence, lock = false }: { label: string; image: string; badge: string; sentence: string; lock?: boolean }) {
  return (
    <div aria-disabled="true" className="relative block aspect-[16/9] overflow-hidden rounded-2xl border border-dashed border-white/15 bg-[#0d1113]">
      {/* eslint-disable-next-line @next/next/no-img-element -- CDN still, no resizing needed */}
      <img src={image} alt="" className="absolute inset-0 h-full w-full object-cover opacity-25 grayscale" />
      <span className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />
      <span className="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-5">
        <span className="flex items-center justify-between gap-3">
          <span className="text-2xl font-semibold text-[#bfbfbf] sm:text-[26px]">{label}</span>
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-black/50 px-3 py-1 text-sm text-[#bfbfbf] backdrop-blur">
            {lock && <LockIcon className="h-4 w-4" />}
            {badge}
          </span>
        </span>
        <span className="text-sm text-[#9ca3af]">{sentence}</span>
      </span>
    </div>
  );
}

/** The block a category page shows instead of the video grid, with a way back to the library. */
function QuietBlock({ eyebrow, heading, children }: { eyebrow: string; heading: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/15 px-6 py-14 text-center">
      <p className="text-sm font-medium uppercase tracking-wider text-[#667085]">{eyebrow}</p>
      <p className="mt-2 text-xl font-medium">{heading}</p>
      <p className="mx-auto mt-2 max-w-md text-base text-[#bfbfbf]">{children}</p>
      <Link
        href="/library"
        className="mt-6 inline-flex h-11 items-center rounded-lg border border-white/15 px-4 text-sm font-medium text-[#bfbfbf] hover:border-[#2a829b] hover:text-white"
      >
        Back to the library
      </Link>
    </div>
  );
}
