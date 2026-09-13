import type { ClinicStatus } from "@prisma/client";
import { AdminsOnly } from "@/components/ui/AdminsOnly";
import { AppShell } from "@/components/ui/AppShell";
import { CATEGORIES } from "@/lib/categories";
import { requireClinicPage } from "@/lib/clinic";
import { clinicIsOpen } from "@/lib/clinic-status";
import { formatCents } from "@/lib/pricing";
import { AdminFrame } from "../AdminFrame";
import { getBillingView } from "./billing";

/**
 * Billing, at /admin/billing: the one place on the clinic side that shows
 * plan and price information. The categories on the plan, the surgeon
 * seats, and an honestly labelled estimate of what that comes to.
 *
 * Nothing here is a bill. Card payment does not exist yet, nothing has
 * been charged, and the page says so. Until billing opens there are no
 * controls on this page: no plan picker, no card form, no invoices. A
 * clinic managed by Pulse sees that its plan is handled by agreement.
 *
 * THIS PAGE STAYS OPEN WHEN THE CLINIC IS NOT. An admin of a PENDING,
 * PAUSED, PAST_DUE or CANCELED clinic must be able to see their plan and,
 * once billing exists, fix it here. So it checks that the person is an
 * admin, and does not check clinicIsOpen() the way every other admin page
 * does. Permission to see and repair billing is separate from permission
 * to use the library or make links; those still follow clinicIsOpen().
 *
 * Nothing on this page writes anything, so there are no actions to guard.
 */
export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const clinic = await requireClinicPage();

  // Members never see billing; it is an admin page.
  if (!clinic.isAdmin) {
    return (
      <AppShell>
        <AdminsOnly />
      </AppShell>
    );
  }

  // Deliberately no clinicIsOpen() check here: see the note above.
  const view = await getBillingView(clinic.id);
  const labels = view
    ? CATEGORIES.filter((category) => view.plan.categories.includes(category.value)).map((category) => category.label)
    : [];
  const managed = view?.plan.managedByPulse ?? false;

  return (
    <AdminFrame clinicName={clinic.name} title="Billing" intro="Your plan, and what it comes to. Nothing here is an invoice.">
      <StatusCard status={clinic.status} managed={managed} />

      <section aria-labelledby="plan-heading" className="mt-6 rounded-2xl border border-white/10 bg-[#0d1113] p-5 sm:p-6">
        <h2 id="plan-heading" className="text-lg font-semibold">
          Your plan
        </h2>
        {!view || !view.hasPlan ? (
          <p className="mt-2 text-[#bfbfbf]">
            {managed ? "Pulse 3D is setting your plan up with you." : "No plan yet. Choosing one here is coming; until then Pulse 3D sets it up with you."}
          </p>
        ) : (
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sm text-[#667085]">Categories</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {labels.map((label) => (
                  <li key={label} className="rounded-full border border-white/15 px-3 py-1 text-sm text-white">
                    {label}
                  </li>
                ))}
              </ul>
              {view.estimate?.fullLibrary && (
                <p className="mt-2 text-sm text-[#bfbfbf]">That is the full library: all current categories.</p>
              )}
            </div>
            <div>
              <p className="text-sm text-[#667085]">Surgeon seats</p>
              <p className="mt-1 text-[15px] text-white">
                {view.plan.surgeonSeats} {view.plan.surgeonSeats === 1 ? "surgeon" : "surgeons"}
              </p>
              <p className="mt-1 text-sm text-[#667085]">Office staff are never charged. Who counts as a surgeon is set on the People page.</p>
            </div>
          </div>
        )}
        {managed && (
          <p className="mt-4 text-sm text-[#bfbfbf]">
            Your plan is managed by Pulse 3D and invoiced by agreement. To change categories or seats, get in touch with Pulse 3D.
          </p>
        )}
      </section>

      {view?.hasPlan && (
        <section aria-labelledby="estimate-heading" className="mt-6 rounded-2xl border border-white/10 bg-[#0d1113] p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="estimate-heading" className="text-lg font-semibold">
              What it comes to
            </h2>
            <span className="rounded-md bg-white/10 px-2 py-0.5 text-[13px] font-medium uppercase tracking-wide text-[#bfbfbf]">Estimate</span>
          </div>

          {view.problem ? (
            <p className="mt-2 text-[#bfbfbf]">{view.problem}</p>
          ) : view.estimate?.band === "enterprise" ? (
            <p className="mt-2 text-[#bfbfbf]">Priced by agreement with Pulse 3D. {view.estimate.notes.join(" ")}</p>
          ) : view.estimate ? (
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-sm text-[#667085]">Per month</p>
                <p className="mt-1 text-2xl font-semibold text-[#5fb8d4]">{formatCents(view.estimate.monthlyCents ?? 0)}</p>
              </div>
              <div>
                <p className="text-sm text-[#667085]">Per year</p>
                <p className="mt-1 text-2xl font-semibold text-[#5fb8d4]">{formatCents(view.estimate.yearlyCents ?? 0)}</p>
              </div>
            </div>
          ) : null}

          <p className="mt-4 text-sm text-[#667085]">
            {managed
              ? "An estimate from the plan on file, not your invoice. Pulse 3D invoices your clinic by agreement."
              : "An estimate from the plan on file. It is not an invoice, and nothing has been charged: card payment is not set up yet."}
          </p>
        </section>
      )}

      <section aria-labelledby="next-heading" className="mt-6 rounded-2xl border border-dashed border-white/15 p-5 sm:p-6">
        <h2 id="next-heading" className="text-lg font-semibold">
          {managed ? "Changes to your plan" : "Coming here"}
        </h2>
        <p className="mt-2 text-[#bfbfbf]">
          {managed
            ? "Pulse 3D manages this plan, so there is nothing to set up here. Questions about your invoice go to Pulse 3D."
            : "Choosing a plan, paying by card, changing seats or categories, and your invoices. Until then, Pulse 3D sets clinics up by hand."}
        </p>
      </section>
    </AdminFrame>
  );
}

