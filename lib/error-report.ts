import type { EmailMessage } from "./email";

/**
 * What the app says about a server error when it tells someone: one
 * scrubbed record, built here and nowhere else, so that nothing which must
 * not leave the server ever does (rules 2 and 7 in CLAUDE.md).
 *
 * KEPT: when it happened; which deployment (production, preview, or a
 * developer's computer, and the short commit id); the route PATTERN as it
 * is written in the app folder ("/watch/[code]", never the actual code);
 * the request method; whether it was a page, a route handler, a Server
 * Action or the proxy; the error's kind (its class name, such as
 * PrismaClientInitializationError); and its digest, the short identifier
 * Next.js prints in the server log beside the full error, so the two can
 * be matched up.
 *
 * LEFT OUT, on purpose: the address that was opened (a patient link
 * carries its share code), every header (cookies, the session), the body
 * (never given to us anyway), and the error's message and stack (a
 * database error can quote a connection string or SQL, a Clerk error an
 * email address). The full error stays in the server log, which Vercel
 * keeps for the project.
 *
 * Pure: no database, no email sending, no Next.js. instrumentation.ts at
 * the root uses it; lib/error-report.test.ts proves what gets through.
 */

/** The scrubbed record. Every field is a short plain string. */
export type ErrorReport = {
  /** When, as an ISO time. */
  when: string;
  /** "production", "preview", "development" (Vercel's names) or "local" on a developer's computer. */
  environment: string;
  /** The first seven characters of the deployed commit, or null when not on Vercel. */
  commit: string | null;
  /** The route pattern from the app folder: "/watch/[code]", "/api/health", "/admin/links". */
  route: string;
  method: string;
  /** "page", "route handler", "action" (a Server Action) or "proxy". */
  kind: string;
  /** The error's class name. */
  errorName: string;
  /** Next.js's identifier for the error, or null. Only letters, digits, underscore and hyphen get through. */
  digest: string | null;
};

/** What Next.js hands onRequestError about the request. Only the method is read; the rest is typed so it is clear it exists and is left alone. */
export type RequestFacts = { method: string; path?: string; headers?: unknown };

/** What Next.js hands onRequestError about where the error happened. */
export type ContextFacts = { routePath: string; routeType: string };

/** The settings read: Vercel's two deployment facts and the alert address. The index signature lets process.env be passed as is. */
export type ReportEnv = { VERCEL_ENV?: string; VERCEL_GIT_COMMIT_SHA?: string; ERROR_ALERT_EMAIL?: string; [name: string]: string | undefined };

/** Next.js's names for where an error happened, in plain words. */
const KINDS: Record<string, string> = { render: "page", route: "route handler", action: "action", proxy: "proxy" };

/** Only a short identifier gets through as a digest or a name: never a sentence, never punctuation that could carry one. */
const SAFE_WORD = /^[\w.-]{1,80}$/;

function safeWord(value: unknown, fallback: string): string {
  return typeof value === "string" && SAFE_WORD.test(value) ? value : fallback;
}

/** The scrubbed record for one error. `now` is passed in so the tests can fix the time. */
export function describeRequestError(error: unknown, request: RequestFacts, context: ContextFacts, env: ReportEnv, now: Date): ErrorReport {
  const sha = env.VERCEL_GIT_COMMIT_SHA?.trim();
  const digest = typeof error === "object" && error !== null && "digest" in error ? (error as { digest: unknown }).digest : null;
  return {
    when: now.toISOString(),
    environment: env.VERCEL_ENV?.trim() || "local",
    commit: sha ? sha.slice(0, 7) : null,
    route: safeRoute(context.routePath),
    method: safeWord(request.method, "unknown"),
    kind: KINDS[context.routeType] ?? safeWord(context.routeType, "unknown"),
    errorName: error instanceof Error ? safeWord(error.name, "Error") : typeof error,
    digest: digest === null ? null : safeWord(digest, "") || null,
  };
}

/** A route pattern is made of segments like "watch", "[code]", "[...rest]", "(group)". Anything else is not a pattern and is not passed on. */
function safeRoute(routePath: unknown): string {
  return typeof routePath === "string" && /^\/[\w\-\[\]().@/]{0,200}$/.test(routePath) ? routePath : "unknown";
}

/** How long one alert covers repeats of the same error: ten minutes. */
export const ALERT_WINDOW_MS = 10 * 60_000;

/**
 * The most alert emails in one ten-minute window for one route, kind and
 * error name, however many different errors that is. A digest is worked out
 * from the error's text, and some error text can vary with the request, so
 * "one email per distinct error" alone has no upper limit.
 */
