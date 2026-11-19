import { allFontClasses, staffLook } from "@/app/brand-look";
import { AdminsOnly } from "@/components/ui/AdminsOnly";
import { ClinicClosed } from "@/components/ui/ClinicClosed";
import { ClinicLogo } from "@/components/ui/ClinicLogo";
import { ClinicShell } from "@/components/ui/ClinicShell";
import { requireClinicPage } from "@/lib/clinic";
import { clinicIsOpen } from "@/lib/clinic-status";
import { getShareTerms } from "@/lib/db/shares";
import { afterFirstPlaySentence } from "@/lib/expiry";
import { AdminFrame } from "../AdminFrame";
import { DetailHeader } from "../DetailParts";
import { saveClinicBrandingAction, saveClinicNameAction, uploadClinicLogoAction } from "./actions";
import { ClinicBrandingForm } from "./ClinicBrandingForm";
import { LogoUploadForm } from "./IdentityForms";

/**
 * Clinic branding, at /admin/branding: one page (the approved design,
 * screen 11). Admins only. It is where a clinic makes the app its own: its
 * name and phone, its logo, one brand colour, a font from a short list, and
 * light or dark for its team's screens, with a phone beside the form showing
 * the patient page as it will look.
 *
 * The name belongs to the clinic's Clerk organization and the logo is
 * uploaded there (saveClinicNameAction, uploadClinicLogoAction; Clerk's own
 * organization panel was taken off People in October 2026). There is one
 * logo column in our database and no file storage of our own, so there are
 * never two logos to disagree. The colour, font, mode and phone are ours
 * (saveClinicBrandingAction). One Save sends the name (when it changed) and
 * then the rest; the logo is uploaded by its own button, since a file goes
 * on its own (ClinicBrandingForm.tsx).
 *
 * Every action checks again on the server that this person is an admin and
 * works out the clinic from who is signed in. Pulse staff can change the
 * same things from /pulse; the last save wins and every change is logged.
 *
 * The phone shows the patient page honestly (PatientPhonePreview); the
 * patient page itself is not changed by anything here except the values.
 *
 * Like every admin page but Billing, it needs the clinic to be open.
 */
export const dynamic = "force-dynamic";

export default async function BrandingPage() {
  const clinic = await requireClinicPage();

  if (!clinic.isAdmin) {
    return (
      <ClinicShell clinic={clinic}>
        <AdminsOnly />
      </ClinicShell>
    );
  }

  // A clinic that is not open: the frame and its navigation stay, so Billing
  // is one tap away, but there is nothing to brand until it opens.
  if (!clinicIsOpen(clinic)) {
    return (
      <AdminFrame clinic={clinic} title="Clinic branding">
        <div className="mt-6">
          <ClinicClosed status={clinic.status} clinicName={clinic.name} billingLink inFrame />
        </div>
      </AdminFrame>
    );
  }

  const look = staffLook(clinic);
  // Only for the line under the video in the picture. A setting out of range leaves the line out.
  const terms = await getShareTerms(clinic.id).catch(() => null);

  return (
    <AdminFrame clinic={clinic} title="Clinic branding" bare>
      <div className="px-4 py-6 md:px-9 md:py-8">
        <DetailHeader as="h1" title="Clinic branding" />
        <div className="mt-6">
          <ClinicBrandingForm
            saveName={saveClinicNameAction}
            saveBranding={saveClinicBrandingAction}
            values={{ name: clinic.name, phone: clinic.phone, brandColor: clinic.branding.color, brandFont: clinic.branding.font, brandTheme: clinic.branding.theme }}
            logoUrl={look.logoUrl}
            senderName={clinic.defaultPatientName}
            deadline={terms ? afterFirstPlaySentence(terms.daysAfterFirstPlay) : null}
            fontClasses={allFontClasses()}
            logo={
              <div className="flex flex-col gap-4">
                {/* Shown on white, which is how it appears on the patient page. */}
                <div className="flex min-h-16 max-w-md items-center gap-4 rounded-xl border border-line bg-white px-4 py-3">
                  <ClinicLogo src={look.logoUrl} name={clinic.name} boxClassName="h-10 w-[220px] max-w-full" nameClassName="text-[15px] font-semibold text-[#12202a]" />
                </div>
                {look.logoUrl && !clinic.logoIsFromClerk && <p className="text-sm text-ink-soft">Pulse 3D set this logo for you. Uploading your own replaces it.</p>}
                {!look.logoUrl && <p className="text-sm text-ink-soft">No logo yet, so your clinic&apos;s name is shown in its place.</p>}
                <LogoUploadForm action={uploadClinicLogoAction} />
              </div>
            }
          />
        </div>
      </div>
    </AdminFrame>
  );
}
