import { StaffClerkProvider } from "@/components/ui/StaffClerkProvider";

/**
 * The onboarding pages (set up your clinic, then the surgeon-or-staff
 * question) use Clerk's organization components, so they need the provider.
 * No AppShell here: there is no library to show yet.
 */
export default function OnboardingLayout({ children }: LayoutProps<"/onboarding">) {
  return <StaffClerkProvider>{children}</StaffClerkProvider>;
}
