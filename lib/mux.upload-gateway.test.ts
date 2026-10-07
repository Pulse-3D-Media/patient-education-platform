import { createHmac, generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MuxApiError,
  MuxSignatureError,
  UPLOAD_TIMEOUT_SECONDS,
  UPLOAD_VIDEO_QUALITY,
  WEBHOOK_TOLERANCE_SECONDS,
  getMuxWebhookSecret,
  makeMuxUploadGateway,
  muxUploadsAreConfigured,
  verifyMuxWebhook,
  type MuxEnv,
} from "./mux";

/**
 * The two parts of lib/mux.ts that uploading adds, without Mux: exactly
 * what Mux's API is asked (with `fetch` a stand-in), and the webhook
 * signature check (Mux's own arithmetic, with a made-up secret). Nothing
 * here holds a real token, key or secret.
 */

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const SIGNING: MuxEnv = { MUX_SIGNING_KEY_ID: "testkey0001", MUX_SIGNING_PRIVATE_KEY: Buffer.from(PEM).toString("base64") };
const ENV: MuxEnv = { ...SIGNING, MUX_TOKEN_ID: "tokenid-madeup", MUX_TOKEN_SECRET: "tokensecret-madeup" };

afterEach(() => vi.restoreAllMocks());

/** A fetch stand-in that records what it was asked and answers with the given status and body. */
function fakeFetch(answers: { status: number; body?: unknown }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const ask = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const answer = answers.shift() ?? { status: 500 };
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { ask, calls };
}

describe("muxUploadsAreConfigured", () => {
  it("needs the access token AND the signing key: a signed asset would play for nobody without the key", () => {
    expect(muxUploadsAreConfigured(ENV)).toBe(true);
    expect(muxUploadsAreConfigured({ ...ENV, MUX_TOKEN_SECRET: " " })).toBe(false);
    expect(muxUploadsAreConfigured({ ...ENV, MUX_TOKEN_ID: undefined })).toBe(false);
    expect(muxUploadsAreConfigured({ MUX_TOKEN_ID: "tokenid-madeup", MUX_TOKEN_SECRET: "tokensecret-madeup" })).toBe(false);
    expect(muxUploadsAreConfigured({})).toBe(false);
  });
});

