"use client";

import { useState } from "react";

/**
 * A button that copies the given text to the clipboard and says "Copied" for
 * a moment. Client component because the clipboard only exists in the browser.
 */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The browser refused (for example, the page is not on https). The text
      // is on screen next to the button, so it can still be selected by hand.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-live="polite"
      className={`h-10 shrink-0 rounded-lg px-4 text-sm font-medium transition ${
        copied
          ? "bg-[#2a829b]/20 text-[#5fb8d4]"
          : "border border-white/15 text-[#bfbfbf] hover:border-[#2a829b] hover:text-white"
      }`}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
