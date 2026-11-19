import { uploadClinicLogoAction } from "@/app/admin/branding/actions";
import { LogoUploadForm } from "@/app/admin/branding/IdentityForms";
import { ClinicLogo } from "@/components/ui/ClinicLogo";
import { SetupFrame } from "../SetupFrame";
import { cameBack, previewFacts, requireSetup } from "../setup-view";
import { BrandingStepForm } from "./BrandingStepForm";

/**
 * Setup step 2 of 4: "Add your branding" (screen 04-setup-2-branding): the
 * logo and the colour, nothing else (the font and light or dark stay on the
 * Clinic branding page). The logo is uploaded through Clinic branding's own
 * upload, with its checks (a PNG, JPG or WebP picture of 1 MB or less, read
 * by its bytes), the moment it is chosen and Upload is pressed; the colour is
 * saved by Continue.
 */
export const dynamic = "force-dynamic";

export default async function SetupBrandingPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const { clinic, progress } = await requireSetup();
  const [preview, welcomeBack] = await Promise.all([previewFacts(clinic), cameBack(searchParams)]);
  return (
    <SetupFrame clinic={clinic} progress={progress} step="branding">
      <BrandingStepForm
        color={clinic.branding.color}
        preview={preview}
        welcomeBack={welcomeBack}
        logo={
          <div className="flex flex-col gap-4">
            {/* Shown on white, which is how it appears on the patient page. */}
            <div className="flex min-h-16 items-center gap-4 rounded-xl border border-line bg-white px-4 py-3">
              <ClinicLogo src={preview.logoUrl} name={clinic.name} boxClassName="h-10 w-[220px] max-w-full" nameClassName="text-[15px] font-semibold text-[#12202a]" />
            </div>
            <LogoUploadForm action={uploadClinicLogoAction} />
          </div>
        }
      />
    </SetupFrame>
  );
}
