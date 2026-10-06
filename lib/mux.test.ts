import { createVerify, generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkPlaybackId, muxIsConfigured, signPlaybackToken, signedPlaylistUrl, signedThumbnailUrl, type MuxEnv } from "./mux";

/**
 * Signing a Mux playback token, with a key pair made here and never a real
 * one. What these prove: the token is a real RS256 signature over the
 * claims Mux documents (the playback id, the audience, the expiry, the key
 * id), a still's options ride in the token and never on the address, the
 * address carries nothing but the token, a missing or damaged key means
 * nothing is signed, and the check of a playback id against Mux reads the
 * two answers the right way round without a word of the body or the token
 * reaching the log. Mux itself is a stand-in: the real check is a staff
 * member saving a real signed id on a deployment with the key in place.
 */

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const ENV: MuxEnv = { MUX_SIGNING_KEY_ID: "testkey0001", MUX_SIGNING_PRIVATE_KEY: Buffer.from(PEM).toString("base64") };
const ID = "PlaybackId00AbCdEf";
const EXPIRES = new Date("2026-10-05T13:00:00Z");

/** Read a token back: header, claims, and whether the signature is this key's. */
function open(token: string) {
  const [header, claims, signature] = token.split(".");
  const read = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
  const valid = createVerify("RSA-SHA256")
    .update(`${header}.${claims}`)
    .verify(publicKey, Buffer.from(signature, "base64url"));
  return { header: read(header), claims: read(claims), valid };
}

afterEach(() => vi.restoreAllMocks());

describe("muxIsConfigured", () => {
  it("needs both settings, and a key that reads as a PEM key, base64 or plain", () => {
    expect(muxIsConfigured(ENV)).toBe(true);
    expect(muxIsConfigured({ MUX_SIGNING_KEY_ID: "testkey0001", MUX_SIGNING_PRIVATE_KEY: PEM })).toBe(true);
    expect(muxIsConfigured({ MUX_SIGNING_KEY_ID: "testkey0001" })).toBe(false);
    expect(muxIsConfigured({ MUX_SIGNING_PRIVATE_KEY: PEM })).toBe(false);
    expect(muxIsConfigured({ MUX_SIGNING_KEY_ID: "testkey0001", MUX_SIGNING_PRIVATE_KEY: "not a key" })).toBe(false);
    expect(muxIsConfigured({ MUX_SIGNING_KEY_ID: " ", MUX_SIGNING_PRIVATE_KEY: PEM })).toBe(false);
    expect(muxIsConfigured({})).toBe(false);
  });
});

describe("signPlaybackToken", () => {
  it("signs the claims Mux documents, with this key, for the video", () => {
    const token = signPlaybackToken(ID, "video", EXPIRES, {}, ENV);
    const { header, claims, valid } = open(token);

    expect(valid).toBe(true);
    expect(header).toEqual({ alg: "RS256", typ: "JWT", kid: "testkey0001" });
    expect(claims).toEqual({ sub: ID, aud: "v", exp: Math.floor(EXPIRES.getTime() / 1000), kid: "testkey0001" });
  });

  it("uses the thumbnail audience for a still, with its options as claims", () => {
    const { claims, valid } = open(signPlaybackToken(ID, "thumbnail", EXPIRES, { time: 1, width: 640 }, ENV));

    expect(valid).toBe(true);
    expect(claims).toMatchObject({ sub: ID, aud: "t", time: 1, width: 640 });
  });

  it("never puts a still's options on a video token", () => {
    const { claims } = open(signPlaybackToken(ID, "video", EXPIRES, { time: 1, width: 640 }, ENV));
    expect(claims).not.toHaveProperty("time");
    expect(claims).not.toHaveProperty("width");
  });

  it("a token for one playback id does not verify as another's, and a changed claim breaks the signature", () => {
    const token = signPlaybackToken(ID, "video", EXPIRES, {}, ENV);
    const [header, , signature] = token.split(".");
    const forgedClaims = Buffer.from(JSON.stringify({ sub: "OtherVideo00AbCd", aud: "v", exp: 9_999_999_999, kid: "testkey0001" })).toString("base64url");
    expect(open(`${header}.${forgedClaims}.${signature}`).valid).toBe(false);
  });

  it("refuses to sign without the settings, with a damaged key, or for something that is not a playback id", () => {
    expect(() => signPlaybackToken(ID, "video", EXPIRES, {}, {})).toThrow(/not configured/);
    expect(() => signPlaybackToken(ID, "video", EXPIRES, {}, { MUX_SIGNING_KEY_ID: "k", MUX_SIGNING_PRIVATE_KEY: "nope" })).toThrow(/not configured/);
    expect(() => signPlaybackToken("has/slash00", "video", EXPIRES, {}, ENV)).toThrow(/playback id/);
  });
});

