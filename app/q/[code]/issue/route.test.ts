import { afterEach, describe, expect, it, vi } from "vitest";
import { ShareTermsError } from "@/lib/expiry";

/**
 * POST /q/<code>/issue, with the database function replaced: what the route
 * accepts, what it answers, that nothing is ever cached, that only POST
 * exists (so opening the page, a preview or a HEAD request makes nothing),
 * and that the log never holds the code, the key or a link. The database
 * side is lib/db/qr-codes.test.ts.
 */

vi.mock("@/lib/db/shares", () => ({ issueShareFromQrCode: vi.fn() }));
vi.mock("@/lib/qr-alert", () => ({ notifyPulseOfBusyQrCode: vi.fn() }));

const { issueShareFromQrCode } = await import("@/lib/db/shares");
const { notifyPulseOfBusyQrCode } = await import("@/lib/qr-alert");
const route = await import("./route");

const CODE = "abcdefghijklmnopqrstuvwx1";
const KEY = "3f2b8a1c-5d4e-4f6a-9b7c-0d1e2f3a4b5c";
const V = "2026-10-08";

function post(code: string, body: unknown) {
  const request = new Request(`http://localhost/q/${code}/issue`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
  return route.POST(request, { params: Promise.resolve({ code }) } as never);
}

afterEach(() => {
  vi.mocked(issueShareFromQrCode).mockReset();
  vi.mocked(notifyPulseOfBusyQrCode).mockReset();
  vi.restoreAllMocks();
});

describe("POST /q/<code>/issue", () => {
  it("answers with this visit's link, never cached and never indexed", async () => {
    vi.mocked(issueShareFromQrCode).mockResolvedValue({ ok: true, code: "k7m2xq4v9p8a7b6c" });
    const response = await post(CODE, { key: KEY, accepted: V });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: "k7m2xq4v9p8a7b6c" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
    // The tick of the "for education only" box goes onto the new link.
    expect(issueShareFromQrCode).toHaveBeenCalledWith(CODE, KEY, { disclaimerVersion: V });
  });

  it("answers every refusal the same way, so the page says only 'not available' and nothing about why", async () => {
    for (const reason of ["no-such-code", "retired", "clinic-closed", "not-on-plan", "unpublished", "placeholder-hidden"] as const) {
      vi.mocked(issueShareFromQrCode).mockResolvedValueOnce({ ok: false, reason });
      const response = await post(CODE, { key: KEY, accepted: V });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ code: null });
    }
  });

  it("refuses a malformed code or key before the database is asked", async () => {
    for (const [code, body] of [
      ["short", { key: KEY, accepted: V }],
      [CODE.toUpperCase(), { key: KEY, accepted: V }],
      [CODE, { key: "x", accepted: V }],
      // No tick of the box: the page never sends Play without one.
      [CODE, { key: KEY }],
      [CODE, { key: KEY, accepted: "yes" }],
      [CODE, {}],
      [CODE, "not json"],
      [CODE, { key: 12345678901234567 }],
    ] as const) {
      expect((await post(code, body)).status).toBe(400);
    }
    expect(issueShareFromQrCode).not.toHaveBeenCalled();
  });

  it("answers 409 for words the server no longer records, so the page reloads, before the database is asked", async () => {
    const response = await post(CODE, { key: KEY, accepted: "2020-01-01" });
    expect(response.status).toBe(409);
    expect(issueShareFromQrCode).not.toHaveBeenCalled();
  });

  it("answers a failure with 500 for the page to try again, and logs only the kind", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(issueShareFromQrCode).mockRejectedValue(new Error(`connection to postgres://user:secret@db.example/neondb failed for ${CODE}`));
    const response = await post(CODE, { key: KEY, accepted: V });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: null });
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain(CODE);
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain("secret");
  });

  it("answers a link setting out of range calmly, as 'not available'", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(issueShareFromQrCode).mockRejectedValue(new ShareTermsError("out of range"));
    const response = await post(CODE, { key: KEY, accepted: V });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: null });
  });

  it("tells Pulse only when the tap made the flag's or the limit's link, without waiting for the email", async () => {
    const alert = { qrCodeId: "qr_row_madeup1", clinicId: "clinic_madeup1", threshold: "flag", issuedToday: 100, cap: 200, day: "2026-11-17" } as const;

    // No alert on the answer: nothing to send.
    vi.mocked(issueShareFromQrCode).mockResolvedValueOnce({ ok: true, code: "k7m2xq4v9p8a7b6c" });
    await post(CODE, { key: KEY, accepted: V });
    expect(notifyPulseOfBusyQrCode).not.toHaveBeenCalled();

    // The flag's link: the email is started, and an email that never finishes does not hold up the answer.
    vi.mocked(notifyPulseOfBusyQrCode).mockReturnValueOnce(new Promise(() => {}));
    vi.mocked(issueShareFromQrCode).mockResolvedValueOnce({ ok: true, code: "k7m2xq4v9p8a7b6c", alert });
    const response = await post(CODE, { key: KEY, accepted: V });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: "k7m2xq4v9p8a7b6c" });
    expect(notifyPulseOfBusyQrCode).toHaveBeenCalledTimes(1);
    // The address in the email comes from this deployment's own list, never the request. The tests have none, so none.
    expect(vi.mocked(notifyPulseOfBusyQrCode).mock.calls[0]).toEqual([alert, null]);
  });

  it("answers the Play tap as usual when the email fails, and the log never holds the code or the key", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const alert = { qrCodeId: "qr_row_madeup1", clinicId: "clinic_madeup1", threshold: "cap", issuedToday: 200, cap: 200, day: "2026-11-17" } as const;
    vi.mocked(notifyPulseOfBusyQrCode).mockRejectedValueOnce(new Error(`failed for ${CODE}`));
    vi.mocked(issueShareFromQrCode).mockResolvedValueOnce({ ok: true, code: "k7m2xq4v9p8a7b6c", alert });
    const response = await post(CODE, { key: KEY, accepted: V });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: "k7m2xq4v9p8a7b6c" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain(CODE);
    expect(logged).not.toContain(KEY);
  });

  it("has no GET or HEAD: opening the address never makes a link", () => {
    expect(Object.keys(route)).toEqual(["POST"]);
  });
});

describe("a code that cannot be one", () => {
  /** Post with a body whose reading is watched, to prove the code is judged first. */
  async function postWatched(code: string) {
    const request = new Request(`http://localhost/q/${encodeURIComponent(code)}/issue`, { method: "POST", body: JSON.stringify({ key: KEY, accepted: V }) });
    const read = vi.spyOn(request, "json");
    const response = await route.POST(request, { params: Promise.resolve({ code }) } as never);
    return { status: response.status, bodyRead: read.mock.calls.length > 0 };
  }

  it("is refused with a 400 before the body is read", async () => {
    for (const bad of ["has space", "<script>", "x".repeat(40), "abc'--", ""]) {
      expect(await postWatched(bad), bad).toEqual({ status: 400, bodyRead: false });
    }
    // The control: a code of the right shape does read the body.
    expect((await postWatched("abcdefghijklmnopqrstuvwx1")).bodyRead).toBe(true);
  });
});
