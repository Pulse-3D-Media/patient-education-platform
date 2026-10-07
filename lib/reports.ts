/**
 * The Pulse reports, the parts that need no database: the periods a report
 * can cover, what each number means, and the little arithmetic on top of
 * the counts. Pure, safe for the browser. The counting itself is in
 * lib/db/reports.ts.
 *
 * READ THIS BEFORE CHANGING A WORD ON THE REPORTS PAGE. Every number is
 * labelled by what it measures (CLAUDE.md, "Writing copy"):
 *
 *   - A LINK is one /watch link made for a patient. It is not a person: one
 *     patient can be given two links, and one link can be opened by several
 *     people, or by a text message's preview, or by nobody.
 *   - A link is PLAYED when at least one play start has been recorded on it.
 *   - A PLAY START is counted once per page load, the first time the video
 *     actually starts playing on the patient page (Share.viewCount). Not a
 *     unique viewer, not a completed watch, not proof anyone understood.
 *   - A RENEWAL REQUEST is a tap on "Ask my clinic" that was recorded: at
 *     most one per link per day (Share.renewalRequests). Requests made
 *     before October 2026 were never kept, so they are not in it.
 *   - A RENEWAL is the clinic turning a paused link back on
 *     (Share.renewalsUsed).
 *
 * THE PERIOD. A report covers the links MADE in the period (the last 30 or
 * 90 days ending now, or two dates chosen on the page), with whatever plays
 * and renewals have been recorded on them so far. It is a group of links, not a diary of activity:
 * a link made 31 days ago and played yesterday is not in "the last 30
 * days". The app keeps a running count on each link, not a dated record of
 * every play, so activity per day cannot be worked out, and the page never
 * pretends otherwise.
 *
 * The playback position is not measured (decided by Evan on 2026-10-07):
 * nothing beyond the play start is reported from the patient's phone.
 */

/** The periods a report can cover, in days. The first is the default. */
export const REPORT_PERIODS = [30, 90] as const;
export type ReportDays = (typeof REPORT_PERIODS)[number];

/** The period from an address such as /pulse/reports?days=90. Anything else, missing or junk, is the default 30. */
export function readReportDays(value: unknown): ReportDays {
  return value === "90" ? 90 : 30;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** When a period of `days` days ending at `now` begins: exactly that many 24-hour days earlier. */
export function periodStart(now: Date, days: ReportDays): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

// ---------------------------------------------------------------------------
// Custom dates. Besides the last 30 or 90 days, a report can cover the links
// made between two dates (?from=2026-09-01&to=2026-09-30). The dates are
// whole days in Utah time, the time every Pulse page shows: from midnight at
// the start of `from` to midnight at the end of `to` (or now, if that is
// sooner). They are checked here, and anything that cannot be used falls
// back to the last 30 days with a plain sentence saying why; a date is never
// guessed at.
// ---------------------------------------------------------------------------

/** The time zone the dates are read in. */
const REPORT_ZONE = "America/Denver";
/** The earliest start date accepted. Long before the first link (2026); it only keeps a typed-in year 0001 out. */
export const EARLIEST_REPORT_DATE = "2024-01-01";

/** The links a report covers: the last 30 or 90 days, or two dates. `since` and `until` are the exact moments the database is asked about. */
export type ReportRange =
  | { kind: "preset"; days: ReportDays; since: Date; until: Date }
  | { kind: "custom"; from: string; to: string; since: Date; until: Date };

/** What the address asked for, made usable: the range, and a sentence when what was asked for could not be used. */
export type RangeReading = { range: ReportRange; problem: string | null };

/** How far Utah's clock is ahead of UTC at instant `t` (negative: it is behind), in milliseconds. */
function zoneOffsetMs(t: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: REPORT_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(t));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
  return wall - Math.floor(t / 1000) * 1000;
}

/** The three numbers of a "2026-09-01" date, or null when it is not a real calendar date in that shape. */
function dateParts(value: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(y, m - 1, d));
  // 2026-02-30 rolls over to March; a real date comes back as itself.
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return [y, m, d];
}

/** Midnight at the start of a "2026-09-01" day in Utah, as an exact moment. US clocks change at 2 a.m., so midnight always exists once. */
export function utahStartOfDay(value: string): Date {
  const parts = dateParts(value);
  if (!parts) throw new Error("Not a date.");
  const guess = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  // Twice, so a day whose offset differs from the guess's settles on the right one.
  let t = guess - zoneOffsetMs(guess);
  t = guess - zoneOffsetMs(t);
  return new Date(t);
}

/** The Utah calendar date of a moment, as "2026-10-07". */
export function utahDateOf(date: Date): string {
  const shifted = new Date(date.getTime() + zoneOffsetMs(date.getTime()));
  return shifted.toISOString().slice(0, 10);
}

/** The day after a "2026-09-30" date: "2026-10-01". */
function nextDay(value: string): string {
  const parts = dateParts(value);
  if (!parts) throw new Error("Not a date.");
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + 1)).toISOString().slice(0, 10);
}

