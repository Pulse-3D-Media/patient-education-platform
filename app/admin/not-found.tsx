import { StaffNotFound } from "@/components/ui/StaffNotFound";

/** A link code the admin's own clinic does not have (the pamphlet, the QR code, the reactivate page). One sentence, a way back. */
export default function AdminNotFound() {
  return <StaffNotFound backHref="/admin" backLabel="Back to the overview" />;
}
