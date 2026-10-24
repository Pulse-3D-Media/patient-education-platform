import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminsOnly } from "@/components/ui/AdminsOnly";
import { ClinicClosed } from "@/components/ui/ClinicClosed";
import { ClinicShell } from "@/components/ui/ClinicShell";
import { PLACEHOLDER_BADGE, SECONDARY_BUTTON } from "@/components/ui/styles";
import { planBlockFor, planBlockMessage } from "@/lib/access";
import { addToPlanHref, addToPlanOffer } from "@/lib/add-to-plan";
import { CATEGORIES } from "@/lib/categories";
import { requireClinicPage } from "@/lib/clinic";
import { clinicIsOpen } from "@/lib/clinic-status";
import { getClinicAccess } from "@/lib/db/access";
import { getCategoryConfigs } from "@/lib/db/category-config";
import { getSettings } from "@/lib/db/settings";
import { getShareByIdForClinic } from "@/lib/db/shares";
import { finishedLinkMessage, renewalState } from "@/lib/expiry";
import { AdminFrame } from "../../AdminFrame";
import { ReactivateForm } from "./ReactivateForm";

/**
 * Turn a paused link back on: /admin/reactivate/<id>. This is where the
 * button in the "a patient is asking" email lands, and where the overview's
 * "Links waiting to be reactivated" sends an admin.
 *
 * THE ADDRESS CARRIES THE LINK'S ROW ID, NEVER ITS CODE. The code is what
 * plays the video; this address sits in an email (which the email service
 * keeps), in browser history and in the hosting logs. The id plays nothing.
 * An address with a code in it (none was ever emailed) finds nothing here
 * and gets not-found, like any other id this clinic does not have.
 *
 * OPENING THIS PAGE CHANGES NOTHING. Mail programs and filters open links
 * on their own to scan them, and an email can be forwarded, so the page
 * only shows the link's details and a Confirm button. Confirm is a POST
 * (ReactivateForm, reactivateLinkAction) and the only thing that turns the
 * link back on.
 *
 * Who may see it: a signed-in office admin of the clinic the link belongs
 * to. A member gets the admins-only page. An id that is not one of this
 * clinic's links (a forged one, or another clinic's) gets not-found, which
 * also gives nothing away about which links exist. A clinic that is not
 * open (paused, cancelled, grace over, or never on a plan) is told why and
 * offered nothing to press: links cannot be turned back on for it.
 *
 * What it shows: the procedure, who the link is from, when it was made, its
 * play starts, and where it stands (paused with so many renewals left,
 * working until a date, or finished and why). The rule is renewalState()
 * in lib/expiry.ts, the same one the patient page and the write use.
 *
 * A paused link whose video the clinic's plan no longer allows (its category
 * is off the plan, or it is a placeholder the clinic is not shown) is not
 * turned back on (decided by Evan on 2026-10-08): the page says so in the
 * write's own sentence (planBlockMessage), draws no Confirm, and, when the
 * category is for sale, offers the library's "Add to your plan" link.
 */
export const dynamic = "force-dynamic";

export default async function ReactivatePage({ params }: PageProps<"/admin/reactivate/[id]">) {
  const { id } = await params;
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

  const share = await getShareByIdForClinic(clinic.id, id);
  if (!share) notFound();

  const now = new Date();
  const [settings, access] = await Promise.all([getSettings(), getClinicAccess(clinic.id)]);
  const state = renewalState(share, settings.maxRenewals, now);
  // The plan, asked with the same rule the write asks (decided by Evan on 2026-10-08): a paused link to a
  // video the plan no longer allows is not turned back on. No clinic row reads as nothing on the plan.
  const block =
    state.kind === "paused" && share.video.isPublished
      ? access
        ? planBlockFor(access, share.video)
        : "not-on-plan"
      : null;
  const canReactivate = state.kind === "paused" && share.video.isPublished && block === null;
  // Off the plan, and the category is for sale: the library's "Add to your plan" link to Billing. Everyone here is an admin.
  const category = CATEGORIES.find((entry) => entry.value === share.video.category);
  const addLink =
    block === "not-on-plan" && category && addToPlanOffer(true, (await getCategoryConfigs())[category.value]) === "link"
      ? addToPlanHref(category.slug)
      : null;

  // One sentence on where the link stands, in the same words the write would use to refuse.
  const standing =
    state.kind === "working"
      ? `Working until ${formatDate(share.expiresAt)}. Nothing to do.`
      : state.kind === "finished"
        ? finishedLinkMessage(state.reason, share.renewalsUsed)
        : !share.video.isPublished
          ? "Paused, and the video behind it is not available right now, so it cannot be turned back on. Ask Pulse 3D about the video."
          : block
            ? `Paused. ${planBlockMessage(block)}`
            : `Paused since ${formatDate(share.expiresAt)}. It can be turned back on ${state.renewalsLeft} more ${state.renewalsLeft === 1 ? "time" : "times"}, ${state.daysPerRenewal} ${state.daysPerRenewal === 1 ? "day" : "days"} each time.`;

  return (
    <AdminFrame clinic={clinic} title="Turn a link back on" intro="A patient link that has paused can be turned back on here. Nothing changes until you press Confirm.">
      <section aria-labelledby="link-heading" className="mt-6 max-w-2xl rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <h2 id="link-heading" className="flex flex-wrap items-center gap-2 text-lg font-semibold">
          {share.video.title}
          {share.video.isPlaceholder && <span className={PLACEHOLDER_BADGE}>Placeholder</span>}
        </h2>
        <dl className="mt-4 grid gap-x-6 gap-y-2 text-[15px] sm:grid-cols-[max-content_1fr]">
          <dt className="text-ink-muted">Surgeon</dt>
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
          shareId={share.id}
          paused={canReactivate}
          days={state.kind === "paused" ? state.daysPerRenewal : 0}
          renewalsLeft={state.kind === "paused" ? state.renewalsLeft : 0}
          whyNot={
            state.kind === "working"
              ? "There is nothing to turn back on."
              : addLink
                ? "Once the category is on your plan again, this link can be turned back on here."
                : block === "not-on-plan"
                  ? "This category is not for sale right now. A new link to another procedure is made on the Shared links page."
                  : "A new link is made on the Shared links page."
          }
        />
      </section>

      <div className="mt-6 flex flex-wrap gap-3">
        {addLink && (
          <Link href={addLink} className={SECONDARY_BUTTON}>
            Add to your plan
          </Link>
        )}
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