/** "Sep 1, 2026", from "2026-09-01". */
export function dateWords(value: string): string {
  const parts = dateParts(value);
  if (!parts) return value;
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** The last `days` days ending `now`. */
export function presetRange(days: ReportDays, now: Date): ReportRange {
  return { kind: "preset", days, since: periodStart(now, days), until: now };
}

/**
 * The range an address asks for. With `from` or `to` it is custom dates, and
 * both must be real dates, from 2024 on, the start not after the end and not
 * after today; anything else is the last 30 days with a sentence saying why.
 * Without them it is ?days (30 or 90, anything else 30).
 */
export function readReportRange(params: { days?: unknown; from?: unknown; to?: unknown }, now: Date): RangeReading {
  const from = typeof params.from === "string" ? params.from.trim() : "";
  const to = typeof params.to === "string" ? params.to.trim() : "";
  if (!from && !to) return { range: presetRange(readReportDays(params.days), now), problem: null };

  const fallback = (problem: string): RangeReading => ({ range: presetRange(30, now), problem: `${problem} Showing the last 30 days instead.` });
  if (!from || !to) return fallback("Choose both a start date and an end date.");
  if (!dateParts(from) || !dateParts(to)) return fallback("Those dates could not be read.");
  // The dates are all the same shape, so comparing them as text compares them as dates.
  if (from < EARLIEST_REPORT_DATE) return fallback(`Choose a start date on or after ${dateWords(EARLIEST_REPORT_DATE)}.`);
  if (from > to) return fallback("The start date is after the end date.");
  if (from > utahDateOf(now)) return fallback("The start date is in the future.");

  const endOfTo = utahStartOfDay(nextDay(to));
  return { range: { kind: "custom", from, to, since: utahStartOfDay(from), until: endOfTo < now ? endOfTo : now }, problem: null };
}

/** What a range adds to a report address: nothing for the default 30 days, ?days=90, or ?from=..&to=.. */
export function rangeSearch(range: ReportRange): Record<string, string> {
  if (range.kind === "custom") return { from: range.from, to: range.to };
  return range.days === 30 ? {} : { days: String(range.days) };
}

/** A report address with the range (and anything else) on it. */
export function reportHref(path: string, range: ReportRange, extra: Record<string, string> = {}): string {
  const text = new URLSearchParams({ ...rangeSearch(range), ...extra }).toString();
  return text ? `${path}?${text}` : path;
}

/** The dates a range covers, for a file name: "2026-09-01-to-2026-09-30". */
export function rangeFileTag(range: ReportRange): string {
  return range.kind === "custom" ? `${range.from}-to-${range.to}` : `${utahDateOf(range.since)}-to-${utahDateOf(range.until)}`;
}

/** The counts the reports show for any group of links: the whole platform, one clinic, one surgeon, one procedure. */
export type LinkCounts = {
  /** Links made in the period. */
  made: number;
  /** Of those, links with at least one play start recorded. */
  played: number;
  /** Play starts recorded on those links. */
  playStarts: number;
  /** Renewal requests recorded on those links. */
  renewalRequests: number;
  /** Times those links were turned back on. */
  renewals: number;
};

export const NO_LINKS: LinkCounts = { made: 0, played: 0, playStarts: 0, renewalRequests: 0, renewals: 0 };

/**
 * Played links over links made, as a whole percent ("62%"), or a dash when
 * no links were made: a rate over nothing is not zero, it is not a number.
 */
export function playedRate(counts: Pick<LinkCounts, "made" | "played">): string {
  if (counts.made <= 0) return "–";
  return `${Math.round((counts.played / counts.made) * 100)}%`;
}

/**
 * Who provides an open clinic's seats, for the platform totals.
 *
 *   card   the clinic follows its own card payments (nobody at Pulse has set
 *          its access by hand, and Pulse does not manage it). Its seats are
 *          the seats it pays for.
 *   pulse  Pulse manages the clinic, or Pulse staff opened it by hand. Its
 *          seats are whatever Pulse set; nobody is paying for them by card.
 *
 * Only OPEN clinics are counted in the seat totals (clinicIsOpen in
 * lib/clinic-status.ts); a closed clinic's seats are not in use by anyone.
 * Every clinic's links are counted in the link numbers, open or not.
 */
export type SeatSource = "card" | "pulse";

export function seatSourceOf(clinic: { managedByPulse: boolean; staffAccess: string | null }): SeatSource {
  return clinic.managedByPulse || clinic.staffAccess === "OPEN" ? "pulse" : "card";
}

/** The words for each, as the report shows them. */
export const SEAT_SOURCE_WORDS: Record<SeatSource, string> = {
  card: "Paid by card",
  pulse: "Set up by Pulse",
};

/** The sentence under the period switch, saying exactly what the numbers cover. */
export function rangeSentence(range: ReportRange): string {
  const which = range.kind === "custom" ? `from ${dateWords(range.from)} to ${dateWords(range.to)}, Utah time` : `in the last ${range.days} days`;
  return `Links made ${which}, with the plays and renewals recorded on them so far.`;
}

/** The definitions box on the reports pages, one line per number. */
export const REPORT_DEFINITIONS: { term: string; meaning: string }[] = [
  {
    term: "Links made",
    meaning: "Links made for patients in the period. A link is not a person: one patient can get two links, and one link can be opened by several people.",
  },
  { term: "Played", meaning: "Links with at least one play start recorded." },
  {
    term: "Play starts",
    meaning:
      "Counted once per page load, the first time the video actually starts playing. Not unique viewers, not completed watches, and not proof that anyone understood anything.",
  },
  {
    term: "Renewal requests",
    meaning: "Taps on Ask my clinic that were recorded, at most one per link per day. Counted from October 2026; earlier requests were not kept.",
  },
  { term: "Renewals", meaning: "Times a clinic turned a paused link back on." },
  {
    term: "The period",
    meaning:
      "A group of links: the ones made in the last 30 or 90 days, or between the dates you chose. A link made before the period and played during it is not in it, because the app keeps a running count on each link, not a dated record of every play.",
  },
];
