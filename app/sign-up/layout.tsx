import { StaffClerkProvider } from "@/components/ui/StaffClerkProvider";
import { STAFF_TEXT_FAMILY, STAFF_TYPE_CLASS } from "@/app/staff-fonts";

/** The sign-up page needs Clerk's provider for the <SignUp /> component. */
export default function SignUpLayout({ children }: LayoutProps<"/sign-up">) {
  // Light, like every staff screen by default, in the staff screens' fonts (app/staff-fonts.ts).
  return (
    <StaffClerkProvider theme="light" fontFamily={STAFF_TEXT_FAMILY}>
      <div data-theme="light" className={`${STAFF_TYPE_CLASS} staff-headings contents`}>
        {children}
      </div>
    </StaffClerkProvider>
  );
}
