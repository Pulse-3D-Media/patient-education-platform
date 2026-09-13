import { AdminsOnly } from "@/components/ui/AdminsOnly";
import { AppShell } from "@/components/ui/AppShell";
import { requireClinicPage } from "@/lib/clinic";
import { AdminFrame } from "../AdminFrame";

/**
 * Reports, at /admin/reports: a placeholder until clinic reporting is
 * built, so the section link in the navigation never leads nowhere.
 * Admins only, like every admin page. Shows nothing about the clinic.
 */
export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const clinic = await requireClinicPage();

  if (!clinic.isAdmin) {
    return (
      <AppShell>
        <AdminsOnly />
      </AppShell>
    );
  }

  return (
    <AdminFrame clinicName={clinic.name} title="Reports" intro="Coming later.">
      <p className="mt-6 max-w-xl text-[#bfbfbf]">
        How your links get used: links made and play starts per procedure, and which categories see the most use. Totals
        only, never anything about a patient. Until then, each link&rsquo;s play starts are on the Shared links page.
      </p>
    </AdminFrame>
  );
}