describe("the upload gateway", () => {
  it("asks Mux for an upload with the SIGNED policy, the chosen quality, the deployment's origin and nothing else, signed in with the token", async () => {
    const { ask, calls } = fakeFetch([{ status: 201, body: { data: { id: "UploadAbc12345", url: "https://storage.googleapis.com/bucket/one-time", status: "waiting" } } }]);
    const gateway = makeMuxUploadGateway({ env: ENV, fetch: ask });

    expect(await gateway.createUpload({ corsOrigin: "https://learn.example.test", title: "Total Knee Replacement", externalId: "clz0000000000000000000000" })).toEqual({
      id: "UploadAbc12345",
      url: "https://storage.googleapis.com/bucket/one-time",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.mux.com/video/v1/uploads");
    expect(calls[0].init.method).toBe("POST");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Basic ${Buffer.from("tokenid-madeup:tokensecret-madeup").toString("base64")}`);
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(body).toEqual({
      cors_origin: "https://learn.example.test",
      timeout: UPLOAD_TIMEOUT_SECONDS,
      new_asset_settings: {
        playback_policies: ["signed"],
        video_quality: UPLOAD_VIDEO_QUALITY,
        // The video's title and id, so the asset reads as the video in the Mux dashboard.
        meta: { title: "Total Knee Replacement", external_id: "clz0000000000000000000000" },
      },
    });
    expect(UPLOAD_VIDEO_QUALITY).toBe("basic");
    // No MP4 downloads, no captions, no public policy, however the settings are spelt.
    expect(JSON.stringify(body)).not.toMatch(/static_renditions|mp4_support|generate_subtitles|public/);
  });

  it("reads an upload and an asset the way Mux spells them, and answers null for an id Mux does not know", async () => {
    const { ask, calls } = fakeFetch([
      { status: 200, body: { data: { id: "UploadAbc12345", status: "asset_created", asset_id: "AssetAbc12345" } } },
      { status: 200, body: { data: { id: "AssetAbc12345", status: "ready", duration: 125.4, upload_id: "UploadAbc12345", playback_ids: [{ id: "Pub00000001", policy: "public" }, { id: "Sig00000001", policy: "signed" }] } } },
      { status: 404, body: { error: { type: "not_found", messages: ["Not found"] } } },
      { status: 404 },
    ]);
    const gateway = makeMuxUploadGateway({ env: ENV, fetch: ask });

    expect(await gateway.getUpload("UploadAbc12345")).toEqual({ id: "UploadAbc12345", status: "asset_created", assetId: "AssetAbc12345" });
    expect(await gateway.getAsset("AssetAbc12345")).toEqual({
      id: "AssetAbc12345",
      status: "ready",
      durationSeconds: 125,
      uploadId: "UploadAbc12345",
      playbackIds: [
        { id: "Pub00000001", policy: "public" },
        { id: "Sig00000001", policy: "signed" },
      ],
    });
    expect(await gateway.getUpload("UploadGone0000")).toBeNull();
    expect(await gateway.getAsset("AssetGone00000")).toBeNull();
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.mux.com/video/v1/uploads/UploadAbc12345",
      "https://api.mux.com/video/v1/assets/AssetAbc12345",
      "https://api.mux.com/video/v1/uploads/UploadGone0000",
      "https://api.mux.com/video/v1/assets/AssetGone00000",
    ]);
    expect(calls.every((call) => call.init.method === "GET")).toBe(true);
  });

  it("reads a status it has never heard of as the harmless one (waiting, preparing), and a missing duration as none", async () => {
    const { ask } = fakeFetch([
      { status: 200, body: { data: { id: "UploadAbc12345", status: "something_new" } } },
      { status: 200, body: { data: { id: "AssetAbc12345", status: "mystery", playback_ids: "not a list" } } },
    ]);
    const gateway = makeMuxUploadGateway({ env: ENV, fetch: ask });
    expect(await gateway.getUpload("UploadAbc12345")).toEqual({ id: "UploadAbc12345", status: "waiting", assetId: null });
    expect(await gateway.getAsset("AssetAbc12345")).toEqual({ id: "AssetAbc12345", status: "preparing", durationSeconds: null, uploadId: null, playbackIds: [] });
  });

  it("cancels with a PUT to the cancel address, and throws the status (never the body) when Mux refuses anything", async () => {
    const { ask, calls } = fakeFetch([{ status: 200, body: { data: { id: "UploadAbc12345", status: "cancelled" } } }, { status: 400, body: { error: { messages: ["secret-looking detail"] } } }]);
    const gateway = makeMuxUploadGateway({ env: ENV, fetch: ask });

    await gateway.cancelUpload("UploadAbc12345");
    expect(calls[0]).toMatchObject({ url: "https://api.mux.com/video/v1/uploads/UploadAbc12345/cancel", init: { method: "PUT" } });

    const refused = await gateway.cancelUpload("UploadAbc12345").catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(MuxApiError);
    expect((refused as MuxApiError).status).toBe(400);
    expect((refused as Error).message).not.toContain("secret-looking");
  });

  it("refuses to call Mux at all without the token", async () => {
    const { ask, calls } = fakeFetch([]);
    const gateway = makeMuxUploadGateway({ env: SIGNING, fetch: ask });
    await expect(gateway.createUpload({ corsOrigin: "https://learn.example.test", title: "Any", externalId: "any" })).rejects.toMatchObject({ name: "MuxConfigError" });
    expect(calls).toHaveLength(0);
  });
});

describe("verifyMuxWebhook", () => {
  const SECRET = "whsec_madeup_for_mux";
  const NOW = new Date("2026-10-06T12:00:00Z");
  const BODY = JSON.stringify({ type: "video.asset.ready", id: "evt-madeup", data: { id: "AssetAbc12345", upload_id: "UploadAbc12345" } });

  function sign(body: string, options: { secret?: string; at?: Date } = {}) {
    const t = Math.floor((options.at ?? NOW).getTime() / 1000);
    const v1 = createHmac("sha256", options.secret ?? SECRET).update(`${t}.${body}`).digest("hex");
    return `t=${t},v1=${v1}`;
  }

  it("accepts Mux's own signature over the exact bytes and hands the body back as JSON", () => {
    expect(verifyMuxWebhook(BODY, sign(BODY), SECRET, NOW)).toEqual(JSON.parse(BODY));
    // A second signature in the header (Mux does this while a secret is being rotated) is fine when either matches.
    expect(verifyMuxWebhook(BODY, `${sign(BODY, { secret: "old" })},v1=${sign(BODY).split("v1=")[1]}`, SECRET, NOW)).toEqual(JSON.parse(BODY));
  });

  it("refuses a missing, forged or re-keyed signature, a changed body, and the same JSON re-spaced", () => {
    const forgeries: (string | null)[] = [null, "", "nonsense", "t=1,v1=00", sign(BODY, { secret: "someone_elses" }), sign(BODY.replace("UploadAbc12345", "UploadAttacker"))];
    for (const header of forgeries) {
      expect(() => verifyMuxWebhook(BODY, header, SECRET, NOW), String(header)).toThrow(MuxSignatureError);
    }
    const respaced = JSON.stringify(JSON.parse(BODY), null, 1);
    expect(() => verifyMuxWebhook(respaced, sign(BODY), SECRET, NOW)).toThrow(MuxSignatureError);
  });

  it("refuses a notification older than the tolerance, as a replay, and takes one just inside it", () => {
    const old = new Date(NOW.getTime() - (WEBHOOK_TOLERANCE_SECONDS + 1) * 1000);
    expect(() => verifyMuxWebhook(BODY, sign(BODY, { at: old }), SECRET, NOW)).toThrow(/too old/);
    const inside = new Date(NOW.getTime() - (WEBHOOK_TOLERANCE_SECONDS - 1) * 1000);
    expect(verifyMuxWebhook(BODY, sign(BODY, { at: inside }), SECRET, NOW)).toEqual(JSON.parse(BODY));
  });

  it("refuses a correctly signed body that is not JSON, and reads the secret only from the setting", () => {
    expect(() => verifyMuxWebhook("not json", sign("not json"), SECRET, NOW)).toThrow(/not JSON/);
    expect(getMuxWebhookSecret({ MUX_WEBHOOK_SECRET: " abc " })).toBe("abc");
    expect(() => getMuxWebhookSecret({})).toThrow(/MUX_WEBHOOK_SECRET/);
  });
});
