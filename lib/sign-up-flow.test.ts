import { describe, expect, it } from "vitest";
import { addPassword, checkCode, clerkErrorCode, problemFor, provisionalClinicName, resendCode, setUpProvisionalClinic, SIGN_UP_WORDS, startSignUp, type ClinicApi, type SignUpApi } from "./sign-up-flow";

/**
 * The steps of "Set up a clinic", against a stand-in for Clerk's sign-up
 * object. This proves our side: what is sent, which step comes next, and
 * the sentence for each refusal. It does not prove Clerk itself; a real
 * sign-up on the preview is the check for that (see the pull request).
 */

/** Clerk's answer from its servers, as its errors arrive: a list, each with a code. */
const refusal = (code: string) => ({ errors: [{ code, message: "developer text, never shown" }] });

type Calls = { create: unknown[]; password: unknown[]; send: number; verify: unknown[] };

/** A stand-in for Clerk. `password` says whether the dashboard still asks for one. */
function fakeClerk(options: { password?: boolean; createError?: unknown; sendError?: unknown; verifyError?: unknown; passwordError?: unknown; throwOnCreate?: unknown } = {}) {
  const calls: Calls = { create: [], password: [], send: 0, verify: [] };
  const state = { status: null as string | null, missingFields: [] as string[], unverifiedFields: [] as string[] };
  const api: SignUpApi = {
    get status() {
      return state.status;
    },
    get missingFields() {
      return state.missingFields;
    },
    get unverifiedFields() {
      return state.unverifiedFields;
    },
    async create(params) {
      calls.create.push(params);
      if (options.throwOnCreate) throw options.throwOnCreate;
      if (options.createError) return { error: options.createError };
      state.status = "missing_requirements";
      state.unverifiedFields = ["email_address"];
      state.missingFields = options.password ? ["password"] : [];
      return { error: null };
    },
    async password(params) {
      calls.password.push(params);
      if (options.passwordError) return { error: options.passwordError };
      state.missingFields = [];
      state.status = "complete";
      return { error: null };
    },
    verifications: {
      async sendEmailCode() {
        calls.send += 1;
        return { error: options.sendError ?? null };
      },
      async verifyEmailCode(params) {
        calls.verify.push(params);
        if (options.verifyError) return { error: options.verifyError };
        state.unverifiedFields = [];
        state.status = state.missingFields.length > 0 ? "missing_requirements" : "complete";
        return { error: null };
      },
    },
  };
  return { api, calls };
}

describe("step 1: name and work email", () => {
  it("asks Clerk to start a sign-up with the split name and the email, then to send the code", async () => {
    const { api, calls } = fakeClerk();
    expect(await startSignUp(api, { name: " Jane  Smith ", email: " jane@clinic.example " })).toEqual({ step: "code" });
    expect(calls.create).toEqual([{ firstName: "Jane", lastName: "Smith", emailAddress: "jane@clinic.example" }]);
    expect(calls.send).toBe(1);
  });

  it("refuses a one-word name or a broken email before asking Clerk anything", async () => {
    const { api, calls } = fakeClerk();
    expect(await startSignUp(api, { name: "Jane", email: "jane@clinic.example" })).toEqual({ problem: { message: SIGN_UP_WORDS.needName, field: "name" } });
    expect(await startSignUp(api, { name: "Jane Smith", email: "jane@clinic" })).toEqual({ problem: { message: SIGN_UP_WORDS.needEmail, field: "email" } });
    expect(calls.create).toHaveLength(0);
  });

  it("an email that already has an account offers Sign in instead", async () => {
    const { api } = fakeClerk({ createError: refusal("form_identifier_exists") });
    expect(await startSignUp(api, { name: "Jane Smith", email: "jane@clinic.example" })).toEqual({
      problem: { message: SIGN_UP_WORDS.emailTaken, field: "email", signInInstead: true },
    });
  });

  it("a lost connection is a plain sentence, never a crash", async () => {
    const { api } = fakeClerk({ throwOnCreate: new TypeError("Failed to fetch") });
    expect(await startSignUp(api, { name: "Jane Smith", email: "jane@clinic.example" })).toEqual({ problem: { message: SIGN_UP_WORDS.unreachable, field: null } });
  });

  it("a code that could not be sent says so", async () => {
    const { api } = fakeClerk({ sendError: refusal("too_many_requests") });
    expect(await startSignUp(api, { name: "Jane Smith", email: "jane@clinic.example" })).toEqual({ problem: { message: SIGN_UP_WORDS.tooMany, field: null } });
  });
});

