import { describe, expect, it } from "vitest";
import { readSetupProgress } from "./setup";
import { daysAfter, reminderDue, setupReminderEmail, setupReminderKey, STOP_AFTER_DAYS, whoGetsReminders, type ReminderClinicFacts } from "./setup-reminders";

/**
 * The reminder rules and wording, with no database: which reminder is due at
 * every boundary, who may get one at all, and what the email says.
 */

const SIGNED_UP = new Date("2026-11-01T10:30:00.000Z");
const at = (days: number, ms = 0) => new Date(daysAfter(SIGNED_UP, days).getTime() + ms);

describe("which reminder is due", () => {
  it("nothing in the first day, reminder 1 from exactly one day", () => {
    expect(reminderDue(SIGNED_UP, 0, SIGNED_UP)).toBeNull();
    expect(reminderDue(SIGNED_UP, 0, at(1, -1))).toBeNull();
    expect(reminderDue(SIGNED_UP, 0, at(1))).toBe(1);
    expect(reminderDue(SIGNED_UP, 0, at(6, 23 * 3600_000))).toBe(1);
  });

  it("reminder 2 from exactly one week, reminder 3 from exactly two weeks", () => {
    expect(reminderDue(SIGNED_UP, 1, at(7, -1))).toBeNull();
    expect(reminderDue(SIGNED_UP, 1, at(7))).toBe(2);
    expect(reminderDue(SIGNED_UP, 2, at(14, -1))).toBeNull();
    expect(reminderDue(SIGNED_UP, 2, at(14))).toBe(3);
  });

  it("a reminder already sent is not due again (a rerun the same day sends nothing)", () => {
    expect(reminderDue(SIGNED_UP, 1, at(1))).toBeNull();
    expect(reminderDue(SIGNED_UP, 1, at(3))).toBeNull();
    expect(reminderDue(SIGNED_UP, 2, at(10))).toBeNull();
  });

  it("after the third, nothing ever again (a fourth run sends nothing)", () => {
    for (const day of [14, 15, 20, 21, 30, 365]) expect(reminderDue(SIGNED_UP, 3, at(day))).toBeNull();
  });

  it("a missed day is made up once, late, with the newest reminder only", () => {
    // The job did not run on day 1 or day 2: on day 3 reminder 1 goes, once.
    expect(reminderDue(SIGNED_UP, 0, at(3))).toBe(1);
    // Nothing went in the first week at all: on day 8 it is reminder 2, never 1 and 2 together.
    expect(reminderDue(SIGNED_UP, 0, at(8))).toBe(2);
    // Reminder 3 has gone: reminder 2's time is long past and it never goes.
    expect(reminderDue(SIGNED_UP, 3, at(15))).toBeNull();
  });

  it("nothing at all from three weeks after sign-up, however many were missed", () => {
    expect(reminderDue(SIGNED_UP, 2, at(STOP_AFTER_DAYS, -1))).toBe(3);
    expect(reminderDue(SIGNED_UP, 0, at(STOP_AFTER_DAYS))).toBeNull();
    expect(reminderDue(SIGNED_UP, 0, at(60))).toBeNull();
  });

  it("a clinic that signed up long ago and only opens now gets at most the one reminder due today", () => {
    expect(reminderDue(SIGNED_UP, 0, at(16))).toBe(3);
    expect(reminderDue(SIGNED_UP, 0, at(45))).toBeNull();
  });

  it("a damaged stored number never sends", () => {
    expect(reminderDue(SIGNED_UP, -1, at(2))).toBeNull();
    expect(reminderDue(SIGNED_UP, 7, at(15))).toBeNull();
    expect(reminderDue(SIGNED_UP, 1.5, at(8))).toBeNull();
    expect(reminderDue(new Date("not a date"), 0, at(2))).toBeNull();
  });
});

describe("who may get a reminder", () => {
  const open: ReminderClinicFacts = { status: "ACTIVE", setupStep: "branding", setupDone: ["clinic"], ownerClerkUserId: "user_owner", clerkOrgId: "org_x" };

  it("an open clinic part-way through setup, with an owner", () => {
    expect(whoGetsReminders(open)).toMatchObject({ current: "branding", doneCount: 1 });
  });

  it("never a clinic made before setup existed, a finished one, or one with a value not understood", () => {
    expect(whoGetsReminders({ ...open, setupStep: null })).toBeNull();
    expect(whoGetsReminders({ ...open, setupStep: "finished" })).toBeNull();
    expect(whoGetsReminders({ ...open, setupStep: "something-else" })).toBeNull();
  });

  it("never a clinic that is not ACTIVE: one that never paid, a paused, cancelled or past-due one", () => {
    for (const status of ["PENDING", "PAUSED", "CANCELED", "PAST_DUE"] as const) expect(whoGetsReminders({ ...open, status })).toBeNull();
  });

  it("never a clinic with no owner or no organization", () => {
    expect(whoGetsReminders({ ...open, ownerClerkUserId: null })).toBeNull();
    expect(whoGetsReminders({ ...open, clerkOrgId: null })).toBeNull();
  });
});

describe("the email", () => {
  const ORIGIN = "https://app.example.test";
  const progress = readSetupProgress("branding", ["clinic"])!;

  it("is worded as drawn, with the steps done ticked, and links to the setup page on the app's own address", () => {
    const email = setupReminderEmail(progress, ORIGIN, true);
    expect(email.subject).toBe("A few minutes to finish setting up your clinic");
    expect(email.text).toContain("Your library is ready. Your team isn't in yet.");
    expect(email.text).toContain("Thanks for signing up. A few setup steps are left before your team can send their first link:");
    expect(email.text).toContain("[x] Clinic name\n[ ] Branding\n[ ] Your team\n[ ] Test link");
    expect(email.text).toContain("It takes about 5 minutes, and it picks up where you left off.");
    expect(email.text).toContain("Finish setup: https://app.example.test/onboarding/setup");
    expect(email.text).toContain("Questions? Reply to this email and a person will answer.");
    expect(email.text).toContain("You're getting this because you set up a clinic on Pulse 3D. These reminders stop once setup is finished.");
    expect(email.html).toContain('href="https://app.example.test/onboarding/setup"');
    expect(email.html).toContain('src="https://app.example.test/pulse-3d-logo.png"');
    expect(email.html.match(/&#10003;/g)).toHaveLength(1);
  });

  it("leaves out the reply line when replies would not reach a person", () => {
    const email = setupReminderEmail(progress, ORIGIN, false);
    expect(email.text).not.toContain("Reply to this email");
    expect(email.html).not.toContain("Reply to this email");
  });

  it("says a few steps are left, not that the team is not in, once the team step is done", () => {
    const email = setupReminderEmail(readSetupProgress("test", ["clinic", "team"])!, ORIGIN, true);
    expect(email.text).toContain("Your library is ready. A few steps are left.");
    expect(email.text).not.toContain("Your team isn't in yet.");
  });

  it("has no em dash", () => {
    const email = setupReminderEmail(progress, ORIGIN, true);
    expect(email.text + email.html + email.subject).not.toContain(String.fromCharCode(0x2014));
  });

  it("the idempotency key is the same for the same clinic and reminder, different otherwise, and does not show the id", () => {
    expect(setupReminderKey("clinic_a", 1)).toBe(setupReminderKey("clinic_a", 1));
    expect(setupReminderKey("clinic_a", 1)).not.toBe(setupReminderKey("clinic_a", 2));
    expect(setupReminderKey("clinic_a", 1)).not.toBe(setupReminderKey("clinic_b", 1));
    expect(setupReminderKey("clinic_a", 1)).not.toContain("clinic_a");
  });
});
