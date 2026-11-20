import "server-only";
import { createHash } from "node:crypto";
import { after } from "next/server";
import { getSeatClinic } from "./db/seats";
import { emailIsConfigured, sendEmail, type EmailEnv, type SendOutcome } from "./email";
import { errorKind } from "./error-kind";
import { getMember, type Person } from "./people";
import { pickTrustedOrigin, type OriginEnv } from "./trusted-origin";

/**
 * The email a person gets when they become a clinic's account owner, and the
 * short one the person who was moved out of the role gets when someone else
 * moved them. Server only: it reads the clinic's row and asks Clerk for the
 * person's address, then sends through lib/email.ts.
 *
 * WHO GETS WHAT (Evan, 2026-11-20). The two places the owner is handed to
 * someone, both in lib/seat-changes.ts:
 *
 *   handOffOwner     the owner hands the account to another admin on
 *                    /admin/people. The new owner is emailed, with the name
 *                    of the person who handed it over. The old owner is not:
 *                    they did it themselves, a moment ago.
 *   setOwnerByStaff  Pulse 3D staff set the owner on /pulse. The new owner is
 *                    emailed ("Pulse 3D made this change", never the staff
 *                    member's own name). The old owner, when they are still
 *                    in the clinic, gets the short second email, because
 *                    someone else moved them out of the role.
 *
 * Nobody else is emailed. The person who creates a clinic at sign-up becomes
 * its owner without being handed anything, so they get nothing. The seat
 * check (and the Clerk webhook, which runs it) only ever CLEARS an owner who
 * has left the clinic; it never picks a new one, so it sends nothing either.
 *
 * ONE EMAIL PER CHANGE, HOWEVER OFTEN IT IS ASKED FOR. Only a change that
 * really happened sends: setClinicOwner() writes the owner and its clinic-log
 * entry in one transaction, and the caller sends only when an entry was
 * written. A second click, a second tab or a retried request either finds
 * the owner already changed (nothing logged) or is refused, so it sends
 * nothing. The send is also given an idempotency key built from the clinic,
 * the person and that log entry's id, so if the same change were ever sent
 * twice within a day, Resend would drop the second. And right before
 * sending, the clinic's row is read again: if the person is no longer the
 * owner (it moved on a moment later), nothing is sent.
 *
 * NEVER IN THE WAY. This runs after the change has committed, handed to
 * Next.js's after() so the person who made the change does not wait for it.
 * It never throws, and a send that fails never undoes the change: it is one
 * log line in words and a reason, never an address, a name, a clinic's name
 * or an error message (only errorKind()).
 *
 * WHERE THE BUTTON POINTS. The People page (the library, for a former owner
 * who is no longer an admin) on the app's own address, picked from the
 * deployment's settings with no request header at all. With none known, or
 * email not set up here, nothing is sent.
 *
 * REPLIES. When EMAIL_REPLY_TO is set, replies go there and the email says
 * a person will answer. Without it the sending address may be a no-reply
 * one, so the email does not mention replying at all.
 *
 * Nothing about any patient (rule 2): the clinic's name, the people's own
 * names, and what the role means.
 */

/** Which of the two emails. */
export type OwnerEmailKind = "new-owner" | "former-owner";

/**
 * The idempotency key Resend keeps a send under for a day: which email, the
 * clinic, the person and the clinic-log entry for this one change. A SHA-256
 * fingerprint, so no id sits in Resend's logs as it is.
 */
export function ownerEmailKey(kind: OwnerEmailKind, clinicId: string, userId: string, changeId: string): string {
  return `owner-change-${createHash("sha256").update(`${kind}:${clinicId}:${userId}:${changeId}`).digest("hex")}`;
}

/** The People page on the app's own address. It asks for a sign-in first, and comes back. */
export function peopleLink(origin: string): string {
  return `${origin}/admin/people`;
}

/** The library on the app's own address, for a former owner who is not an admin. */
export function libraryLink(origin: string): string {
  return `${origin}/library`;
}