describe("step 2: the code", () => {
  async function atCode(options: Parameters<typeof fakeClerk>[0] = {}) {
    const clerk = fakeClerk(options);
    await startSignUp(clerk.api, { name: "Jane Smith", email: "jane@clinic.example" });
    return clerk;
  }

  it("a right code with no password asked for finishes the account", async () => {
    const { api, calls } = await atCode();
    expect(await checkCode(api, "123 456")).toEqual({ step: "finish" });
    expect(calls.verify).toEqual([{ code: "123456" }]);
  });

  it("while Clerk's dashboard still asks for a password, the password box comes next", async () => {
    const { api } = await atCode({ password: true });
    expect(await checkCode(api, "123456")).toEqual({ step: "password" });
  });

  it("asks for six digits before sending anything", async () => {
    const { api, calls } = await atCode();
    expect(await checkCode(api, "12345")).toEqual({ problem: { message: SIGN_UP_WORDS.needCode, field: "code" } });
    expect(calls.verify).toHaveLength(0);
  });

  it("a wrong code and an expired code each get their own sentence", async () => {
    const wrong = await atCode({ verifyError: refusal("form_code_incorrect") });
    expect(await checkCode(wrong.api, "000000")).toEqual({ problem: { message: SIGN_UP_WORDS.wrongCode, field: "code" } });

    const expired = await atCode({ verifyError: refusal("verification_expired") });
    expect(await checkCode(expired.api, "000000")).toEqual({ problem: { message: SIGN_UP_WORDS.codeExpired, field: "code", needsNewCode: true } });
  });

  it("Send it again asks Clerk for a new code, and says so if it cannot", async () => {
    const ok = await atCode();
    expect(await resendCode(ok.api)).toEqual({});
    expect(ok.calls.send).toBe(2);

    const busy = await atCode();
    busy.api.verifications.sendEmailCode = async () => ({ error: refusal("too_many_requests") });
    expect(await resendCode(busy.api)).toEqual({ problem: { message: SIGN_UP_WORDS.tooMany, field: null } });
  });
});

describe("step 3: a password, only while Clerk asks", () => {
  it("hands the password to Clerk and finishes", async () => {
    const { api, calls } = fakeClerk({ password: true });
    await startSignUp(api, { name: "Jane Smith", email: "jane@clinic.example" });
    await checkCode(api, "123456");
    expect(await addPassword(api, "a long made-up passphrase")).toEqual({ step: "finish" });
    expect(calls.password).toEqual([{ password: "a long made-up passphrase" }]);
  });

  it("an empty box or a password Clerk refuses is a plain sentence", async () => {
    const { api } = fakeClerk({ password: true, passwordError: refusal("form_password_pwned") });
    expect(await addPassword(api, "")).toEqual({ problem: { message: SIGN_UP_WORDS.needPassword, field: "password" } });
    expect(await addPassword(api, "password")).toEqual({ problem: { message: SIGN_UP_WORDS.weakPassword, field: "password" } });
  });
});

describe("Clerk's errors", () => {
  it("reads the code from Clerk's list, from its own errors, or finds none", () => {
    expect(clerkErrorCode(refusal("form_code_incorrect"))).toBe("form_code_incorrect");
    expect(clerkErrorCode({ code: "captcha_invalid" })).toBe("captcha_invalid");
    expect(clerkErrorCode(new Error("x"))).toBeNull();
    expect(clerkErrorCode(null)).toBeNull();
  });

  it("never shows Clerk's own text, and anything unknown is the general sentence", () => {
    const problem = problemFor(refusal("something_new"), "details");
    expect(problem).toEqual({ message: SIGN_UP_WORDS.failed, field: null });
    expect(problemFor(refusal("captcha_invalid"), "details").message).toBe(SIGN_UP_WORDS.botCheck);
  });

  it("no sentence has an em dash", () => {
    for (const words of Object.values(SIGN_UP_WORDS)) expect(words).not.toContain("—");
  });
});

describe("the clinic after the account: a provisional name, never a second clinic", () => {
  function clinicApi(belongs: boolean | Error, fail: { create?: boolean; activate?: boolean } = {}) {
    const calls: string[] = [];
    const api: ClinicApi = {
      async hasClinicOrInvitation() {
        calls.push("ask");
        if (belongs instanceof Error) throw belongs;
        return belongs;
      },
      async createClinic(name) {
        calls.push(`create:${name}`);
        if (fail.create) throw new Error("made-up refusal");
        return "org_made_up";
      },
      async makeActive(id) {
        calls.push(`active:${id}`);
        if (fail.activate) throw new Error("made-up network failure");
      },
    };
    return { api, calls };
  }

  it("names it from the person's own name", () => {
    expect(provisionalClinicName("Jane Smith")).toBe("Jane Smith's clinic");
    expect(provisionalClinicName("  Mary Ann   Lee ")).toBe("Mary Ann Lee's clinic");
    expect(provisionalClinicName("Cher")).toBe("Your clinic");
  });

  it("a brand-new person: one clinic made, made active, and on they go", async () => {
    const { api, calls } = clinicApi(false);
    expect(await setUpProvisionalClinic(api, "Jane Smith")).toBe("made");
    expect(calls).toEqual(["ask", "create:Jane Smith's clinic", "active:org_made_up"]);
  });

  it("someone who already belongs to a clinic or holds an invitation is never given a new one: Clerk's own list instead", async () => {
    const { api, calls } = clinicApi(true);
    expect(await setUpProvisionalClinic(api, "Jane Smith")).toBe("choose");
    expect(calls).toEqual(["ask"]);
  });

  it("Clerk cannot be asked: nothing is made, Clerk's own form decides", async () => {
    const { api, calls } = clinicApi(new Error("made-up outage"));
    expect(await setUpProvisionalClinic(api, "Jane Smith")).toBe("choose");
    expect(calls).toEqual(["ask"]);
  });

  it("Clerk refuses to make it, or makes it and cannot make it active: Clerk's own form, which shows any clinic that exists", async () => {
    expect(await setUpProvisionalClinic(clinicApi(false, { create: true }).api, "Jane Smith")).toBe("choose");
    const later = clinicApi(false, { activate: true });
    expect(await setUpProvisionalClinic(later.api, "Jane Smith")).toBe("choose");
    expect(later.calls.filter((call) => call.startsWith("create:"))).toHaveLength(1);
  });
});
