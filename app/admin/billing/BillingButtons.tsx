"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "@/components/ui/styles";
import { STRIPE_INVOICE_PREFIX, STRIPE_PORTAL_PREFIX } from "@/lib/stripe-pages";
import { cancelWaitingChangeAction, checkWithStripeAction, openBillingPortalAction, payInvoiceAction, type BillingActionState } from "./actions";

/**
 * The buttons on /admin/billing that are not the plan form: open Stripe's
 * billing page, pay an unpaid invoice, cancel a change that is waiting, and
 * ask Stripe where things stand.
 *
 * Each one asks the server and shows what it said in plain words beside the
 * button. A button being drawn is a courtesy: every action checks again who
 * is asking before it does anything (rule 8 in CLAUDE.md).
 */

/** Send the browser to an address the server returned, but only if it really is one of Stripe's two hosted pages. */
function leaveForStripe(url: string): boolean {
  if (!url.startsWith(STRIPE_PORTAL_PREFIX) && !url.startsWith(STRIPE_INVOICE_PREFIX)) return false;
  window.location.assign(url);
  return true;
}

function useBillingAction(run: () => Promise<BillingActionState>) {
  const router = useRouter();
  const [note, setNote] = useState<{ text: string; problem: boolean } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [working, startWork] = useTransition();
  const press = () =>
    startWork(async () => {
      setNote(null);
      const result = await run();
      if (result?.redirectTo && leaveForStripe(result.redirectTo)) {
        setLeaving(true);
        return;
      }
      if (result?.error) setNote({ text: result.error, problem: true });
      else if (result?.message) setNote({ text: result.message, problem: false });
      else setNote({ text: "That could not be done just now. Try again in a moment.", problem: true });
      router.refresh();
    });
  return { press, note, busy: working || leaving, leaving };
}

function Note({ note }: { note: { text: string; problem: boolean } | null }) {
  return (
    <span aria-live="polite" className={`text-[15px] ${note?.problem ? "text-warn" : "text-ink-soft"}`}>
      {note?.text}
    </span>
  );
}

/** "Open Stripe's billing page": update the card, see invoices, cancel. */
export function PortalButton({ primary = false }: { primary?: boolean }) {
  const { press, note, busy, leaving } = useBillingAction(openBillingPortalAction);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={press} disabled={busy} className={primary ? PRIMARY_BUTTON : SECONDARY_BUTTON}>
        {leaving ? "Opening Stripe..." : "Open Stripe’s billing page"}
      </button>
      <Note note={note} />
    </div>
  );
}

/** "Pay now": Stripe's page for the unpaid invoice (a failed renewal, or an upgrade waiting for its payment). */
export function PayInvoiceButton({ label = "Pay now on Stripe’s page" }: { label?: string }) {
  const { press, note, busy, leaving } = useBillingAction(payInvoiceAction);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={press} disabled={busy} className={PRIMARY_BUTTON}>
        {leaving ? "Opening Stripe..." : label}
      </button>
      <Note note={note} />
    </div>
  );
}

/** "Cancel this change": the one scheduled for the renewal, or the upgrade waiting for its payment. */
export function CancelChangeButton({ which }: { which: "scheduled" | "payment" }) {
  const { press, note, busy } = useBillingAction(() => cancelWaitingChangeAction(which));
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={press} disabled={busy} className={SECONDARY_BUTTON}>
        {busy ? "Cancelling..." : "Cancel this change"}
      </button>
      <Note note={note} />
    </div>
  );
}

/**
 * "Check with Stripe": ask Stripe where the subscription stands and bring
 * this page into line, instead of waiting to be told. For after a visit to
 * Stripe's pages, and for a deployment Stripe's notifications cannot reach.
 * It runs the same rules the notifications run and is safe to press again.
 */
export function CheckWithStripeButton() {
  const { press, note, busy } = useBillingAction(checkWithStripeAction);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={press} disabled={busy} className={SECONDARY_BUTTON}>
        {busy ? "Checking..." : "Check with Stripe"}
      </button>
      <Note note={note} />
    </div>
  );
}
