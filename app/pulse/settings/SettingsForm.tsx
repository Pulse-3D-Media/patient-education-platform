"use client";

import { INPUT, PRIMARY_BUTTON } from "@/components/ui/styles";
import { MAX_LINK_DAYS, MAX_RENEWALS, MIN_RENEWALS } from "@/lib/expiry";
import { SETTINGS_DEFAULTS, SETTINGS_HELP, SETTINGS_NOT_ACTIVE, type Settings } from "@/lib/settings-defaults";
import { saveSettingsAction } from "../actions";
import { useKeptForm } from "../FormBits";

/**
 * The settings form: one row per setting, with the field, its default and
 * a plain sentence about what it does. Saves all five at once through
 * saveSettingsAction and shows the answer under the button.
 *
 * A setting that nothing in the app reads yet carries an amber "Not active
 * yet" line (SETTINGS_NOT_ACTIVE), so a saved number is never taken for one
 * that is doing something.
 *
 * A refused or failed save leaves every number as typed (useKeptForm).
 *
 * This file runs in the browser, so it imports the shape, defaults and help
 * text from lib/settings-defaults.ts, never from lib/db.
 */

const FIELDS: { name: keyof Settings; label: string; unit: string; min?: number; max?: number }[] = [
  // The two link day counts stop at a year, and the renewal count runs from 0 to 10; the browser's min and max are a courtesy, the action checks them (rule 8).
  { name: "unclaimedDays", label: "Unclaimed link days", unit: "days", max: MAX_LINK_DAYS },
  { name: "viewDays", label: "Days after first play", unit: "days", max: MAX_LINK_DAYS },
  { name: "maxRenewals", label: "Maximum renewals", unit: "times", min: MIN_RENEWALS, max: MAX_RENEWALS },
  { name: "graceDays", label: "Grace days", unit: "days" },
  { name: "qrDailyFlag", label: "QR scans per day to flag", unit: "scans" },
];

export function SettingsForm({ settings }: { settings: Settings }) {
  const { state, pending, form } = useKeptForm(saveSettingsAction);

  return (
    <form {...form} className="flex flex-col gap-4">
      {FIELDS.map((field) => (
        <div key={field.name} className="rounded-2xl border border-white/10 bg-[#0d1113] p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-md">
              <label htmlFor={field.name} className="block text-[15px] font-medium">
                {field.label}
              </label>
              <p className="mt-1 text-sm text-[#bfbfbf]">{SETTINGS_HELP[field.name]}</p>
              {SETTINGS_NOT_ACTIVE[field.name] && <p className="mt-2 text-sm font-medium text-[#f3b94d]">{SETTINGS_NOT_ACTIVE[field.name]}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <input
                id={field.name}
                name={field.name}
                type="number"
                min={field.min ?? 1}
                max={field.max}
                step={1}
                required
                defaultValue={settings[field.name]}
                className={`${INPUT} w-28 text-right`}
              />
              <span className="w-32 text-sm text-[#667085]">
                {field.unit}. Default {SETTINGS_DEFAULTS[field.name]}.
              </span>
            </div>
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={`${PRIMARY_BUTTON} h-11`}>
          {pending ? "Saving..." : "Save settings"}
        </button>
        {state?.error && (
          <p role="alert" className="text-sm text-[#f3b94d]">
            {state.error}
          </p>
        )}
        {state?.ok && (
          <p role="status" className="text-sm text-[#5fb8d4]">
            {state.ok}
          </p>
        )}
      </div>
    </form>
  );
}
