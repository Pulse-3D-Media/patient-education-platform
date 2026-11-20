"use client";

import { useState } from "react";
import { PatientPhonePreview } from "@/components/ui/PatientPhonePreview";
import { INPUT, LABEL } from "@/components/ui/styles";
import { typedPhoneProblem, typedUsPhone } from "@/lib/phone";
import { saveClinicStepAction } from "../actions";
import { SETUP_PRIMARY, StepProblem, useSetupForm } from "../SetupButtons";
import { StepBody, StepHeading } from "../SetupFrame";
import type { PreviewFacts } from "../setup-view";

/**
 * Step 1's form: the clinic's name and phone. Continue saves both (the name
 * through Clinic branding's rename, the phone through the same rules) and
 * moves on; a refusal keeps what was typed and says why next to the box.
 */
export function ClinicStepForm({ name, phone: initialPhone, preview, welcomeBack }: { name: string; phone: string; preview: PreviewFacts; welcomeBack: boolean }) {
  const { state, pending, form } = useSetupForm(saveClinicStepAction);
  const [typedName, setTypedName] = useState(name);
  // The phone as shown: ten digits at most, formatted as they arrive (lib/phone.ts). Only a courtesy; the server checks again.
  const [phone, setPhone] = useState(typedUsPhone(initialPhone));
  const [phoneTouched, setPhoneTouched] = useState(false);
  const phoneHint = phoneTouched ? typedPhoneProblem(phone) : null;
  const nameProblem = state?.fieldErrors?.name;
  const phoneProblem = phoneHint ?? state?.fieldErrors?.phone;

  return (
    <form
      {...form}
      onSubmit={(event) => {
        // A half-typed phone is said before anything is sent, not after.
        if (typedPhoneProblem(phone)) {
          event.preventDefault();
          setPhoneTouched(true);
        }
      }}
      className="flex flex-1 flex-col"
      noValidate
    >
      <StepBody
        step="clinic"
        welcomeBack={welcomeBack}
        preview={<PatientPhonePreview {...preview} clinicName={typedName.trim() || name} />}
        actions={
          <button type="submit" disabled={pending} className={SETUP_PRIMARY}>
            {pending ? "Saving..." : "Continue"}
          </button>
        }
      >
        <StepHeading>What&apos;s your clinic called?</StepHeading>
        <input type="hidden" name="previousName" value={name} />
        <div className="mt-8 flex flex-col gap-5">
          <div>
            <label htmlFor="setup-clinic-name" className={LABEL}>
              Clinic name
            </label>
            <input
              id="setup-clinic-name"
              name="name"
              type="text"
              required
              maxLength={100}
              autoComplete="organization"
              value={typedName}
              onChange={(event) => setTypedName(event.target.value)}
              aria-invalid={nameProblem ? true : undefined}
              aria-describedby={nameProblem ? "setup-clinic-name-problem" : undefined}
              className={`${INPUT} h-12 text-base`}
            />
            {nameProblem && (
              <p id="setup-clinic-name-problem" className="mt-1 text-sm text-warn">
                {nameProblem}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="setup-clinic-phone" className={LABEL}>
              Clinic phone (optional)
            </label>
            <input
              id="setup-clinic-phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(event) => setPhone(typedUsPhone(event.target.value))}
              onBlur={() => setPhoneTouched(true)}
              placeholder="(801) 555-0123"
              aria-invalid={phoneProblem ? true : undefined}
              aria-describedby={phoneProblem ? "setup-clinic-phone-problem" : undefined}
              className={`${INPUT} h-12 text-base`}
            />
            {phoneProblem && (
              <p id="setup-clinic-phone-problem" className="mt-1 text-sm text-warn">
                {phoneProblem}
              </p>
            )}
          </div>
        </div>
        <StepProblem message={state?.error && !nameProblem && !phoneProblem ? state.error : null} />
      </StepBody>
    </form>
  );
}
