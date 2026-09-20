import Link from "next/link";
import type { ReactNode } from "react";
import { AdminsOnly } from "@/components/ui/AdminsOnly";
import { ClinicShell } from "@/components/ui/ClinicShell";
import { ClinicClosed } from "@/components/ui/ClinicClosed";
import { PLACEHOLDER_BADGE, SECONDARY_BUTTON } from "@/components/ui/styles";
import { ADMIN_SECTIONS } from "@/lib/admin-nav";
import { requireClinicPage } from "@/lib/clinic";
import { clinicIsOpen } from "@/lib/clinic-status";
import { listRecentSharesForClinic, summarizeSharesForClinic, SUMMARY_RECENT_DAYS, SUMMARY_SOON_DAYS } from "@/lib/db/shares";
import { shareExpiryState } from "@/lib/expiry";
import { AdminFrame } from "./AdminFrame";

/**
 * The clinic admin overview, at /admin: the first thing an office manager
 * sees. It is not the full list of anything. It shows what needs a look,
 * a few totals about the clinic's links, the newest few links, and a card
 * for each section, so Shared links, People and Billing are one tap away.
 *
 * Everything on it is bounded: five counts done in the database, and the
 * newest RECENT_LINKS links. The whole history lives on /admin/links.
 *
 * Plan and price information is not here on purpose; it lives on
 * /admin/billing and nowhere else on the clinic side.
 *
 * Admins only (org:admin). A member sees the plain admins-only note. An
 * admin of a clinic that is not open sees why, with a button to Billing,
 * which is the one page that stays open for them.
 */
export const dynamic = "force-dynamic";

/** How many of the newest links the overview shows. */
const RECENT_LINKS = 5;

