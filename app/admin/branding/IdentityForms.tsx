"use client";

import { useState, type FormEvent } from "react";
import { useKeptForm } from "@/app/pulse/FormBits";
import { LABEL, PRIMARY_BUTTON } from "@/components/ui/styles";
import { checkLogoSize, LOGO_ACCEPT, LOGO_MAX_WORDS, LOGO_MISSING, LOGO_WRONG_KIND, sniffLogoKind } from "@/lib/clinic-identity";
import type { BrandingFormState } from "./actions";

/**
 * The logo's form on /admin/branding (the clinic's name is in the page's
 * main form, ClinicBrandingForm.tsx). It replaces Clerk's organization panel
 * that used to sit at the bottom of People.
 *
 * It goes through useKeptForm (app/pulse/FormBits.tsx), so a refused or
 * failed save keeps what was typed and the file that was chosen, with a plain
 * sentence under the button. It checks in the browser first with the same
 * rules the server uses (lib/clinic-identity.ts), so a file that is too big
 * or not a picture is caught before it is sent; the server checks everything
 * again, and decides who may save and for which clinic.
 */

type Action = (previous: BrandingFormState, formData: FormData) => Promise<BrandingFormState>;

/** What the server said, in the staff screens' colours (light or dark). */
function Said({ state, local }: { state: BrandingFormState; local?: string | null }) {
  const error = local ?? state?.error;
  if (error) {
    return (
      <p role="alert" className="text-sm text-warn">
        {error}
      </p>
    );
  }
  if (state?.ok) {
    return (
      <p role="status" className="text-sm text-brand-bright">
        {state.ok}
      </p>
    );
  }
  return null;
}

/** The logo: choose a picture, then Upload. */
export function LogoUploadForm({ action }: { action: Action }) {
  const { state, pending, form } = useKeptForm(action);
  const [chosen, setChosen] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function onChoose(event: FormEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    setProblem(null);
    setChosen(null);
    if (!file) return;
    const sizeProblem = checkLogoSize(file.size);
    if (sizeProblem) return setProblem(sizeProblem);
    // The same check of the first bytes the server makes, so a wrong file is caught before it is sent.
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (!sniffLogoKind(head)) return setProblem(LOGO_WRONG_KIND);
    setChosen(`${file.name} (${Math.max(1, Math.round(file.size / 1000))} KB)`);
  }

  return (
    <form
      {...form}
      onSubmit={(event) => {
        // Nothing is sent while the chosen file is known to be wrong, or before one is chosen.
        if (problem || !chosen) {
          event.preventDefault();
          if (!problem) setProblem(LOGO_MISSING);
        }
      }}
      className="flex flex-col gap-2"
    >
      <label htmlFor="clinic-logo" className={LABEL}>
        New logo
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <input
          id="clinic-logo"
          name="logo"
          type="file"
          accept={LOGO_ACCEPT}
          onChange={onChoose}
          aria-describedby="clinic-logo-help"
          className="min-w-0 max-w-full text-sm text-ink-soft file:mr-3 file:h-11 file:cursor-pointer file:rounded-lg file:border file:border-line-strong file:bg-field file:px-4 file:text-sm file:font-medium file:text-ink"
        />
        <button type="submit" disabled={pending} className={`${PRIMARY_BUTTON} h-11`}>
          {pending ? "Uploading..." : "Upload logo"}
        </button>
      </div>
      <p id="clinic-logo-help" className="text-xs text-ink-muted">
        A PNG, JPG or WebP picture of {LOGO_MAX_WORDS} or less. It replaces the logo you have now.
      </p>
      {chosen && !problem && <p className="text-sm text-ink-soft">Chosen: {chosen}</p>}
      <Said state={problem ? null : state} local={problem} />
    </form>
  );
}
