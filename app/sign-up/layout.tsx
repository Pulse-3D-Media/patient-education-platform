import { StaffClerkProvider } from "@/components/ui/StaffClerkProvider";

/** The sign-up page needs Clerk's provider for the <SignUp /> component. */
export default function SignUpLayout({ children }: LayoutProps<"/sign-up">) {
  return <StaffClerkProvider>{children}</StaffClerkProvider>;
}
