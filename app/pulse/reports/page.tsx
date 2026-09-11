import { requirePulseStaff } from "@/lib/pulse";
import { ComingSoon } from "../ui";

/** Placeholder for the Reports section. Staff only, like every page here. */
export const dynamic = "force-dynamic";

export default async function PulseReportsPage() {
  await requirePulseStaff();
  return (
    <ComingSoon
      title="Reports"
      blurb="Links made and watched per clinic and per procedure, QR codes scanned more than the daily flag, and which categories get used. Totals only, never anything about a patient."
    />
  );
}