export const ALERT_CEILING = 3;

/** Which ten-minute window a moment falls in. */
export function alertWindow(now: Date): number {
  return Math.floor(now.getTime() / ALERT_WINDOW_MS);
}

/** What makes two reports "the same error" on one server: the digest, or the class name when there is none. */
export function distinctError(report: ErrorReport): string {
  return report.digest ?? report.errorName;
}

/**
 * The group the ceiling counts within: deployment type, route, kind and error
 * name. The route and the kind are in it because an error with no digest
 * falls back to its class name ("Error", "TypeError"), and without them one
 * plain Error on the patient page would use up Billing's alerts too. The
 * deployment type is in it so a preview can never use up production's.
 */
export function alertGroup(report: ErrorReport): string {
  return `${report.environment}-${report.route}-${report.kind}-${report.errorName}`.replace(/[^\w-]/g, "_").slice(0, 200);
}

/**
 * The key of the nth alert email (1 up to ALERT_CEILING) for a group in a
 * window. Resend keeps the first message sent under a key and drops the rest
 * (see lib/email.ts). This is what makes the ceiling hold across servers: a
 * serverless function may be one of many running at once, each counting only
 * for itself, but between them they only have ALERT_CEILING keys to send
 * under. An outage with one error is that group's first alert on every
 * server, so it is one email. The price: when two servers each see a
 * different first error in the same window, only one of them is emailed. The
 * other is still in the server log.
 */
export function alertKey(report: ErrorReport, slot: number, now: Date): string {
  return `error-alert-${alertGroup(report)}-${slot}-${alertWindow(now)}`;
}

/** The key of the one "alerts were held back" note for a group in a window. The same on every server, so there is one note. */
export function heldBackKey(report: ErrorReport, now: Date): string {
  return `error-alert-held-back-${alertGroup(report)}-${alertWindow(now)}`;
}

/** Who gets alerts: ERROR_ALERT_EMAIL, one address or several separated by commas. Empty means nobody, and no email is sent. */
export function alertRecipients(env: ReportEnv): string[] {
  return (env.ERROR_ALERT_EMAIL ?? "")
    .split(",")
    .map((address) => address.trim())
    .filter((address) => address.includes("@"));
}

/** The alert email: the scrubbed record in plain words, and nothing else. */
export function alertEmail(report: ErrorReport, to: string[], idempotencyKey: string): EmailMessage {
  const where = `${report.route} (${report.method}, ${report.kind})`;
  const deployment = report.commit ? `${report.environment}, commit ${report.commit}` : report.environment;
  const lines = [
    `The Pulse 3D app hit an error on ${report.environment}.`,
    "",
    `When: ${report.when}`,
    `Deployment: ${deployment}`,
    `Where: ${where}`,
    `What: ${report.errorName}`,
    `Digest: ${report.digest ?? "none"}`,
    "",
    "This message names the route pattern and the kind of error only, never the address a person opened, a link code, an error message or a request body. The full detail is in the server log: Vercel, the project, Logs; search for the digest.",
    "",
    `You get at most one message per distinct error every ten minutes, and at most ${ALERT_CEILING} for one kind of error at one route.`,
  ];
  const html = `<p>${lines.map(escapeHtml).join("<br>")}</p>`;
  return {
    to,
    subject: `Pulse 3D app: an error on ${report.environment} (${report.route})`,
    text: lines.join("\n"),
    html,
    idempotencyKey,
  };
}

/**
 * The one note that says the ceiling was reached. It names the group and the
 * window, not the error that tipped it over, so it reads the same from every
 * server (Resend answers the same key with different words as a refusal).
 */
export function heldBackEmail(report: ErrorReport, to: string[], idempotencyKey: string, now: Date): EmailMessage {
  const windowStart = new Date(alertWindow(now) * ALERT_WINDOW_MS).toISOString();
  const lines = [
    `The Pulse 3D app has held back error alerts on ${report.environment}: it reached its limit of ${ALERT_CEILING} messages in ten minutes for one kind of error at one route.`,
    "",
    `Ten minutes starting: ${windowStart}`,
    `Where: ${report.route} (${report.kind})`,
    `What: ${report.errorName}`,
    "",
    'More errors of this kind may happen in these ten minutes, and no message will be sent about them. Each one is still in the server log: Vercel, the project, Logs; search for "Request error:". Alerts start again with the next ten minutes.',
  ];
  return {
    to,
    subject: `Pulse 3D app: error alerts held back on ${report.environment} (${report.route})`,
    text: lines.join("\n"),
    html: `<p>${lines.map(escapeHtml).join("<br>")}</p>`,
    idempotencyKey,
  };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
