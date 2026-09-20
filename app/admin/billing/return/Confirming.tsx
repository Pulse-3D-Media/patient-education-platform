"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { SECONDARY_BUTTON } from "@/components/ui/styles";
import { checkPaymentAction } from "../actions";

/**
 * What the return page shows while a payment is not confirmed yet.
 *
 * Coming back from Stripe proves nothing, so this page grants nothing. It
 * only LOOKS: every few seconds it asks the server to draw the page again,
 * and the server reads the clinic's billing record. When Stripe's
 * notification has arrived and been applied, the page that comes back is
 * the "confirmed" one and this component is gone.
 *
 * Bounded on purpose. It looks a fixed number of times and then stops, so a
 * tab left open does not ask for ever. After that there is a Check again
 * button, which asks Stripe directly where the payment stands (for when the
 * notification is slow, or cannot reach this site at all). That is bounded
 * too. None of it starts another checkout.
 */

/** How many times the page looks by itself, and how far apart. About 24 seconds in all. */
const AUTO_LOOKS = 6;
const LOOK_EVERY_MS = 4000;
/** How many times Check again may be pressed before the page says to get in touch instead. */
const MANUAL_CHECKS = 6;

export function Confirming() {
  const router = useRouter();
  const [looks, setLooks] = useState(0);
  const [checks, setChecks] = useState(0);
  const [note, setNote] = useState<{ text: string; problem: boolean } | null>(null);
  const [checking, startCheck] = useTransition();

  useEffect(() => {
    if (looks >= AUTO_LOOKS) return;
    const timer = window.setTimeout(() => {
      router.refresh();
      setLooks((count) => count + 1);
    }, LOOK_EVERY_MS);
    return () => window.clearTimeout(timer);
  }, [looks, router]);

  const looking = looks < AUTO_LOOKS;

  const checkAgain = () =>
    startCheck(async () => {
      setChecks((count) => count + 1);
      const result = await checkPaymentAction();
      setNote(result?.error ? { text: result.error, problem: true } : { text: result?.message ?? "", problem: false });
      router.refresh();
    });

  return (
    <div className="mt-4">
      <p className="text-[15px] text-ink-soft" aria-live="polite">
        {looking
          ? "Waiting for Stripe to confirm the payment. This usually takes a few seconds."
          : "Stripe has not confirmed the payment yet. You can close this page: if the payment went through, your clinic opens by itself as soon as Stripe tells us."}
      </p>

      {!looking && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={checkAgain} disabled={checking || checks >= MANUAL_CHECKS} className={SECONDARY_BUTTON}>
            {checking ? "Checking..." : "Check again"}
          </button>
          <span aria-live="polite" className={`text-[15px] ${note?.problem ? "text-warn" : "text-ink-soft"}`}>
            {checks >= MANUAL_CHECKS && !checking ? "That is enough checking for now. If you paid and this still says waiting, get in touch with Pulse 3D." : note?.text}
          </span>
        </div>
      )}
    </div>
  );
}
