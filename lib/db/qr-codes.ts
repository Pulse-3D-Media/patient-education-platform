import { Prisma } from "@prisma/client";
import { randomInt } from "crypto";
import { decideVideoAccess, type AccessDecision } from "../access";
import { liveKeyFor, QR_CODE_LENGTH, QR_RECENT_DAYS, utcDayStart } from "../qr-code";
import { isClerkUserId } from "../seats";
import { effectiveSenderName } from "../sender-name";
import { lockClinicAccess, lockSenderSeat, lockVideoFacts } from "./access";
import { prisma } from "./client";
import { listSeatNames } from "./seats";
import { PATIENT_CLINIC_FIELDS, SenderRefusedError, ShareRefusedError, type ShareSender } from "./shares";

/**
 * Queries for printed (permanent) QR codes: the QrCode table. What a printed
 * code is, and why it is safe to print, is at the top of lib/qr-code.ts. The
 * patient's link itself is made by issueShareFromQrCode() in shares.ts, where
 * every link is written.
 *
 * Functions used on the clinic side take clinicId first and filter by it
 * (rule 1). The one public function, getQrCodeByCode(), serves the patient's
 * /q/<code> page, where the printed code in the address is the key.
 *
 * A code is never deleted. Retiring it sets retiredAt and empties liveKey,
 * and nothing ever sets them back: a replacement is a new row with a new
 * code, so a code on a pamphlet that was retired can never quietly start
 * working again.
 */

/** The characters a printed code is made from: lowercase letters and digits, like a share code. */
const QR_CHARACTERS = "abcdefghijklmnopqrstuvwxyz0123456789";

/** A new printed code: 25 characters, each picked by Node's cryptographic generator (about 129 bits). */
function randomQrCode(): string {
  let code = "";
  for (let i = 0; i < QR_CODE_LENGTH; i++) code += QR_CHARACTERS[randomInt(QR_CHARACTERS.length)];
  return code;
}

/** How many times a write that hit a unique column (a taken code, or a second live code made at the same moment) is tried again. */
const ATTEMPTS = 5;

/** True when the database refused a write because a unique value is taken (Prisma's P2002). */
function isUniqueClash(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** What createQrCode() and replaceQrCode() hand back: the code that is live now, and whether this call made it. */
export type QrCodeMade = { id: string; created: boolean };

/**
 * Make the printed code for one procedure from one surgeon at this clinic,
 * or, when one is already live for that pair, hand that one back: there is
 * at most one live code per procedure per surgeon (decided by Evan on
 * 2026-10-08). The clinic prints and downloads that one code as many times
 * as it likes.
 *
 * Checked in one transaction, under the same locks as createShare: the clinic
 * may use the video right now (else ShareRefusedError, with the same plain
 * sentence), and the surgeon holds a seat here right now (else
 * SenderRefusedError). Nothing is written on a refusal.
 *
 * Two admins pressing at the same moment: both may find no live code, but
 * QrCode.liveKey is unique, so only one insert is accepted; the other is
 * refused by the database (P2002), tries again, and finds the code the first
 * one made. One live code, whatever the timing. A clash on the random code
 * itself is handled the same way, with a new code.
 *
 * `sender` comes from resolveSender() (checked with Clerk to be in this
 * clinic); its fallback name is stored on the code, so the patient's page can
 * name the surgeon without asking Clerk. `actorName` is the admin's name from
 * Clerk, for the clinic log. Written to the log in the same transaction.
 */
export async function createQrCode(
  clinicId: string,
  videoId: string,
  sender: ShareSender,
  actorName: string,
  options: { now?: Date; makeCode?: () => string } = {},
): Promise<QrCodeMade> {
  if (!isClerkUserId(sender.clerkUserId)) throw new SenderRefusedError();
  const makeCode = options.makeCode ?? randomQrCode;
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction((tx) => writeQrCode(tx, clinicId, videoId, sender, makeCode(), options.now ?? new Date(), (name, title) => ({
        body: `Printed QR code made for ${title}, from ${name ?? "no name set"}. It is the same code every time it is printed or downloaded.`,
        authorName: `${actorName} (clinic admin)`,
      })));
    } catch (error) {
      if (!isUniqueClash(error) || attempt >= ATTEMPTS) throw error;
    }
  }
}

