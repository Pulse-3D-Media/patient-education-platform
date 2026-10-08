import { describe, expect, it } from "vitest";
import {
  isAttemptKey,
  isQrCodeShape,
  liveKeyFor,
  PERMANENT_QR_ORIGIN,
  printedQrFileName,
  qrLink,
  qrOriginFor,
  utcDayStart,
} from "./qr-code";

/**
 * The plain rules of printed QR codes: what a code and a visit's key look
 * like, the fixed address on production, the preview's own address marked as
 * a test, and the UTC day the daily flag counts from. Made-up hosts only.
 */

describe("what a printed code looks like", () => {
  it("is exactly 25 lowercase letters and digits", () => {
    expect(isQrCodeShape("abcdefghijklmnopqrstuvwx1")).toBe(true);
    expect(isQrCodeShape("abcdefghijklmnopqrstuvwx")).toBe(false); // 24
    expect(isQrCodeShape("abcdefghijklmnopqrstuvwx12")).toBe(false); // 26
    expect(isQrCodeShape("ABCDEFGHIJKLMNOPQRSTUVWX1")).toBe(false);
    expect(isQrCodeShape("abcdefghijklmnopqrstuvw-1")).toBe(false);
    expect(isQrCodeShape(null)).toBe(false);
    expect(isQrCodeShape(12345)).toBe(false);
  });
});

describe("a visit's one-time key", () => {
  it("takes a random UUID or a hex string, and nothing odd", () => {
    expect(isAttemptKey("3f2b8a1c-5d4e-4f6a-9b7c-0d1e2f3a4b5c")).toBe(true);
    expect(isAttemptKey("a".repeat(32))).toBe(true);
    expect(isAttemptKey("short")).toBe(false);
    expect(isAttemptKey("a".repeat(65))).toBe(false);
    expect(isAttemptKey("abc def ghi jkl mno")).toBe(false);
    expect(isAttemptKey("<script>alert(1)</script>")).toBe(false);
    expect(isAttemptKey(undefined)).toBe(false);
  });
});

describe("the address a printed code carries", () => {
  it("is the fixed company address on production, whatever host the request names", () => {
    const env = { VERCEL: "1", VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "example-app.vercel.app" };
    expect(qrOriginFor("example-app.vercel.app", env)).toEqual({ origin: PERMANENT_QR_ORIGIN, testOnly: false });
    expect(qrOriginFor("evil.example.com", env)).toEqual({ origin: PERMANENT_QR_ORIGIN, testOnly: false });
    expect(qrOriginFor(null, env)).toEqual({ origin: PERMANENT_QR_ORIGIN, testOnly: false });
    expect(PERMANENT_QR_ORIGIN).toBe("https://learn.pulse3dmedia.com");
  });

  it("is the preview's own address on a preview, marked as a test, and never a host the request made up", () => {
    const env = { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_BRANCH_URL: "example-git-qr-codes.vercel.app" };
    expect(qrOriginFor("example-git-qr-codes.vercel.app", env)).toEqual({ origin: "https://example-git-qr-codes.vercel.app", testOnly: true });
    expect(qrOriginFor("evil.example.com", env)).toEqual({ origin: "https://example-git-qr-codes.vercel.app", testOnly: true });
  });

  it("is localhost on a developer's computer, marked as a test", () => {
    expect(qrOriginFor("localhost:3000", { NODE_ENV: "development" })).toEqual({ origin: "http://localhost:3000", testOnly: true });
  });

  it("is nothing when the deployment knows no address of its own", () => {
    expect(qrOriginFor("evil.example.com", { VERCEL: "1", VERCEL_ENV: "preview" })).toBeNull();
  });

  it("puts the code after /q/", () => {
    expect(qrLink(PERMANENT_QR_ORIGIN, "abcdefghijklmnopqrstuvwx1")).toBe("https://learn.pulse3dmedia.com/q/abcdefghijklmnopqrstuvwx1");
  });
});

describe("the live key", () => {
  it("names the clinic, the video and the surgeon", () => {
    expect(liveKeyFor("clinic1", "video1", "user_1")).toBe("clinic1:video1:user_1");
    expect(liveKeyFor("clinic1", "video1", "user_2")).not.toBe(liveKeyFor("clinic1", "video1", "user_1"));
  });
});

describe("the day the daily flag counts from", () => {
  it("is midnight UTC of the same UTC day", () => {
    expect(utcDayStart(new Date("2026-10-08T00:00:00.000Z")).toISOString()).toBe("2026-10-08T00:00:00.000Z");
    expect(utcDayStart(new Date("2026-10-08T23:59:59.999Z")).toISOString()).toBe("2026-10-08T00:00:00.000Z");
    // 6pm in Utah on Oct 7 is already Oct 8 in UTC.
    expect(utcDayStart(new Date("2026-10-07T18:00:00-06:00")).toISOString()).toBe("2026-10-08T00:00:00.000Z");
  });
});

describe("the downloaded picture's file name", () => {
  it("names the procedure and never the code", () => {
    expect(printedQrFileName("Total Knee Replacement", "clx9abcdef123456")).toBe("total-knee-replacement-printed-qr-123456.png");
    expect(printedQrFileName("!!!", "clx9abcdef123456")).toBe("procedure-printed-qr-123456.png");
  });
});
