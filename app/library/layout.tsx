import { AppShell } from "@/components/ui/AppShell";
import { StaffClerkProvider } from "@/components/ui/StaffClerkProvider";
import { isClinicAdmin } from "@/lib/roles";

/**
 * Every library page sits inside the shared shell: thin top banner, icon
 * rail, and the category drawer that opens from the books icon. The page
 * itself is server-rendered and passed through as children.
 *
 * Clerk's provider goes around the shell so the user button in the banner
 * works. Signing in itself is checked in proxy.ts and in each page, not
 * here: a layout does not re-run on every navigation, so it is not a safe
 * place for that check.
 *
 * The one thing the layout does read from the session is whether this
 * person is a clinic admin, so the shell can show or hide the admin icon.
 * Hiding it is a courtesy, not the check: /admin checks for itself.
 */
export default async function LibraryLayout({ children }: LayoutProps<"/library">) {
  const showAdmin = await isClinicAdmin();
  return (
    <StaffClerkProvider>
      <AppShell showAdmin={showAdmin}>{children}</AppShell>
    </StaffClerkProvider>
  );
}
