import Link from "next/link";
import type { ReactNode } from "react";
import { LOGO_HEIGHT, LOGO_URL, LOGO_WIDTH } from "@/lib/brand";
import { PULSE_STAFF_LIGHT_THEME, themeVars } from "@/lib/branding";
import { SIGN_UP_STEPS, stepState, stepsDone, type SignUpStepKey } from "@/lib/sign-up-steps";

/**
 * The frame around the sign-up steps after the email code (the approved
 * design, screens 02-signup-2, 3 and 3b): the Pulse 3D logo and "Finish
 * later" across the top, the progress list on the left ("Signing up", a bar,
 * Email, Plan, Payment), and the step itself on the right.
 *
 * It shows ONLY the three sign-up steps, never the app's menu, and nothing
 * runs across the top but the logo. On a phone the list folds into one line
 * under the top bar ("Signing up", the bar, "Step 2 of 3: Plan"), as drawn.
 *
 * "Finish later" goes to the clinic's Billing page: the clinic already
 * exists, nothing is lost, and Billing is where a plan can be chosen at any
 * time (and the page every closed clinic's admin is sent to anyway).
 *
 * Always light, in the Pulse colours, like the landing page before it.
 */
export function SignUpFrame({
  step,
  backToPlan,
  children,
}: {
  step: SignUpStepKey;
  /**
   * On the payment step: the plan step's address with the plan as picked (the same one its Back button uses),
   * which makes "Plan" in the list a link (Evan, 2026-11-20). Email stays a plain line: the account is made.
   */
  backToPlan?: string;
  children: ReactNode;
}) {
  const done = stepsDone(step);
  const total = SIGN_UP_STEPS.length;
  const currentIndex = SIGN_UP_STEPS.findIndex((entry) => entry.key === step);
  const currentLabel = SIGN_UP_STEPS[currentIndex]?.label ?? "";

  const bar = (
    <div
      role="progressbar"
      aria-label="Sign-up progress"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      className="h-1.5 flex-1 overflow-hidden rounded-full bg-wash-strong"
    >
      <div className="h-full rounded-full bg-brand" style={{ width: `${Math.round((done / total) * 100)}%` }} />
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col bg-sunken text-ink-soft" style={themeVars(PULSE_STAFF_LIGHT_THEME)}>
      <header className="flex h-[76px] shrink-0 items-center justify-between border-b border-line bg-surface px-6 sm:px-10">
        {/* eslint-disable-next-line @next/next/no-img-element -- small fixed logo file, served from our own address */}
        <img src={LOGO_URL} width={LOGO_WIDTH} height={LOGO_HEIGHT} alt="Pulse 3D" className="h-9 w-auto" />
        <Link href="/admin/billing" className="text-[15px] font-medium text-ink-soft hover:text-ink">
          Finish later
        </Link>
      </header>

      {/* On a phone: the progress list as one line under the top bar. */}
      <div className="border-b border-line bg-surface px-6 py-3 md:hidden">
        <div className="flex items-center gap-4">
          <p className="text-[1.0625rem] font-semibold text-ink">Signing up</p>
          {bar}
          <p className="text-sm text-ink-soft">
            {done} of {total}
          </p>
        </div>
        <p className="mt-1 text-sm text-ink-soft">
          Step {currentIndex + 1} of {total}: <strong className="font-semibold text-ink">{currentLabel}</strong>
        </p>
      </div>

      <div className="flex flex-1">
        <nav aria-label="Sign-up steps" className="hidden w-[300px] shrink-0 border-r border-line bg-surface px-4 py-10 md:block">
          <p className="px-3 text-[1.375rem] font-semibold text-ink">Signing up</p>
          <div className="mt-5 flex items-center gap-3 px-3">
            {bar}
            <span className="text-sm text-ink-soft">
              {done} of {total}
            </span>
          </div>
          <ol className="mt-5 flex flex-col gap-1">
            {SIGN_UP_STEPS.map((entry, index) => {
              const state = stepState(entry.key, step);
              const linked = entry.key === "plan" && state === "done" && backToPlan;
              const row = (
                <>
                  <span aria-hidden="true" className="mt-0.5 w-4 text-center text-ink">
                    {state === "done" ? "✓" : "•"}
                  </span>
                  <span className="flex-1">
                    <span className={`block text-[15px] ${state === "current" ? "font-semibold text-ink" : state === "done" ? "text-ink-soft" : "font-medium text-ink"}`}>
                      {entry.label}
                    </span>
                    {state === "current" && (
                      <span className="block text-[13px] text-ink-soft">
                        Step {index + 1} of {total}
                      </span>
                    )}
                  </span>
                  {state === "done" && <span className="text-[13px] font-semibold text-ink-soft">Done</span>}
                </>
              );
              return (
                <li key={entry.key} aria-current={state === "current" ? "step" : undefined}>
                  {linked ? (
                    <Link
                      href={linked}
                      aria-label={`${entry.label}, done. Change the plan`}
                      className="flex min-h-11 items-start gap-3 rounded-xl px-3 py-3 hover:bg-wash focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-bright"
                    >
                      {row}
                    </Link>
                  ) : (
                    <div className={`flex items-start gap-3 rounded-xl px-3 py-3 ${state === "current" ? "bg-brand/10" : ""}`}>{row}</div>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>

        <main className="flex-1 px-6 py-8 sm:px-12 sm:py-11">{children}</main>
      </div>
    </div>
  );
}
