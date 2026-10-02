import { getSettings } from "@/lib/db/settings";
import { requirePulseStaff } from "@/lib/pulse";
import { SettingsForm } from "./SettingsForm";

/**
 * The platform settings: the five numbers in the AppSettings row, each with
 * its default beside it and a sentence saying what it does. Saving writes
 * the row (creating it the first time). Until then the app runs on the
 * defaults, which getSettings() returns when the row is missing.
 *
 * Not every number does something yet. One that nothing reads is marked
 * "not active yet" on its own row (SETTINGS_NOT_ACTIVE in
 * lib/settings-defaults.ts), and the sentence at the top says so.
 *
 * Staff only. Rendered fresh on every request.
 */
export const dynamic = "force-dynamic";

export default async function PulseSettingsPage() {
  await requirePulseStaff();
  const settings = await getSettings();

  return (
    <main className="px-5 py-6 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <header>
          <h1 className="text-2xl font-semibold sm:text-3xl">Settings</h1>
          <p className="mt-1 max-w-2xl text-[#bfbfbf]">
            The platform&rsquo;s numbers. A clinic can be given its own view-days number on its page; everything else applies
            to everyone. A number marked &ldquo;not active yet&rdquo; is saved but nothing reads it until its feature is built.
          </p>
        </header>
        <div className="mt-8">
          <SettingsForm settings={settings} />
        </div>
      </div>
    </main>
  );
}
