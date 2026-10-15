import { redirect } from "next/navigation";

/**
 * /admin/reports used to be a "Coming later" placeholder. Clinics get no
 * reports or usage numbers at all for now (decided by Van on 2026-10-08:
 * numbers handed to a clinic could talk it out of renewing; revisit if
 * clinics ask), so the section is gone from the navigation, the menu and the
 * overview. This page stays only so an old bookmark lands somewhere: it sends
 * everyone to the overview, which checks who is asking for itself (signed
 * out goes to sign-in, a member is told the page is for office admins).
 *
 * A plain redirect, not a permanent one, so browsers do not remember it if a
 * clinic page is ever built here. Reports for Pulse staff are /pulse/reports.
 */
export const dynamic = "force-dynamic";

export default function ReportsPage(): never {
  redirect("/admin");
}
