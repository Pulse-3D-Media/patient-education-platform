"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Category } from "@/lib/categories";
import { planHref, SIGN_UP_PATHS } from "@/lib/sign-up-steps";
import { checkoutDestination, isTestPublishableKey, STRIPE_JS_URL } from "@/lib/stripe-pages";
import { startSignUpCardAction } from "@/app/admin/billing/actions";

/**
 * Stripe's card form, drawn inside our own sign-up payment step (Evan, 2026-11-20:
 * "can we not put the card capture on here?").
 *
 * HOW IT WORKS, in plain words:
 *
 *   1. When the page opens, this asks our server for a payment page, exactly as
 *      "Pay" did before (startSignUpCardAction: the same checks, the same prices
 *      worked out on the server, the same one-attempt and one-first-payment
 *      guards). Instead of an address on Stripe's site, the server answers with
 *      a one-time value that lets Stripe draw that one payment page here.
 *   2. Stripe's own script (loaded from js.stripe.com, never copied into our
 *      files) draws the form inside a frame that belongs to Stripe. The card
 *      number, the date and the three digits are typed into Stripe's frame and
 *      go straight to Stripe. Our page, our server, our logs and our database
 *      never see them.
 *   3. Stripe's frame has its own Pay button, the express buttons (Apple Pay,
 *      Google Pay, Link) the Stripe account offers, its own message for a
 *      declined card, and its own bank check (3-D Secure) when a card needs one.
 *   4. When Stripe says the payment went through, this goes to /onboarding/done,
 *      which still waits for Stripe's notification that the invoice was PAID
 *      before the clinic opens. Nothing here opens anything.
 *
 * Opening the page again, in a second tab, or after a refresh gets the same
 * payment page back from the server, so a second subscription cannot be made
 * this way. If the payment already went through, the server says so and this
 * goes straight to /onboarding/done.
 *
 * TEST MODE ONLY: it draws nothing with a publishable key that is not "pk_test_"
 * (the page checks too, and falls back to Stripe's hosted page). The page itself
 * is only reachable where checkout is open, so on the production deployment
 * neither this nor Stripe's script is ever loaded.
 */

/** The few parts of Stripe's browser script this uses (Stripe's own names). */
type StripeEmbeddedCheckout = { mount(target: HTMLElement): void; destroy(): void };
type StripeJs = {
  createEmbeddedCheckoutPage(options: { fetchClientSecret: () => Promise<string>; onComplete?: () => void }): Promise<StripeEmbeddedCheckout>;
};
type StripeFactory = (publishableKey: string) => StripeJs;

declare global {
  interface Window {
    Stripe?: StripeFactory;
  }
}

/** Stripe's script is added to the page once, the first time the form is drawn, and kept for a second try. */
let scriptLoading: Promise<StripeFactory> | null = null;

function loadStripeScript(): Promise<StripeFactory> {
  if (window.Stripe) return Promise.resolve(window.Stripe);
  scriptLoading ??= new Promise<StripeFactory>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = STRIPE_JS_URL;
    script.async = true;
    script.onload = () => (window.Stripe ? resolve(window.Stripe) : reject(new Error("Stripe's script loaded without Stripe in it.")));
    script.onerror = () => {
      // Forget the failed try, so Try again adds the script afresh.
      scriptLoading = null;
      script.remove();
      reject(new Error("Stripe's script could not be loaded."));
    };
    document.head.appendChild(script);
  });
  return scriptLoading;
}

/**
 * Stripe allows one card form on a page at a time. The one on screen now, so a
 * new one (Try again, or React drawing the page twice while developing) first
 * takes the old one down.
 */
let onScreen: StripeEmbeddedCheckout | null = null;

type Phase =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "finishing" }
  /** The total moved since the page was drawn: show the sentence and a way to load the page again. */
  | { kind: "changed"; message: string }
  | { kind: "problem"; message: string; signIn?: boolean };

/** The sentence when the form could not be drawn for a reason that is not the server's to explain. */
const NOT_LOADED = "The card form could not be loaded just now. Nothing was charged. Try again in a moment.";

