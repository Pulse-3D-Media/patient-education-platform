"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ClinicLogo } from "@/components/ui/ClinicLogo";
import { PatientPhonePreview } from "@/components/ui/PatientPhonePreview";
import { INPUT, LABEL } from "@/components/ui/styles";
import { parseBrandColor } from "@/lib/branding";
import { checkLogoSize, LOGO_ACCEPT, LOGO_MAX_WORDS, LOGO_WRONG_KIND, sniffLogoKind } from "@/lib/clinic-identity";
import { saveBrandingStepAction } from "../actions";
import { SETUP_PRIMARY, SETUP_SECONDARY, StepProblem, useSetupForm } from "../SetupButtons";
import { StepBody, StepHeading } from "../SetupFrame";
import type { PreviewFacts } from "../setup-view";

/** What the colour picker shows when nothing is chosen: the Pulse 3D accent (the Design section of CLAUDE.md). */
const BRAND_COLOR_DEFAULT_HEX = "#2a829b";

/**
 * Step 2's form: the logo and the colour, in ONE form, so a chosen logo can
 * never be dropped without a word (Evan, 2026-11-19: his first logo was
 * chosen, Continue was pressed, and it went nowhere).
 *
 *   - Choosing a file checks it here first (size, and its first bytes, the
 *     same checks the server makes) and shows it in the phone at once, as a
 *     picture only: nothing is sent until Continue.
 *   - Continue uploads the chosen file through Clinic branding's own upload,
 *     then saves the colour, then moves on. The step counts as done.
 *   - If the upload fails, nothing moves on: the page says the logo was not
 *     saved, keeps the file and the colour, and offers Try again (Continue
 *     again) or "Go on without the logo", which saves the colour and moves on
 *     with the step left as not done, so the library's reminder says
 *     "Add your logo".
 *
 * The phone follows the colour and the logo as they change.
 */
export function BrandingStepForm({
  color,
  savedLogoUrl,
  clinicName,
  preview,
  welcomeBack,
}: {
  color: string | null;
  savedLogoUrl: string | null;
  clinicName: string;
  preview: PreviewFacts;
  welcomeBack: boolean;
}) {
  const { state, pending, form } = useSetupForm(saveBrandingStepAction);
  const [picked, setPicked] = useState(color ?? "");
  const checked = picked ? parseBrandColor(picked) : null;
  const [chosen, setChosen] = useState<{ name: string; kb: number; url: string } | null>(null);
  const [fileProblem, setFileProblem] = useState<string | null>(null);

  // A local picture of the chosen file is let go when it is replaced or the page closes.
  useEffect(() => {
    return () => {
      if (chosen) URL.revokeObjectURL(chosen.url);
    };
  }, [chosen]);

  async function onChoose(event: FormEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    setFileProblem(null);
    setChosen(null);
    if (!file) return;
    const sizeProblem = checkLogoSize(file.size);
    // The same check of the first bytes the server makes, so a wrong file is caught before anything is sent.
    const problem = sizeProblem ?? (sniffLogoKind(new Uint8Array(await file.slice(0, 16).arrayBuffer())) ? null : LOGO_WRONG_KIND);
    if (problem) {
      setFileProblem(problem);
      input.value = "";
      return;
    }
    setChosen({ name: file.name, kb: Math.max(1, Math.round(file.size / 1000)), url: URL.createObjectURL(file) });
  }

  const logoFailed = Boolean(state?.fieldErrors?.logo);
  const shownLogo = chosen?.url ?? savedLogoUrl;

  return (
    <form {...form} encType="multipart/form-data" className="flex flex-1 flex-col" noValidate>
      <StepBody
        step="branding"
        welcomeBack={welcomeBack}
        preview={<PatientPhonePreview {...preview} logoUrl={shownLogo} color={checked} />}
        actions={
          <button type="submit" disabled={pending || Boolean(fileProblem)} className={SETUP_PRIMARY}>
            {pending ? "Saving..." : logoFailed ? "Try again" : "Continue"}
          </button>
        }
      >
        <StepHeading>Add your branding</StepHeading>
        <div className="mt-8 flex flex-col gap-8">
          <section aria-labelledby="setup-logo-heading">
            <h2 id="setup-logo-heading" className="mb-3 text-[17px] font-semibold text-ink">
              Logo
            </h2>
            {/* Shown on white, which is how it appears on the patient page. */}
            <div className="flex min-h-16 items-center gap-4 rounded-xl border border-line bg-white px-4 py-3">
              <ClinicLogo src={shownLogo} name={clinicName} boxClassName="h-10 w-[220px] max-w-full" nameClassName="text-[15px] font-semibold text-[#12202a]" />
            </div>
            <label htmlFor="setup-logo" className={`${LABEL} mt-4`}>
              {savedLogoUrl ? "New logo" : "Your logo"}
            </label>
            <input
              id="setup-logo"
              name="logo"
              type="file"
              accept={LOGO_ACCEPT}
              onChange={onChoose}
              aria-describedby="setup-logo-help"
              className="min-w-0 max-w-full text-sm text-ink-soft file:mr-3 file:h-11 file:cursor-pointer file:rounded-lg file:border file:border-line-strong file:bg-field file:px-4 file:text-sm file:font-medium file:text-ink"
            />
            <p id="setup-logo-help" className="mt-1 text-xs text-ink-muted">
              A PNG, JPG or WebP picture of {LOGO_MAX_WORDS} or less. It is saved when you press Continue.
            </p>
            {chosen && !fileProblem && (
              <p className="mt-2 text-sm text-ink-soft">
                Chosen: {chosen.name} ({chosen.kb} KB)
              </p>
            )}
            {fileProblem && (
              <p role="alert" className="mt-2 text-sm text-warn">
                {fileProblem}
              </p>
            )}
          </section>

          <div>
            <label htmlFor="setup-color" className={`${LABEL} text-[17px] font-semibold text-ink`}>
              Color
            </label>
            <div className="mt-2 flex items-center gap-3">
              <input
                type="color"
                aria-label="Pick a color"
                value={checked ?? BRAND_COLOR_DEFAULT_HEX}
                onChange={(event) => setPicked(event.target.value)}
                className="h-12 w-14 shrink-0 cursor-pointer rounded-lg border border-line-strong bg-field p-1"
              />
              <input
                id="setup-color"
                name="brandColor"
                type="text"
                value={picked}
                onChange={(event) => setPicked(event.target.value)}
                placeholder={BRAND_COLOR_DEFAULT_HEX}
                maxLength={7}
                autoComplete="off"
                className={`${INPUT} h-12 max-w-[160px] text-base`}
              />
            </div>
          </div>
        </div>

        {logoFailed ? (
          <div role="alert" className="mt-6 rounded-xl border border-warn/40 bg-warn/10 px-4 py-4 text-[15px] text-ink">
            <p className="font-semibold">Your logo was not saved.</p>
            <p className="mt-1">{state?.fieldErrors?.logo}</p>
            <button type="submit" name="withoutLogo" value="1" disabled={pending} className={`${SETUP_SECONDARY} mt-3 h-11`}>
              Go on without the logo
            </button>
          </div>
        ) : (
          <StepProblem message={state?.error} />
        )}
      </StepBody>
    </form>
  );
}
