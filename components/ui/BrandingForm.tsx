"use client";

import { useActionState, useState, type CSSProperties } from "react";
import {
  BRAND_FONTS,
  BRAND_THEMES,
  PULSE_STAFF_THEME,
  parseBrandColor,
  parseLogoUrl,
  patientTheme,
  staffTheme,
  themeVars,
  type BrandFontKey,
  type BrandTheme,
} from "@/lib/branding";
import { formatUsPhone, normalizeUsPhone } from "@/lib/phone";
import { ClinicLogo } from "./ClinicLogo";
import { PhoneIcon } from "./icons";
import { INPUT, LABEL, PRIMARY_BUTTON, SECONDARY_BUTTON } from "./styles";

/**
 * The branding form: light or dark, brand colour, font and phone, with a
 * live preview of the patient page and of the staff screens beside it. One form for both
 * places that edit branding, so they cannot look or behave differently:
 *
 *   - the clinic's own admin, on /admin/branding (no logo address box: a
 *     clinic's logo is the one it uploads to its Clerk organization);
 *   - Pulse staff, on a clinic's Branding tab on /pulse (with the logo
 *     address box, and the clinic's id in a hidden field, which the staff
 *     action looks up before using).
 *
 * IT KEEPS WHAT WAS TYPED. Every box holds its value in this component's
 * own state, so when a save is refused (a colour that is not a colour, a
 * lost connection), the sentence saying why appears and the form stays
 * exactly as it was, ready to fix and send again. A save that works leaves
 * the boxes as typed too, which is what was just saved.
 *
 * The preview is worked out in the browser by the same functions the server
 * uses (lib/branding.ts): pick a pale yellow and the preview shows the
 * darker shade the patient page would really use, with a line saying so.
 * The "What your team sees" card also switches between dark and light as
 * the mode is chosen, before anything is saved: it carries its own
 * data-theme attribute, so the colour tokens inside it take that mode's
 * values whatever the page around the form looks like (on /pulse the page
 * is always dark). The patient card never changes with the mode.
 * It is a preview only. The server checks every value again when the form
 * is sent, and what the browser thinks is never what gets saved.
 *
 * A client component because a form has to know what is typed, whether it
 * is sending, and what came back.
 */

export type BrandingFormState = { ok?: string; error?: string } | null;

export type BrandingFormValues = {
  logoUrl: string | null;
  /** Ten digits as stored, or null. */
  phone: string | null;
  /** "#rrggbb" as stored, or null for the Pulse colour. */
  brandColor: string | null;
  brandFont: BrandFontKey;
  /** Light or dark staff screens, as stored and checked. */
  brandTheme: BrandTheme;
};

