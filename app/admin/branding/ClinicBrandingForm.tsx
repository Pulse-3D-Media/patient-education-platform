"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { PatientPhonePreview } from "@/components/ui/PatientPhonePreview";
import { INPUT, LABEL } from "@/components/ui/styles";
import {
  BRAND_FONTS,
  BRAND_THEMES,
  PULSE_STAFF_THEME,
  parseBrandColor,
  patientTheme,
  type BrandFontKey,
  type BrandTheme,
} from "@/lib/branding";
import { CLINIC_NAME_MAX, readClinicName } from "@/lib/clinic-identity";
import { safeSave } from "@/lib/form-save";
import { formatUsPhone, normalizeUsPhone } from "@/lib/phone";
import type { BrandingFormState } from "./actions";

/**
 * The clinic's own branding form on /admin/branding, laid out as the
 * approved design draws it (screen 11): name and phone, the logo (its own
 * small form, handed in as `logo`, because a file is sent on its own), the
 * colour, the font, light or dark for the staff screens, and one Save. A
 * phone beside it shows the patient page as it will look, changing as the
 * boxes change.
 *
 * ONE SAVE, TWO SERVER ACTIONS, both unchanged: the name belongs to the
 * clinic's Clerk organization (saveClinicNameAction renames it there first),
 * and the colour, font, mode and phone are ours (saveClinicBrandingAction).
 * Save sends the name only when it was changed, then the rest. If the name is
 * refused, the rest is not sent, and the sentence says so. Each action checks
 * on the server who is asking and for which clinic; nothing here decides.
 *
 * IT KEEPS WHAT WAS TYPED. Every box holds its value in this component's own
 * state, so a refusal or a lost connection leaves the form exactly as it was,
 * with a plain sentence and the same Save to try again.
 *
 * The /pulse clinic page keeps the older form (components/ui/BrandingForm.tsx).
 */

type Action = (
  previous: BrandingFormState,
  formData: FormData,
) => Promise<BrandingFormState>;

/** The swatches. The first is the Pulse 3D colour, which is what "no colour chosen" means; the rest are suggestions, and any hex code works. */
const SWATCHES: { value: string; color: string; label: string }[] = [
  {
    value: "",
    color: PULSE_STAFF_THEME.accent,
    label: "Pulse 3D teal (the default)",
  },
  { value: "#1e5668", color: "#1e5668", label: "Deep teal" },
  { value: "#3d6b4f", color: "#3d6b4f", label: "Green" },
  { value: "#6a4c93", color: "#6a4c93", label: "Purple" },
  { value: "#9b3b3b", color: "#9b3b3b", label: "Red" },
  { value: "#3b4a54", color: "#3b4a54", label: "Slate" },
];

