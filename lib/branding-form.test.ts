import { describe, expect, it } from "vitest";
import { readBrandingForm, readLogoField } from "./branding-form";

/** Reading the branding form: what is accepted, how it is tidied, and what is refused. Pure, no database. */

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

describe("readBrandingForm", () => {
  it("tidies good values: lowercase hex, ten-digit phone, the font's key", () => {
    expect(readBrandingForm(form({ brandColor: " #7A1F2B ", brandFont: "Merriweather", phone: "+1 (801) 555-0123" }))).toEqual({
      values: { brandColor: "#7a1f2b", brandFont: "merriweather", phone: "8015550123" },
    });
  });

  it("reads an empty form, and a form with fields missing altogether, as the Pulse look and no phone", () => {
    const nothing = { values: { brandColor: null, brandFont: null, phone: null } };
    expect(readBrandingForm(form({ brandColor: "", brandFont: "", phone: "" }))).toEqual(nothing);
    expect(readBrandingForm(form({}))).toEqual(nothing);
  });

  it("stores the default font as nothing set", () => {
    expect(readBrandingForm(form({ brandFont: "inter" }))).toEqual({ values: { brandColor: null, brandFont: null, phone: null } });
  });

  it("refuses a value it does not understand rather than guessing or dropping it", () => {
    expect(readBrandingForm(form({ brandColor: "teal" }))).toMatchObject({ error: expect.stringContaining("hex colour") });
    expect(readBrandingForm(form({ brandFont: "comic-sans" }))).toMatchObject({ error: expect.stringContaining("fonts on the list") });
    expect(readBrandingForm(form({ phone: "12345" }))).toMatchObject({ error: expect.stringContaining("US phone number") });
  });

  it("refuses a file sent where text belongs without clearing the saved colour", () => {
    const data = form({ brandFont: "open-sans" });
    data.append("brandColor", new Blob(["#ff0000"]), "colour.txt");
    expect(readBrandingForm(data)).toHaveProperty("error");
  });

  it("refuses ambiguous duplicate fields", () => {
    const data = form({ brandColor: "#123456" });
    data.append("brandColor", "#654321");
    expect(readBrandingForm(data)).toHaveProperty("error");
  });
});

describe("readLogoField", () => {
  it("refuses files and duplicate addresses", () => {
    const file = new FormData();
    file.append("logoUrl", new Blob(["logo"]), "logo.png");
    expect(readLogoField(file)).toHaveProperty("error");
    const duplicate = form({ logoUrl: "https://example.com/logo.png" });
    duplicate.append("logoUrl", "");
    expect(readLogoField(duplicate)).toHaveProperty("error");
  });
  it("reads an empty box as no logo", () => {
    expect(readLogoField(form({ logoUrl: "  " }))).toEqual({ logoUrl: null });
    expect(readLogoField(form({}))).toEqual({ logoUrl: null });
  });

  it("accepts a full https address and refuses anything else", () => {
    expect(readLogoField(form({ logoUrl: "https://cdn.example.org/summit.png" }))).toEqual({ logoUrl: "https://cdn.example.org/summit.png" });
    for (const bad of ["http://example.com/a.png", "example.com/a.png", "javascript:alert(1)", "data:image/png;base64,AAAA"]) {
      expect(readLogoField(form({ logoUrl: bad }))).toMatchObject({ error: expect.stringContaining("https://") });
    }
  });
});
