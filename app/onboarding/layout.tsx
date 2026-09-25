import { StaffClerkProvider } from "@/components/ui/StaffClerkProvider";

/**
 * The onboarding page (set up or pick your clinic) uses Clerk's
 * organization components, so it needs the provider.
 * No AppShell here: there is no library to show yet.
 */
export default function OnboardingLayout({ children }: LayoutProps<"/onboarding">) {
  return <StaffClerkProvider>{children}</StaffClerkProvider>;
}
