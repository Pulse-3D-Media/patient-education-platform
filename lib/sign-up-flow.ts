import { cleanCode, looksLikeEmail, splitFullName } from "@/lib/landing";

/**
 * The steps of "Set up a clinic", the sign-up form on the landing page
 * (components/landing/SetUpClinicForm.tsx), kept apart from the form so they
 * can be tested without a browser or a real Clerk.
 *
 * Clerk is still the only sign-in system. These steps only call Clerk's own
 * sign-up object (useSignUp() from @clerk/nextjs, "custom flow" in Clerk's
 * words): Clerk makes the account, sends the email code, checks it, and
 * keeps the password if it asks for one. Nothing here stores a name, an
 * email, a code or a password anywhere of ours.
 *
 * The steps, as the person sees them:
 *
 *   1. details   "Your name" and "Work email", then Continue. Clerk is asked
 *                to start a sign-up and to email a six-digit code.
 *   2. code      "Code from your email", then Continue. Clerk checks it.
 *   3. password  Only if Clerk still says a password is missing. The design
 *                asks for no password, and Clerk asks for one only while the
 *                Clerk dashboard's "Password" setting is on (a vendor setting,
 *                Evan's). With it off, this step never appears.
 *   4. finish    The account is made. The form then hands over to Clerk to
 *                start the session (and, when Clerk requires it, to set up
 *                the clinic), exactly where a new account went before.
 *
 * Every step answers with the next step, or with a problem: one plain
 * sentence, and which box it is about. The form keeps what was typed either
 * way (CLAUDE.md, "A form keeps what was typed when something goes wrong").
 * Clerk's own error text is never shown: it is meant for developers, and it
 * could change. The sentences below are ours, chosen by Clerk's error code.
 */

/** The part of Clerk's sign-up object these steps use. Clerk's real one has more; tests pass a stand-in. */
export interface SignUpApi {
  readonly status: string | null;
  readonly missingFields: readonly string[];
  readonly unverifiedFields: readonly string[];
  create(params: { firstName: string; lastName: string; emailAddress: string }): Promise<{ error: unknown }>;
  password(params: { password: string }): Promise<{ error: unknown }>;
  verifications: {
    sendEmailCode(): Promise<{ error: unknown }>;
    verifyEmailCode(params: { code: string }): Promise<{ error: unknown }>;
  };
}

export type SignUpStep = "details" | "code" | "password" | "finish";

/** Which box a problem is about, so the form can mark it and put the cursor there. */
export type ProblemField = "name" | "email" | "code" | "password" | null;

export interface Problem {
  message: string;
  field: ProblemField;
  /** The email already has an account: the form offers the Sign in tab. */
  signInInstead?: boolean;
  /** The code ran out or was tried too often: the form points at "Send it again". */
  needsNewCode?: boolean;
}

export type StepResult = { step: SignUpStep; problem?: undefined } | { step?: undefined; problem: Problem };

/** The sentences, in one place, so tests and the form use the same words. */
export const SIGN_UP_WORDS = {
  needName: "Enter your first and last name.",
  needEmail: "Enter your work email, like name@clinic.com.",
  emailTaken: "That email already has an account. Sign in instead.",
  emailRefused: "That email cannot be used to sign up. Check it, or use another work email.",
  needCode: "Enter the six-digit code from the email.",
  wrongCode: "That code did not match. Check the email and try again.",
  codeExpired: "That code has run out. Send a new one below, then enter it.",
  needPassword: "Choose a password.",
  weakPassword: "Clerk did not accept that password. Choose a longer one that you have not used anywhere else.",
  tooMany: "Too many tries for now. Wait a minute, then try again.",
  botCheck: "We could not confirm this browser. Reload the page and try again.",
  unreachable: "We could not reach sign-in just now. Your entries are still here. Try again.",
  failed: "Something went wrong on our side. Your entries are still here. Try again.",
  stillLoading: "Sign-in is still loading. Wait a moment, then press Continue again.",
  sentAgain: "A new code is on its way.",
} as const;