/** The five characters that mean something in HTML, made harmless. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Who made the change, as the email says it. Null leaves the line out. */
export type ChangedBy = { handedOverBy: string } | { pulse: true } | null;

const REPLY_LINE = "Questions? Reply to this email and a person will answer.";

/**
 * The page around an email, in the same look as the setup reminder
 * (lib/setup-reminders.ts), so the two read as one family: the grey ground,
 * the white card, the Pulse 3D logo, the heading, the paragraphs, one button,
 * a rule, and the small line about why it came.
 */
function emailPage(origin: string, title: string, heading: string, paragraphs: string[], button: { label: string; href: string }, small: string[]): string {
  const font = "'Hanken Grotesk',Arial,Helvetica,sans-serif";
  const headingFont = "'Schibsted Grotesk','Hanken Grotesk',Arial,Helvetica,sans-serif";
  return [
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>`,
    `<style>@media (max-width:480px){.em-pad{padding:26px 20px !important}.em-outer{padding:20px 12px 32px !important}}</style></head>`,
    `<body style="margin:0;padding:0;background:#eef1f4">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f4"><tr><td class="em-outer" align="center" style="padding:32px 12px 48px">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border:1px solid #e3e7eb;border-radius:14px"><tr><td class="em-pad" style="padding:36px 40px 36px 40px;font-family:${font};color:#3a4c56;font-size:16px;line-height:1.6">`,
    `<img src="${escapeHtml(`${origin}/pulse-3d-logo.png`)}" alt="Pulse 3D Media" height="30" style="height:30px;width:auto;display:block;border:0;margin:0 0 22px">`,
    `<h1 style="margin:0 0 18px;font-family:${headingFont};font-size:26px;font-weight:600;letter-spacing:-0.02em;line-height:1.2;color:#12202a">${escapeHtml(heading)}</h1>`,
    ...paragraphs.map((paragraph) => `<p style="margin:0 0 14px">${escapeHtml(paragraph)}</p>`),
    `<p style="margin:24px 0"><a href="${escapeHtml(button.href)}" style="display:inline-block;padding:14px 28px;border-radius:999px;background:#1e5668;color:#ffffff;font-weight:700;text-decoration:none">${escapeHtml(button.label)}</a></p>`,
    ...small.slice(0, -1).map((line) => `<p style="margin:0 0 14px;font-size:14px;color:#52616a">${escapeHtml(line)}</p>`),
    `<hr style="border:0;border-top:1px solid #e3e7eb;margin:22px 0">`,
    `<p style="margin:0;font-size:14px;color:#52616a">${escapeHtml(small[small.length - 1])}</p>`,
    `</td></tr></table>`,
    `</td></tr></table>`,
    `</body></html>`,
  ].join("\n");
}

/** The plain-text version, line for line with the HTML. */
function emailText(heading: string, paragraphs: string[], button: { label: string; href: string }, small: string[]): string {
  return [heading, "", ...paragraphs.flatMap((paragraph) => [paragraph, ""]), `${button.label}: ${button.href}`, "", ...small.flatMap((line, index) => (index < small.length - 1 ? [line, ""] : [line]))].join("\n");
}

/**
 * The email to the new account owner.
 *
 *   clinicName  the clinic's name, as on its row
 *   changedBy   who handed it over, "Pulse 3D", or null to leave the line out
 *   origin      the app's own address, from the deployment's settings
 *   canReply    true when replies reach a person (EMAIL_REPLY_TO is set)
 *
 * What it says the role means is only what is true in the app today
 * (docs/areas/auth-and-roles.md, "The account owner"): the owner is always
 * an admin, cannot be removed or have admin switched off on the People page,
 * decides their own seat, and is the one who can hand the account on. It
 * says nothing about billing, because any office admin can change the plan.
 */
export function newOwnerEmail(args: { clinicName: string; changedBy: ChangedBy; origin: string; canReply: boolean }): { subject: string; text: string; html: string } {
  const subject = `You are now the account owner for ${args.clinicName}`;
  const heading = `You are now the account owner for ${args.clinicName}.`;
  const who =
    args.changedBy === null ? null : "pulse" in args.changedBy ? "Pulse 3D made this change." : `${args.changedBy.handedOverBy} handed the account over to you.`;
  const paragraphs = [
    ...(who ? [who] : []),
    "As the account owner you are always an admin, and nobody can remove you or switch your admin off on the People page. You also decide for yourself whether you take a seat.",
    "If someone else should run the account later, you can hand it over to them on the People page.",
  ];
  const button = { label: "Open People", href: peopleLink(args.origin) };
  const small = [...(args.canReply ? [REPLY_LINE] : []), "You're getting this because you were made the account owner of a clinic on Pulse 3D."];
  return { subject, text: emailText(heading, paragraphs, button, small), html: emailPage(args.origin, subject, heading, paragraphs, button, small) };
}

/**
 * The short email to the person who was moved out of the role by someone
 * else (Pulse 3D staff). Only sent while they are still in the clinic.
 *
 *   newOwnerName  who the owner is now
 *   stillAdmin    true when Clerk says they are still an admin, so the
 *                 button goes to People; otherwise it goes to the library
 */
export function formerOwnerEmail(args: { clinicName: string; newOwnerName: string; stillAdmin: boolean; origin: string; canReply: boolean }): { subject: string; text: string; html: string } {
  const subject = `You are no longer the account owner for ${args.clinicName}`;
  const heading = `You are no longer the account owner for ${args.clinicName}.`;
  const paragraphs = [
    `Pulse 3D made ${args.newOwnerName} the account owner.`,
    args.stillAdmin ? "You are still in the clinic, and still an admin." : "You are still in the clinic.",
  ];
  const button = args.stillAdmin ? { label: "Open People", href: peopleLink(args.origin) } : { label: "Open the library", href: libraryLink(args.origin) };
  const small = [...(args.canReply ? [REPLY_LINE] : []), "You're getting this because you were the account owner of a clinic on Pulse 3D."];
  return { subject, text: emailText(heading, paragraphs, button, small), html: emailPage(args.origin, subject, heading, paragraphs, button, small) };
}

/** One owner change that went through and was logged. */
export type OwnerChange = {
  clinicId: string;
  /** The clinic-log entry's id for this change: what makes the idempotency key one per change. */
  changeId: string;
  newOwnerId: string;
  changedBy: ChangedBy;
  /** The person moved out of the role, to be told too. Only for a change someone else made, and only when they are still in the clinic. */
  tellFormerOwner?: string | null;
};

/** What was done, for the tests. A skip is not a failure: it is "nothing to send". */
export type OwnerEmailOutcome = SendOutcome | { sent: false; reason: "no-origin" | "no-longer-owner" | "not-in-clinic" | "lookup-failed" };

export type OwnerEmailOptions = {
  env?: EmailEnv & OriginEnv;
  fetch?: typeof fetch;
  /** A stand-in for Clerk's member lookup, for the tests. */
  member?: (clerkOrgId: string, userId: string) => Promise<Person | null>;
};

/**
 * Send the owner emails for one change. Never throws. Call it only after the
 * change has committed, and only when a log entry was written for it.
 */
export async function sendOwnerEmails(change: OwnerChange, options: OwnerEmailOptions = {}): Promise<{ newOwner: OwnerEmailOutcome; formerOwner: OwnerEmailOutcome | null }> {
  const env = options.env ?? (process.env as EmailEnv & OriginEnv);
  const member = options.member ?? getMember;
  const skip = (reason: Exclude<OwnerEmailOutcome, { sent: true }>["reason"]): OwnerEmailOutcome => ({ sent: false, reason });

  if (!emailIsConfigured(env)) {
    const none = skip("not-configured");
    return { newOwner: none, formerOwner: change.tellFormerOwner ? none : null };
  }
  const origin = pickTrustedOrigin(null, env);
  if (!origin) {
    console.error("Owner email: no address for the app is known here, so nothing was sent");
    const none = skip("no-origin");
    return { newOwner: none, formerOwner: change.tellFormerOwner ? none : null };
  }
  const replyTo = env.EMAIL_REPLY_TO?.trim() || undefined;

  // Read the clinic again, after the change committed: the person must still be the owner.
  let clinic: Awaited<ReturnType<typeof getSeatClinic>>;
  try {
    clinic = await getSeatClinic(change.clinicId);
  } catch (error) {
    console.error("Owner email: the clinic could not be read, so nothing was sent", errorKind(error));
    const failed = skip("lookup-failed");
    return { newOwner: failed, formerOwner: change.tellFormerOwner ? failed : null };
  }
  if (!clinic?.clerkOrgId || clinic.ownerClerkUserId !== change.newOwnerId) {
    const moved = skip("no-longer-owner");
    return { newOwner: moved, formerOwner: change.tellFormerOwner ? moved : null };
  }
  const orgId = clinic.clerkOrgId;

  // Each person's address comes from Clerk, for THIS clinic's organization only.
  const lookUp = async (userId: string): Promise<Person | "failed" | null> => {
    try {
      const person = await member(orgId, userId);
      return person && person.email.trim() ? person : null;
    } catch (error) {
      console.error("Owner email: a person could not be read from Clerk", errorKind(error));
      return "failed";
    }
  };
  const send = async (kind: OwnerEmailKind, userId: string, to: string, message: { subject: string; text: string; html: string }) => {
    const outcome = await sendEmail({ to: [to], ...message, replyTo, idempotencyKey: ownerEmailKey(kind, change.clinicId, userId, change.changeId) }, { env, fetch: options.fetch });
    // The reason is one word (refused, unreachable, ...). The owner change itself stands either way.
    if (!outcome.sent) console.error(`Owner email: the ${kind} email was not sent`, outcome.reason);
    return outcome;
  };

  const owner = await lookUp(change.newOwnerId);
  let newOwner: OwnerEmailOutcome;
  if (owner === "failed") newOwner = skip("lookup-failed");
  else if (owner === null) newOwner = skip("not-in-clinic");
  else newOwner = await send("new-owner", owner.userId, owner.email, newOwnerEmail({ clinicName: clinic.name, changedBy: change.changedBy, origin, canReply: Boolean(replyTo) }));

  let formerOwner: OwnerEmailOutcome | null = null;
  if (change.tellFormerOwner && change.tellFormerOwner !== change.newOwnerId) {
    const former = await lookUp(change.tellFormerOwner);
    if (former === "failed") formerOwner = skip("lookup-failed");
    else if (former === null) formerOwner = skip("not-in-clinic");
    else {
      const newOwnerName = owner !== "failed" && owner !== null ? owner.name : "someone else";
      formerOwner = await send(
        "former-owner",
        former.userId,
        former.email,
        formerOwnerEmail({ clinicName: clinic.name, newOwnerName, stillAdmin: former.role === "admin", origin, canReply: Boolean(replyTo) }),
      );
    }
  }
  return { newOwner, formerOwner };
}

/**
 * Start the owner emails for a change that has committed, without making the
 * person who made it wait: the sending is handed to Next.js's after(), which
 * keeps the function alive until it finishes. Never throws. Returns the
 * sending, for the tests to wait on; the app does not wait.
 */
export function sendOwnerEmailsLater(change: OwnerChange, send: (change: OwnerChange) => Promise<unknown> = sendOwnerEmails): Promise<unknown> {
  let sending: Promise<unknown>;
  try {
    sending = Promise.resolve(send(change)).catch((error) => {
      console.error("Owner email: the email was not sent", errorKind(error));
    });
  } catch (error) {
    console.error("Owner email: the email was not sent", errorKind(error));
    return Promise.resolve();
  }
  try {
    after(sending);
  } catch {
    // Not inside a request (a script, a test), so the platform cannot be asked to wait. The send goes on.
  }
  return sending;
}