export function CardForm({
  plan,
  versionId,
  totalCents,
  publishableKey,
}: {
  plan: { categories: Category[]; seats: number; interval: "MONTH" | "YEAR" };
  versionId: string;
  totalCents: number;
  /** Stripe's test publishable key, read on the server (NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY). */
  publishableKey: string;
}) {
  const router = useRouter();
  const target = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  // Pressing Try again adds one, which draws the form afresh.
  const [tries, setTries] = useState(0);

  // The picks, joined, so the effect below runs again only when the plan itself changes.
  const categories = plan.categories.join(",");

  useEffect(() => {
    let cancelled = false;
    let mine: StripeEmbeddedCheckout | null = null;

    async function draw() {
      // Never with a live key (the page has already checked; this is the browser checking again).
      if (!isTestPublishableKey(publishableKey)) {
        setPhase({ kind: "problem", message: NOT_LOADED });
        return;
      }
      try {
        // What was picked and which total was on screen. The server works the price out again and never charges these.
        const form = new FormData();
        for (const category of categories.split(",")) form.append("categories", category);
        form.append("seats", String(plan.seats));
        form.append("interval", plan.interval);
        form.append("seenVersionId", versionId);
        form.append("seenTotalCents", String(totalCents));

        const [factory, answer] = await Promise.all([loadStripeScript(), startSignUpCardAction(form)]);
        if (cancelled) return;

        // Already paid (a refresh after paying, say): the server sends us to the page that confirms it.
        if (answer?.redirectTo) {
          const destination = checkoutDestination(answer.redirectTo);
          if (destination?.kind === "here") router.push(destination.path);
          else setPhase({ kind: "problem", message: NOT_LOADED });
          return;
        }
        if (answer?.changed) return setPhase({ kind: "changed", message: answer.changed });
        if (answer?.error) return setPhase({ kind: "problem", message: answer.error, signIn: answer.signIn });
        const clientSecret = answer?.clientSecret;
        if (!clientSecret) return setPhase({ kind: "problem", message: NOT_LOADED });

        onScreen?.destroy();
        onScreen = null;
        mine = await factory(publishableKey).createEmbeddedCheckoutPage({
          fetchClientSecret: async () => clientSecret,
          // Stripe says the payment went through. The clinic still opens only when Stripe's notification says
          // the invoice was paid; /onboarding/done waits for that and says so.
          onComplete: () => {
            setPhase({ kind: "finishing" });
            router.push(SIGN_UP_PATHS.done);
          },
        });
        if (cancelled || !target.current) {
          mine.destroy();
          mine = null;
          return;
        }
        onScreen = mine;
        mine.mount(target.current);
        setPhase({ kind: "ready" });
      } catch {
        // Only the kind of failure would be worth logging, and the server logs its own; the person gets a sentence.
        if (!cancelled) setPhase({ kind: "problem", message: NOT_LOADED });
      }
    }

    void draw();
    return () => {
      cancelled = true;
      if (mine) {
        mine.destroy();
        if (onScreen === mine) onScreen = null;
      }
    };
  }, [categories, plan.seats, plan.interval, versionId, totalCents, publishableKey, tries, router]);

  return (
    <div>
      {phase.kind === "problem" && (
        <div role="alert" className="mb-4 flex gap-3 rounded-xl border border-warn/40 bg-warn/10 px-5 py-4 text-[15px] text-ink">
          <span aria-hidden="true" className="text-warn">
            ⚠
          </span>
          <div>
            <p>{phase.message}</p>
            <div className="mt-3 flex flex-wrap gap-3">
              {phase.signIn ? (
                <a href={`/sign-in?redirect_url=${encodeURIComponent(planHref(plan))}`} className="font-semibold text-brand-bright underline underline-offset-2">
                  Sign in
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setPhase({ kind: "loading" });
                    setTries((n) => n + 1);
                  }} className="font-semibold text-brand-bright underline underline-offset-2">
                  Try again
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {phase.kind === "changed" && (
        <div role="alert" className="mb-4 rounded-xl border border-warn/40 bg-warn/10 px-5 py-4 text-[15px] text-ink">
          <p>{phase.message}</p>
          <button
            type="button"
            onClick={() => {
              setPhase({ kind: "loading" });
              router.refresh();
            }} className="mt-3 font-semibold text-brand-bright underline underline-offset-2">
            Show the new total
          </button>
        </div>
      )}

      {/* Stripe's frame goes in here. It sets its own height; the box only keeps the page from jumping while it loads.
          Hidden (never removed, so Try again can draw into it) while a sentence above says the form is not there. */}
      <div className={`relative min-h-[420px] overflow-hidden rounded-xl border border-line bg-white ${phase.kind === "problem" || phase.kind === "changed" ? "hidden" : ""}`}>
        {(phase.kind === "loading" || phase.kind === "finishing") && (
          <p aria-live="polite" className="absolute inset-x-0 top-10 text-center text-[15px] text-ink-soft">
            {phase.kind === "loading" ? "Loading the secure card form..." : "Payment sent. Confirming it with Stripe..."}
          </p>
        )}
        <div ref={target} data-card-form="" />
      </div>
    </div>
  );
}