/** Where the clinic stands, in one line, with what it means for the rest of the app. */
function StatusCard({ status, managed }: { status: ClinicStatus; managed: boolean }) {
  const open = clinicIsOpen(status);
  const { label, body } = STATUS_COPY[status];
  return (
    <section
      aria-labelledby="status-heading"
      className={`mt-6 rounded-2xl border px-5 py-4 ${open ? "border-white/10 bg-[#0d1113]" : "border-[#f3b94d]/40 bg-[#f3b94d]/10"}`}
    >
      <h2 id="status-heading" className="flex flex-wrap items-center gap-3 text-lg font-semibold">
        Status
        <span
          className={`rounded-md px-2 py-0.5 text-[13px] font-medium uppercase tracking-wide ${
            open ? "bg-[#2a829b]/20 text-[#5fb8d4]" : "bg-[#f3b94d]/20 text-[#f3b94d]"
          }`}
        >
          {label}
        </span>
      </h2>
      <p className="mt-2 text-[15px] text-[#bfbfbf]">{body}</p>
      {!open && managed && <p className="mt-2 text-[15px] text-[#bfbfbf]">Your plan is managed by Pulse 3D, so get in touch with Pulse 3D to sort this out.</p>}
    </section>
  );
}

const STATUS_COPY: Record<ClinicStatus, { label: string; body: string }> = {
  PENDING: {
    label: "Pending",
    body: "Your clinic is set up but not on a plan yet, so the library and shared links are not open. Plans are coming soon; until they open, Pulse 3D switches clinics on by hand: get in touch and we will turn yours on.",
  },
  ACTIVE: {
    label: "Active",
    body: "Your clinic is on a plan. The library and shared links are open.",
  },
  PAUSED: {
    label: "Paused",
    body: "Your plan is paused, so the library and shared links are off. Links patients already have keep working until they expire.",
  },
  PAST_DUE: {
    label: "Past due",
    body: "Your last payment did not go through, so the library and shared links are off. Updating the payment method will live here once billing opens; until then, get in touch with Pulse 3D.",
  },
  CANCELED: {
    label: "Ended",
    body: "Your plan has ended, so the library and shared links are off. Your people and settings are kept. Starting again will live here once billing opens; until then, get in touch with Pulse 3D.",
  },
};
