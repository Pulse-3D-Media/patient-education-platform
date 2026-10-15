import { StaffNotFound } from "@/components/ui/StaffNotFound";

/** A link the admin's own clinic does not have (the pamphlet and the QR code by its code, the reactivate page by its id). One sentence, a way back. */
export default function AdminNotFound() {
  return <StaffNotFound backHref="/admin" backLabel="Back to the overview" />;
}
