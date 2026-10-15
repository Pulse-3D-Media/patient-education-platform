import Link from "next/link";
import { comingSoonSentence, type CategoryConfig } from "@/lib/categories";

/**
 * What the library shows for a category that has nothing published yet,
 * or nothing this clinic is shown (a clinic with placeholders switched
 * off sees a placeholder-only category as empty).
 *
 * The sentence is the one Pulse staff wrote for the category on
 * /pulse/videos, or the standard one. Calm and plain: this is not an
 * error, the animations are simply not finished.
 */

/** A category's own page when it has nothing published yet. (On the library home the same sentence is one quiet line under the category's name.) */
export function ComingSoon({ label, config }: { label: string; config: CategoryConfig | undefined }) {
  return (
    <div className="rounded-2xl border border-dashed border-line-strong px-6 py-14 text-center">
      <p className="text-sm font-medium uppercase tracking-wider text-ink-muted">Coming soon</p>
      <p className="mt-2 text-xl font-medium">Nothing in {label} yet.</p>
      <p className="mx-auto mt-2 max-w-md text-base text-ink-soft">{comingSoonSentence(config)}</p>
      <Link href="/library" className="mt-6 inline-flex h-11 items-center rounded-lg border border-line-strong px-4 text-sm font-medium text-ink-soft hover:border-brand hover:text-ink">
        Back to the library
      </Link>
    </div>
  );
}
