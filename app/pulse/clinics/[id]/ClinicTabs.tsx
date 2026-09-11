"use client";

import { useSyncExternalStore, type ReactNode } from "react";

/**
 * The pill row at the top of a clinic's page, and the one section it shows.
 *
 * Which pill is pressed lives in the address bar as a hash (#plan, #notes),
 * so a refresh or a shared link lands on the same section, and the browser
 * back button steps through them. The sections that are not showing are
 * hidden, not removed, so a half-typed form survives switching away and
 * back.
 *
 * A client component because the pressed pill is state. The sections
 * themselves arrive from the server as children, already rendered.
 */

export type Panel = { id: string; label: string; content: ReactNode };

/** Read the hash from the address bar, without the "#". */
function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}
function readHash() {
  return window.location.hash.replace(/^#/, "");
}
/** On the server there is no address bar; the first pill wins until the browser takes over. */
function readServerHash() {
  return "";
}

export function ClinicTabs({ panels }: { panels: Panel[] }) {
  const hash = useSyncExternalStore(subscribe, readHash, readServerHash);
  const active = panels.some((panel) => panel.id === hash) ? hash : panels[0].id;

  function show(id: string) {
    // Put the new hash in the address bar (a history entry, so the back
    // button steps through sections) and tell the store. pushState does not
    // fire "hashchange" on its own, so the event is sent by hand. No element
    // carries the bare id, so the page does not jump.
    window.history.pushState(null, "", `#${id}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }

  return (
    <div>
      <div role="tablist" aria-label="Clinic sections" className="flex flex-wrap gap-2">
        {panels.map((panel) => {
          const pressed = panel.id === active;
          return (
            <button
              key={panel.id}
              type="button"
              role="tab"
              id={`tab-${panel.id}`}
              aria-selected={pressed}
              aria-controls={`panel-${panel.id}`}
              onClick={() => show(panel.id)}
              className={`h-12 rounded-full border px-5 text-[15px] font-medium transition ${
                pressed
                  ? "border-[#2a829b] bg-[#2a829b]/20 text-white"
                  : "border-white/15 text-[#bfbfbf] hover:border-[#2a829b] hover:text-white"
              }`}
            >
              {panel.label}
            </button>
          );
        })}
      </div>

      {panels.map((panel) => (
        <div
          key={panel.id}
          role="tabpanel"
          id={`panel-${panel.id}`}
          aria-labelledby={`tab-${panel.id}`}
          hidden={panel.id !== active}
          className="mt-6 flex flex-col gap-6"
        >
          {panel.content}
        </div>
      ))}
    </div>
  );
}
