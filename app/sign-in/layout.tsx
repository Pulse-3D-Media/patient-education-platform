import { StaffClerkProvider } from "@/components/ui/StaffClerkProvider";
import { STAFF_TEXT_FAMILY, STAFF_TYPE_CLASS } from "@/app/staff-fonts";

/** The sign-in page needs Clerk's provider for the <SignIn /> component. */
export default function SignInLayout({ children }: LayoutProps<"/sign-in">) {
  // Light, like every staff screen by default, in the staff screens' fonts (app/staff-fonts.ts).
  return (
    <StaffClerkProvider theme="light" fontFamily={STAFF_TEXT_FAMILY}>
      <div data-theme="light" className={`${STAFF_TYPE_CLASS} staff-headings contents`}>
        {children}
      </div>
    </StaffClerkProvider>
  );
}
