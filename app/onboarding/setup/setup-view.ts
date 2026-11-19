import { redirect } from "next/navigation";
import { staffLook } from "@/app/brand-look";
import { getShareTerms } from "@/lib/db/shares";
import { afterFirstPlaySentence } from "@/lib/expiry";
import { requireClinicPage, type CurrentClinic } from "@/lib/clinic";
import { clinicIsOpen } from "@/lib/clinic-status";
import type { SetupProgress } from "@/lib/setup";

/**
 * Who may see the setup steps, decided on the server for every request
 * (rule 8). SERVER ONLY.
 *
 *   - signed out: sent to sign in by requireClinicPage(), and back here after;
 *   - a member who is not an office admin: the library (setup is for admins
 *     only, and members are never shown the reminder either);
 *   - a clinic that is not open: Billing, which says why (every step's
 *     change needs an open clinic, as on the admin pages);
 *   - a clinic made before setup existed: the admin overview. It counts as
 *     set up, so there is nothing to walk through.
 */
export type SetupPage = { clinic: CurrentClinic; progress: SetupProgress };

export async function requireSetup(): Promise<SetupPage> {
  const clinic = await requireClinicPage();
  if (!clinic.isAdmin) redirect("/library");
  if (!clinicIsOpen(clinic)) redirect("/admin/billing");
  if (!clinic.setup) redirect("/admin");
  return { clinic, progress: clinic.setup };
}

/** What the phone on the right of a step needs to draw the patient page, worked out on the server. */
export type PreviewFacts = {
  clinicName: string;
  logoUrl: string | null;
  color: string | null;
  fontClass: string;
  senderName: string | null;
  deadline: string | null;
};

export async function previewFacts(clinic: CurrentClinic): Promise<PreviewFacts> {
  const look = staffLook(clinic);
  // Only for the line under the video in the picture. A setting out of range leaves the line out.
  const terms = await getShareTerms(clinic.id).catch(() => null);
  return {
    clinicName: clinic.name,
    logoUrl: look.logoUrl,
    color: clinic.branding.color,
    fontClass: look.fontClass,
    senderName: clinic.defaultPatientName,
    deadline: terms ? afterFirstPlaySentence(terms.daysAfterFirstPlay) : null,
  };
}

/** True when the address says the admin has just come back into setup (the entry page adds it), for "Welcome back." */
export async function cameBack(searchParams: Promise<Record<string, string | string[] | undefined>> | undefined): Promise<boolean> {
  return (await searchParams)?.back === "1";
}
