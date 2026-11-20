import { redirect } from "next/navigation";
import { SETUP_FINISHED_HREF, SETUP_PATH } from "@/lib/setup";
import { requireSetup } from "../setup-view";

/**
 * The old end of setup. The full "You're ready for patients." page was taken
 * out on 2026-11-20 (Evan: "just go back to the dialogue box that pops up
 * after sign up"): finishing setup now opens the library with the welcome
 * dialog over it, showing setup as done (app/library/WelcomeDialog.tsx).
 * This address only sends people there, so an old bookmark or an email
 * still lands somewhere sensible. Someone who opens it before setup is
 * finished goes to the step their clinic is on; the checks are setup's own.
 */
export const dynamic = "force-dynamic";

export default async function SetupDonePage() {
  const { progress } = await requireSetup();
  redirect(progress.finished ? SETUP_FINISHED_HREF : SETUP_PATH);
}
