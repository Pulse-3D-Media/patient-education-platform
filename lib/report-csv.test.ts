import { describe, expect, it } from "vitest";
import { categoriesCsv, clinicsCsv, exportFileName, proceduresCsv, readExportTable, surgeonsCsv } from "./report-csv";

const counts = { made: 3, played: 2, playStarts: 5, renewalRequests: 1, renewals: 0 };
const none = { made: 0, played: 0, playStarts: 0, renewalRequests: 0, renewals: 0 };

/** The lines of a file, without the byte-order mark. */
const lines = (csv: string) => csv.replace(/^﻿/, "").trimEnd().split("\r\n");

describe("the report files", () => {
  it("have the table's columns, the rate as a whole percent, and an empty rate (not 0) when nothing was made", () => {
    expect(lines(categoriesCsv([{ category: "FOOT_ANKLE", ...counts }, { category: "HIP", ...none }]))).toEqual([
      "Category,Links made,Played,Played rate (%),Play starts,Renewal requests,Renewals",
      "Foot & Ankle,3,2,67,5,1,0",
      "Hip,0,0,,0,0,0",
    ]);
  });

  it("mark placeholders and give the category's label", () => {
    expect(lines(proceduresCsv([{ videoId: "v1", title: "Total Knee", category: "KNEE", isPlaceholder: true, ...counts }]))[1]).toBe("Total Knee,Knee,Yes,3,2,67,5,1,0");
  });

  it("give each clinic's status in words and make a formula-looking name harmless", () => {
    const row = {
      id: "c1",
      name: "=cmd|' /C calc'!A0",
      status: "PAST_DUE" as const,
      managedByPulse: true,
      staffAccess: null,
      categoryCount: 2,
      surgeonSeats: 3,
      seatsInUse: 1,
      ...counts,
    };
    const [heading, line] = lines(clinicsCsv([row]));
    expect(heading).toBe("Clinic,Status,Managed by Pulse,Categories on plan,Seats in use,Seats on plan,Links made,Played,Played rate (%),Play starts,Renewal requests,Renewals");
    expect(line).toBe("'=cmd|' /C calc'!A0,Past due,Yes,2,1,3,3,2,67,5,1,0");
  });

  it("name surgeons as patients saw them and never write a Clerk id", () => {
    const csv = surgeonsCsv([
      { userId: "user_secret123", name: "Dr. Jane Smith, DO", ...counts },
      { userId: "user_noname", name: null, ...none },
      { userId: null, name: null, ...none },
    ]);
    expect(lines(csv).slice(1)).toEqual(['"Dr. Jane Smith, DO",3,2,67,5,1,0', "Name not recorded,0,0,,0,0,0", "No surgeon recorded (older links),0,0,,0,0,0"]);
    expect(csv).not.toContain("user_");
  });
});

describe("downloads", () => {
  it("accept only the four tables", () => {
    expect(readExportTable("clinics")).toBe("clinics");
    for (const junk of ["", "Clinics", "shares", null, ["clinics"]]) expect(readExportTable(junk)).toBeNull();
  });

  it("have a file name with only letters, digits and hyphens", () => {
    expect(exportFileName("clinics", "2026-09-01-to-2026-09-30")).toBe("pulse-report-clinics-2026-09-01-to-2026-09-30.csv");
    expect(exportFileName("surgeons", "2026-09-01-to-2026-09-30", 'St. Mark\'s "Ortho" & Spine')).toBe("pulse-report-st-mark-s-ortho-spine-surgeons-2026-09-01-to-2026-09-30.csv");
    expect(exportFileName("procedures", "x", "!!!")).toBe("pulse-report-clinic-procedures-x.csv");
  });
});
