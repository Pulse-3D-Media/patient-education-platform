import { LandingProviders } from "@/components/landing/LandingFrame";

/** The sign-in page is the landing page with its Sign in tab open: Clerk's provider and the staff fonts (components/landing/LandingFrame.tsx). */
export default function SignInLayout({ children }: LayoutProps<"/sign-in">) {
  return <LandingProviders>{children}</LandingProviders>;
}