/**
 * Clerk's error code from whatever a call handed back. Clerk's answer from
 * its servers carries a list of errors, each with a code; its own errors
 * carry one code. Anything else has none.
 */
export function clerkErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const list = (error as { errors?: unknown }).errors;
  if (Array.isArray(list) && list.length > 0) {
    const first = list[0] as { code?: unknown };
    if (typeof first?.code === "string") return first.code;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/** Is this a "no network" failure rather than an answer from Clerk? */
function isNetworkFailure(error: unknown): boolean {
  const code = clerkErrorCode(error);
  if (code === "network_error") return true;
  return error instanceof TypeError; // fetch() throws a TypeError when it cannot connect
}

/** Turns one of Clerk's error codes into our sentence and the box it is about. */
export function problemFor(error: unknown, during: "details" | "code" | "password" | "resend"): Problem {
  if (isNetworkFailure(error)) return { message: SIGN_UP_WORDS.unreachable, field: null };
  const code = clerkErrorCode(error) ?? "";

  if (code === "form_identifier_exists" || code === "identifier_already_signed_in") {
    return { message: SIGN_UP_WORDS.emailTaken, field: "email", signInInstead: true };
  }
  if (code === "too_many_requests" || code === "rate_limit_exceeded") return { message: SIGN_UP_WORDS.tooMany, field: null };
  if (code.startsWith("captcha_")) return { message: SIGN_UP_WORDS.botCheck, field: null };

  if (during === "details") {
    if (code === "form_param_format_invalid" || code === "form_param_nil" || code === "form_email_address_blocked" || code === "form_param_value_invalid") {
      return { message: code === "form_param_format_invalid" || code === "form_param_nil" ? SIGN_UP_WORDS.needEmail : SIGN_UP_WORDS.emailRefused, field: "email" };
    }
  }
  if (during === "code" || during === "resend") {
    if (code === "form_code_incorrect" || code === "form_param_format_invalid") return { message: SIGN_UP_WORDS.wrongCode, field: "code" };
    if (code === "verification_expired" || code === "verification_failed" || code === "form_code_expired") {
      return { message: SIGN_UP_WORDS.codeExpired, field: "code", needsNewCode: true };
    }
  }
  if (during === "password" && code.startsWith("form_password")) return { message: SIGN_UP_WORDS.weakPassword, field: "password" };

  return { message: SIGN_UP_WORDS.failed, field: null };
}

/** What comes after a successful call, read from where Clerk's sign-up now stands. */
function nextStep(api: SignUpApi): SignUpStep {
  if (api.status === "complete") return "finish";
  if (api.unverifiedFields.includes("email_address")) return "code";
  if (api.missingFields.includes("password")) return "password";
  // Anything else Clerk is still missing is a dashboard setting the design does not cover; the form says so plainly.
  return "details";
}

/** Runs one call to Clerk, turning a thrown error (a lost connection) into the same shape as an answered one. */
async function ask(call: () => Promise<{ error: unknown }>): Promise<unknown> {
  try {
    const { error } = await call();
    return error ?? null;
  } catch (thrown) {
    return thrown ?? new Error("unknown");
  }
}

/** Step 1: the name and the work email. Starts the sign-up and asks Clerk to email the code. */
export async function startSignUp(api: SignUpApi, typed: { name: string; email: string }): Promise<StepResult> {
  const name = splitFullName(typed.name);
  if (!name) return { problem: { message: SIGN_UP_WORDS.needName, field: "name" } };
  const email = typed.email.trim();
  if (!looksLikeEmail(email)) return { problem: { message: SIGN_UP_WORDS.needEmail, field: "email" } };

  const created = await ask(() => api.create({ ...name, emailAddress: email }));
  if (created) return { problem: problemFor(created, "details") };

  if (api.unverifiedFields.includes("email_address")) {
    const sent = await ask(() => api.verifications.sendEmailCode());
    if (sent) return { problem: problemFor(sent, "details") };
    return { step: "code" };
  }
  const step = nextStep(api);
  return step === "details" ? { problem: { message: SIGN_UP_WORDS.failed, field: null } } : { step };
}

/** Step 2: the six-digit code. */
export async function checkCode(api: SignUpApi, typed: string): Promise<StepResult> {
  const code = cleanCode(typed);
  if (!/^\d{6}$/.test(code)) return { problem: { message: SIGN_UP_WORDS.needCode, field: "code" } };

  const checked = await ask(() => api.verifications.verifyEmailCode({ code }));
  if (checked) return { problem: problemFor(checked, "code") };

  const step = nextStep(api);
  return step === "details" || step === "code" ? { problem: { message: SIGN_UP_WORDS.failed, field: null } } : { step };
}

/** "Send it again" under the code box. */
export async function resendCode(api: SignUpApi): Promise<{ problem?: Problem }> {
  const sent = await ask(() => api.verifications.sendEmailCode());
  return sent ? { problem: problemFor(sent, "resend") } : {};
}

/** Step 3, only while Clerk's dashboard still asks for a password. */
export async function addPassword(api: SignUpApi, password: string): Promise<StepResult> {
  if (password === "") return { problem: { message: SIGN_UP_WORDS.needPassword, field: "password" } };

  const saved = await ask(() => api.password({ password }));
  if (saved) return { problem: problemFor(saved, "password") };

  const step = nextStep(api);
  return step === "finish" ? { step } : { problem: { message: SIGN_UP_WORDS.failed, field: null } };
}

// ---------------------------------------------------------------------------
// The clinic, after the account: a provisional name, corrected later
// ---------------------------------------------------------------------------

/**
 * The design asks for the clinic's name AFTER payment (setup, pull request #5),
 * but Clerk needs a clinic (an organization) with a name before the new
 * person can go any further. So a brand-new owner's clinic is made with a
 * provisional name taken from their own name ("Jane Smith's clinic"), and
 * the real name is typed later: today on Clinic branding, where the existing
 * name sync sends it to Clerk and our database.
 *
 * Made through Clerk's own browser client (createOrganization, then
 * setActive), the same two calls Clerk's own "set up your clinic" form makes.
 * Clerk records the person as its creator, so they become the account owner
 * exactly as before (lib/clinic.ts). Our database row is still made the first
 * time the clinic is used, so there is nothing of ours that can fail halfway.
 *
 * Never a second clinic:
 *   - Someone who already belongs to a clinic, or has an invitation waiting,
 *     is never given one: they get Clerk's own list to pick from ("choose").
 *   - If Clerk cannot be asked, the answer is "choose" too: Clerk's own form,
 *     which shows any clinic that exists and lets them name one if none does.
 *   - The form runs this once per Continue (it refuses a second press while
 *     one is running), and a refresh afterwards finds the clinic already made
 *     and so lands on Clerk's list with that one clinic in it.
 */
export interface ClinicApi {
  /** Does this person already belong to a clinic, or have an invitation to one? */
  hasClinicOrInvitation(): Promise<boolean>;
  /** Make a clinic with this name; its id. */
  createClinic(name: string): Promise<string>;
  /** Make it the clinic this session is working in. */
  makeActive(clinicId: string): Promise<void>;
}

/** "Jane Smith's clinic", from the name typed at sign-up. "Your clinic" when there is none. */
export function provisionalClinicName(typedName: string): string {
  const name = splitFullName(typedName);
  if (!name) return "Your clinic";
  return `${name.firstName} ${name.lastName}'s clinic`.slice(0, 100);
}

/** "made": the clinic exists and is active, go on. "choose": show Clerk's own form instead. */
export async function setUpProvisionalClinic(api: ClinicApi, typedName: string): Promise<"made" | "choose"> {
  let belongs: boolean;
  try {
    belongs = await api.hasClinicOrInvitation();
  } catch {
    return "choose";
  }
  if (belongs) return "choose";

  let clinicId: string;
  try {
    clinicId = await api.createClinic(provisionalClinicName(typedName));
  } catch {
    return "choose";
  }
  try {
    await api.makeActive(clinicId);
  } catch {
    // The clinic exists; Clerk's list shows it, and picking it finishes the step.
    return "choose";
  }
  return "made";
}
