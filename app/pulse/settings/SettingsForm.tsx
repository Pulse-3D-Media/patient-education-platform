"use client";

import { useActionState } from "react";
import { INPUT, PRIMARY_BUTTON } from "@/components/ui/styles";
import { SETTINGS_DEFAULTS, SETTINGS_HELP, type Settings } from "@/lib/db/settings";
import { saveSettingsAction } from "../actions";

/**
 * The settings form: one row per setting, with the field, its default and
 * a plain sentence about what it does. Saves all four at once through
 * saveSettingsAction and shows the answer under the button.
 */

const FIELDS: { name: keyof Settings; label: string; unit: string }[] = [
  { name: "unclaimedDays", label: "Unclaimed link days", unit: "days" },
  { name: "viewDays", label: "Days after first view", unit: "days" },
  { name: "graceDays", label: "Grace days", unit: "days" },
  { name: "qrDailyFlag", label: "QR scans per day to flag", unit: "scans" },
];

export function SettingsForm({ settings }: { settings: Settings }) {
  const [state, action, pending] = useActionState(saveSettingsAction, null);

  return (
    <form action={action} className="flex flex-col gap-4">
      {FIELDS.map((field) => (
        <div key={field.name} className="rounded-2xl border border-white/10 bg-[#0d1113] p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-md">
              <label htmlFor={field.name} className="block text-[15px] font-medium">
                {field.label}
              </label>
              <p className="mt-1 text-sm text-[#bfbfbf]">{SETTINGS_HELP[field.name]}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <input
                id={field.name}
                name={field.name}
                type="number"
                min={1}
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
