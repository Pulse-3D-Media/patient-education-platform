"use client";

import { StaffError } from "@/components/ui/StaffError";

/**
 * What Pulse staff see if a dashboard page could not be drawn. Inside the
 * dashboard's shell (the layout has already checked that they are staff),
 * with the calm message, Try again and a way back to the clinics list. A
 * failure in the layout's own staff check lands on app/error.tsx instead.
 */
export default function PulseError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <StaffError error={error} retry={retry} backHref="/pulse" backLabel="Back to clinics" />;
}