export function ClinicBrandingForm({
  saveName,
  saveBranding,
  values,
  logo,
  logoUrl,
  senderName,
  deadline,
  fontClasses,
}: {
  saveName: Action;
  saveBranding: Action;
  values: {
    name: string;
    phone: string | null;
    brandColor: string | null;
    brandFont: BrandFontKey;
    brandTheme: BrandTheme;
  };
  /** The logo's own form and picture, drawn by the page. */
  logo: ReactNode;
  logoUrl: string | null;
  /** The signed-in person's name as patients would see it, for the picture. */
  senderName: string | null;
  /** The line under the video in the picture, or null. */
  deadline: string | null;
  fontClasses: Record<BrandFontKey, string>;
}) {
  const [savedName, setSavedName] = useState(values.name);
  const [name, setName] = useState(values.name);
  const [phone, setPhone] = useState(formatUsPhone(values.phone));
  const [color, setColor] = useState(values.brandColor ?? "");
  const [font, setFont] = useState<BrandFontKey>(values.brandFont);
  const [mode, setMode] = useState<BrandTheme>(values.brandTheme);
  const [said, setSaid] = useState<{ ok?: string; error?: string } | null>(
    null,
  );
  const [pending, startTransition] = useTransition();

  const checkedName = readClinicName(name);
  const nameProblem = "error" in checkedName ? checkedName.error : null;
  const checkedColor = color.trim() ? parseBrandColor(color) : null;
  const colorIsBad = color.trim() !== "" && checkedColor === null;
  const phoneIsBad = phone.trim() !== "" && normalizeUsPhone(phone) === null;
  const adjusted =
    checkedColor !== null && patientTheme(checkedColor).accent !== checkedColor;

  function save(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (nameProblem) return setSaid({ error: nameProblem });
    setSaid(null);
    startTransition(async () => {
      const outcome = await safeSave(async () => {
        let nameWords: string | undefined;
        if (name.trim() !== savedName.trim()) {
          const named = new FormData();
          named.set("name", name);
          const answer = await saveName(null, named);
          if (answer?.error)
            return { error: `${answer.error} Nothing else was saved.` };
          setSavedName(name);
          nameWords = answer?.ok;
        }
        const look = new FormData();
        look.set("brandColor", color);
        look.set("brandFont", font);
        look.set("brandTheme", mode);
        look.set("phone", phone);
        const answer = await saveBranding(null, look);
        if (answer?.error)
          return {
            error: nameWords
              ? `The name was saved. ${answer.error}`
              : answer.error,
          };
        // Only the name changed: say what was saved, not "nothing changed".
        if (nameWords && answer?.ok?.startsWith("Nothing changed"))
          return { ok: nameWords };
        return { ok: answer?.ok ?? "Saved." };
      });
      setSaid(outcome);
    });
  }

  return (
    <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_240px]">
      <div className="min-w-0 max-w-[44rem]">
        <form
          id="clinic-branding"
          onSubmit={save}
          onReset={(event) => event.preventDefault()}
        />

        <Section title="Name and phone" first>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="clinic-name" className={LABEL}>
                Clinic name
              </label>
              <input
                id="clinic-name"
                form="clinic-branding"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={CLINIC_NAME_MAX + 20}
                autoComplete="organization"
                aria-invalid={nameProblem !== null}
                className={INPUT}
              />
              {nameProblem && name.trim() !== "" && (
                <p className="mt-1 text-sm text-warn">{nameProblem}</p>
              )}
            </div>
            <div>
              <label htmlFor="clinic-phone" className={LABEL}>
                Phone
              </label>
              <input
                id="clinic-phone"
                form="clinic-branding"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="(801) 555-0123"
                aria-invalid={phoneIsBad}
                className={INPUT}
              />
              {phoneIsBad && (
                <p className="mt-1 text-sm text-warn">
                  A US number has ten digits. Any format is fine.
                </p>
              )}
            </div>
          </div>
        </Section>

        <Section title="Logo">{logo}</Section>

        <Section title="Color">
          <div
            role="radiogroup"
            aria-label="Brand colour"
            className="flex flex-wrap items-center gap-2.5"
          >
            {SWATCHES.map((swatch) => {
              const picked =
                swatch.value === ""
                  ? color.trim() === ""
                  : checkedColor === swatch.value;
              return (
                <button
                  key={swatch.label}
                  type="button"
                  role="radio"
                  aria-checked={picked}
                  aria-label={swatch.label}
                  onClick={() => setColor(swatch.value)}
                  className={`h-11 w-11 rounded-xl transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-bright ${
                    picked
                      ? "ring-2 ring-ink ring-offset-2 ring-offset-ground"
                      : ""
                  }`}
                  style={{ backgroundColor: swatch.color }}
                />
              );
            })}
            <div className="w-36">
              <input
                form="clinic-branding"
                aria-label="Brand colour as a hex code"
                value={color}
                onChange={(event) => setColor(event.target.value)}
                placeholder={PULSE_STAFF_THEME.accent}
                spellCheck={false}
                autoCapitalize="off"
                aria-invalid={colorIsBad}
                className={INPUT}
              />
            </div>
          </div>
          {colorIsBad && (
            <p className="mt-2 text-sm text-warn">
              That is not a hex colour yet. It looks like #2a829b.
            </p>
          )}
          {adjusted && (
            <p className="mt-2 text-sm text-ink-soft">
              Patients see a slightly darker shade, so the button and its words
              stay readable. The picture shows it.
            </p>
          )}
        </Section>

        <Section title="Font">
          <label htmlFor="clinic-font" className="sr-only">
            Font
          </label>
          <select
            id="clinic-font"
            form="clinic-branding"
            value={font}
            onChange={(event) => setFont(event.target.value as BrandFontKey)}
            className={`${INPUT} max-w-xs`}
          >
            {BRAND_FONTS.map((choice) => (
              <option key={choice.key} value={choice.key}>
                {choice.label}
              </option>
            ))}
          </select>
        </Section>

        <Section title="Staff screens">
          <div
            role="radiogroup"
            aria-label="Light or dark staff screens"
            className="inline-flex rounded-xl border border-line-strong p-1"
          >
            {/* Light first, as the design draws it. */}
            {[...BRAND_THEMES].sort((a, b) => (a.key === "light" ? -1 : b.key === "light" ? 1 : 0)).map((choice) => (
              <button
                key={choice.key}
                type="button"
                role="radio"
                aria-checked={mode === choice.key}
                onClick={() => setMode(choice.key)}
                className={`h-10 min-w-[4.5rem] rounded-lg px-4 text-[15px] font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-bright ${
                  mode === choice.key
                    ? "bg-brand text-on-brand"
                    : "text-ink-soft hover:text-ink"
                }`}
              >
                {choice.label}
              </button>
            ))}
          </div>
        </Section>

        <div className="mt-2 flex flex-col-reverse items-stretch gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-end">
          {said?.error && (
            <p role="alert" className="text-sm text-warn sm:mr-auto">
              {said.error}
            </p>
          )}
          {said?.ok && (
            <p role="status" className="text-sm text-brand-bright sm:mr-auto">
              {said.ok}
            </p>
          )}
          <button
            type="submit"
            form="clinic-branding"
            disabled={pending}
            className="inline-flex h-11 items-center justify-center rounded-xl bg-brand px-6 text-[15px] font-semibold text-on-brand transition hover:bg-brand-hover disabled:cursor-wait disabled:opacity-60"
          >
            {pending ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      <div className="flex justify-center xl:sticky xl:top-24 xl:block xl:self-start">
        <PatientPhonePreview
          clinicName={
            checkedName && "name" in checkedName ? checkedName.name : savedName
          }
          logoUrl={logoUrl}
          color={checkedColor}
          fontClass={fontClasses[font]}
          senderName={senderName}
          title="Total Knee Replacement"
          deadline={deadline}
        />
      </div>
    </div>
  );
}

/** One part of the form, with its heading and the rule above it. */
function Section({
  title,
  first = false,
  children,
}: {
  title: string;
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={first ? "pb-6" : "border-t border-line py-6"}>
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}
