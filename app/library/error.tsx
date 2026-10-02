"use client";

import { StaffError } from "@/components/ui/StaffError";

/**
 * What a surgeon sees if a library page could not be drawn. It sits inside
 * the library's shell (the layout keeps its shell even when the clinic
 * could not be read, see getClinicForShell in lib/clinic.ts), so the banner
 * and the menus are still there, with the calm message and Try again in
 * the content area. The words come from StaffError; the way back is Home.
 */
export default function LibraryError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <StaffError error={error} retry={retry} backHref="/library" backLabel="Back to the library" />;
}
