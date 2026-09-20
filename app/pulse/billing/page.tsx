import Link from "next/link";
import { BILLING_EVENT_LIMIT, countBillingEventsNeedingAttention, listBillingEvents, needsAttention, type BillingEventRow } from "@/lib/db/billing";
import { requirePulseStaff } from "@/lib/pulse";
import { isTestSecretKey } from "@/lib/stripe";
import { formatDateTime } from "../ui";
import { RetryButton } from "./RetryButton";

/**
 * Billing diagnostics: what became of each notification Stripe sent.
 *
 * For finding the ones that are stuck: written down but never finished,
 * failed and waiting for Stripe to send them again, or finished with a note
 * that a person should check something in Stripe. Try again asks Stripe
 * where the subscription stands now and applies that, the same as a fresh
 * delivery would.
 *
 * What is NOT here, on purpose: the body of any notification (never
 * stored), any key or signing secret, and error messages (only the kind of
 * error is kept). Whether the two Stripe settings are present is shown as
 * yes or no, never their values.
 *
 * Staff only. Rendered fresh on every request. The list is bounded.
 */
export const dynamic = "force-dynamic";

const STATUS_LOOK: Record<BillingEventRow["status"], { label: string; className: string }> = {
  RECEIVED: { label: "Not finished", className: "bg-[#f3b94d]/20 text-[#f3b94d]" },
  FAILED: { label: "Failed", className: "bg-[#f87171]/15 text-[#f87171]" },
  PROCESSED: { label: "Done", className: "bg-[#2a829b]/20 text-[#5fb8d4]" },
  IGNORED: { label: "Nothing to do", className: "bg-white/10 text-[#bfbfbf]" },
};

export default async function PulseBillingPage({ searchParams }: PageProps<"/pulse/billing">) {
  await requirePulseStaff();

  const params = await searchParams;
  const attentionOnly = params.show !== "all";
  const now = new Date();
  const [events, attentionCount] = await Promise.all([listBillingEvents({ attention: attentionOnly }, now), countBillingEventsNeedingAttention(now)]);

  const keySet = isTestSecretKey(process.env.STRIPE_SECRET_KEY);
  const secretSet = Boolean(process.env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_"));

  return (
    <main className="px-5 py-6 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <header>
          <h1 className="text-2xl font-semibold sm:text-3xl">Billing</h1>
          <p className="mt-1 max-w-2xl text-[#bfbfbf]">
            Notifications from Stripe and what became of each. Stripe runs in test mode only: no real card is charged. Nothing here shows a key, a
            secret or what a notification contained.
          </p>
        </header>

        <section className="mt-6 rounded-2xl border border-white/10 bg-[#0d1113] p-5 sm:p-6">
          <h2 className="text-lg font-semibold">Set up on this deployment</h2>
          <ul className="mt-3 space-y-1 text-[15px] text-[#bfbfbf]">
            <li>Stripe test key: {keySet ? "set" : "not set (or not a test key), so Stripe cannot be asked anything"}</li>
            <li>Webhook signing secret: {secretSet ? "set" : "not set, so every notification is turned away until it is"}</li>
          </ul>
        </section>

        <div className="mt-8 flex flex-wrap items-center gap-2">
          <FilterLink href="/pulse/billing" active={attentionOnly}>
            Needs attention ({attentionCount})
          </FilterLink>
          <FilterLink href="/pulse/billing?show=all" active={!attentionOnly}>
            Newest {BILLING_EVENT_LIMIT}
          </FilterLink>
        </div>

        {events.length === 0 ? (
          <p className="mt-6 rounded-2xl border border-dashed border-white/15 p-6 text-[#bfbfbf]">
            {attentionOnly ? "Nothing needs attention." : "No notifications have arrived yet."}
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-[#0d1113]">
            <table className="w-full min-w-[760px] text-left text-[15px]">
              <thead className="text-xs uppercase tracking-wider text-[#667085]">
                <tr className="border-b border-white/10">
                  <th className="px-4 py-3 font-medium">Arrived</th>
                  <th className="px-4 py-3 font-medium">Kind</th>
                  <th className="px-4 py-3 font-medium">Clinic</th>
                  <th className="px-4 py-3 font-medium">What became of it</th>
                  <th className="px-4 py-3 font-medium">Tries</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {events.map((event) => {
                  const look = STATUS_LOOK[event.status];
                  const stuck = needsAttention(event, now);
                  return (
                    <tr key={event.id} className="border-b border-white/5 align-top last:border-b-0">
                      <td className="whitespace-nowrap px-4 py-3 text-[#bfbfbf]">{formatDateTime(event.receivedAt)}</td>
                      <td className="px-4 py-3">{event.type}</td>
                      <td className="px-4 py-3">
                        {event.clinicId ? (
                          <Link href={`/pulse/clinics/${event.clinicId}`} className="text-[#5fb8d4] hover:underline">
                            Open clinic
                          </Link>
                        ) : (
                          <span className="text-[#667085]">None found</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-md px-2 py-0.5 text-[13px] font-medium uppercase tracking-wide ${look.className}`}>
                          {look.label}
                        </span>
                        {event.outcome && <p className="mt-1 max-w-md text-sm text-[#bfbfbf]">{event.outcome}</p>}
                        {event.lastErrorCode && <p className="mt-1 text-sm text-[#bfbfbf]">Kind of error: {event.lastErrorCode}</p>}
                      </td>
                      <td className="px-4 py-3 text-[#bfbfbf]">{event.attempts}</td>
                      <td className="px-4 py-3">{stuck && (event.status === "FAILED" || event.status === "RECEIVED") && <RetryButton eventId={event.id} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 max-w-2xl text-sm text-[#667085]">
          A failed notification is sent again by Stripe on its own (three times over a few hours in test mode). Not finished means it was written down
          and the work did not complete; after ten minutes it is listed here. Try again is safe to press more than once.
        </p>
      </div>
    </main>
  );
}

function FilterLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex h-11 items-center rounded-lg border px-4 text-[15px] font-medium ${
        active ? "border-[#2a829b] bg-[#2a829b]/15 text-white" : "border-white/15 text-[#bfbfbf] hover:border-[#2a829b]"
      }`}
    >
      {children}
    </Link>
  );
}
