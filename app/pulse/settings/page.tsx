import { getSettings } from "@/lib/db/settings";
import { requirePulseStaff } from "@/lib/pulse";
import { SettingsForm } from "./SettingsForm";

/**
 * The platform settings: the four numbers in the AppSettings row, each with
 * its default beside it and a sentence saying what it does. Saving writes
 * the row (creating it the first time). Until then the app runs on the
 * defaults, which getSettings() returns when the row is missing.
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
            The numbers the whole platform runs on. A clinic can be given its own view-days number on its page; everything
            else applies to everyone.
          </p>
        </header>
        <div className="mt-8">
          <SettingsForm settings={settings} />
        </div>
      </div>
    </main>
  );
}
