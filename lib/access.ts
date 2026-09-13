import type { Category, ClinicStatus } from "@prisma/client";
import { CATEGORIES } from "./categories";
import { clinicIsOpen } from "./clinic-status";

/**
 * The access rule: may this clinic use this video, and what state is a
 * library category in for this clinic?
 *
 * This file is the rule itself, with no database in it, so it can be
 * tested with plain values. lib/db/access.ts reads a clinic's facts and
 * hands them here; lib/db/shares.ts does the same inside the transaction
 * that creates a share link; the library and admin pages do the same for
 * what they list. Every one of them asks this file, so the rule cannot
 * drift between the page that shows a video and the action that shares it.
 *
 * What access depends on, and nothing else:
 *
 *   - the clinic is open (clinicIsOpen in lib/clinic-status.ts)
 *   - the video's category is on the clinic's plan (Clinic.categories)
 *   - the video is published
 *   - a placeholder video is only usable while the clinic is shown
 *     placeholders (Clinic.showPlaceholders)
 *
 * What it deliberately does NOT depend on: managedByPulse (that says who
 * manages billing, not what the clinic may use; a managed clinic that is
 * paused is closed, and a managed clinic with no categories has none) and
 * whether a category is for sale right now (that governs new purchases;
 * a category already on the plan stays usable when it comes off sale).
 *
 * Patient links already issued are not governed by this file at all. A
 * share keeps working after its category leaves the plan or the clinic is
 * paused; only its own expiry, cancellation, or the video being
 * unpublished stop it. See "Nothing breaks while the library fills up" in
 * CLAUDE.md, and app/watch, which never reads a clinic's plan.
 */

/** What is known about a clinic that decides access. Read by getClinicAccess() in lib/db/access.ts. */
export type ClinicAccess = {
  clinicId: string;
  status: ClinicStatus;
  /** clinicIsOpen(status): whether the clinic may use the app at all right now. */
  open: boolean;
  /** The categories on the clinic's plan, each once, in library order. Empty means no plan yet. */
  categories: Category[];
  /** False when Pulse staff have hidden placeholder videos from this clinic. */
  showPlaceholders: boolean;
};

/** The three facts about a video the rule reads. */
export type VideoFacts = {
  category: Category;
  isPublished: boolean;
  isPlaceholder: boolean;
};

/** Why a clinic may not use a video, in the order the checks run. */
export type AccessReason = "clinic-closed" | "no-such-video" | "unpublished" | "not-on-plan" | "placeholder-hidden";

export type AccessDecision = { allowed: true } | { allowed: false; reason: AccessReason };

/** The categories in the order the library shows them, each once. Values that are not ours are dropped. */
export function inLibraryOrder(categories: Category[]): Category[] {
  const wanted = new Set(categories);
  return CATEGORIES.filter((c) => wanted.has(c.value)).map((c) => c.value);
}

/** Turn the fields of a clinic row into a ClinicAccess. Pure, so lib/db/access.ts and the tests share it. */
export function accessFromClinic(clinic: { id: string; status: ClinicStatus; categories: Category[]; showPlaceholders: boolean }): ClinicAccess {
  return {
    clinicId: clinic.id,
    status: clinic.status,
    open: clinicIsOpen(clinic.status),
    categories: inLibraryOrder(clinic.categories),
    showPlaceholders: clinic.showPlaceholders,
  };
}

/**
 * May this clinic use this video? `video` is null when no video has the id
 * that was asked for. The checks run in the order the reasons are listed:
 * a closed clinic is refused before the video is even looked at.
 */
export function decideVideoAccess(access: ClinicAccess, video: VideoFacts | null): AccessDecision {
  if (!access.open) return { allowed: false, reason: "clinic-closed" };
  if (!video) return { allowed: false, reason: "no-such-video" };
  if (!video.isPublished) return { allowed: false, reason: "unpublished" };
  if (!access.categories.includes(video.category)) return { allowed: false, reason: "not-on-plan" };
  if (video.isPlaceholder && !access.showPlaceholders) return { allowed: false, reason: "placeholder-hidden" };
  return { allowed: true };
}

/**
 * The sentence a staff member reads when a share link is refused. Plain,
 * says what to do, and never a technical word. The clinic-closed sentence
 * matches what the actions already say when the clinic is not open.
 */
export function accessRefusalMessage(reason: AccessReason): string {
  switch (reason) {
    case "clinic-closed":
      return "Your clinic can't share links right now. Your clinic's admin can see why under Billing.";
    case "no-such-video":
      return "That video no longer exists.";
    case "unpublished":
      return "That video is not published, so it cannot be shared.";
    case "not-on-plan":
      return "That procedure is not in a category on your clinic's plan, so it can't be shared. Your clinic's admin can see the plan under Billing.";
    case "placeholder-hidden":
      return "That is a placeholder animation, and your clinic is set to use finished animations only, so it can't be shared.";
  }
}

/**
 * How many published videos a category holds, split by kind. Both numbers
 * are needed to tell the states apart: a category can hold placeholders a
 * clinic is not shown, which is not the same as holding nothing.
 */
export type PublishedCounts = {
  /** Finished animations. */
  real: number;
  /** Sample animations standing in for a procedure. */
  placeholder: number;
};

/**
 * What the library shows a clinic for one category:
 *
 *   coming-soon  nothing is published in it, for anyone. The "Coming soon"
 *                tile, with the category's own sentence.
 *   locked       something is published, but the category is not on this
 *                clinic's plan. A dimmed tile saying so; nothing playable.
 *   empty        it is on the plan, but everything published in it is a
 *                placeholder and this clinic is shown finished animations
 *                only. An honest empty state, not "coming soon".
 *   available    it is on the plan and there is something to show.
 *
 * Whether the category is for sale plays no part: a category on the plan
 * stays available when it comes off sale.
 */
export type CategoryState = "coming-soon" | "locked" | "empty" | "available";

export function categoryState(access: ClinicAccess, category: Category, counts: PublishedCounts | undefined): CategoryState {
  const real = counts?.real ?? 0;
  const placeholder = counts?.placeholder ?? 0;
  if (real + placeholder === 0) return "coming-soon";
  if (!access.categories.includes(category)) return "locked";
  const visible = real + (access.showPlaceholders ? placeholder : 0);
  if (visible === 0) return "empty";
  return "available";
}

/** How many of a category's published videos this clinic is shown: the finished ones, plus the placeholders when it sees them. */
export function visibleCount(access: ClinicAccess, counts: PublishedCounts | undefined): number {
  const real = counts?.real ?? 0;
  const placeholder = counts?.placeholder ?? 0;
  return real + (access.showPlaceholders ? placeholder : 0);
}
