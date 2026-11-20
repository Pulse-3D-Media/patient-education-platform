"use client";

import { SignOutButton } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { setMyPatientNameAction } from "@/app/library/[category]/actions";
import { SenderNameForm } from "@/components/ui/SenderNameForm";

/**
 * The join screen's form: the shared name and credential editor (the same one
 * People and the Send panel use), with "Join and open the library" as its
 * button, and "Not you? Sign out" under it. It opens on the name from their
 * account with no credential, which is what patients would see if they
 * skipped it. Once the server has saved, the library opens.
 */
export function JoinForm({ defaultName }: { defaultName: string | null }) {
  const router = useRouter();
  return (
    <div className="mt-6">
      <SenderNameForm
        idPrefix="join"
        current={defaultName}
        heading="Your name, as patients will see it on the links you send."
        saveLabel="Join and open the library"
        onSave={(choice) => setMyPatientNameAction(choice)}
        onSaved={() => router.push("/library")}
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