/** The checks and the insert, inside the caller's transaction. Returns the live code for the pair, made here or found. */
async function writeQrCode(
  tx: Prisma.TransactionClient,
  clinicId: string,
  videoId: string,
  sender: ShareSender,
  code: string,
  now: Date,
  log: (surgeonName: string | null, title: string) => { body: string; authorName: string },
): Promise<QrCodeMade> {
  const access = await lockClinicAccess(tx, clinicId, now);
  const decision: AccessDecision = access ? decideVideoAccess(access, await lockVideoFacts(tx, videoId)) : { allowed: false, reason: "clinic-closed" };
  if (!decision.allowed) throw new ShareRefusedError(decision.reason);

  const seat = await lockSenderSeat(tx, clinicId, sender.clerkUserId);
  if (!seat) throw new SenderRefusedError();

  const liveKey = liveKeyFor(clinicId, videoId, sender.clerkUserId);
  const live = await tx.qrCode.findUnique({ where: { liveKey }, select: { id: true } });
  if (live) return { id: live.id, created: false };

  const video = await tx.video.findUniqueOrThrow({ where: { id: videoId }, select: { title: true } });
  const made = await tx.qrCode.create({
    data: { code, clinicId, videoId, senderUserId: sender.clerkUserId, senderFallbackName: sender.fallbackName, liveKey, createdAt: now },
    select: { id: true },
  });
  const entry = log(effectiveSenderName(seat.displayName, sender.fallbackName), video.title);
  await tx.clinicNote.create({ data: { clinicId, kind: "STATUS", ...entry }, select: { id: true } });
  return { id: made.id, created: true };
}

/** What retireQrCode() and replaceQrCode() did, or why they did nothing. Each message is a plain sentence for the admin's screen. */
export type QrChangeOutcome = { ok: true; message: string; id: string } | { ok: false; message: string };

const NOT_FOUND = "We couldn't find that printed code for your clinic.";
const ALREADY_RETIRED = "That printed code was already retired. Nothing was changed.";

/**
 * Retire one of this clinic's printed codes: from this moment it hands out
 * no new links, on every copy that was ever printed or downloaded. Links it
 * already handed out keep working by their own rules, like every issued
 * link. Never undone: a new code is made instead.
 *
 * One UPDATE whose WHERE says "this clinic's, and still live", so another
 * clinic's code, or a code retired a moment ago by another admin, changes
 * nothing (two presses retire once and log once). A link being handed out
 * from the code at this instant holds its row (lockQrCodeForIssue), so the
 * retirement waits for it, and the next tap is refused. The log entry goes in
 * the same transaction.
 */
export async function retireQrCode(clinicId: string, qrCodeId: string, actorName: string, now: Date = new Date()): Promise<QrChangeOutcome> {
  return prisma.$transaction(async (tx) => {
    const qr = await tx.qrCode.findFirst({
      where: { id: qrCodeId, clinicId },
      select: { id: true, retiredAt: true, senderFallbackName: true, video: { select: { title: true } } },
    });
    if (!qr) return { ok: false, message: NOT_FOUND };
    const retired = await tx.qrCode.updateMany({ where: { id: qr.id, clinicId, retiredAt: null }, data: { retiredAt: now, liveKey: null } });
    if (retired.count !== 1) return { ok: false, message: ALREADY_RETIRED };
    await tx.clinicNote.create({
      data: {
        clinicId,
        kind: "STATUS",
        body: `Printed QR code for ${qr.video.title} retired. Every printed copy of it stops handing out links; links it already handed out keep working.`,
        authorName: `${actorName} (clinic admin)`,
      },
      select: { id: true },
    });
    return { ok: true, id: qr.id, message: `Retired. That code no longer works, wherever it was printed. Links it already gave patients keep working.` };
  });
}

/**
 * Replace one of this clinic's printed codes: retire it and make a new one
 * for the same procedure from the same surgeon, in ONE transaction. Either
 * both happen or neither does: if the new one cannot be made (the clinic may
 * not use the video right now, or the surgeon holds no seat here any more),
 * the old code is left exactly as it was and the reason is returned.
 *
 * For a pamphlet that got into the wrong hands, or a code that needs to look
 * different on paper: the old paper stops working the moment this commits,
 * and the new code has to be printed. `sender` is the old code's surgeon,
 * checked with Clerk by the caller (resolveSender); the caller never picks
 * a different one.
 */