describe("the signed addresses", () => {
  it("carry the token and nothing else, on Mux's own hosts", () => {
    const playlist = new URL(signedPlaylistUrl(ID, EXPIRES, ENV));
    expect(playlist.origin).toBe("https://stream.mux.com");
    expect(playlist.pathname).toBe(`/${ID}.m3u8`);
    expect([...playlist.searchParams.keys()]).toEqual(["token"]);
    expect(open(playlist.searchParams.get("token")!).claims).toMatchObject({ aud: "v" });

    const still = new URL(signedThumbnailUrl(ID, EXPIRES, { time: 1, width: 640 }, ENV));
    expect(still.origin).toBe("https://image.mux.com");
    expect(still.pathname).toBe(`/${ID}/thumbnail.jpg`);
    expect([...still.searchParams.keys()]).toEqual(["token"]);
    expect(open(still.searchParams.get("token")!).claims).toMatchObject({ aud: "t", time: 1, width: 640 });
  });
});

describe("checkPlaybackId", () => {
  /** A Mux that answers the plain request one way and the signed request another. */
  function mux(unsigned: number, signed: number) {
    const calls: string[] = [];
    const ask = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      const status = url.includes("token=") ? signed : unsigned;
      return new Response("playlist or refusal body that must never be read", { status });
    });
    return { ask: ask as unknown as typeof fetch, calls };
  }

  it("accepts an id Mux refuses without a token and answers with ours", async () => {
    const { ask, calls } = mux(403, 200);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await checkPlaybackId(ID, { env: ENV, fetch: ask })).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe(`https://stream.mux.com/${ID}.m3u8`);
    expect(calls[1]).toMatch(new RegExp(`^https://stream\\.mux\\.com/${ID}\\.m3u8\\?token=`));
    expect(log).not.toHaveBeenCalled();
  });

  it("refuses an id Mux plays without a token: its policy is public", async () => {
    const { ask, calls } = mux(200, 200);
    const result = await checkPlaybackId(ID, { env: ENV, fetch: ask });
    expect(result).toMatchObject({ ok: false, reason: "public" });
    // Nothing signed was even sent for it.
    expect(calls).toHaveLength(1);
  });

  it("refuses an id Mux will not open with our key, saying the status in words and logging only the status", async () => {
    const { ask } = mux(404, 404);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await checkPlaybackId(ID, { env: ENV, fetch: ask });
    expect(result).toMatchObject({ ok: false, reason: "refused", message: expect.stringContaining("404") });
    expect(log).toHaveBeenCalledTimes(1);
    const line = log.mock.calls[0].map(String).join(" ");
    expect(line).not.toContain("token");
    expect(line).not.toContain(ID);
    expect(line).not.toContain("never be read");
  });

  it("refuses without Mux configured, and refuses a malformed id before asking anyone", async () => {
    const { ask, calls } = mux(403, 200);
    expect(await checkPlaybackId(ID, { env: {}, fetch: ask })).toMatchObject({ ok: false, reason: "not-configured" });
    expect(await checkPlaybackId("not an id", { env: ENV, fetch: ask })).toMatchObject({ ok: false, reason: "bad-id" });
    expect(calls).toHaveLength(0);
  });

  it("answers calmly when Mux cannot be reached, logging the kind of failure only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const ask = vi.fn(async () => {
      throw Object.assign(new Error(`connect ECONNREFUSED https://stream.mux.com/${ID}.m3u8?token=secret`), { name: "TypeError" });
    }) as unknown as typeof fetch;

    expect(await checkPlaybackId(ID, { env: ENV, fetch: ask })).toMatchObject({ ok: false, reason: "unreachable" });
    const line = log.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
    expect(line).toContain("TypeError");
    expect(line).not.toContain("secret");
    expect(line).not.toContain(ID);
  });
});
