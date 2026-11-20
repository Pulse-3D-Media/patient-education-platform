import type { NextConfig } from "next";
import { headerRules } from "./lib/security-headers";

const nextConfig: NextConfig = {
  // Next.js would otherwise append its own notes to AGENTS.md every time the
  // dev server starts. That file is a deliberate one-line pointer to CLAUDE.md,
  // so keep it that way.
  agentRules: false,

  // No "X-Powered-By: Next.js" header on our responses. It tells a stranger
  // what the site is built with and helps nobody who uses it.
  poweredByHeader: false,

  // The security headers, on every response, plus the two per-page additions
  // (Stripe's card form on the sign-up payment step, and "not in search
  // engines" on the patient's pages). What each one does is in
  // lib/security-headers.ts (headerRules). Worked out when the deployment is
  // built, from settings that are fixed for that deployment.
  async headers() {
    return headerRules({
      clerkPublishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      vercelEnv: process.env.VERCEL_ENV,
      dev: process.env.NODE_ENV === "development",
    });
  },
};

export default nextConfig;
