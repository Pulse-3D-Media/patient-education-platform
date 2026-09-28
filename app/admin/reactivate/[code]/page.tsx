import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminsOnly } from "@/components/ui/AdminsOnly";
import { ClinicClosed } from "@/components/ui/ClinicClosed";
import { ClinicShell } from "@/components/ui/ClinicShell";
import { PLACEHOLDER_BADGE, SECONDARY_BUTTON } from "@/components/ui/styles";
import { requireClinicPage } from "@/lib/clinic";
import { clinicIsOpen } from "@/lib/clinic-status";
import { getSettings } from "@/lib/db/settings";
import { getShareForClinic } from "@/lib/db/shares";
import { finishedLinkMessage, renewalState } from "@/lib/expiry";
import { AdminFrame } from "../../AdminFrame";
import { ReactivateForm } from "./ReactivateForm";

/**
 * Turn a paused link back on: /admin/reactivate/<code>. This is where the
 * button in the "a patient is asking" email lands, and where the overview's
 * "Links waiting to be reactivated" sends an admin.
 *
 * OPENING THIS PAGE CHANGES NOTHING. Mail programs and filters open links
 * on their own to scan them, and an email can be forwarded, so the page
 * only shows the link's details and a Confirm button. Confirm is a POST
 * (ReactivateForm, reactivateLinkAction) and the only thing that turns the
 * link back on.
 *
 * Who may see it: a signed-in office admin of the clinic the link belongs
 * to. A member gets the admins-only page. A code that is not one of this
 * clinic's links (a forged one, or another clinic's) gets not-found, which
 * also gives nothing away about which codes exist. A clinic that is not
 * open (paused, cancelled, grace over, or never on a plan) is told why and
 * offered nothing to press: links cannot be turned back on for it.
 *
 * What it shows: the procedure, who the link is from, when it was made, its
 * play starts, and where it stands (paused with so many renewals left,
 * working until a date, or finished and why). The rule is renewalState()
 * in lib/expiry.ts, the same one the patient page and the write use.
 */
export const dynamic = "force-dynamic";

export default async function ReactivatePage({ params }: PageProps<"/admin/reactivate/[code]">) {
  const { code } = await params;
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
      <AdminFrame clinic={clinic} title="Turn a link back on">
        <p className="mt-6 max-w-2xl text-ink-soft">Links cannot be turned back on while your clinic is not open. Here is why it is not:</p>
        <div className="mt-2">
          <ClinicClosed status={clinic.status} clinicName={clinic.name} billingLink inFrame />
        </div>
      </AdminFrame>
    );
  }

  const share = await getShareForClinic(clinic.id, code);
  if (!share) notFound();

  const now = new Date();
  const settings = await getSettings();
  const state = renewalState(share, settings.maxRenewals, now);
  const canReactivate = state.kind === "paused" && share.video.isPublished;

  // One sentence on where the link stands, in the same words the write would use to refuse.
  const standing =
    state.kind === "working"
      ? `Working until ${formatDate(share.expiresAt)}. Nothing to do.`
      : state.kind === "finished"
        ? finishedLinkMessage(state.reason, share.renewalsUsed)
        : !share.video.isPublished
          ? "Paused, and the video behind it is not available right now, so it cannot be turned back on. Ask Pulse 3D about the video."
          : `Paused since ${formatDate(share.expiresAt)}. It can be turned back on ${state.renewalsLeft} more ${state.renewalsLeft === 1 ? "time" : "times"}, ${state.daysPerRenewal} ${state.daysPerRenewal === 1 ? "day" : "days"} each time.`;

  return (
    <AdminFrame clinic={clinic} title="Turn a link back on" intro="A patient link that has paused can be turned back on here. Nothing changes until you press Confirm.">
      <section aria-labelledby="link-heading" className="mt-6 max-w-2xl rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <h2 id="link-heading" className="flex flex-wrap items-center gap-2 text-lg font-semibold">
          {share.video.title}
          {share.video.isPlaceholder && <span className={PLACEHOLDER_BADGE}>Placeholder</span>}
        </h2>
        <dl className="mt-4 grid gap-x-6 gap-y-2 text-[15px] sm:grid-cols-[max-content_1fr]">
          <dt className="text-ink-muted">Link from</dt>
          <dd className="text-ink">{share.senderName ?? "Not recorded on this link"}</dd>
          <dt className="text-ink-muted">Made</dt>
          <dd className="text-ink">{formatDate(share.createdAt)}</dd>
          <dt className="text-ink-muted">Play starts</dt>
          <dd className="text-ink">{share.viewCount === 0 ? "Not played yet" : share.viewCount}</dd>
          <dt className="text-ink-muted">Turned back on before</dt>
          <dd className="text-ink">{share.renewalsUsed === 0 ? "Never" : `${share.renewalsUsed} ${share.renewalsUsed === 1 ? "time" : "times"}`}</dd>
          <dt className="text-ink-muted">Where it stands</dt>
          <dd className="text-ink">{standing}</dd>
        </dl>

        {/* Always drawn, so the "Done" sentence survives the page's own refresh after Confirm (see ReactivateForm). */}
        <ReactivateForm
          code={share.code}
          paused={canReactivate}
          days={state.kind === "paused" ? state.daysPerRenewal : 0}
          renewalsLeft={state.kind === "paused" ? state.renewalsLeft : 0}
          whyNot={state.kind === "working" ? "There is nothing to turn back on." : "A new link is made on the Shared links page."}
        />
      </section>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/admin" className={SECONDARY_BUTTON}>
          Back to the overview
        </Link>
        {!canReactivate && state.kind !== "working" && (
          <Link href="/admin/links" className={SECONDARY_BUTTON}>
            Make a new link
          </Link>
        )}
      </div>
    </AdminFrame>
  );
}

/** "Sep 19, 2026". Utah time, like the rest of the admin area. */
function formatDate(date: Date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Denver" });
}
