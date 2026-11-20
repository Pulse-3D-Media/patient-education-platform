import Link from "next/link";
import { redirect } from "next/navigation";
import { PatientPhonePreview } from "@/components/ui/PatientPhonePreview";
import { setupStepHref, SETUP_PATH } from "@/lib/setup";
import { TOUR_START_HREF } from "@/lib/tour";
import { SETUP_PRIMARY, SETUP_SECONDARY } from "../SetupButtons";
import { SetupFrame, StepBody, StepHeading } from "../SetupFrame";
import { previewFacts, requireSetup } from "../setup-view";

/**
 * The end of setup: "You're ready for patients." (screen 04-setup-5-done).
 * Each step with Done, or "Add it now" for one that was skipped (it opens
 * that step; saving it there keeps setup finished), then "Take the tour" and
 * "Open the library".
 *
 * "Take the tour" opens the quick tour's first stop on the library home
 * (components/tour), as the welcome dialog's "Take a quick tour" does.
 */
export const dynamic = "force-dynamic";

/** The quick tour's first stop, as the welcome dialog's "Take a quick tour" has. */
const TOUR_HREF = TOUR_START_HREF;

export default async function SetupDonePage() {
  const { clinic, progress } = await requireSetup();
  // Not finished yet (someone opened this address early): back to the step the clinic is on.
  if (!progress.finished) redirect(SETUP_PATH);
  const preview = await previewFacts(clinic);

  return (
    <SetupFrame clinic={clinic} progress={progress} step={null}>
      <StepBody
        step={null}
        preview={<PatientPhonePreview {...preview} />}
        actions={
          <>
            <Link href={TOUR_HREF} className={SETUP_SECONDARY}>
              Take the tour
            </Link>
            <Link href="/library" className={SETUP_PRIMARY}>
              Open the library
            </Link>
          </>
        }
      >
        <StepHeading>You&apos;re ready for patients.</StepHeading>
        <ul className="mt-8 flex flex-col gap-2">
          {progress.steps.map((step) => (
            <li key={step.key} className="flex min-h-12 items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-[15px]">
              <span aria-hidden="true" className="w-4 text-center text-ink">
                {step.state === "done" ? "✓" : "○"}
              </span>
              <span className="flex-1 font-medium text-ink">{step.label}</span>
              {step.state === "done" ? (
                <span className="text-[13px] font-semibold text-ink-soft">Done</span>
              ) : (
                <Link href={setupStepHref(step.key)} className="text-[15px] font-semibold text-brand underline-offset-2 hover:underline">
                  Add it now
                </Link>
              )}
            </li>
          ))}
        </ul>
      </StepBody>
    </SetupFrame>
  );
}
