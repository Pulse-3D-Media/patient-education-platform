import { StaffClerkProvider } from "@/components/ui/StaffClerkProvider";

/** The sign-in page needs Clerk's provider for the <SignIn /> component. */
export default function SignInLayout({ children }: LayoutProps<"/sign-in">) {
  return <StaffClerkProvider>{children}</StaffClerkProvider>;
}
