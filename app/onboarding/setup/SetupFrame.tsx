import Link from "next/link";
import type { ReactNode } from "react";
import { ClinicLogo } from "@/components/ui/ClinicLogo";
import { PULSE_STAFF_LIGHT_THEME, themeVars } from "@/lib/branding";
import { SETUP_STEPS, setupStepHref, stepBefore, stepIsOpen, type SetupProgress, type SetupStepKey, type SetupStepState } from "@/lib/setup";
import { SkipButton } from "./SetupButtons";
import { StepLink, StepTypingWatch } from "./StepLink";

/**
 * The frame around every setup step (the approved design, screens 04 and
 * 06-setup-resume): the clinic's logo and name with "Finish later" across
 * the top, the progress list on the left ("Setting up", a bar, "1 of 4", and
 * each step with Done or Later), and the step itself on the right
 * (StepBody below lays it out).
 *
 * Only the setup steps, never the app's menu, as drawn. On a phone the list
 * folds into two lines under the top bar. Always light, in the Pulse colours,
 * like the sign-up steps before it (components/sign-up/SignUpFrame.tsx).
 *
 * "Finish later" goes to the library: nothing is lost, setup keeps its place,
 * and the library's menu has "Finish setup" until it is done.
 *
 * THE STEPS IN THE LIST ARE LINKS (Evan, 2026-11-20): every step already
 * reached (done, left for later, or the one the clinic is on) and the one
 * after it, as stepIsOpen() in lib/setup.ts says; each step's page asks the
 * same question on the server. On a phone they are a row of four under the
 * two lines, each at least 44 pixels tall. A link that would leave typed
 * words behind asks first (StepLink).
 */

/** What a screen reader hears after a step's name. */
const STATE_WORDS: Record<SetupStepState, string> = { done: "done", later: "left for later", current: "", ahead: "" };

