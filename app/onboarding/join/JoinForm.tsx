"use client";

import { SignOutButton } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { setMyPatientNameAction } from "@/app/library/[category]/actions";
import { SenderNameForm } from "@/components/ui/SenderNameForm";
import { LIBRARY_HOME } from "@/lib/tour";

/**
 * The join screen's form: the shared name and credential editor (the same one
 * People and the Send panel use), with "Join the library" as its
 * button, and "Not you? Sign out" under it. It opens on the name from their
 * account with no credential, which is what patients would see if they
 * skipped it. Once the server has saved, the library opens, where the menu
 * shows "Take the tour" until the tour is started.
 */
export function JoinForm({ defaultName }: { defaultName: string | null }) {
  const router = useRouter();
  return (
    <div className="mt-6">
      <SenderNameForm
        idPrefix="join"
        current={defaultName}
        heading="Your name, as patients will see it on the links you send."
        saveLabel="Join the library"
        // Evan, 2026-11-20: no helper sentences under the boxes here; "Patients will see" stays as the live result.
        plain
        onSave={(choice) => setMyPatientNameAction(choice)}
        // The library home. Its menu shows "Take the tour" until the tour is started in this browser (components/tour/TourNotice.tsx).
        onSaved={() => router.push(LIBRARY_HOME)}
      />
      <p className="mt-6 text-[15px] text-ink-soft">
        Not you?{" "}
        <SignOutButton redirectUrl="/sign-in">
          <button type="button" className="font-semibold text-brand underline-offset-2 hover:underline">
            Sign out
          </button>
        </SignOutButton>
      </p>
    </div>
  );
}
