"use client";

import { ClerkFailed, TaskChooseOrganization, useAuth, useSignUp } from "@clerk/nextjs";
import { useState, type FormEvent } from "react";
import { safeReturnPath, tabHref } from "@/lib/landing";
import { addPassword, checkCode, resendCode, SIGN_UP_WORDS, startSignUp, type Problem, type SignUpApi, type SignUpStep } from "@/lib/sign-up-flow";
import { BOX_APPEARANCE } from "./clerk-look";

/**
 * "Set up a clinic": sign-up step one in the landing page's box (the
 * approved design, screens 02-signup-1 and 1b). Your name and your work
 * email, then the six-digit code Clerk emails. No password and no credential
 * are asked for (decided by Evan, 2026-11-19; the credential is added later
 * on People).
 *
 * Clerk is still the only sign-in system. Clerk's ready-made sign-up form
 * cannot be limited to these two boxes, so this uses Clerk's own sign-up
 * object instead (useSignUp, a "custom flow" in Clerk's words, part of
 * @clerk/nextjs). The steps and their sentences are in lib/sign-up-flow.ts.
 *
 * What still decides on Clerk's side: while the Clerk dashboard's "Password"
 * setting is on, Clerk will not finish an account without one, so a third
 * box, "Choose a password", appears after the code. Turning that setting off
 * (Evan's, in the Clerk dashboard) makes it disappear with no code change.
 *
 * When the account is made, Clerk starts the session and the new person goes
 * where a new account always went: the page they were sent from, if they
 * came from one, otherwise /onboarding. If Clerk asks them to set up their
 * clinic first (the "choose an organization" step Clerk adds when the
 * dashboard requires an organization), Clerk's own form for that is shown in
 * the box, exactly the step Clerk's ready-made form showed before. Nothing
 * here creates the clinic.
 *
 * Every box keeps what was typed when something goes wrong: the boxes hold
 * their own values here (React only empties a form it sent as an action, and
 * this one is never sent that way), and every problem is one plain sentence
 * with the box it is about.
 *
 * Google: "Continue with Google" under the boxes, as drawn, starts Clerk's
 * own Google sign-up and comes back through /sign-up/sso-callback.
 */
