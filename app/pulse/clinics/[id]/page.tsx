import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { allFontClasses } from "@/app/brand-look";
import { BrandingForm } from "@/components/ui/BrandingForm";
import { PLACEHOLDER_BADGE } from "@/components/ui/styles";
import { BILLING_STATUS_WORDS, STAFF_ACCESS_WORDS, hasLiveSubscription } from "@/lib/billing-state";
import { parseLogoUrl, readBranding } from "@/lib/branding";
import { CATEGORIES } from "@/lib/categories";
import { getClinicBilling } from "@/lib/db/billing";
import { getCategoryAvailability } from "@/lib/db/category-config";
import { getClinicForPulse } from "@/lib/db/clinics";
import { listNotesForClinic } from "@/lib/db/notes";
import { getSettings } from "@/lib/db/settings";
import { listSharesForClinic } from "@/lib/db/shares";
import { shareExpiryState } from "@/lib/expiry";
import { listPeople, type Person } from "@/lib/people";
import { formatUsPhone } from "@/lib/phone";
import { formatCents } from "@/lib/pricing";
import { requirePulseStaff } from "@/lib/pulse";
import { saveBrandingAction } from "../../actions";
import { Section, StatusBadge, formatDate, formatDateTime } from "../../ui";
import { ClinicTabs } from "./ClinicTabs";
import { DetailsForm, ManagedForm, NoteForm, PlanForm, PracticeTypeForm, StatusForm } from "./forms";

/**
 * One clinic, everything Pulse staff can see and change about it, in seven
 * sections behind a row of pills (ClinicTabs): Overview (status, managed by
 * Pulse), Plan, Details, Branding, People, Links, Notes.
 *
 * The editable sections are forms in forms.tsx, each saving through its own
 * Server Action. People come from Clerk; links are the same list the
 * clinic's own admin console shows; Notes is the running log, newest first,
 * to which every change saved on this page adds an entry of its own.
 *
 * Staff only. Rendered fresh on every request so a save is seen at once.
 */
export const dynamic = "force-dynamic";

/** How many of the clinic's newest links to show. The admin console shows them all. */
const RECENT_LINK_LIMIT = 20;

