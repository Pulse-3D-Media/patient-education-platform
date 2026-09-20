import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The webhook route: what it answers, and that NOTHING is handed on until
 * the signature has been checked.
 *
 * The signature check is the real one (Stripe's own arithmetic, with a
 * made-up secret). The processor behind it is a stand-in here, because it
 * has its own tests against the database (lib/db/billing.test.ts); this
 * file is about the door, not the room.
 */

vi.mock("@/lib/billing-events", () => ({ handleStripeEvent: vi.fn() }));

import { handleStripeEvent } from "@/lib/billing-events";
import { POST } from "./route";

const SECRET = "whsec_madeup_for_the_route_test";
const BODY = JSON.stringify({ id: "evt_madeup_route", object: "event", type: "invoice.paid", livemode: false, data: { object: { id: "in_madeup", customer: "cus_madeup" } } });

function sign(body: string, secret = SECRET) {
  return new Stripe("sk_test_madeup").webhooks.generateTestHeaderString({ payload: body, secret });
}

function request(body: string, signature: string | null) {
  return new Request("https://example.test/api/webhooks/stripe", {
    method: "POST",
    body,
    headers: signature ? { "stripe-signature": signature, "content-type": "application/json" } : { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
  vi.mocked(handleStripeEvent).mockReset();
  vi.mocked(handleStripeEvent).mockResolvedValue({ status: "processed", outcome: "done" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/webhooks/stripe", () => {
  it("hands a correctly signed notification on, once, and answers 200 with nothing in the body but a word", async () => {
    const response = await POST(request(BODY, sign(BODY)));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(handleStripeEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(handleStripeEvent).mock.calls[0][0]).toMatchObject({ id: "evt_madeup_route", type: "invoice.paid" });
  });

  it("answers 400 and hands NOTHING on for a missing, wrong or forged signature", async () => {
    const forgeries = [null, "nonsense", "t=1,v1=00", sign(BODY, "whsec_someone_elses_secret"), sign(BODY.replace("cus_madeup", "cus_attacker"))];
    for (const signature of forgeries) {
      const response = await POST(request(BODY, signature));
      expect(response.status).toBe(400);
    }
    expect(handleStripeEvent).not.toHaveBeenCalled();
  });

  it("checks the signature against the exact bytes sent: the same JSON re-spaced fails", async () => {
    const respaced = JSON.stringify(JSON.parse(BODY), null, 1);
    const response = await POST(request(respaced, sign(BODY)));
    expect(response.status).toBe(400);
    expect(handleStripeEvent).not.toHaveBeenCalled();
  });

  it("answers 500 when the work fails, so that Stripe sends it again, and gives no detail", async () => {
    vi.mocked(handleStripeEvent).mockRejectedValue(new Error("database unreachable at host db.internal"));
    const response = await POST(request(BODY, sign(BODY)));
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("failed");
  });

  it("answers 200 for a repeat and for a kind it does not use, so Stripe stops sending them", async () => {
    vi.mocked(handleStripeEvent).mockResolvedValue({ status: "duplicate", outcome: "" });
    expect((await POST(request(BODY, sign(BODY)))).status).toBe(200);
    vi.mocked(handleStripeEvent).mockResolvedValue({ status: "skipped", outcome: "" });
    expect((await POST(request(BODY, sign(BODY)))).status).toBe(200);
  });

  it("answers 503, reading nothing, when the signing secret is not set on the deployment", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await POST(request(BODY, sign(BODY)));
    expect(response.status).toBe(503);
    expect(handleStripeEvent).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  });
});
