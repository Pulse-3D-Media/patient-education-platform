import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { qrDailyThreshold, type QrAlert } from "./qr-code";
import { notifyPulseOfBusyQrCode, pulseLinksTab, qrAlertEmail, qrAlertKey } from "./qr-alert";

/**
 * The email Pulse staff get when a printed QR code reaches the day's flag or
 * its daily limit (lib/qr-alert.ts). What these prove:
 *
 *   - which counts send anything: exactly the flag and exactly the limit,
 *     and no other number;
 *   - the key is the same however many servers work it out, and differs by
 *     code, day and threshold, so Resend sends each one once;
 *   - the email names the clinic, the procedure and the count, links to the
 *     clinic's Links tab on /pulse from the origin handed in, and holds no
 *     printed code and nothing about the visitor;
 *   - nothing is sent, and nothing asked, when email or ERROR_ALERT_EMAIL is
 *     not set up;
 *   - a failed send or a failed lookup is one log line with one word, and
 *     never throws.
 *
 * The database lookup and Resend are stand-ins here. The count itself, under
 * the code's lock, is proved in lib/db/qr-codes.cap.test.ts.
 */

const PRINTED_CODE = "abcdefghijklmnopqrstuvwx1";
const ENV = { RESEND_API_KEY: "re_madeup_key", EMAIL_FROM: "Pulse 3D <alerts@example.test>", ERROR_ALERT_EMAIL: "staff@example.test" };
const ALERT: QrAlert = { qrCodeId: "qr_row_madeup1", clinicId: "clinic_madeup1", threshold: "flag", issuedToday: 100, cap: 200, day: "2026-11-17" };
const NAMES = { clinicName: "Vitest Bone & Joint", videoTitle: "Total Knee Replacement" };

let errors: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("qrDailyThreshold", () => {
  it("names the flag at exactly the flag, the limit at exactly the limit, and nothing at any other count", () => {
    expect(qrDailyThreshold(100, 100, 200)).toBe("flag");
    expect(qrDailyThreshold(200, 100, 200)).toBe("cap");
    for (const count of [0, 1, 99, 101, 150, 199, 201, 1000]) {
      expect(qrDailyThreshold(count, 100, 200), String(count)).toBeNull();
    }
  });

  it("never sends a flag that is not below the limit (a stored pair nothing in the app writes)", () => {
    expect(qrDailyThreshold(200, 200, 200)).toBe("cap");
    expect(qrDailyThreshold(300, 300, 200)).toBeNull();
  });
});

describe("the key", () => {
  it("is the same every time for one code, day and threshold, and different when any of them changes", () => {
    expect(qrAlertKey(ALERT)).toBe(qrAlertKey({ ...ALERT }));
    expect(qrAlertKey(ALERT)).not.toBe(qrAlertKey({ ...ALERT, threshold: "cap", issuedToday: 200 }));
    expect(qrAlertKey(ALERT)).not.toBe(qrAlertKey({ ...ALERT, day: "2026-11-18" }));
    expect(qrAlertKey(ALERT)).not.toBe(qrAlertKey({ ...ALERT, qrCodeId: "qr_row_madeup2" }));
  });
});

describe("the email", () => {
  it("at the flag: names the clinic, the procedure and the count, and links to the clinic's Links tab", () => {
    const email = qrAlertEmail(ALERT, NAMES, ["staff@example.test"], "https://app.example.test");
    expect(email.to).toEqual(["staff@example.test"]);
    expect(email.subject).toContain("Vitest Bone & Joint");
    expect(email.text).toContain("Vitest Bone & Joint");
    expect(email.text).toContain("Total Knee Replacement");
    expect(email.text).toContain("100 links");
    expect(email.text).toContain("https://app.example.test/pulse/clinics/clinic_madeup1#links");
    expect(email.html).toContain("Vitest Bone &amp; Joint");
    expect(email.idempotencyKey).toBe(qrAlertKey(ALERT));
  });

  it("at the limit: says the code hands out nothing more until midnight UTC", () => {
    const email = qrAlertEmail({ ...ALERT, threshold: "cap", issuedToday: 200 }, NAMES, ["staff@example.test"], "https://app.example.test");
    expect(email.subject).toContain("daily limit");
    expect(email.text).toContain("200 links");
    expect(email.text).toContain("midnight UTC");
  });

  it("without a trusted origin, names the page instead of linking to an address", () => {
    const email = qrAlertEmail(ALERT, NAMES, ["staff@example.test"], null);
    expect(email.text).toContain("/pulse/clinics/clinic_madeup1");
    expect(email.text).not.toContain("http");
  });

  it("builds the Links tab address from the origin it is given", () => {
    expect(pulseLinksTab("https://learn.example.test", "clinic_1")).toBe("https://learn.example.test/pulse/clinics/clinic_1#links");
  });
});