export function BrandingForm({
  action,
  clinicId,
  clinicName,
  values,
  showLogoField,
  fontClasses,
}: {
  /** The Server Action that saves the form. It decides who may save and for which clinic; this form decides nothing. */
  action: (previous: BrandingFormState, formData: FormData) => Promise<BrandingFormState>;
  /** Pulse staff only: which clinic is being edited. Left out on the clinic's own page, where the server works the clinic out from who is signed in. */
  clinicId?: string;
  clinicName: string;
  values: BrandingFormValues;
  /** True on /pulse, where staff can type a logo address. */
  showLogoField: boolean;
  /** The class that sets each font, from app/brand-fonts.ts, so each choice is shown in its own letters. */
  fontClasses: Record<BrandFontKey, string>;
}) {
  const [state, formAction, pending] = useActionState(async (previous: BrandingFormState, data: FormData) => {
    try {
      return await action(previous, data);
    } catch {
      // A lost response may follow a successful write. Keep the draft and let
      // the user safely resend it; do not claim nothing reached the server.
      return { error: "We could not confirm the save. Your entries are still here. Try again." };
    }
  }, null);

  const [color, setColor] = useState(values.brandColor ?? "");
  const [font, setFont] = useState<BrandFontKey>(values.brandFont);
  const [mode, setMode] = useState<BrandTheme>(values.brandTheme);
  const [phone, setPhone] = useState(formatUsPhone(values.phone));
  const [logoUrl, setLogoUrl] = useState(values.logoUrl ?? "");

  // What the preview shows: the typed values when they are good, the saved look when they are not (yet).
  const checkedColor = color.trim() ? parseBrandColor(color) : null;
  const colorIsBad = color.trim() !== "" && checkedColor === null;
  const phoneIsBad = phone.trim() !== "" && normalizeUsPhone(phone) === null;
  const previewLogo = showLogoField ? parseLogoUrl(logoUrl) : values.logoUrl;
  const logoIsBad = showLogoField && logoUrl.trim() !== "" && previewLogo === null;
  const previewPhone = normalizeUsPhone(phone);

  const patient = patientTheme(checkedColor);
  const staff = staffTheme(checkedColor, mode);
  const adjusted = checkedColor !== null && (patient.accent !== checkedColor || staff.accent !== checkedColor);
  // On dark screens a hard-to-see colour is lightened; on light screens, and on the patient page, it is darkened.
  const adjustedWord = staff.accent !== checkedColor && mode === "dark" ? "lighter" : "darker";

  return (
    <form action={formAction} onReset={(event) => event.preventDefault()} className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-6">
        {clinicId && <input type="hidden" name="clinicId" value={clinicId} />}

        {showLogoField && (
          <div>
            <label htmlFor="brand-logo" className={LABEL}>
              Logo address
            </label>
            <input
              id="brand-logo"
              name="logoUrl"
              type="url"
              inputMode="url"
              value={logoUrl}
              onChange={(event) => setLogoUrl(event.target.value)}
              placeholder="https://"
              aria-invalid={logoIsBad}
              aria-describedby="brand-logo-help"
              className={INPUT}
            />
            <p id="brand-logo-help" className="mt-1 text-xs text-ink-muted">
              A full https:// address to a PNG, JPG, SVG or WebP you have looked at. Patients&rsquo; phones load it straight from there. A logo
              the clinic uploads to its own Clerk organization replaces this one on their next sign-in.
            </p>
            {logoIsBad && <p className="mt-1 text-sm text-warn">That is not a full https:// address yet.</p>}
          </div>
        )}

        <fieldset>
          <legend className={LABEL}>Light or dark</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {BRAND_THEMES.map((choice) => (
              <label
                key={choice.key}
                className="flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border border-line-strong px-3 py-2 has-[:checked]:border-brand has-[:checked]:bg-brand/15"
              >
                <input
                  type="radio"
                  name="brandTheme"
                  value={choice.key}
                  checked={mode === choice.key}
                  onChange={() => setMode(choice.key)}
                  className="h-5 w-5 shrink-0 accent-brand"
                />
                {/* A small picture of the mode: its page colour, a card, and two lines of its text. Fixed colours, because it has to show the OTHER mode too. */}
                <span
                  aria-hidden="true"
                  className={`flex h-10 w-14 shrink-0 flex-col justify-center gap-1 rounded-md border px-2 ${
                    choice.key === "light" ? "border-[#7f796c] bg-[#fbfaf7]" : "border-white/30 bg-black"
                  }`}
                >
                  <span className={`h-1.5 w-8 rounded-full ${choice.key === "light" ? "bg-[#12202a]" : "bg-white"}`} />
                  <span className={`h-1.5 w-5 rounded-full ${choice.key === "light" ? "bg-[#52616a]" : "bg-[#bfbfbf]"}`} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[17px] font-semibold leading-tight">{choice.label}</span>
                  <span className="block text-sm text-ink-soft">{choice.note}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            For your team&rsquo;s screens: the library and this admin area. It is the clinic&rsquo;s setting, the same for everyone who signs
            in. The patient page is always light, and a video always plays on black. Your logo sits straight on the banner with nothing
            behind it, so a dark logo suits Light and a white or pale logo suits Dark.
          </p>
        </fieldset>

        <fieldset>
          <legend className={LABEL}>Brand colour</legend>
          <div className="flex flex-wrap items-center gap-3">
            {/* The colour well and the text box are the same value. The well needs a real colour to show, so it falls back to the Pulse teal when the box is empty or not a colour yet. */}
            <input
              type="color"
              aria-label="Pick the brand colour"
              value={checkedColor ?? PULSE_STAFF_THEME.accent}
              onChange={(event) => setColor(event.target.value)}
              className="h-11 w-14 cursor-pointer rounded-lg border border-line-strong bg-field p-1"
            />
            <input
              name="brandColor"
              aria-label="Brand colour as a hex code"
              value={color}
              onChange={(event) => setColor(event.target.value)}
              placeholder="#2a829b"
              spellCheck={false}
              autoCapitalize="off"
              aria-invalid={colorIsBad}
              className={`${INPUT} max-w-[10rem]`}
            />
            <button type="button" onClick={() => setColor("")} disabled={color === ""} className={`${SECONDARY_BUTTON} h-11 disabled:opacity-50`}>
              Use the Pulse 3D colour
            </button>
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            One colour. It shows on buttons, highlights and the active tab for your team, and as the band at the top of the patient page
            and its call button. The page&rsquo;s text stays dark on light for every clinic, so patients can always read it.
          </p>
          {colorIsBad && <p className="mt-1 text-sm text-warn">That is not a hex colour yet. It looks like #2a829b.</p>}
          {adjusted && (
            <p className="mt-1 text-sm text-ink-soft">
              We use a slightly {adjustedWord} shade of this where your own would be hard to see, so
              buttons and their words stay readable. The preview shows the real result.
            </p>
          )}
        </fieldset>

        <fieldset>
          <legend className={LABEL}>Font</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {BRAND_FONTS.map((choice) => (
              <label
                key={choice.key}
                className="flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border border-line-strong px-3 py-2 has-[:checked]:border-brand has-[:checked]:bg-brand/15"
              >
                <input
                  type="radio"
                  name="brandFont"
                  value={choice.key}
                  checked={font === choice.key}
                  onChange={() => setFont(choice.key)}
                  className="h-5 w-5 shrink-0 accent-brand"
                />
                <span className={`min-w-0 ${fontClasses[choice.key]}`}>
                  <span className="block text-[17px] font-semibold leading-tight">{choice.label}</span>
                  <span className="block text-sm text-ink-soft">{choice.note}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            Every font here is easy to read at the size the patient page uses. The video never waits for a font to arrive.
          </p>
        </fieldset>

        <div>
          <label htmlFor="brand-phone" className={LABEL}>
            Office phone
          </label>
          <input
            id="brand-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="(801) 555-0123"
            aria-invalid={phoneIsBad}
            aria-describedby="brand-phone-help"
            className={`${INPUT} max-w-xs`}
          />
          <p id="brand-phone-help" className="mt-1 text-xs text-ink-muted">
            Patients get a tap-to-call button with this number when their link has expired or the video will not load. Leave it empty
            for no button.
          </p>
          {phoneIsBad && <p className="mt-1 text-sm text-warn">A US number has ten digits. Any format is fine.</p>}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending} className={`${PRIMARY_BUTTON} h-11`}>
            {pending ? "Saving..." : "Save branding"}
          </button>
          {state?.error && (
            <p role="alert" className="text-sm text-warn">
              {state.error}
            </p>
          )}
          {state?.ok && (
            <p role="status" className="text-sm text-brand-bright">
              {state.ok}
            </p>
          )}
        </div>
      </div>

      {/* The preview. Decoration for the person choosing: screen readers skip it, since it repeats the choices above. */}
      <div aria-hidden="true" className="flex flex-col gap-4">
        <p className="text-sm font-medium text-ink-soft">Preview</p>

        <div className={`overflow-hidden rounded-2xl bg-[#fbfaf7] text-[#12202a] ${fontClasses[font]}`} style={themeVars(patient) as CSSProperties}>
          <div className="h-1.5 bg-brand" />
          <div className="px-5 pb-5 pt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#46555e]">What a patient sees</p>
            {previewLogo && (
              <div className="mb-2">
                {/* A new key for a new address, so the picture's loaded-or-failed state starts over. */}
                <ClinicLogo key={previewLogo} src={previewLogo} name={clinicName} boxClassName="h-11 w-[220px] max-w-full" fallback="blank" />
              </div>
            )}
            <p className="text-[15px] font-semibold break-words text-[#46555e]">From {clinicName}</p>
            <p className="mt-1 text-[24px] leading-[1.15] font-bold tracking-[-.02em]">Total Knee Replacement</p>
            <p className="mt-2 text-[17px] leading-[1.5] text-[#3a4c56]">Your surgeon shared this so you can see what happens during your operation.</p>
            {previewPhone ? (
              <span className="mt-4 inline-flex min-h-12 items-center gap-2.5 rounded-full bg-brand px-6 text-[17px] font-semibold text-on-brand">
                <PhoneIcon className="h-5 w-5 shrink-0" />
                Call {formatUsPhone(previewPhone)}
              </span>
            ) : (
              <p className="mt-4 text-sm text-[#46555e]">No phone yet, so no call button.</p>
            )}
          </div>
        </div>

        {/* data-theme gives the tokens inside this card the chosen mode's values, whatever the page around the form is. text-ink is set here, not inherited, for the same reason. */}
        <div data-theme={mode} className={`rounded-2xl border border-line bg-surface p-5 text-ink ${fontClasses[font]}`} style={themeVars(staff) as CSSProperties}>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">What your team sees</p>
          <div className="flex flex-wrap items-center gap-3">
            <span className={`${PRIMARY_BUTTON} h-11`}>Create link</span>
            <span className="inline-flex h-11 items-center rounded-full border border-brand bg-brand/20 px-5 text-[15px] font-medium text-ink">Knee</span>
            <span className="text-[15px] text-brand-bright">All shared links</span>
          </div>
        </div>
      </div>
    </form>
  );
}
