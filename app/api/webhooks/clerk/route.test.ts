import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Clerk webhook route: what it answers, and that NOTHING is handed on
 * until the signature has been checked, and then only the clinic's
 * organization id and the member's user id.
 *
 * The signature check is Clerk's real one (verifyWebhook, which follows the
 * Standard Webhooks scheme), fed deliveries signed here with a made-up
 * secret. The work behind it is a stand-in, because it has its own tests
 * against the database (lib/clerk-webhook.test.ts).
 */

vi.mock("@/lib/clerk-webhook", () => ({ handleClerkEvent: vi.fn() }));

import { handleClerkEvent } from "@/lib/clerk-webhook";
import { POST } from "./route";

const KEY = Buffer.from("madeup clerk webhook signing key, 32b");
const SECRET = `whsec_${KEY.toString("base64")}`;
const BODY = JSON.stringify({
  type: "organizationMembership.deleted",
  object: "event",
  data: { organization: { id: "org_madeup1" }, public_user_data: { user_id: "user_madeup1", identifier: "someone@example.test" }, role: "org:admin" },
  event_attributes: { http_request: { client_ip: "192.0.2.1", user_agent: "made-up browser" } },
});

function headers(body: string, options: { key?: Buffer; id?: string; seconds?: number } = {}) {
  const msgId = options.id ?? "msg_madeup1";
  const timestamp = String(options.seconds ?? Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", options.key ?? KEY).update(`${msgId}.${timestamp}.${body}`).digest("base64");
  return { "svix-id": msgId, "svix-timestamp": timestamp, "svix-signature": `v1,${signature}`, "content-type": "application/json" };
}

const post = (body: string, head: Record<string, string>) => POST(new NextRequest("https://example.test/api/webhooks/clerk", { method: "POST", body, headers: head }));

let errors: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", SECRET);
  vi.mocked(handleClerkEvent).mockReset();
  vi.mocked(handleClerkEvent).mockResolvedValue("nothing-to-report");
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/webhooks/clerk", () => {
  it("a signed delivery: hands on the organization and member ids only, with the delivery id, and answers 200", async () => {
    const response = await post(BODY, headers(BODY));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(handleClerkEvent).toHaveBeenCalledWith({ kind: "membership", orgId: "org_madeup1", userId: "user_madeup1" }, "msg_madeup1");
  });

  it("refuses without handing anything on: no signature, a wrong secret, a changed body, re-spaced JSON, a replay past the tolerance", async () => {
    const plain = { "content-type": "application/json" };
    const respaced = JSON.stringify(JSON.parse(BODY), null, 2);
    const cases = [
      await post(BODY, plain),
      await post(BODY, headers(BODY, { key: Buffer.from("some other made-up key, 32 bytes") })),
      await post(BODY.replace("user_madeup1", "user_madeup2"), headers(BODY)),
      await post(respaced, headers(BODY)),
      await post(BODY, headers(BODY, { seconds: Math.floor(Date.now() / 1000) - 60 * 60 })),
    ];
    for (const response of cases) {
      expect(response.status).toBe(400);
      expect(await response.text()).toBe("bad signature");
    }
    expect(handleClerkEvent).not.toHaveBeenCalled();
  });

  it("a kind we do not use, or a body naming no organization: 200 and dropped", async () => {
    const other = JSON.stringify({ type: "user.updated", object: "event", data: { id: "user_madeup1" } });
    const noOrg = JSON.stringify({ type: "organizationMembership.updated", object: "event", data: { organization: { id: "not an id" } } });
    for (const body of [other, noOrg]) {
      const response = await post(body, headers(body));
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("ignored");
    }
    expect(handleClerkEvent).not.toHaveBeenCalled();
  });

  it("a deleted organization is handed on as such", async () => {
    const body = JSON.stringify({ type: "organization.deleted", object: "event", data: { id: "org_madeup9", deleted: true, object: "organization" } });
    expect((await post(body, headers(body))).status).toBe(200);
    expect(handleClerkEvent).toHaveBeenCalledWith({ kind: "organization-deleted", orgId: "org_madeup9" }, "msg_madeup1");
  });

  it("the work failing: 500 so Clerk sends it again, and the log holds the kind only", async () => {
    const failure = new Error("connection to postgres://madeup:secret@db.example.test failed for org_madeup1");
    vi.mocked(handleClerkEvent).mockRejectedValue(failure);
    const response = await post(BODY, headers(BODY));
    expect(response.status).toBe(500);
    const logged = JSON.stringify(errors.mock.calls);
    expect(logged).not.toContain("postgres://");
    expect(logged).not.toContain("org_madeup1");
    expect(logged).not.toContain("192.0.2.1");
  });

  it("no signing secret on this deployment: 503, and nothing is read", async () => {
    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", "");
    const response = await post(BODY, headers(BODY));
    expect(response.status).toBe(503);
    expect(handleClerkEvent).not.toHaveBeenCalled();
  });
});