/** A stand-in for Resend that remembers what it was sent. */
function resend(status = 200) {
  const sent: { body: string; headers: Record<string, string> }[] = [];
  const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    sent.push({ body: String(init?.body), headers: init?.headers as Record<string, string> });
    return new Response("{}", { status });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, sent };
}

describe("notifyPulseOfBusyQrCode", () => {
  it("sends one email to ERROR_ALERT_EMAIL under the key, with no printed code and nothing about the visitor", async () => {
    const service = resend();
    const lookup = vi.fn(async () => NAMES);
    const outcome = await notifyPulseOfBusyQrCode(ALERT, "https://app.example.test", { env: ENV, fetch: service.fetch, lookup });
    expect(outcome).toEqual({ told: true });
    expect(lookup).toHaveBeenCalledWith("clinic_madeup1", "qr_row_madeup1");
    expect(service.sent).toHaveLength(1);
    expect(service.sent[0].headers["Idempotency-Key"]).toBe(qrAlertKey(ALERT));
    const body = service.sent[0].body;
    expect(body).toContain("staff@example.test");
    expect(body).not.toContain(PRINTED_CODE);
    for (const visitorDetail of ["ip", "user-agent", "User-Agent", "device", "192.0.2"]) {
      expect(body.toLowerCase()).not.toContain(`${visitorDetail.toLowerCase()}:`);
    }
    expect(errors).not.toHaveBeenCalled();
  });

  it("sends nothing and asks nothing when email or ERROR_ALERT_EMAIL is not set up", async () => {
    for (const env of [{ ...ENV, ERROR_ALERT_EMAIL: "" }, { ...ENV, RESEND_API_KEY: "" }, { ...ENV, EMAIL_FROM: "" }]) {
      const service = resend();
      const lookup = vi.fn(async () => NAMES);
      expect(await notifyPulseOfBusyQrCode(ALERT, "https://app.example.test", { env, fetch: service.fetch, lookup })).toEqual({ told: false, reason: "not-configured" });
      expect(service.sent).toHaveLength(0);
      expect(lookup).not.toHaveBeenCalled();
    }
    expect(errors).not.toHaveBeenCalled();
  });

  it("a refused send is one log line with one word, and never throws", async () => {
    const service = resend(500);
    const outcome = await notifyPulseOfBusyQrCode(ALERT, "https://app.example.test", { env: ENV, fetch: service.fetch, lookup: async () => NAMES });
    expect(outcome.told).toBe(false);
    const ours = errors.mock.calls.filter((call) => String(call[0]).startsWith("Printed code alert"));
    expect(ours).toHaveLength(1);
    expect(ours[0]).toEqual(["Printed code alert: the email was not sent.", "refused"]);
  });

  it("a lookup that fails, or finds no code, sends nothing and logs one word", async () => {
    const service = resend();
    const failing = await notifyPulseOfBusyQrCode(ALERT, null, {
      env: ENV,
      fetch: service.fetch,
      lookup: async () => {
        throw new Error(`could not read ${PRINTED_CODE}`);
      },
    });
    expect(failing).toEqual({ told: false, reason: "lookup-failed" });
    const missing = await notifyPulseOfBusyQrCode(ALERT, null, { env: ENV, fetch: service.fetch, lookup: async () => null });
    expect(missing).toEqual({ told: false, reason: "lookup-failed" });
    expect(service.sent).toHaveLength(0);
    const logged = errors.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).not.toContain(PRINTED_CODE);
    expect(errors.mock.calls.every((call) => call.length === 2)).toBe(true);
  });
});
