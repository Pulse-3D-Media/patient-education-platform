import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ClinicLogo } from "@/components/ui/ClinicLogo";
import { PatientPhonePreview } from "@/components/ui/PatientPhonePreview";
import { requireClinicPage } from "@/lib/clinic";
import { getSeatFor } from "@/lib/db/seats";
import { errorKind } from "@/lib/error-kind";
import { PULSE_STAFF_LIGHT_THEME, themeVars } from "@/lib/branding";
import { checkSeats } from "@/lib/seat-changes";
import { previewFacts } from "../setup/setup-view";
import { JoinForm } from "./JoinForm";

/**
 * "Join <clinic>" (screen 05-join): where an invited person lands when they
 * accept, to enter their own name and credential, which is the name patients
 * see on the links they send ("Marcus Lee, DO"). The office admin only typed
 * their email (decided by Evan on 2026-11-19); People keeps the admin's
 * Change, to correct it.
 *
 * HOW THEY GET HERE: the invitation email's link opens our sign-up page with
 * Clerk's ticket; Clerk's own form makes the account and accepts the
 * invitation, then sends them here (forceRedirectUrl on that form, and the
 * "already accepted" case of the sign-up page).
 *
 * WHO SEES THE FORM: someone in the clinic, not its account owner, who holds
 * a seat and has no name chosen yet. Their invitation's held seat becomes
 * theirs when the seats are checked against Clerk; Clerk's notification
 * usually does that within seconds, and this page checks once itself if it
 * has not happened yet. Anyone else goes straight to the library, so the
 * page never blocks anyone: a person who leaves it can set their name later
 * from the Send panel, as always.
 *
 * The name is saved through the library's own "change my name" action
 * (setMyPatientNameAction), with the same checks and rules (lib/sender-name.ts):
 * only the signed-in person's own seat, logged, checked with Clerk.
 */
export const dynamic = "force-dynamic";

export default async function JoinPage() {
  const clinic = await requireClinicPage();
  const { userId } = await auth();
  if (!userId || clinic.isOwner) redirect("/library");

  let seat = await getSeatFor(clinic.id, userId);
  if (!seat) {
    // The invitation's seat may not have been turned into theirs yet: check once.
    await checkSeats(clinic.id).catch((error) => console.error("Join: the seats could not be checked", errorKind(error)));
    seat = await getSeatFor(clinic.id, userId);
  }
  if (!seat || seat.displayName) redirect("/library");

  const preview = await previewFacts(clinic);

  return (
    <div className="flex min-h-screen flex-col bg-sunken text-ink-soft" style={themeVars(PULSE_STAFF_LIGHT_THEME)}>
      <header className="flex h-[76px] shrink-0 items-center border-b border-line bg-surface px-6 sm:px-10">
        <ClinicLogo src={preview.logoUrl} name={clinic.name} boxClassName="h-10 w-[220px] max-w-[70vw]" nameClassName="truncate text-[17px] font-semibold text-ink" />
      </header>
      <main className="flex flex-1 justify-center px-6 py-10 sm:px-12 sm:py-14">
        <div className="flex w-full max-w-[884px] flex-col gap-10 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1 lg:max-w-[480px]">
            <h1 className="text-[2.25rem] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[2.5rem]">Join {clinic.name}</h1>
            <JoinForm defaultName={clinic.defaultPatientName} />
          </div>
          <div className="hidden shrink-0 lg:block">
            <PatientPhonePreview {...preview} title="Total Knee Replacement" />
          </div>
        </div>
      </main>
    </div>
  );
}
