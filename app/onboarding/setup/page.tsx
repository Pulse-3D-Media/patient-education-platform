import { redirect } from "next/navigation";
import { SETUP_FINISHED_HREF, setupStepHref } from "@/lib/setup";
import { requireSetup } from "./setup-view";

/**
 * The way into setup, at /onboarding/setup: the welcome dialog's "Finish
 * setting up" and the library's "Finish setup" both come here. It sends the
 * admin to the step their clinic is on (saved on the clinic, so any admin
 * lands in the same place), or, once setup is done, to the library with the
 * welcome dialog showing setup as done.
 * Someone who has already been through a step is greeted with "Welcome
 * back." (06-setup-resume), which the address carries as ?back=1.
 */
export const dynamic = "force-dynamic";

export default async function SetupEntryPage() {
  const { progress } = await requireSetup();
  if (!progress.current) redirect(SETUP_FINISHED_HREF);
  const begun = progress.steps.some((step) => step.state === "done" || step.state === "later");
  redirect(begun ? `${setupStepHref(progress.current)}?back=1` : setupStepHref(progress.current));
}
