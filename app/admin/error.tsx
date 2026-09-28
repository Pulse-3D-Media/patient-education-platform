"use client";

import { StaffError } from "@/components/ui/StaffError";

/**
 * What an office admin sees if an admin page could not be drawn. The admin
 * layout draws no shell of its own (each admin page draws one once it has
 * checked who is asking), so this fills the screen on its own, in the dark
 * tokens, with the calm message, Try again and a way back to the overview.
 */
export default function AdminError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <StaffError error={error} retry={retry} backHref="/admin" backLabel="Back to the overview" />;
}
