import { requirePulseStaff } from "@/lib/pulse";
import { ComingSoon } from "../ui";

/** Placeholder for the Pricing section. Staff only, like every page here. */
export const dynamic = "force-dynamic";

export default async function PulsePricingPage() {
  await requirePulseStaff();
  return (
    <ComingSoon
      title="Pricing"
      blurb="Each category's monthly price per surgeon seat, the discounts for taking more categories, and which categories are for sale. Prices will be settings edited here, never numbers in the code."
    />
  );
}
