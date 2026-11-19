import { describe, expect, it } from "vitest";
import { cleanCode, looksLikeEmail, safeReturnPath, SITE_LINKS, splitFullName, tabHref } from "./landing";

const ORIGIN = "https://app.example.test";

describe("tabHref", () => {
  it("is the plain page when nobody was sent from anywhere", () => {
    expect(tabHref("/sign-up", undefined)).toBe("/sign-up");
    expect(tabHref("/sign-in", "")).toBe("/sign-in");
    expect(tabHref("/sign-in", ["/a", "/b"])).toBe("/sign-in");
  });

  it("carries the page someone was sent from, and nothing else", () => {
    expect(tabHref("/sign-up", "https://app.example.test/library?category=knee")).toBe(
      "/sign-up?redirect_url=https%3A%2F%2Fapp.example.test%2Flibrary%3Fcategory%3Dknee",
    );
  });
});

describe("safeReturnPath", () => {
  it("goes to /onboarding when nothing was asked for", () => {
    expect(safeReturnPath(undefined, ORIGIN)).toBe("/onboarding");
    expect(safeReturnPath("", ORIGIN)).toBe("/onboarding");
  });

  it("returns to a page on this same site, by path", () => {
    expect(safeReturnPath(`${ORIGIN}/library?category=knee`, ORIGIN)).toBe("/library?category=knee");
    expect(safeReturnPath("/admin/people", ORIGIN)).toBe("/admin/people");
  });

  it("never sends a new account to another site", () => {
    expect(safeReturnPath("https://evil.example/", ORIGIN)).toBe("/onboarding");
    expect(safeReturnPath("//evil.example/library", ORIGIN)).toBe("/onboarding");
    expect(safeReturnPath("javascript:alert(1)", ORIGIN)).toBe("/onboarding");
    expect(safeReturnPath("http://app.example.test/library", ORIGIN)).toBe("/onboarding");
  });

  it("never sends them back to the sign-in or sign-up pages", () => {
    expect(safeReturnPath("/sign-up", ORIGIN)).toBe("/onboarding");
    expect(safeReturnPath(`${ORIGIN}/sign-in/factor-one`, ORIGIN)).toBe("/onboarding");
    expect(safeReturnPath("/sign-ups-report", ORIGIN)).toBe("/sign-ups-report");
  });
});

describe("splitFullName", () => {
  it("takes the last word as the last name", () => {
    expect(splitFullName("Jane Smith")).toEqual({ firstName: "Jane", lastName: "Smith" });
    expect(splitFullName("  Mary Ann   Lee ")).toEqual({ firstName: "Mary Ann", lastName: "Lee" });
  });

  it("asks for more than one word, because Clerk keeps both", () => {
    expect(splitFullName("Jane")).toBeNull();
    expect(splitFullName("   ")).toBeNull();
  });
});

describe("the small checks", () => {
  it("looksLikeEmail is a light check, not Clerk's", () => {
    expect(looksLikeEmail("name@clinic.com")).toBe(true);
    expect(looksLikeEmail(" name@clinic.com ")).toBe(true);
    expect(looksLikeEmail("name@clinic")).toBe(false);
    expect(looksLikeEmail("name clinic.com")).toBe(false);
  });

  it("cleanCode takes out spaces a person may type", () => {
    expect(cleanCode(" 123 456 ")).toBe("123456");
  });

  it("the navigation goes only to the public website, with Patient Education marked", () => {
    for (const link of SITE_LINKS) expect(link.href.startsWith("https://www.pulse3dmedia.com/")).toBe(true);
    expect(SITE_LINKS.filter((link) => link.current).map((link) => link.label)).toEqual(["Patient Education"]);
  });
});
