import { SetupFrame } from "../SetupFrame";
import { cameBack, previewFacts, requireSetup } from "../setup-view";
import { BrandingStepForm } from "./BrandingStepForm";

/**
 * Setup step 2 of 4: "Add your branding" (screen 04-setup-2-branding): the
 * logo and the colour, nothing else (the font and light or dark stay on the
 * Clinic branding page). One form: the chosen logo is uploaded by Continue,
 * through Clinic branding's own upload and its checks (a PNG, JPG or WebP
 * picture of 1 MB or less, read by its bytes), then the colour is saved. The
 * phone beside it shows the chosen logo and colour as they change.
 */
export const dynamic = "force-dynamic";

export default async function SetupBrandingPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const { clinic, progress } = await requireSetup();
  const [preview, welcomeBack] = await Promise.all([previewFacts(clinic), cameBack(searchParams)]);
  return (
    <SetupFrame clinic={clinic} progress={progress} step="branding">
      <BrandingStepForm color={clinic.branding.color} savedLogoUrl={preview.logoUrl} clinicName={clinic.name} preview={preview} welcomeBack={welcomeBack} />
    </SetupFrame>
  );
}
