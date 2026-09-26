/**
 * Sending email. Server only.
 *
 * The service is Resend (resend.com), spoken to over plain HTTPS with the
 * fetch built into Node, so there is no package to install or keep up to
 * date. This is the only file that talks to it, the way lib/stripe.ts is
 * the only file that talks to Stripe.
 *
 * Two environment variables, both in .env and in Vercel (rule 7 applies to
 * the first):
 *
 *   RESEND_API_KEY   the key from the Resend dashboard. A secret.
 *   EMAIL_FROM       who the email is from, on a domain verified in Resend,
 *                    for example "Pulse 3D <links@pulse3dmedia.com>". Not a
 *                    secret, but a setting, so it is not written into code.
 *
 * With either one missing the app runs exactly as before: sendEmail()
 * answers "not-configured" and nothing is sent. The one email so far (a
 * patient asking for a paused link to be turned back on) is written to the
 * database before it is sent and listed on the clinic's overview, so a
 * missing key loses nothing; the office just is not told by email.
 *
 * sendEmail() never throws. A refusal from the service and a service that
 * cannot be reached are both answered with a reason, and only the KIND of
 * failure goes to the server log: never the key, never an address, never
 * the message.
 */

/** The two settings, read from process.env unless a test hands in its own (the index signature is what lets process.env itself be passed). */
export type EmailEnv = { RESEND_API_KEY?: string; EMAIL_FROM?: string; [name: string]: string | undefined };

/** One message to send. `to` is every recipient; the same message goes to all of them. */
export type EmailMessage = {
  to: string[];
  subject: string;
  /** The plain-text version, for mail programs that show no HTML, and for the tests to read. */
  text: string;
  html: string;
  /**
   * A key that makes sending the same message twice harmless: Resend keeps
   * the first send under a key and answers a repeat with it, for a day.
   */
  idempotencyKey?: string;
};

/** What sendEmail() did. `sent: true` means the service accepted the message, not that it was read. */
export type SendOutcome = { sent: true } | { sent: false; reason: "not-configured" | "no-recipients" | "refused" | "unreachable" };

/** Where Resend takes a message. */
const RESEND_URL = "https://api.resend.com/emails";

/** How long to wait for the service. A patient is waiting on the other end of the one email so far, so not long. */
const TIMEOUT_MS = 10_000;

/** True when both settings are present. The pages that say "the office will be emailed" may ask this. */
export function emailIsConfigured(env: EmailEnv = process.env): boolean {
  return Boolean(env.RESEND_API_KEY?.trim()) && Boolean(env.EMAIL_FROM?.trim());
}

/**
 * Send one message. `options.fetch` and `options.env` exist for the tests,
 * which hand in a stand-in for the service and made-up settings; the app
 * passes neither.
 */
export async function sendEmail(message: EmailMessage, options: { env?: EmailEnv; fetch?: typeof fetch } = {}): Promise<SendOutcome> {
  const env = options.env ?? process.env;
  const send = options.fetch ?? fetch;
  if (!emailIsConfigured(env)) return { sent: false, reason: "not-configured" };

  const to = message.to.map((address) => address.trim()).filter((address) => address.length > 0);
  if (to.length === 0) return { sent: false, reason: "no-recipients" };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.RESEND_API_KEY!.trim()}`,
    "Content-Type": "application/json",
  };
  if (message.idempotencyKey) headers["Idempotency-Key"] = message.idempotencyKey;

  try {
    const response = await send(RESEND_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ from: env.EMAIL_FROM!.trim(), to, subject: message.subject, text: message.text, html: message.html }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      // The status code says what kind of refusal it was (a bad key is 401, a
      // domain not verified is 403); the body is not read, so nothing from it
      // can land in a log.
      console.error("Email: the service refused the message", response.status);
      return { sent: false, reason: "refused" };
    }
    return { sent: true };
  } catch (error) {
    console.error("Email: the service could not be reached", error instanceof Error ? error.name : "unknown error");
    return { sent: false, reason: "unreachable" };
  }
}