export async function replaceQrCode(
  clinicId: string,
  qrCodeId: string,
  sender: ShareSender,
  actorName: string,
  options: { now?: Date; makeCode?: () => string } = {},
): Promise<QrChangeOutcome> {
  const makeCode = options.makeCode ?? randomQrCode;
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx): Promise<QrChangeOutcome> => {
        const now = options.now ?? new Date();
        const old = await tx.qrCode.findFirst({ where: { id: qrCodeId, clinicId }, select: { id: true, videoId: true, senderUserId: true, retiredAt: true } });
        if (!old) return { ok: false, message: NOT_FOUND };
        if (old.retiredAt) return { ok: false, message: ALREADY_RETIRED };
        if (old.senderUserId !== sender.clerkUserId) return { ok: false, message: NOT_FOUND };

        // The clinic's lock first, as every path takes it, then the old code is retired, then the new one made.
        const access = await lockClinicAccess(tx, clinicId, now);
        if (!access) return { ok: false, message: NOT_FOUND };
        const retired = await tx.qrCode.updateMany({ where: { id: old.id, clinicId, retiredAt: null }, data: { retiredAt: now, liveKey: null } });
        if (retired.count !== 1) return { ok: false, message: ALREADY_RETIRED };

        const made = await writeQrCode(tx, clinicId, old.videoId, sender, makeCode(), now, (name, title) => ({
          body: `Printed QR code for ${title}, from ${name ?? "no name set"}, replaced with a new one. The old code stops handing out links; links it already handed out keep working.`,
          authorName: `${actorName} (clinic admin)`,
        }));
        return { ok: true, id: made.id, message: "Replaced. The old code no longer works. Print or download the new one below." };
      });
    } catch (error) {
      // A refusal (ShareRefusedError, SenderRefusedError) rolled the retirement back too; say why, the old code still works.
      if (error instanceof ShareRefusedError || error instanceof SenderRefusedError) {
        return { ok: false, message: `${error.message} The old code was left as it was.` };
      }
      if (!isUniqueClash(error) || attempt >= ATTEMPTS) throw error;
    }
  }
}

/** One live printed code, as /admin/links lists it. */
export type LiveQrCodeRow = {
  id: string;
  createdAt: Date;
  videoTitle: string;
  isPlaceholder: boolean;
  /** The video is published right now; a code for an unpublished one hands out nothing until it is back. */
  isPublished: boolean;
  /** The surgeon's Clerk id, so the page can match them to the people it already read. */
  senderUserId: string;
  /** The name the links name them by: the one chosen on People, else the one recorded when the code was made. */
  surgeonName: string | null;
  /** False once they hold no seat here: the code still works, but its new links name only the clinic. */
  surgeonSeated: boolean;
};

/** How many live printed codes /admin/links lists at most. */
export const LIVE_QR_LIMIT = 100;

/**
 * This clinic's live printed codes, newest first, at most LIVE_QR_LIMIT of
 * them, and how many there are in all. For the "Printed QR codes" list on
 * /admin/links. Whether each surgeon still holds a seat is read from our own
 * seat table, never from Clerk. No numbers about use: clinics do not see
 * usage yet (decided by Evan on 2026-10-07).
 */
export async function listLiveQrCodesForClinic(clinicId: string): Promise<{ rows: LiveQrCodeRow[]; total: number }> {
  const [codes, total, seats] = await Promise.all([
    prisma.qrCode.findMany({
      where: { clinicId, retiredAt: null },
      orderBy: { createdAt: "desc" },
      take: LIVE_QR_LIMIT,
      select: {
        id: true,
        createdAt: true,
        senderUserId: true,
        senderFallbackName: true,
        video: { select: { title: true, isPlaceholder: true, isPublished: true } },
      },
    }),
    prisma.qrCode.count({ where: { clinicId, retiredAt: null } }),
    listSeatNames(clinicId),
  ]);
  const seated = new Map(seats.map((seat) => [seat.clerkUserId, seat.displayName]));
  return {
    total,
    rows: codes.map((qr) => ({
      id: qr.id,
      createdAt: qr.createdAt,
      videoTitle: qr.video.title,
      isPlaceholder: qr.video.isPlaceholder,
      isPublished: qr.video.isPublished,
      senderUserId: qr.senderUserId,
      surgeonName: effectiveSenderName(seated.get(qr.senderUserId), qr.senderFallbackName),
      surgeonSeated: seated.has(qr.senderUserId),
    })),
  };
}

/**
 * One of this clinic's printed codes, by its row id, for the pamphlet and the
 * picture (/admin/qr-codes/<id>), with the procedure, the clinic's name and
 * the surgeon's seat. Null when the id is not this clinic's, or the code is
 * retired: a retired code is never printed again.
 */
export async function getLiveQrCodeForClinic(clinicId: string, qrCodeId: string) {
  const qr = await prisma.qrCode.findFirst({
    where: { id: qrCodeId, clinicId, retiredAt: null },
    select: {
      id: true,
      code: true,
      senderUserId: true,
      senderFallbackName: true,
      video: { select: { title: true, isPlaceholder: true } },
      clinic: { select: { name: true } },
    },
  });
  if (!qr) return null;
  const seat = await prisma.seatAllocation.findUnique({
    where: { clinicId_clerkUserId: { clinicId, clerkUserId: qr.senderUserId } },
    select: { displayName: true },
  });
  return { ...qr, surgeonName: seat ? effectiveSenderName(seat.displayName, qr.senderFallbackName) : null };
}

