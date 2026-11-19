import { StaffClerkProvider } from "@/components/ui/StaffClerkProvider";
import { STAFF_TEXT_FAMILY, STAFF_TYPE_CLASS } from "@/app/staff-fonts";

/**
 * The onboarding page (set up or pick your clinic) uses Clerk's
 * organization components, so it needs the provider.
 * No AppShell here: there is no library to show yet.
 */
export default function OnboardingLayout({ children }: LayoutProps<"/onboarding">) {
  // Light, like every staff screen by default, in the staff screens' fonts (app/staff-fonts.ts).
  return (
    <StaffClerkProvider theme="light" fontFamily={STAFF_TEXT_FAMILY}>
      <div data-theme="light" className={`${STAFF_TYPE_CLASS} staff-headings contents`}>
        {children}
      </div>
    </StaffClerkProvider>
  );
}
