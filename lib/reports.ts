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
 * THE PERIOD. A report covers the links MADE in the period, a rolling window
 * of whole days ending now, with whatever plays and renewals have been
 * recorded on them so far. It is a group of links, not a diary of activity:
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
export function periodSentence(days: ReportDays): string {
  return `Links made in the last ${days} days, with the plays and renewals recorded on them so far.`;
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
      "A group of links: the ones made in the last 30 or 90 days. A link made before the period and played during it is not in it, because the app keeps a running count on each link, not a dated record of every play.",
  },
];
