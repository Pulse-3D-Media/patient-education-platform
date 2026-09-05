"use client";

/** Opens the browser's print dialog. Client component because printing happens in the browser. */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="h-10 rounded-lg bg-[#2a829b] px-5 text-sm font-medium text-white transition hover:bg-[#1e5668]"
    >
      Print
    </button>
  );
}