export function SetUpClinicForm({ redirectUrl }: { redirectUrl?: string }) {
  const { signUp } = useSignUp();
  const { isLoaded } = useAuth();

  const [step, setStep] = useState<SignUpStep | "clinic">("details");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Where the new account goes once Clerk has finished with it (the page it came from, or /onboarding). */
  const [destination, setDestination] = useState("/onboarding");

  // Clerk's sign-up object is shaped like SignUpApi (lib/sign-up-flow.ts lists the parts used).
  const api = signUp as unknown as SignUpApi;

  /** Runs one step, one at a time, keeping every box as typed. */
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setProblem(null);
    setNote(null);
    if (!isLoaded) {
      setProblem({ message: SIGN_UP_WORDS.stillLoading, field: null });
      return;
    }
    setBusy(true);
    try {
      await work();
    } catch {
      setProblem({ message: SIGN_UP_WORDS.unreachable, field: null });
    } finally {
      setBusy(false);
    }
  }

  /** The account exists: Clerk starts the session, then off to where a new account goes. */
  async function finish() {
    const goTo = safeReturnPath(redirectUrl, window.location.origin);
    setDestination(goTo);
    const { error } = await signUp.finalize({
      navigate: async ({ session, decorateUrl }) => {
        if (session?.currentTask) {
          // Clerk wants the clinic set up first: its own form, in the box (see the top of this file).
          setStep("clinic");
          return;
        }
        // A full page load, so the server sees the new session at once.
        window.location.assign(decorateUrl(goTo));
      },
    });
    if (error) setProblem({ message: SIGN_UP_WORDS.failed, field: null });
  }

  function onDetails(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const result = await startSignUp(api, { name, email });
      if (result.problem) return setProblem(result.problem);
      if (result.step === "finish") return finish();
      setStep(result.step);
    });
  }

  function onCode(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const result = await checkCode(api, code);
      if (result.problem) return setProblem(result.problem);
      if (result.step === "finish") return finish();
      setStep(result.step);
    });
  }

  function onPassword(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const result = await addPassword(api, password);
      if (result.problem) return setProblem(result.problem);
      return finish();
    });
  }

  function onSendAgain() {
    void run(async () => {
      const result = await resendCode(api);
      if (result.problem) return setProblem(result.problem);
      setCode("");
      setNote(SIGN_UP_WORDS.sentAgain);
    });
  }

  function onChangeEmail() {
    // Back to the first step with the name and email as typed; Clerk's half-made sign-up is dropped.
    void signUp.reset();
    setCode("");
    setPassword("");
    setProblem(null);
    setNote(null);
    setStep("details");
  }

  function onGoogle() {
    void run(async () => {
      const { error } = await signUp.sso({
        strategy: "oauth_google",
        redirectUrl: safeReturnPath(redirectUrl, window.location.origin),
        redirectCallbackUrl: "/sign-up/sso-callback",
      });
      if (error) setProblem({ message: SIGN_UP_WORDS.failed, field: null });
    });
  }

  if (step === "clinic") {
    return <TaskChooseOrganization redirectUrlComplete={destination} appearance={BOX_APPEARANCE} />;
  }

  const label = "mb-1.5 block text-[0.9375rem] font-semibold text-ink";
  const box = (field: Problem["field"]) =>
    `block min-h-[50px] w-full rounded-xl border bg-field px-3.5 text-[1rem] text-ink ${problem?.field === field ? "border-problem" : "border-line-strong"}`;
  const primary =
    "inline-flex min-h-[54px] w-full items-center justify-center gap-2.5 rounded-full bg-brand px-6 text-[1rem] font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60";
  const linkButton = "font-semibold text-brand-bright underline underline-offset-2 hover:text-ink disabled:opacity-60";

  const problemLine = problem ? (
    <p role="alert" className="mb-4 text-[0.9375rem] font-medium text-problem">
      {problem.message}
      {problem.signInInstead ? (
        <>
          {" "}
          <a href={tabHref("/sign-in", redirectUrl)} className="text-brand-bright underline underline-offset-2">
            Go to Sign in
          </a>
        </>
      ) : null}
    </p>
  ) : null;

  const continueButton = (
    <button type="submit" className={primary} disabled={busy}>
      {busy ? "One moment" : "Continue"}
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );

  return (
    <div>
      <ClerkFailed>
        <p role="alert" className="mb-4 text-[0.9375rem] font-medium text-problem">
          We could not reach sign-in just now. Check your connection and reload the page.
        </p>
      </ClerkFailed>

      {step === "details" ? (
        <form onSubmit={onDetails} noValidate>
          {problemLine}
          <div className="mb-4">
            <label htmlFor="setup-name" className={label}>
              Your name
            </label>
            <input id="setup-name" type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={box("name")} aria-invalid={problem?.field === "name" || undefined} />
          </div>
          <div className="mb-4">
            <label htmlFor="setup-email" className={label}>
              Work email
            </label>
            <input
              id="setup-email"
              type="email"
              autoComplete="email"
              placeholder="name@clinic.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={box("email")}
              aria-invalid={problem?.field === "email" || undefined}
            />
          </div>
          {/* Clerk's bot check draws itself here when it needs to (Clerk's custom flows require this element). */}
          <div id="clerk-captcha" />
          {continueButton}
          <p className="my-[18px] flex items-center gap-3 text-[0.875rem] text-ink-muted before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">or</p>
          <button
            type="button"
            onClick={onGoogle}
            disabled={busy}
            className="inline-flex min-h-[54px] w-full items-center justify-center rounded-full border border-line-strong px-6 text-[1rem] font-semibold text-ink hover:bg-wash disabled:opacity-60"
          >
            Continue with Google
          </button>
        </form>
      ) : null}

      {step === "code" ? (
        <form onSubmit={onCode} noValidate>
          {problemLine}
          <div className="mb-4">
            <label htmlFor="setup-code" className={label}>
              Code from your email
            </label>
            <input
              id="setup-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              placeholder="6 digits"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={box("code")}
              aria-invalid={problem?.field === "code" || undefined}
              autoFocus
            />
          </div>
          {continueButton}
          <p className="mt-4 text-center text-[0.8125rem] text-ink-muted">
            Sent to {email.trim()}.{" "}
            <button type="button" onClick={onSendAgain} disabled={busy} className={linkButton}>
              Send it again
            </button>{" "}
            ·{" "}
            <button type="button" onClick={onChangeEmail} disabled={busy} className={linkButton}>
              Change email
            </button>
          </p>
          {note ? (
            <p role="status" className="mt-2 text-center text-[0.8125rem] text-ink-muted">
              {note}
            </p>
          ) : null}
        </form>
      ) : null}

      {step === "password" ? (
        <form onSubmit={onPassword} noValidate>
          {problemLine}
          <input type="email" autoComplete="username" value={email.trim()} readOnly hidden />
          <div className="mb-4">
            <label htmlFor="setup-password" className={label}>
              Choose a password
            </label>
            <input
              id="setup-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={box("password")}
              aria-invalid={problem?.field === "password" || undefined}
              autoFocus
            />
          </div>
          {continueButton}
        </form>
      ) : null}
    </div>
  );
}
