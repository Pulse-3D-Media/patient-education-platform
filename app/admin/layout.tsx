import { StaffClerkProvider } from "@/components/ui/StaffClerkProvider";

/**
 * Every admin page (the console, the printable pamphlet) gets Clerk's
 * provider, so the user button and sign-out work there. The console draws
 * its own AppShell inside this, as before.
 */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return <StaffClerkProvider>{children}</StaffClerkProvider>;
}