function stepLinkLabel(label: string, state: SetupStepState): string {
  return STATE_WORDS[state] ? `${label}, ${STATE_WORDS[state]}` : label;
}
export function SetupFrame({
  clinic,
  progress,
  step,
  children,
}: {
  clinic: { name: string; logoUrl: string | null };
  progress: SetupProgress;
  /** The step on screen, or null for the finished page. */
  step: SetupStepKey | null;
  children: ReactNode;
}) {
  const total = progress.total;
  const index = step ? SETUP_STEPS.findIndex((entry) => entry.key === step) : -1;

  const bar = (
    <div role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={progress.doneCount} className="h-1.5 flex-1 overflow-hidden rounded-full bg-wash-strong">
      <div className="h-full rounded-full bg-brand" style={{ width: `${Math.round((progress.doneCount / total) * 100)}%` }} />
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col bg-sunken text-ink-soft" style={themeVars(PULSE_STAFF_LIGHT_THEME)}>
      <header className="flex h-[76px] shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-6 sm:px-10">
        <ClinicLogo src={clinic.logoUrl} name={clinic.name} boxClassName="h-10 w-[220px] max-w-[60vw]" nameClassName="truncate text-[17px] font-semibold text-ink" />
        {step && (
          <Link href="/library" className="shrink-0 text-[15px] font-medium text-ink-soft hover:text-ink">
            Finish later
          </Link>
        )}
      </header>

      {/* On a phone: the progress list as two lines under the top bar. */}
      <div className="border-b border-line bg-surface px-6 py-3 md:hidden">
        <div className="flex items-center gap-4">
          <p className="text-[1.0625rem] font-semibold text-ink">Setting up</p>
          {bar}
          <p className="text-sm text-ink-soft">
            {progress.doneCount} of {total}
          </p>
        </div>
        {step && (
          <p className="mt-1 text-sm text-ink-soft">
            Step {index + 1} of {total}: <strong className="font-semibold text-ink">{SETUP_STEPS[index].label}</strong>
          </p>
        )}
        <ol aria-label="Setup steps" className="mt-2 grid grid-cols-4 gap-1">
          {progress.steps.map((entry) => {
            const onScreen = entry.key === step;
            const body = (
              <>
                {entry.state === "done" && <span aria-hidden="true">✓&nbsp;</span>}
                {entry.label}
              </>
            );
            const box = "flex min-h-11 items-center justify-center rounded-lg px-1 text-center text-[13px] leading-tight";
            return (
              <li key={entry.key} aria-current={onScreen ? "step" : undefined}>
                {onScreen ? (
                  <span className={`${box} bg-brand/10 font-semibold text-ink`}>{body}</span>
                ) : stepIsOpen(progress, entry.key) ? (
                  <StepLink href={setupStepHref(entry.key)} ariaLabel={stepLinkLabel(entry.label, entry.state)} className={`${box} text-ink-soft underline underline-offset-2 hover:bg-wash hover:text-ink`}>
                    {body}
                  </StepLink>
                ) : (
                  <span className={`${box} text-ink-muted`}>{body}</span>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="flex flex-1">
        <nav aria-label="Setup steps" className="hidden w-[300px] shrink-0 border-r border-line bg-surface px-4 py-10 md:block">
          <p className="px-3 text-[1.375rem] font-semibold text-ink">Setting up</p>
          <div className="mt-5 flex items-center gap-3 px-3">
            {bar}
            <span className="text-sm text-ink-soft">
              {progress.doneCount} of {total}
            </span>
          </div>
          <ol className="mt-5 flex flex-col gap-1">
            {progress.steps.map((entry, position) => {
              const onScreen = entry.key === step;
              const row = "flex min-h-11 items-start gap-3 rounded-xl px-3 py-3";
              const body = (
                <>
                  <span aria-hidden="true" className="mt-0.5 w-4 text-center text-ink">
                    {entry.state === "done" ? "✓" : entry.state === "later" ? "○" : "•"}
                  </span>
                  <span className="flex-1">
                    <span className={`block text-[15px] ${onScreen ? "font-semibold text-ink" : entry.state === "ahead" ? "font-medium text-ink" : "text-ink-soft"}`}>{entry.label}</span>
                    {onScreen && (
                      <span className="block text-[13px] text-ink-soft">
                        Step {position + 1} of {total}
                      </span>
                    )}
                  </span>
                  {!onScreen && entry.state === "done" && <span className="text-[13px] font-semibold text-ink-soft">Done</span>}
                  {!onScreen && entry.state === "later" && <span className="text-[13px] font-semibold text-ink-soft">Later</span>}
                </>
              );
              return (
                <li key={entry.key} aria-current={onScreen ? "step" : undefined}>
                  {onScreen ? (
                    <div className={`${row} bg-brand/10`}>{body}</div>
                  ) : stepIsOpen(progress, entry.key) ? (
                    <StepLink
                      href={setupStepHref(entry.key)}
                      ariaLabel={stepLinkLabel(entry.label, entry.state)}
                      className={`${row} hover:bg-wash focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-bright`}
                    >
                      {body}
                    </StepLink>
                  ) : (
                    <div className={row}>{body}</div>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>

        <main className="flex min-w-0 flex-1 flex-col px-6 py-8 sm:px-12 sm:py-11">
          <StepTypingWatch>{children}</StepTypingWatch>
        </main>
      </div>
    </div>
  );
}

/** The step's heading, as drawn: large, tight. */
export function StepHeading({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <>
      <h1 className="text-[2.25rem] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[2.5rem]">{children}</h1>
      {sub && <p className="mt-2 text-[17px] text-ink-soft">{sub}</p>}
    </>
  );
}

/**
 * One step's page inside the frame: the words and boxes on the left, the
 * phone showing the patient page on the right (on a wide screen), and the
 * step's buttons along the bottom: "Skip for now" on the left, Back and the
 * step's own button on the right, as drawn. No hooks, so a step's form (a
 * client component) can wrap the whole of it, buttons included.
 */
export function StepBody({
  step,
  welcomeBack = false,
  preview,
  actions,
  children,
}: {
  /** The step on screen, or null for the finished page (no Skip and no Back). */
  step: SetupStepKey | null;
  /** "Welcome back." above the heading, for an admin who left and came back (06-setup-resume). */
  welcomeBack?: boolean;
  /** The patient page in a phone, where the step changes what patients see. */
  preview?: ReactNode;
  /** The step's own button(s), at the right of the bottom row. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const back = step ? stepBefore(step) : null;
  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-[884px] flex-1 flex-col gap-10 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1 lg:max-w-[560px]">
          {welcomeBack && <p className="mb-3 text-[15px] font-semibold text-brand">Welcome back.</p>}
          {children}
        </div>
        {preview && <div className="hidden shrink-0 lg:block">{preview}</div>}
      </div>
      <div className="mx-auto mt-10 flex w-full max-w-[884px] flex-wrap items-center gap-3">
        {step && <SkipButton step={step} />}
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {back && (
            <StepLink href={setupStepHref(back)} className="inline-flex h-12 items-center rounded-xl border border-line-strong bg-surface px-5 text-[15px] font-semibold text-ink hover:border-brand">
              Back
            </StepLink>
          )}
          {actions}
        </div>
      </div>
    </div>
  );
}
