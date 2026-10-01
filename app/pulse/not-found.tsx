import { StaffNotFound } from "@/components/ui/StaffNotFound";

/**
 * A clinic or video id the dashboard does not have, for Pulse staff. Someone
 * who is not staff never reaches this: the layout's not-found lands on the
 * root page, with no dashboard around it.
 */
export default function PulseNotFound() {
  return <StaffNotFound backHref="/pulse" backLabel="Back to clinics" />;
}
