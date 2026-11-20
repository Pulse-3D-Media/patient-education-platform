import { formatUsPhone } from "@/lib/phone";
import { SetupFrame } from "../SetupFrame";
import { cameBack, previewFacts, requireSetup } from "../setup-view";
import { ClinicStepForm } from "./ClinicStepForm";

/**
 * Setup step 1 of 4: "What's your clinic called?" (screen 04-setup-1-clinic).
 * The clinic's name, which replaces the provisional one made at sign-up
 * ("Jane Smith's clinic"), and its phone (optional), which patients can tap
 * to call. The phone on the right shows the patient page as it changes.
 */
export const dynamic = "force-dynamic";

export default async function SetupClinicPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const { clinic, progress } = await requireSetup("clinic");
  const [preview, welcomeBack] = await Promise.all([previewFacts(clinic), cameBack(searchParams)]);
  return (
    <SetupFrame clinic={clinic} progress={progress} step="clinic">
      <ClinicStepForm name={clinic.name} phone={formatUsPhone(clinic.phone)} preview={preview} welcomeBack={welcomeBack} />
    </SetupFrame>
  );
}
