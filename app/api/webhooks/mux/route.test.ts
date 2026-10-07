import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Mux webhook route: what it answers, and that NOTHING is handed on
 * until the signature has been checked, and then only the upload's id.
 *
 * The signature check is the real one (Mux's documented arithmetic, with a
 * made-up secret). The flow behind it is a stand-in here, because it has
 * its own tests against the database (lib/mux-uploads.test.ts); this file
 * is about the door, not the room.
 */

vi.mock("@/lib/mux-uploads", () => ({ reconcileUpload: vi.fn() }));

import { reconcileUpload } from "@/lib/mux-uploads";
import { POST } from "./route";

const SECRET = "madeup_mux_webhook_secret";
const BODY = JSON.stringify({ type: "video.asset.ready", id: "evt-madeup", object: { type: "asset", id: "AssetAbc12345" }, data: { id: "AssetAbc12345", upload_id: "UploadAbc12345", playback_ids: [{ id: "Sig00000001", policy: "signed" }] } });

function sign(body: string, secret = SECRET) {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

function request(body: string, signature: string | null) {
  return new Request("https://example.test/api/webhooks/mux", {
    method: "POST",
    body,
    headers: signature ? { "mux-signature": signature, "content-type": "application/json" } : { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubEnv("MUX_WEBHOOK_SECRET", SECRET);
  vi.mocked(reconcileUpload).mockReset();
  vi.mocked(reconcileUpload).mockResolvedValue({ kind: "ready", message: "done" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/webhooks/mux", () => {
  it("hands a correctly signed notification on as its upload id only, once, and answers 200 with a word", async () => {
    const response = await POST(request(BODY, sign(BODY)));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(reconcileUpload).toHaveBeenCalledTimes(1);
    expect(reconcileUpload).toHaveBeenCalledWith("UploadAbc12345");
  });

  it("answers 400 and hands NOTHING on for a missing, wrong or forged signature, or a changed body", async () => {
    const forgeries = [null, "nonsense", "t=1,v1=00", sign(BODY, "someone_elses_secret"), sign(BODY.replace("UploadAbc12345", "UploadAttacker"))];
    for (const signature of forgeries) {
      expect((await POST(request(BODY, signature))).status).toBe(400);
    }
    expect(reconcileUpload).not.toHaveBeenCalled();
  });

  it("checks the signature against the exact bytes sent: the same JSON re-spaced fails", async () => {
    const respaced = JSON.stringify(JSON.parse(BODY), null, 1);
    expect((await POST(request(respaced, sign(BODY)))).status).toBe(400);
    expect(reconcileUpload).not.toHaveBeenCalled();
  });

  it("answers 200 and does nothing for a kind it does not use, or a notification that names no upload", async () => {
    const created = JSON.stringify({ type: "video.asset.created", data: { id: "AssetAbc12345", upload_id: "UploadAbc12345" } });
    expect(await (await POST(request(created, sign(created)))).text()).toBe("ignored");
    const noUpload = JSON.stringify({ type: "video.asset.ready", data: { id: "AssetAbc12345" } });
    expect(await (await POST(request(noUpload, sign(noUpload)))).text()).toBe("ignored");
    const junk = JSON.stringify({ hello: "world" });
    expect(await (await POST(request(junk, sign(junk)))).text()).toBe("ignored");
    expect(reconcileUpload).not.toHaveBeenCalled();
  });

  it("answers 500 when the work fails, so that Mux sends it again, and gives no detail", async () => {
    vi.mocked(reconcileUpload).mockRejectedValue(new Error("database unreachable at host db.internal"));
    const response = await POST(request(BODY, sign(BODY)));
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("failed");
  });

  it("answers 503 with nothing read when the signing secret is not set on this deployment", async () => {
    vi.stubEnv("MUX_WEBHOOK_SECRET", "");
    const response = await POST(request(BODY, sign(BODY)));
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("not configured");
    expect(reconcileUpload).not.toHaveBeenCalled();
  });
});
