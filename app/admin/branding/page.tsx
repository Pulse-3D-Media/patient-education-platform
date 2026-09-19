import Link from "next/link";
import { allFontClasses, staffLook } from "@/app/brand-look";
import { AdminsOnly } from "@/components/ui/AdminsOnly";
import { BrandingForm } from "@/components/ui/BrandingForm";
import { ClinicClosed } from "@/components/ui/ClinicClosed";
import { ClinicLogo } from "@/components/ui/ClinicLogo";
import { ClinicShell } from "@/components/ui/ClinicShell";
import { SECONDARY_BUTTON } from "@/components/ui/styles";
import { requireClinicPage } from "@/lib/clinic";
import { clinicIsOpen } from "@/lib/clinic-status";
import { AdminFrame } from "../AdminFrame";
import { saveClinicBrandingAction } from "./actions";

/**
 * The Branding section of the clinic admin area, at /admin/branding. Admins
 * only. It is where a clinic makes the app its own: its logo, one brand
 * colour, a font from a short list, and the office phone. All four show on
 * the clinic's /admin and /library screens and on every patient page it
 * sends.
 *
 * Two parts:
 *
 *   1. The logo. It is not uploaded here. A clinic's logo is the one on its
 *      Clerk organization, which an admin changes in the panel at the
 *      bottom of the People page (General, Update profile). There is one
 *      logo column in our database and that upload is what fills it, so
 *      there are never two logos to disagree. This page shows the logo in
 *      use and says where to change it. If Pulse 3D set a logo for the
 *      clinic, it says that too, and that uploading one replaces it.
 *
 *   2. The form (BrandingForm): colour, font and phone, with a live preview.
 *      It saves through saveClinicBrandingAction, which checks again on the
 *      server that this person is an admin and works out the clinic from
 *      who is signed in. Pulse staff can change the same three things from
 *      /pulse; the last save wins and every change is logged.
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
  if (!clinicIsOpen(clinic.status)) {
    return (
      <AdminFrame clinic={clinic} title="Branding">
        <div className="mt-6">
          <ClinicClosed status={clinic.status} clinicName={clinic.name} billingLink inFrame />
        </div>
      </AdminFrame>
    );
  }

  const look = staffLook(clinic);

  return (
    <AdminFrame
      clinic={clinic}
      title="Branding"
      intro={
        <>
          Your logo, colour, font and phone. They show here, in the library your surgeons use, and on every page a patient opens from
          one of your links.
        </>
      }
      wide
    >
      <section aria-labelledby="logo-heading" className="mt-8 rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <h2 id="logo-heading" className="text-lg font-semibold">
          Logo
        </h2>
        <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-center">
          {/* Shown on white, which is how it appears on the patient page and in the mark above a video. (In the banner it sits straight on the page colour, dark or light; the form below says which kind of logo suits which.) */}
          <div className="flex h-20 w-[260px] max-w-full shrink-0 items-center rounded-xl bg-white px-4">
            <ClinicLogo
              src={look.logoUrl}
              name={clinic.name}
              boxClassName="h-12 w-full"
              nameClassName="text-[15px] font-semibold text-[#12202a]"
            />
          </div>
          <div className="min-w-0">
            <p className="text-[15px] text-ink">
              {look.logoUrl
                ? clinic.logoIsFromClerk
                  ? "This is the logo on your clinic's profile."
                  : "Pulse 3D set this logo for you. Uploading your own replaces it."
                : "No logo yet, so your clinic's name is shown in its place everywhere."}
            </p>
            <p className="mt-1 max-w-xl text-sm text-ink-soft">
              To change it, open People, scroll to the panel at the bottom, and choose General, then Update profile. A wide logo on a
              white or clear background works best. It shows here the next time you open a page.
            </p>
            <Link href="/admin/people" className={`${SECONDARY_BUTTON} mt-3`}>
              Open People
            </Link>
          </div>
        </div>
      </section>

      <section aria-labelledby="look-heading" className="mt-6 rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <h2 id="look-heading" className="text-lg font-semibold">
          Colour, font and phone
        </h2>
        <div className="mt-4">
          <BrandingForm
            action={saveClinicBrandingAction}
            clinicName={clinic.name}
            values={{ logoUrl: look.logoUrl, phone: clinic.phone, brandColor: clinic.branding.color, brandFont: clinic.branding.font, brandTheme: clinic.branding.theme }}
            showLogoField={false}
            fontClasses={allFontClasses()}
          />
        </div>
      </section>
    </AdminFrame>
  );
}
