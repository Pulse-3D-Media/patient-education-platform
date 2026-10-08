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

const { issueShareFromQrCode } = await import("@/lib/db/shares");
const route = await import("./route");

const CODE = "abcdefghijklmnopqrstuvwx1";
const KEY = "3f2b8a1c-5d4e-4f6a-9b7c-0d1e2f3a4b5c";

function post(code: string, body: unknown) {
  const request = new Request(`http://localhost/q/${code}/issue`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
  return route.POST(request, { params: Promise.resolve({ code }) } as never);
}

afterEach(() => {
  vi.mocked(issueShareFromQrCode).mockReset();
  vi.restoreAllMocks();
});

describe("POST /q/<code>/issue", () => {
  it("answers with this visit's link, never cached and never indexed", async () => {
    vi.mocked(issueShareFromQrCode).mockResolvedValue({ ok: true, code: "k7m2xq4v9p8a7b6c" });
    const response = await post(CODE, { key: KEY });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: "k7m2xq4v9p8a7b6c" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
    expect(issueShareFromQrCode).toHaveBeenCalledWith(CODE, KEY);
  });

  it("answers every refusal the same way, so the page says only 'not available' and nothing about why", async () => {
    for (const reason of ["no-such-code", "retired", "clinic-closed", "not-on-plan", "unpublished", "placeholder-hidden"] as const) {
      vi.mocked(issueShareFromQrCode).mockResolvedValueOnce({ ok: false, reason });
      const response = await post(CODE, { key: KEY });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ code: null });
    }
  });

  it("refuses a malformed code or key before the database is asked", async () => {
    for (const [code, body] of [
      ["short", { key: KEY }],
      [CODE.toUpperCase(), { key: KEY }],
      [CODE, { key: "x" }],
      [CODE, {}],
      [CODE, "not json"],
      [CODE, { key: 12345678901234567 }],
    ] as const) {
      expect((await post(code, body)).status).toBe(400);
    }
    expect(issueShareFromQrCode).not.toHaveBeenCalled();
  });

  it("answers a failure with 500 for the page to try again, and logs only the kind", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(issueShareFromQrCode).mockRejectedValue(new Error(`connection to postgres://user:secret@db.example/neondb failed for ${CODE}`));
    const response = await post(CODE, { key: KEY });
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
    const response = await post(CODE, { key: KEY });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: null });
  });

  it("has no GET or HEAD: opening the address never makes a link", () => {
    expect(Object.keys(route)).toEqual(["POST"]);
  });
});