export default async function PulseClinicPage({ params }: PageProps<"/pulse/clinics/[id]">) {
  await requirePulseStaff();

  const { id } = await params;
  const clinic = await getClinicForPulse(id);
  if (!clinic) notFound();

  const [settings, shares, notes, people, availability, billing] = await Promise.all([
    getSettings(),
    listSharesForClinic(clinic.id),
    listNotesForClinic(clinic.id),
    clinic.clerkOrgId ? listPeople(clinic.clerkOrgId).catch(() => null) : Promise.resolve(null),
    getCategoryAvailability(),
    getClinicBilling(clinic.id),
  ]);
  const now = new Date();
  const surgeons = people?.filter((person) => person.kind === "surgeon").length;

  const overview = (
    <>
      <Section
        title="Status"
        blurb={
          clinic.statusChangedAt
            ? `Last changed by ${clinic.statusChangedBy ?? "unknown"} on ${formatDateTime(clinic.statusChangedAt)}${
                clinic.statusReason ? `: ${clinic.statusReason}` : ""
              }`
            : "Never changed. New clinics start pending until they are opened here or pay by card."
        }
      >
        <p className="mb-4 text-[15px] text-[#bfbfbf]">
          {clinic.staffAccess
            ? `Set by hand to ${STAFF_ACCESS_WORDS[clinic.staffAccess]}. That wins over billing until it is changed here.`
            : clinic.managedByPulse
              ? "Nothing is set by hand, and this clinic is managed by Pulse, so it stays pending until it is opened here."
              : "Nothing is set by hand, so this clinic's status follows its card payments."}
          {clinic.status === "PAST_DUE" && clinic.graceEndsAt ? ` Its grace period ends ${formatDateTime(clinic.graceEndsAt)}.` : ""}
        </p>
        <StatusForm clinicId={clinic.id} staffAccess={clinic.staffAccess} />
      </Section>

      <Section title="Managed by Pulse">
        <ManagedForm clinicId={clinic.id} managedByPulse={clinic.managedByPulse} />
      </Section>

      <Section
        title="Card billing"
        blurb="What Stripe says about this clinic's subscription. Read-only: it is kept up to date from Stripe's notifications, whatever is set by hand above. Test mode only."
      >
        {billing ? (
          <dl className="grid gap-x-8 gap-y-3 text-[15px] sm:grid-cols-2">
            <Fact label="Subscription">{BILLING_STATUS_WORDS[billing.status]}</Fact>
            <Fact label="Stripe customer">{billing.stripeCustomerId ?? "None"}</Fact>
            <Fact label="Stripe subscription">{billing.stripeSubscriptionId ?? "None"}</Fact>
            <Fact label="Paid through">{billing.currentPeriodEnd ? formatDate(billing.currentPeriodEnd) : "Not known"}</Fact>
            {billing.cancelAt && <Fact label="Cancellation scheduled for">{formatDateTime(billing.cancelAt)}</Fact>}
            {billing.paymentFailedAt && <Fact label="Payment failure first recorded">{formatDateTime(billing.paymentFailedAt)}</Fact>}
            {billing.graceEndsAt && <Fact label="Grace period ends">{formatDateTime(billing.graceEndsAt)}</Fact>}
            <Fact label="Plan in force">{planWords(billing.currentPlan)}</Fact>
            {billing.pendingPlan && <Fact label="Plan waiting for a first payment">{planWords(billing.pendingPlan)}</Fact>}
            <Fact label="Last checked against Stripe">{billing.lastReconciledAt ? formatDateTime(billing.lastReconciledAt) : "Never"}</Fact>
          </dl>
        ) : (
          <p className="text-[15px] text-[#bfbfbf]">This clinic has never started a card checkout, so there is nothing in Stripe for it.</p>
        )}
        {billing && hasLiveSubscription(billing.status) && (clinic.managedByPulse || clinic.staffAccess === "PAUSED" || clinic.staffAccess === "CANCELED") && (
          <p className="mt-4 rounded-lg border border-[#f3b94d]/40 bg-[#f3b94d]/10 px-4 py-3 text-[15px] text-[#f3b94d]">
            This clinic is closed or managed by hand, but its card subscription is still live in Stripe and keeps being charged until it is cancelled
            there.
          </p>
        )}
      </Section>

      <Section
        title="Practice type"
        blurb="A hospital or health system is always Enterprise and is never offered card checkout. A clinic that has not answered cannot check out until it does. The clinic's admin is asked once on their Billing page; change it here if they chose wrongly."
      >
        <PracticeTypeForm clinicId={clinic.id} practiceType={clinic.practiceType} />
      </Section>
    </>
  );

  const plan = (
    <Section
      title="Plan"
      blurb="Which categories the clinic can use and how many surgeon seats it pays for. A category marked Not for sale or Coming soon can still be ticked (an enterprise or comped clinic may get one early); the label makes it a choice, not an accident. Once billing exists, self-serve clinics set this themselves and it becomes read-only here unless the clinic is managed by Pulse."
    >
      <PlanForm clinicId={clinic.id} categories={clinic.categories} surgeonSeats={clinic.surgeonSeats} availability={availability} />
    </Section>
  );

  const details = (
    <Section title="Clinic details">
      <DetailsForm
        clinicId={clinic.id}
        values={{
          name: clinic.name,
          noticeText: clinic.noticeText,
          showPlaceholders: clinic.showPlaceholders,
          viewDaysOverride: clinic.viewDaysOverride,
          platformViewDays: settings.viewDays,
        }}
      />
    </Section>
  );

  // The clinic's look: logo, colour, font, phone. The clinic's own admin can change the last
  // three as well (/admin/branding); both saves are logged and the last one wins. Stored values
  // are checked on the way out, so the form opens on what the clinic's screens really show.
  const stored = readBranding(clinic);
  const branding = (
    <Section
      title="Branding"
      blurb="The clinic's logo, brand colour, font and office phone, as they show on its admin screens, in its library and on every patient page it sends. The clinic's own admin can change the colour, font and phone too, from their Branding page; whoever saves last wins, and every change is logged in Notes with who made it. The logo is the one exception: the clinic sets its own by uploading it to its Clerk organization, and the address typed here is used only while it has not."
    >
      <BrandingForm
        action={saveBrandingAction}
        clinicId={clinic.id}
        clinicName={clinic.name}
        values={{ logoUrl: parseLogoUrl(clinic.logoUrl), phone: clinic.phone, brandColor: stored.color, brandFont: stored.font, brandTheme: stored.theme }}
        showLogoField
        fontClasses={allFontClasses()}
      />
    </Section>
  );

  const peopleSection = (
    <Section
      title="People"
      blurb={
        people === null
          ? "Could not read this clinic's people from Clerk right now."
          : `${people.length} ${people.length === 1 ? "person" : "people"}, ${surgeons} marked as ${surgeons === 1 ? "surgeon" : "surgeons"}, ${clinic.surgeonSeats} ${clinic.surgeonSeats === 1 ? "seat" : "seats"} paid for.`
      }
    >
      {people && people.length > 0 ? <PeopleTable people={people} /> : <p className="text-sm text-[#667085]">Nobody yet.</p>}
    </Section>
  );

  const links = (
    <Section
      title="Recent links"
      blurb={`The newest ${Math.min(shares.length, RECENT_LINK_LIMIT)} of ${shares.length} share ${shares.length === 1 ? "link" : "links"}, as the clinic's admin console lists them.`}
    >
      {shares.length === 0 ? (
        <p className="text-sm text-[#667085]">No links yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[15px]">
            <thead className="text-xs uppercase tracking-wider text-[#667085]">
              <tr className="border-b border-white/10">
                <th className="px-3 py-2 font-medium">Code</th>
                <th className="px-3 py-2 font-medium">Procedure</th>
                <th className="px-3 py-2 font-medium">Category</th>
                <th className="px-3 py-2 font-medium">Expires</th>
                <th className="px-3 py-2 text-right font-medium">Play starts</th>
                <th className="px-3 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {shares.slice(0, RECENT_LINK_LIMIT).map((share) => {
                const state = shareExpiryState(share, now);
                const expired = state.kind === "expired";
                // Expires: the date, plus how it got there (lib/expiry.ts). A link
                // nobody has played yet stops on its unclaimed date unless it is
                // played first; a legacy link's date is fixed and says so.
                const expires =
                  state.kind === "expired"
                    ? `Expired ${formatDate(state.expiresAt)}`
                    : state.kind === "awaiting"
                      ? `${formatDate(state.unclaimedUntil)} if never played; ${state.daysAfterFirstPlay} days after the first play`
                      : state.kind === "played"
                        ? `${formatDate(state.expiresAt)} (first played ${formatDate(state.firstPlayedAt)})`
                        : `${formatDate(state.expiresAt)} (fixed date, made before the first-play rule)`;
                return (
                  <tr key={share.id} className="border-b border-white/5 last:border-b-0">
                    <td className="px-3 py-2 text-[#bfbfbf]">{share.code}</td>
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap items-center gap-2">
                        {share.video.title}
                        {share.video.isPlaceholder && <span className={PLACEHOLDER_BADGE}>Placeholder</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[#bfbfbf]">{categoryLabel(share.video.category)}</td>
                    <td className={`px-3 py-2 ${expired ? "text-[#667085]" : "text-[#bfbfbf]"}`}>{expires}</td>
                    <td className="px-3 py-2 text-right text-[#bfbfbf]">{share.viewCount}</td>
                    <td className="px-3 py-2 text-[#bfbfbf]">{formatDate(share.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );

  const notesSection = (
    <Section
      title="Notes"
      blurb="Internal, and the clinic never sees this. Every entry stays: a note is added, never edited or deleted, and every change made on this page (status, plan, details, branding, managed by Pulse) writes one on its own. So does a branding change the clinic's own admin makes, marked (clinic admin)."
    >
      <NoteForm clinicId={clinic.id} />
      {notes.length === 0 ? (
        <p className="mt-6 text-sm text-[#667085]">No notes yet.</p>
      ) : (
        <ol className="mt-6 flex flex-col gap-3">
          {notes.map((note) => (
            <li key={note.id} className="rounded-xl border border-white/10 bg-[#07090b] p-4">
              <p className="flex flex-wrap items-center gap-2 text-sm text-[#667085]">
                <span
                  className={`rounded-md px-2 py-0.5 text-[12px] font-medium uppercase tracking-wide ${
                    note.kind === "STATUS" ? "bg-[#2a829b]/20 text-[#5fb8d4]" : "bg-white/10 text-[#bfbfbf]"
                  }`}
                >
                  {note.kind === "STATUS" ? "Change" : "Note"}
                </span>
                <span className="text-[#bfbfbf]">{note.authorName}</span>
                <span>{formatDateTime(note.createdAt)}</span>
              </p>
              <p className="mt-2 whitespace-pre-wrap text-[15px] text-white">{note.body}</p>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );

  return (
    <main className="px-5 py-6 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6">
          <p className="text-sm text-[#667085]">
            <Link href="/pulse" className="hover:text-white">
              Clinics
            </Link>
            <span className="mx-2">/</span>
            <span className="text-[#bfbfbf]">{clinic.name}</span>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold sm:text-3xl">{clinic.name}</h1>
            <StatusBadge status={clinic.status} />
            {clinic.managedByPulse && (
              <span className="rounded-md bg-white/10 px-2 py-0.5 text-[13px] font-medium uppercase tracking-wide text-[#bfbfbf]">
                Managed by Pulse
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-[#667085]">
            Created {formatDate(clinic.createdAt)}
            {clinic.phone && <> · {formatUsPhone(clinic.phone)}</>}
            {!clinic.clerkOrgId && <> · Not linked to a Clerk organization yet</>}
          </p>
        </header>

        <ClinicTabs
          panels={[
            { id: "overview", label: "Overview", content: overview },
            { id: "plan", label: "Plan", content: plan },
            { id: "details", label: "Details", content: details },
            { id: "branding", label: "Branding", content: branding },
            { id: "people", label: "People", content: peopleSection },
            { id: "links", label: "Links", content: links },
            { id: "notes", label: `Notes${notes.length ? ` (${notes.length})` : ""}`, content: notesSection },
          ]}
        />
      </div>
    </main>
  );
}

function PeopleTable({ people }: { people: Person[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-[15px]">
        <thead className="text-xs uppercase tracking-wider text-[#667085]">
          <tr className="border-b border-white/10">
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Email</th>
            <th className="px-3 py-2 font-medium">Role</th>
            <th className="px-3 py-2 font-medium">Kind</th>
          </tr>
        </thead>
        <tbody>
          {people.map((person) => (
            <tr key={person.userId} className="border-b border-white/5 last:border-b-0">
              <td className="px-3 py-2">{person.name}</td>
              <td className="px-3 py-2 text-[#bfbfbf]">{person.email}</td>
              <td className="px-3 py-2 text-[#bfbfbf]">{person.role === "admin" ? "Admin" : "Member"}</td>
              <td className="px-3 py-2 text-[#bfbfbf]">{person.kind === "surgeon" ? "Surgeon" : person.kind === "staff" ? "Staff" : "Not set"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "KNEE" becomes "Knee". */
function categoryLabel(value: string) {
  return CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

/** One labelled fact in the Card billing section. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-[#667085]">{label}</dt>
      <dd className="mt-0.5 break-all">{children}</dd>
    </div>
  );
}

/** One accepted plan in a line: what, how many seats, how much, who accepted it. */
function planWords(plan: NonNullable<Awaited<ReturnType<typeof getClinicBilling>>>["currentPlan"]) {
  if (!plan) return "None";
  const categories = plan.entitledCategories.map(categoryLabel).join(", ");
  const seats = `${plan.surgeonSeats} ${plan.surgeonSeats === 1 ? "seat" : "seats"}`;
  const per = plan.interval === "YEAR" ? "year" : "month";
  return `${categories}; ${seats}; ${formatCents(plan.totalCents)} a ${per}; prices version ${plan.pricingVersion.version}; accepted by ${plan.acceptedByName} on ${formatDate(plan.createdAt)}`;
}
