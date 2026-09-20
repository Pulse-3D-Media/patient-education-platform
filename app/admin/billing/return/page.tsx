import Link from "next/link";
import { AdminsOnly } from "@/components/ui/AdminsOnly";
import { ClinicShell } from "@/components/ui/ClinicShell";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "@/components/ui/styles";
import { requireClinicPage } from "@/lib/clinic";
import { clinicIsOpen } from "@/lib/clinic-status";
import { getCheckoutFacts } from "@/lib/db/billing";
import { AdminFrame } from "../../AdminFrame";
import { Confirming } from "./Confirming";

/**
 * Where Stripe sends an admin back to after the payment page:
 * /admin/billing/return.
 *
 * ARRIVING HERE PROVES NOTHING AND CHANGES NOTHING. Anybody can type this
 * address. The page reads the clinic's billing record on the server, the
 * same record the rest of the app reads, and says what it finds:
 *
 *   confirmed     the record says the subscription is paid
 *   waiting       a plan was accepted and no confirmed payment has arrived
 *                 yet: look again a few times, then offer Check again
 *   failed        the record says a payment failed
 *   nothing       there is no checkout to confirm
 *
 * What opens the clinic is the billing rules acting on what Stripe says
 * about the subscription (lib/db/billing.ts), whether or not this page is
 * ever opened. An admin who pays and closes the browser loses nothing.
 *
 * Like the rest of Billing, it is open to the admin of a clinic that is not
 * open: that is who has just paid.
 */
export const dynamic = "force-dynamic";

export default async function CheckoutReturnPage() {
  const clinic = await requireClinicPage();
  if (!clinic.isAdmin) {
    return (
      <ClinicShell clinic={clinic}>
        <AdminsOnly billing />
      </ClinicShell>
    );
  }

  const facts = await getCheckoutFacts(clinic.id);
  const status = facts?.facts.status ?? "NONE";
  const waiting = status === "INCOMPLETE" || (status !== "ACTIVE" && status !== "PAST_DUE" && Boolean(facts?.pendingPlan));
  const open = clinicIsOpen(clinic);

  return (
    <AdminFrame clinic={clinic} title="Billing" intro="Your payment, as Stripe reports it to us.">
      <section aria-labelledby="return-heading" className="mt-6 rounded-2xl border border-line bg-surface p-5 sm:p-6">
        {status === "ACTIVE" ? (
          <>
            <h2 id="return-heading" className="text-lg font-semibold">
              Payment confirmed
            </h2>
            <p className="mt-2 text-ink-soft">
              {open
                ? "Stripe has confirmed your payment and your plan has started. The library and shared links are open."
                : "Stripe has confirmed your payment. Your clinic is not open yet for a separate reason, which the Billing page explains."}
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              {open && (
                <Link href="/library" className={PRIMARY_BUTTON}>
                  Open the library
                </Link>
              )}
              <Link href="/admin/billing" className={SECONDARY_BUTTON}>
                See your plan
              </Link>
            </div>
          </>
        ) : waiting ? (
          <>
            <h2 id="return-heading" className="text-lg font-semibold">
              Confirming your payment
            </h2>
            <Confirming />
            <p className="mt-5 text-sm text-ink-muted">
              Did not pay, or closed Stripe&rsquo;s page?{" "}
              <Link href="/admin/billing" className="font-medium text-brand-bright underline underline-offset-2">
                Go back to your plan
              </Link>
              . Nothing is charged unless you finish on Stripe&rsquo;s page.
            </p>
          </>
        ) : status === "PAST_DUE" ? (
          <>
            <h2 id="return-heading" className="text-lg font-semibold">
              Your last payment did not go through
            </h2>
            <p className="mt-2 text-ink-soft">The Billing page says where your clinic stands and what to do next.</p>
            <Link href="/admin/billing" className={`mt-5 ${PRIMARY_BUTTON}`}>
              Go to billing
            </Link>
          </>
        ) : (
          <>
            <h2 id="return-heading" className="text-lg font-semibold">
              Nothing to confirm
            </h2>
            <p className="mt-2 text-ink-soft">There is no checkout waiting for your clinic. Nothing has been charged.</p>
            <Link href="/admin/billing" className={`mt-5 ${PRIMARY_BUTTON}`}>
              Go to billing
            </Link>
          </>
        )}
      </section>
    </AdminFrame>
  );
}
