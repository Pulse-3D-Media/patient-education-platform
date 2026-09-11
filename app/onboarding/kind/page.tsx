import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { LOGO_URL } from "@/lib/brand";
import { getCurrentClinic } from "@/lib/clinic";
import { KindForm } from "./KindForm";

/**
 * Step two of onboarding, asked once per person per clinic:
 * "Are you a surgeon who will send videos to patients?"
 *
 * Yes makes them a surgeon, no makes them staff (see lib/roles.ts). This is
 * kind, not permission: it decides what the clinic pays for, never what the
 * person can do. Everyone is asked, admins included, because the office
 * manager who sets the clinic up is usually staff and the surgeon who sets
 * it up is usually a surgeon.
 *
 * Once answered, the answer is on their Clerk membership and this page
 * sends them straight to the library.
 */
export const dynamic = "force-dynamic";

export default async function KindPage() {
  await auth.protect();

  const clinic = await getCurrentClinic();
  if (!clinic) redirect("/onboarding");
  if (clinic.kind) redirect("/library");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-[#e4ebf3] px-4 py-10">
      {/* eslint-disable-next-line @next/next/no-img-element -- small static logo from the CDN */}
      <img src={LOGO_URL} alt="Pulse 3D" className="h-9 w-auto" />

      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-[0_8px_40px_rgba(0,0,0,.08)]">
        <p className="text-sm font-medium uppercase tracking-wider text-[#667085]">{clinic.name}</p>
        <h1 className="mt-2 text-2xl font-semibold text-black">Are you a surgeon who will send videos to patients?</h1>
        <p className="mt-2 text-[#667085]">
          One question, asked once. It only affects how your clinic is billed: surgeons are what a clinic pays for,
          everyone else is free.
        </p>
        <KindForm />
      </div>
    </main>
  );
}
