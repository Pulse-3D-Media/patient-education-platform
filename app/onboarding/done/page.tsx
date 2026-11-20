import Link from "next/link";
import { redirect } from "next/navigation";
import { Confirming } from "@/app/admin/billing/return/Confirming";
import { SignUpFrame } from "@/components/sign-up/SignUpFrame";
import { requireClinicPage } from "@/lib/clinic";
import { clinicIsOpen } from "@/lib/clinic-status";
import { getCheckoutFacts } from "@/lib/db/billing";
import { SIGN_UP_PATHS } from "@/lib/sign-up-steps";

/**
 * Where Stripe sends a new clinic's owner after paying on the sign-up steps:
 * /onboarding/done. The sign-up twin of /admin/billing/return.
 *
 * ARRIVING HERE PROVES NOTHING AND CHANGES NOTHING. Anybody can type this
 * address. The page reads the clinic's billing record on the server and:
 *
 *   paid and open    sends the owner to the library with the welcome dialog
 *                    (/library?welcome=1); any other admin just to the library
 *   confirming       shows "Confirming your payment" and looks again a few
 *                    times (the same Confirming part as the Billing return
 *                    page), then offers Check again
 *   paid, not open   a plain sentence and the way to Billing (Pulse staff
 *                    paused the clinic by hand, say)
 *   anything else    Billing, which says where the clinic stands
 *
 * The clinic opens only when Stripe says the invoice was paid (the webhook,
 * or Check again running the same rules), exactly as before. The welcome
 * dialog is never shown before the server says the clinic is open, because
 * this page only sends the owner there once it does.
 */
export const dynamic = "force-dynamic";

export default async function SignUpDonePage() {
  const clinic = await requireClinicPage();
  if (!clinic.isAdmin) redirect("/library");

  const record = await getCheckoutFacts(clinic.id);
  const status = record?.facts.status ?? "NONE";
  const open = clinicIsOpen(clinic);

  if (status === "ACTIVE" && open) redirect(clinic.isOwner ? "/library?welcome=1" : "/library");

  const waiting = status === "INCOMPLETE" || (status !== "ACTIVE" && status !== "PAST_DUE" && Boolean(record?.pendingPlan));
  if (status !== "ACTIVE" && !waiting) redirect("/admin/billing");

  return (
    <SignUpFrame step="payment">
      <section aria-labelledby="done-heading" className="mx-auto max-w-[884px]">
        {status === "ACTIVE" ? (
          <>
            <h1 id="done-heading" className="text-[2.25rem] font-semibold leading-tight tracking-[-0.02em] text-ink">
              Payment confirmed
            </h1>
            <p className="mt-3 text-base text-ink-soft">Stripe has confirmed your payment. Your clinic is not open yet for a separate reason, which the Billing page explains.</p>
            <Link href="/admin/billing" className="mt-6 inline-flex min-h-[48px] items-center rounded-xl bg-brand px-6 text-base font-semibold text-on-brand hover:bg-brand-hover">
              Go to billing
            </Link>
          </>
        ) : (
          <>
            <h1 id="done-heading" className="text-[2.25rem] font-semibold leading-tight tracking-[-0.02em] text-ink">
              Confirming your payment
            </h1>
            <Confirming />
            <p className="mt-6 text-sm text-ink-soft">
              Did not pay, or closed Stripe&rsquo;s page?{" "}
              <Link href={`${SIGN_UP_PATHS.payment}?stopped=1`} className="font-medium text-brand-bright underline underline-offset-2">
                Go back to payment
              </Link>
              . Nothing is charged unless you finish on Stripe&rsquo;s page.
            </p>
          </>
        )}
      </section>
    </SignUpFrame>
  );
}
