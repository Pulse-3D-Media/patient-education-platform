import { ClerkFailed, ClerkLoading } from "@clerk/nextjs";

/**
 * What sits under Clerk's sign-in form in the landing page's box: the line
 * for patients from the design, and two states Clerk's form cannot show for
 * itself, because they happen before it exists.
 *
 * - While Clerk's script is still on its way, a quiet line, so the box is
 *   never an empty white panel.
 * - If Clerk's script never arrives (no connection, or Clerk is down), a
 *   plain sentence and what to do, never a blank box.
 */
export function SignInExtras({ patientLine = true }: { patientLine?: boolean }) {
  return (
    <>
      <ClerkLoading>
        <p role="status" className="py-6 text-center text-[0.9375rem] text-ink-muted">
          Loading sign-in…
        </p>
      </ClerkLoading>
      <ClerkFailed>
        <p role="alert" className="py-4 text-[0.9375rem] font-medium text-problem">
          We could not reach sign-in just now. Check your connection and reload the page.
        </p>
      </ClerkFailed>
      {patientLine ? <p className="mt-4 text-center text-[0.8125rem] text-ink-muted">Patient with a link? Just open it. No account needed.</p> : null}
    </>
  );
}