/**
 * The surgeon on one of this clinic's live printed codes, for Replace (which
 * keeps the same surgeon). Null when the id is not this clinic's or the code
 * is retired.
 */
export async function getLiveQrCodeSender(clinicId: string, qrCodeId: string): Promise<string | null> {
  const qr = await prisma.qrCode.findFirst({ where: { id: qrCodeId, clinicId, retiredAt: null }, select: { senderUserId: true } });
  return qr?.senderUserId ?? null;
}

/**
 * A printed code by the code in its address, for the patient's /q/<code>
 * page: the video (to play it), the clinic's name and branding (only what
 * the patient is meant to see, the same fields as a patient link), whether it
 * is retired, and the name its links would carry right now (the surgeon's,
 * while they hold a seat here; null once they do not). Null for a code nobody
 * has.
 *
 * Public on purpose, like getShareByCode: the patient is not signed in. It
 * reads and changes nothing else; opening the page never makes a link.
 */
export async function getQrCodeByCode(code: string) {
  const qr = await prisma.qrCode.findUnique({
    where: { code },
    select: {
      id: true,
      code: true,
      clinicId: true,
      videoId: true,
      senderUserId: true,
      senderFallbackName: true,
      retiredAt: true,
      video: true,
      clinic: { select: PATIENT_CLINIC_FIELDS },
    },
  });
  if (!qr) return null;
  const seat = await prisma.seatAllocation.findUnique({
    where: { clinicId_clerkUserId: { clinicId: qr.clinicId, clerkUserId: qr.senderUserId } },
    select: { displayName: true },
  });
  return { ...qr, senderName: seat ? effectiveSenderName(seat.displayName, qr.senderFallbackName) : null };
}

/** One printed code as the clinic's /pulse page shows it: read-only, with how many links it handed out. */
export type PulseQrCodeRow = {
  id: string;
  createdAt: Date;
  retiredAt: Date | null;
  videoTitle: string;
  isPlaceholder: boolean;
  surgeonName: string | null;
  surgeonSeated: boolean;
  /** Links handed out since midnight UTC today. Not scans and not people: a link is made only by a tap on Play. */
  issuedToday: number;
  /** Links handed out in the last QR_RECENT_DAYS days (30 times 24 hours before now). */
  issuedRecently: number;
};

/** How many printed codes a clinic's /pulse page lists at most. */
export const PULSE_QR_LIMIT = 50;

/**
 * This clinic's printed codes for its /pulse page, live ones first, newest
 * first within each, at most PULSE_QR_LIMIT, with the total, and for each the
 * links it handed out today (UTC) and in the last 30 days. Counted in the
 * database (two grouped counts), never by reading the links.
 */
export async function listQrCodesForPulse(clinicId: string, now: Date = new Date()): Promise<{ rows: PulseQrCodeRow[]; total: number }> {
  const [codes, total, seats] = await Promise.all([
    prisma.qrCode.findMany({
      where: { clinicId },
      orderBy: [{ retiredAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
      take: PULSE_QR_LIMIT,
      select: {
        id: true,
        createdAt: true,
        retiredAt: true,
        senderUserId: true,
        senderFallbackName: true,
        video: { select: { title: true, isPlaceholder: true } },
      },
    }),
    prisma.qrCode.count({ where: { clinicId } }),
    listSeatNames(clinicId),
  ]);
  const ids = codes.map((qr) => qr.id);
  const [today, recent] = await Promise.all([
    countIssued(ids, utcDayStart(now)),
    countIssued(ids, new Date(now.getTime() - QR_RECENT_DAYS * 24 * 60 * 60 * 1000)),
  ]);
  const seated = new Map(seats.map((seat) => [seat.clerkUserId, seat.displayName]));
  return {
    total,
    rows: codes.map((qr) => ({
      id: qr.id,
      createdAt: qr.createdAt,
      retiredAt: qr.retiredAt,
      videoTitle: qr.video.title,
      isPlaceholder: qr.video.isPlaceholder,
      surgeonName: effectiveSenderName(seated.get(qr.senderUserId), qr.senderFallbackName),
      surgeonSeated: seated.has(qr.senderUserId),
      issuedToday: today.get(qr.id) ?? 0,
      issuedRecently: recent.get(qr.id) ?? 0,
    })),
  };
}

/** Links handed out by each of these codes since `since`, counted in the database. */
async function countIssued(ids: string[], since: Date): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const groups = await prisma.share.groupBy({
    by: ["qrCodeId"],
    where: { qrCodeId: { in: ids }, createdAt: { gte: since } },
    _count: { _all: true },
  });
  return new Map(groups.map((group) => [group.qrCodeId as string, group._count._all]));
}
