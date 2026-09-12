import Link from "next/link";
import type { ReactNode } from "react";
import { AdminsOnly } from "@/components/ui/AdminsOnly";
import { AppShell } from "@/components/ui/AppShell";
import { ClinicClosed } from "@/components/ui/ClinicClosed";
import { PLACEHOLDER_BADGE, SECONDARY_BUTTON } from "@/components/ui/styles";
import { ADMIN_SECTIONS } from "@/lib/admin-nav";
import { requireClinicPage } from "@/lib/clinic";
import { clinicIsOpen } from "@/lib/clinic-status";
import { listRecentSharesForClinic, summarizeSharesForClinic, SUMMARY_RECENT_DAYS, SUMMARY_SOON_DAYS } from "@/lib/db/shares";
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
      <AppShell>
        <AdminsOnly />
      </AppShell>
    );
  }

  if (!clinicIsOpen(clinic.status)) {
    return (
      <AdminFrame clinicName={clinic.name} title="Overview">
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
    <AdminFrame clinicName={clinic.name} title="Overview" intro="What needs a look, how your links are doing, and the way into each section.">
      <Notice text={clinic.noticeText} />

      <section aria-labelledby="attention-heading" className="mt-6">
        <h2 id="attention-heading" className="text-lg font-semibold">
          Needs a look
        </h2>
        {attention.length === 0 ? (
          <p className="mt-2 text-[#bfbfbf]">Nothing right now.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {attention.map((item) => (
              <li
                key={item.text}
                className="flex flex-col gap-3 rounded-2xl border border-[#f3b94d]/40 bg-[#f3b94d]/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <p className="text-[15px] text-white">{item.text}</p>
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
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          <Fact label="Working right now" value={summary.working} />
          <Fact label={`Made in the last ${SUMMARY_RECENT_DAYS} days`} value={summary.madeRecently} />
          <Fact label="Play starts, all links" value={summary.playStarts} note="One per press of play. Not a count of patients." />
        </dl>
      </section>

      <section aria-labelledby="recent-heading" className="mt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="recent-heading" className="text-lg font-semibold">
            Newest links
          </h2>
          <Link href="/admin/links" className="text-sm text-[#5fb8d4] hover:text-white">
            All shared links
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="mt-2 text-[#bfbfbf]">
            No links yet.{" "}
            <Link href="/admin/links" className="text-[#5fb8d4] hover:text-white">
              Create the first one.
            </Link>
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-white/10 rounded-2xl border border-white/10 bg-[#0d1113]">
            {recent.map((share) => {
              const works = share.expiresAt > now && share.video.isPublished;
              return (
                <li key={share.id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className={`flex flex-wrap items-center gap-2 text-[15px] ${works ? "" : "text-[#667085]"}`}>
                    {share.video.title}
                    {share.video.isPlaceholder && <span className={PLACEHOLDER_BADGE}>Placeholder</span>}
                  </p>
                  <p className="text-sm text-[#667085]">
                    {works ? `Works until ${formatDate(share.expiresAt)}` : share.video.isPublished ? "Expired" : "Not working"} &middot;{" "}
                    {share.viewCount} {share.viewCount === 1 ? "play start" : "play starts"}
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
    <p role="status" className="mt-6 rounded-xl border border-[#2a829b]/50 bg-[#2a829b]/15 px-4 py-3 text-[15px] text-white">
      <span className="mr-2 font-semibold text-[#5fb8d4]">From Pulse 3D:</span>
      {text}
    </p>
  );
}

/** One number with its label. The label says exactly what is counted. */
function Fact({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0d1113] px-5 py-4">
      <dt className="text-sm text-[#667085]">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-white">{value.toLocaleString("en-US")}</dd>
      {note && <dd className="mt-1 text-xs text-[#667085]">{note}</dd>}
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
              className="flex h-full flex-col rounded-2xl border border-white/10 bg-[#0d1113] p-5 transition hover:border-[#2a829b]/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5fb8d4]"
            >
              <span className="flex items-center gap-2 text-lg font-semibold text-white">
                {section.label}
                {section.coming && <span className="text-xs font-normal uppercase tracking-wider text-[#667085]">Coming</span>}
              </span>
              <span className="mt-1 text-sm text-[#bfbfbf]">{section.blurb}</span>
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
