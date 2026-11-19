import { DEFAULT_BRAND_FONT, DEFAULT_BRAND_THEME, parseBrandColor, parseBrandFont, parseBrandTheme, parseLogoUrl } from "./branding";
import { normalizeUsPhone } from "./phone";
import { isAllowedPictureUrl, pictureHostRefusal } from "./picture-hosts";

/**
 * Reading and checking the branding form, the same way for the two places
 * that accept it: the clinic's own admin (app/admin/branding/actions.ts)
 * and Pulse staff (saveBrandingAction in app/pulse/actions.ts). One set of
 * checks, so the two cannot drift apart.
 *
 * Pure: no database, no Clerk. It only reads what the browser sent and says
 * whether it is acceptable. Who is allowed to save, and for which clinic,
 * is the actions' job, and they never take the clinic from this form.
 *
 * Anything not understood is refused with a plain sentence. Nothing is
 * guessed at or quietly dropped, and nothing is saved alongside a bad
 * value: a form is accepted whole or not at all.
 */

/** The four values every branding save carries, checked and ready to store. */
export type BrandingFormValues = {
  /** Ten digits, or null for no phone. */
  phone: string | null;
  /** "#rrggbb", or null for the Pulse 3D colour. */
  brandColor: string | null;
  /** A font key, or null for the default (Inter). */
  brandFont: string | null;
  /** "light", or null for the default (dark). */
  brandTheme: string | null;
};

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** The phone, colour, font and light-or-dark choice from a branding form, or the sentence saying what to fix. */
export function readBrandingForm(formData: FormData): { values: BrandingFormValues } | { error: string } {
  if (["phone", "brandColor", "brandFont", "brandTheme"].some((name) => {
    const values = formData.getAll(name);
    return values.length > 1 || values.some((value) => typeof value !== "string");
  })) return { error: "Send one text value for each branding field." };
  const phoneText = field(formData, "phone");
  const phone = phoneText ? normalizeUsPhone(phoneText) : null;
  if (phoneText && !phone) return { error: "That does not look like a US phone number. Ten digits, any format." };

  // An empty colour means "use the Pulse 3D colour". Anything else has to be a plain hex colour.
  const colorText = field(formData, "brandColor");
  const brandColor = colorText ? parseBrandColor(colorText) : null;
  if (colorText && !brandColor) return { error: "The colour must be a hex colour, like #2a829b." };

  // An empty font means the default. Anything else has to be on the list.
  const fontText = field(formData, "brandFont");
  const font = fontText ? parseBrandFont(fontText) : DEFAULT_BRAND_FONT;
  if (!font) return { error: "Choose one of the fonts on the list." };

  // An empty mode means the default (light, since 2026-11-18). Anything else has to be one of the two.
  const themeText = field(formData, "brandTheme");
  const theme = themeText ? parseBrandTheme(themeText) : DEFAULT_BRAND_THEME;
  if (!theme) return { error: "Choose Dark or Light." };

  // The defaults are stored as "nothing set", so a clinic that never chose and a clinic that chose the default font, or light, are the same row.
  // Dark, no longer the default, is written down as "dark".
  return {
    values: {
      phone,
      brandColor,
      brandFont: font === DEFAULT_BRAND_FONT ? null : font,
      brandTheme: theme === DEFAULT_BRAND_THEME ? null : theme,
    },
  };
}

/** One text value for `name`, or null when the form sent it more than once or not as text. */
function single(formData: FormData, name: string): string | null {
  const values = formData.getAll(name);
  if (values.length > 1 || values.some((value) => typeof value !== "string")) return null;
  return field(formData, name);
}

/**
 * Only the phone, for setup step 1 (the clinic's name and phone). The same
 * rule as the full form above: ten US digits in any format, or empty for none.
 */
export function readPhoneField(formData: FormData): { phone: string | null } | { error: string } {
  const text = single(formData, "phone");
  if (text === null) return { error: "Send one text value for each branding field." };
  const phone = text ? normalizeUsPhone(text) : null;
  if (text && !phone) return { error: "That does not look like a US phone number. Ten digits, any format." };
  return { phone };
}

/** Only the colour, for setup step 2 (logo and colour). The same rule as the full form above: a hex colour, or empty for the Pulse 3D colour. */
export function readColorField(formData: FormData): { brandColor: string | null } | { error: string } {
  const text = single(formData, "brandColor");
  if (text === null) return { error: "Send one text value for each branding field." };
  const brandColor = text ? parseBrandColor(text) : null;
  if (text && !brandColor) return { error: "The colour must be a hex colour, like #2a829b." };
  return { brandColor };
}

/**
 * The logo address from the Pulse staff form: a checked https address, or
 * null for an empty box (no Pulse-set logo). Only Pulse staff send this; the
 * clinic's own admin form has no such field and its action never reads one.
 */
export function readLogoField(formData: FormData, current: string | null = null): { logoUrl: string | null } | { error: string } {
  const values = formData.getAll("logoUrl");
  if (values.length > 1 || values.some((value) => typeof value !== "string")) {
    return { error: "Send one text value for the logo address." };
  }
  const text = field(formData, "logoUrl");
  if (!text) return { logoUrl: null };
  const logoUrl = parseLogoUrl(text);
  if (!logoUrl) return { error: "The logo address must be a full https:// address." };
  // Only the sites pictures may come from (lib/picture-hosts.ts), so the patient page never asks an unknown site.
  // `current` (the logo the clinic has now) is let through unchanged, so a clinic whose logo was saved
  // before the list existed can still have its colour, font and phone saved.
  if (logoUrl !== current && !isAllowedPictureUrl(logoUrl)) return { error: pictureHostRefusal("logo") };
  return { logoUrl };
}
