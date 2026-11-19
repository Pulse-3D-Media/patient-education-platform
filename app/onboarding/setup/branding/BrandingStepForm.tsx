"use client";

import { useState, type ReactNode } from "react";
import { PatientPhonePreview } from "@/components/ui/PatientPhonePreview";
import { INPUT, LABEL } from "@/components/ui/styles";
import { parseBrandColor } from "@/lib/branding";
import { saveBrandingStepAction } from "../actions";
import { SETUP_PRIMARY, StepProblem, useSetupForm } from "../SetupButtons";
import { StepBody, StepHeading } from "../SetupFrame";
import type { PreviewFacts } from "../setup-view";

/** What the colour picker shows when nothing is chosen: the Pulse 3D accent (the Design section of CLAUDE.md). */
const BRAND_COLOR_DEFAULT_HEX = "#2a829b";

/**
 * Step 2's form: the logo (its own upload form, passed in from the page, so
 * the two forms are never one inside the other) and the colour. Continue
 * saves the colour and moves on. The phone on the right follows the colour as
 * it is picked; a colour that is not understood leaves the Pulse colour there.
 */
export function BrandingStepForm({ color, logo, preview, welcomeBack }: { color: string | null; logo: ReactNode; preview: PreviewFacts; welcomeBack: boolean }) {
  const { state, pending, form } = useSetupForm(saveBrandingStepAction);
  const [picked, setPicked] = useState(color ?? "");
  const checked = picked ? parseBrandColor(picked) : null;

  return (
    <StepBody
      step="branding"
      welcomeBack={welcomeBack}
      preview={<PatientPhonePreview {...preview} color={checked} title="Total Knee Replacement" />}
      actions={
        <button type="submit" form="setup-branding" disabled={pending} className={SETUP_PRIMARY}>
          {pending ? "Saving..." : "Continue"}
        </button>
      }
    >
      <StepHeading>Add your branding</StepHeading>
      <div className="mt-8 flex flex-col gap-8">
        <section aria-labelledby="setup-logo-heading">
          <h2 id="setup-logo-heading" className="mb-3 text-[17px] font-semibold text-ink">
            Logo
          </h2>
          {logo}
        </section>

        <form id="setup-branding" {...form} noValidate>
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
          <StepProblem message={state?.error} />
        </form>
      </div>
    </StepBody>
  );
}
