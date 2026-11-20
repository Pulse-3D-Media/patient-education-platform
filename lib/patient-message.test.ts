import { describe, expect, it, vi } from "vitest";
import {
  copyMessage,
  mailtoHref,
  messageNotice,
  patientMessage,
  PATIENT_MESSAGE_SUBJECT,
  sendWaysFor,
  shareMessage,
  smsHref,
} from "./patient-message";

// Made-up addresses only: a real link is a secret.
const LINK = "https://example.test/watch/AbCdEfGh12";

describe("patientMessage", () => {
  it("names the sender exactly as patients see it, with the link last", () => {
    expect(patientMessage({ link: LINK, senderName: "Dr. Jane Smith, DO", clinicName: "Example Orthopedics" })).toBe(
      `Here is a short video about your procedure from Dr. Jane Smith, DO: ${LINK}`,
    );
  });

  it("uses the clinic's name when the link names only the clinic", () => {
    expect(patientMessage({ link: LINK, senderName: null, clinicName: "Example Orthopedics" })).toBe(
      `Here is a short video about your procedure from Example Orthopedics: ${LINK}`,
    );
  });

  it("still reads naturally with no names at all", () => {
    expect(patientMessage({ link: LINK, senderName: "  ", clinicName: "" })).toBe(`Here is a short video about your procedure from your clinic: ${LINK}`);
  });

  it("keeps a long name whole and on one line", () => {
    const long = "Dr. Alexandria Montgomery-Featherstonehaugh\nthe Third, MD, PhD, FACS";
    const message = patientMessage({ link: LINK, senderName: long, clinicName: "Example" });
    expect(message).not.toContain("\n");
    expect(message).toContain("Featherstonehaugh the Third, MD, PhD, FACS");
    expect(message.endsWith(LINK)).toBe(true);
  });

  it("follows the copy rules: no em dash, no consent, no claim of understanding", () => {
    const words = [patientMessage({ link: LINK, senderName: "Dr. A", clinicName: "B" }), PATIENT_MESSAGE_SUBJECT].join(" ").toLowerCase();
    expect(words).not.toContain("—");
    expect(words).not.toContain("consent");
    expect(words).not.toContain("understand");
  });
});

describe("the device's own apps", () => {
  it("opens a text with the message and no number", () => {
    const href = smsHref("Hi: https://example.test/watch/x?a=1&b=2");
    expect(href.startsWith("sms:?&body=")).toBe(true);
    expect(decodeURIComponent(href.slice("sms:?&body=".length))).toBe("Hi: https://example.test/watch/x?a=1&b=2");
  });

  it("opens an email with the subject and message and no recipient", () => {
    const href = mailtoHref(`Hello: ${LINK}`);
    expect(href.startsWith("mailto:?")).toBe(true);
    const params = new URLSearchParams(href.slice("mailto:?".length));
    expect(params.get("subject")).toBe(PATIENT_MESSAGE_SUBJECT);
    expect(params.get("body")).toBe(`Hello: ${LINK}`);
  });
});

describe("sendWaysFor", () => {
  it("offers the share sheet wherever the browser has one", () => {
    expect(sendWaysFor({ share: () => undefined, touchFirst: true })).toBe("share");
    expect(sendWaysFor({ share: () => undefined, canShare: () => true, touchFirst: false })).toBe("share");
  });

  it("does not offer a share sheet that says it cannot share text, or throws when asked", () => {
    expect(sendWaysFor({ share: () => undefined, canShare: () => false, touchFirst: false })).toBe("email");
    expect(sendWaysFor({ share: () => undefined, canShare: () => { throw new Error("no"); }, touchFirst: true })).toBe("text-and-email");
  });

  it("offers Text message only on a touch-first device, decided by the device and not the screen width", () => {
    expect(sendWaysFor({ touchFirst: true })).toBe("text-and-email");
    expect(sendWaysFor({ touchFirst: false })).toBe("email");
  });
});

describe("copyMessage and shareMessage", () => {
  it("copies the message", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await copyMessage({ clipboard: { writeText } }, "m")).toBe("copied");
    expect(writeText).toHaveBeenCalledWith("m");
  });

  it("says plainly when the clipboard is refused or missing", async () => {
    expect(await copyMessage({ clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } }, "m")).toBe("refused");
    expect(await copyMessage({}, "m")).toBe("refused");
    expect(messageNotice("copy", "refused")).toContain("copy it by hand");
  });

  it("shares the text alone, with the link inside it", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    expect(await shareMessage({ share }, "m")).toBe("shared");
    expect(share).toHaveBeenCalledWith({ text: "m" });
  });

  it("says nothing when the person closes the sheet", async () => {
    const closed = Object.assign(new Error("closed"), { name: "AbortError" });
    const outcome = await shareMessage({ share: vi.fn().mockRejectedValue(closed) }, "m");
    expect(outcome).toBe("closed");
    expect(messageNotice("share", outcome)).toBe("");
    expect(messageNotice("share", "shared")).toBe("");
  });

  it("offers the message by hand when the sheet will not open", async () => {
    const outcome = await shareMessage({ share: vi.fn().mockRejectedValue(Object.assign(new Error("x"), { name: "NotAllowedError" })) }, "m");
    expect(outcome).toBe("refused");
    expect(messageNotice("share", outcome)).toContain("copy it by hand");
  });
});
