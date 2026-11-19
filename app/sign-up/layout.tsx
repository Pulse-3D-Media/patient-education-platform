import { LandingProviders } from "@/components/landing/LandingFrame";

/** The sign-up page is the landing page with its "Set up a clinic" tab open: Clerk's provider and the staff fonts (components/landing/LandingFrame.tsx). */
export default function SignUpLayout({ children }: LayoutProps<"/sign-up">) {
  return <LandingProviders>{children}</LandingProviders>;
}
