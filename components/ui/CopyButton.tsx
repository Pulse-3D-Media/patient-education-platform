"use client";

import { useState } from "react";
import { SECONDARY_BUTTON, SECONDARY_BUTTON_DONE } from "./styles";

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
      className={copied ? SECONDARY_BUTTON_DONE : SECONDARY_BUTTON}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