export default async function AdminOverviewPage() {
  const clinic = await requireClinicPage();

  if (!clinic.isAdmin) {
    return (
      <ClinicShell clinic={clinic}>
        <AdminsOnly />
      </ClinicShell>
    );
  }

  if (!clinicIsOpen(clinic)) {
    return (
      <AdminFrame clinic={clinic} title="Overview">
        <Notice text={clinic.noticeText} />
        <div className="mt-6">
          <ClinicClosed status={clinic.status} clinicName={clinic.name} billingLink inFrame />
        </div>
        <SectionCards />
      </AdminFrame>
    );
  }

  const [summary, recent] = await Promise.all([
    summarizeSharesForClinic(clinic.id),
    listRecentSharesForClinic(clinic.id, RECENT_LINKS),
  ]);
  const now = new Date();

  // What needs a look. Each line is one sentence and one link.
  const attention: { text: string; href: string; label: string }[] = [];
  if (summary.notWorking > 0) {
    attention.push({
      text: `${summary.notWorking} ${summary.notWorking === 1 ? "link points" : "links point"} at a video that is not published right now, so ${summary.notWorking === 1 ? "it does" : "they do"} not work.`,
      href: "/admin/links",
      label: "See the links",
    });
  }
  if (summary.expiringSoon > 0) {
    attention.push({
      text: `${summary.expiringSoon} ${summary.expiringSoon === 1 ? "link stops" : "links stop"} working within ${SUMMARY_SOON_DAYS} days.`,
      href: "/admin/links",
      label: "See the links",
    });
  }

  return (
    <AdminFrame clinic={clinic} title="Overview" intro="What needs a look, how your links are doing, and the way into each section.">
      <Notice text={clinic.noticeText} />

      <section aria-labelledby="attention-heading" className="mt-6">
        <h2 id="attention-heading" className="text-lg font-semibold">
          Needs a look
        </h2>
        {attention.length === 0 ? (
          <p className="mt-2 text-ink-soft">Nothing right now.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {attention.map((item) => (
              <li
                key={item.text}
                className="flex flex-col gap-3 rounded-2xl border border-warn/40 bg-warn/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <p className="text-[15px] text-ink">{item.text}</p>
                <Link href={item.href} className={SECONDARY_BUTTON}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="numbers-heading" className="mt-8">
        <h2 id="numbers-heading" className="text-lg font-semibold">
          Your links
        </h2>
        {/* A cancelled link is deleted (see lib/db/shares.ts), so these count the links still on the list, not everything ever made. */}
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          <Fact label="Working right now" value={summary.working} />
          <Fact label={`Made in the last ${SUMMARY_RECENT_DAYS} days`} value={summary.madeRecently} note="Links you have cancelled are not counted." />
          <Fact
            label="Play starts, current links"
            value={summary.playStarts}
            note="Counted once per page load, the first time play is pressed. Not a count of patients, and not counting links you have cancelled."
          />
        </dl>
      </section>

      <section aria-labelledby="recent-heading" className="mt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="recent-heading" className="text-lg font-semibold">
            Newest links
          </h2>
          <Link href="/admin/links" className="text-sm text-brand-bright hover:text-ink">
            All shared links
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="mt-2 text-ink-soft">
            No links yet.{" "}
            <Link href="/admin/links" className="text-brand-bright hover:text-ink">
              Create the first one.
            </Link>
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-surface">
            {recent.map((share) => {
              const state = shareExpiryState(share, now);
              const works = state.kind !== "expired" && share.video.isPublished;
              // One short line per link; the full wording is on /admin/links. A link nobody has
              // played yet shows the date it stops on if that stays true, since its deadline
              // moves at the first play (lib/expiry.ts).
              const when = !works
                ? share.video.isPublished
                  ? "Expired"
                  : "Not working"
                : state.kind === "awaiting"
                  ? `Open until ${formatDate(state.unclaimedUntil)} if never played`
                  : `Works until ${formatDate(share.expiresAt)}`;
              return (
                <li key={share.id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className={`flex flex-wrap items-center gap-2 text-[15px] ${works ? "" : "text-ink-muted"}`}>
                    {share.video.title}
                    {share.video.isPlaceholder && <span className={PLACEHOLDER_BADGE}>Placeholder</span>}
                  </p>
                  <p className="text-sm text-ink-muted">
                    {when} &middot;{" "}
                    {share.viewCount === 0 ? "Not played yet" : `${share.viewCount} ${share.viewCount === 1 ? "play start" : "play starts"}`}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <SectionCards />
    </AdminFrame>
  );
}

/** A line from Pulse 3D for this clinic, set on /pulse. Nothing shows when there is none. */
function Notice({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="status" className="mt-6 rounded-xl border border-brand/50 bg-brand/15 px-4 py-3 text-[15px] text-ink">
      <span className="mr-2 font-semibold text-brand-bright">From Pulse 3D:</span>
      {text}
    </p>
  );
}

/** One number with its label. The label says exactly what is counted. */
function Fact({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-5 py-4">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-ink">{value.toLocaleString("en-US")}</dd>
      {note && <dd className="mt-1 text-xs text-ink-muted">{note}</dd>}
    </div>
  );
}

/** A card for every section other than the overview itself, so each is one tap away. */
function SectionCards(): ReactNode {
  return (
    <section aria-labelledby="sections-heading" className="mt-8">
      <h2 id="sections-heading" className="text-lg font-semibold">
        Sections
      </h2>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {ADMIN_SECTIONS.filter((section) => section.href !== "/admin").map((section) => (
          <li key={section.href}>
            <Link
              href={section.href}
              className="flex h-full flex-col rounded-2xl border border-line bg-surface p-5 transition hover:border-brand/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-bright"
            >
              <span className="flex items-center gap-2 text-lg font-semibold text-ink">
                {section.label}
                {section.coming && <span className="text-xs font-normal uppercase tracking-wider text-ink-muted">Coming</span>}
              </span>
              <span className="mt-1 text-sm text-ink-soft">{section.blurb}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "Sep 19, 2026". Utah time, like the rest of the admin area. */
function formatDate(date: Date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Denver" });
}
