import Link from "next/link";
import { PRIMARY_BUTTON } from "@/components/ui/styles";
import { addToPlanHref, type AddToPlanOffer } from "@/lib/add-to-plan";

/**
 * What the library shows for a category a clinic cannot open right now,
 * other than "Coming soon" (which has its own file, ComingSoon.tsx):
 *
 *   Locked   something is published in it, but the category is not on
 *            this clinic's plan. The library home lists it by name under
 *            "More categories"; its page says so and, for an office admin,
 *            has "Add to your plan" (Billing, with the category ticked; a
 *            member is told to ask an office admin). Nothing playable is
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

/** A category's own page when it is not on the plan, for someone who typed the address or tapped it in the drawer. (On the library home it is one line under "More categories".) */
export function LockedCategory({ label, slug, offer }: { label: string; slug: string; offer: AddToPlanOffer }) {
  return (
    <QuietBlock
      eyebrow="Not on your plan"
      heading={`${label} is not on your clinic's plan.`}
      // An office admin's one step to adding it: Billing, with this category ticked. Nothing is charged by following it.
      action={offer === "link" ? { href: addToPlanHref(slug), label: "Add to your plan" } : undefined}
    >
      {offer === "link"
        ? "You can add it on Billing. You see what it comes to there before anything changes."
        : offer === "ask"
          ? "Ask your office admin to add this."
          : "Your clinic’s admin can see the plan under Billing, and talk to Pulse 3D about adding it."}
    </QuietBlock>
  );
}

/** The one line the library home shows under a category on the plan whose only videos are placeholders this clinic is not shown. */
export const ONLY_PLACEHOLDERS = "Only placeholder animations so far, and your clinic sees finished animations only.";

/** The same message on the category's own page. */
export function EmptyCategory({ label }: { label: string }) {
  return (
    <QuietBlock eyebrow="Nothing to show yet" heading={`Nothing in ${label} yet.`}>
      Its animations are placeholders for now, and your clinic is set to see finished animations only. They will appear here as each one is
      finished.
    </QuietBlock>
  );
}

/** The block a category page shows instead of the video grid, with a way back to the library. */
function QuietBlock({
  eyebrow,
  heading,
  action,
  children,
}: {
  eyebrow: string;
  heading: string;
  /** One more link beside "Back to the library", for the block that has somewhere useful to send people. */
  action?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-line-strong px-6 py-14 text-center">
      <p className="text-sm font-medium uppercase tracking-wider text-ink-muted">{eyebrow}</p>
      <p className="mt-2 text-xl font-medium">{heading}</p>
      <p className="mx-auto mt-2 max-w-md text-base text-ink-soft">{children}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        {action && (
          <Link href={action.href} prefetch={false} className={PRIMARY_BUTTON}>
            {action.label}
          </Link>
        )}
        <Link
          href="/library"
          className="inline-flex h-11 items-center rounded-lg border border-line-strong px-4 text-sm font-medium text-ink-soft hover:border-brand hover:text-ink"
        >
          Back to the library
        </Link>
      </div>
    </div>
  );
}
