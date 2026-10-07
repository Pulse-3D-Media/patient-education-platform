import { AdminsOnly } from "@/components/ui/AdminsOnly";
import { ClinicShell } from "@/components/ui/ClinicShell";
import { requireClinicPage } from "@/lib/clinic";
import { AdminFrame } from "../AdminFrame";

/**
 * Reports, at /admin/reports: a placeholder, so the section link in the
 * navigation never leads nowhere. Admins only, like every admin page. Shows
 * nothing about the clinic. Reports exist for Pulse staff (/pulse/reports);
 * clinics do not see them yet (decided by Evan on 2026-10-07, while it is
 * still being tested whether clinics want them), so this page promises no
 * particular number.
 */
export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const clinic = await requireClinicPage();

  if (!clinic.isAdmin) {
    return (
      <ClinicShell clinic={clinic}>
        <AdminsOnly />
      </ClinicShell>
    );
  }

  return (
    <AdminFrame clinic={clinic} title="Reports" intro="Coming later.">
      <p className="mt-6 max-w-xl text-ink-soft">
        Reports on how your clinic uses its links are coming later. They will show totals only, never anything about a patient.
      </p>
    </AdminFrame>
  );
}
