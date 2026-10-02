import type { NextConfig } from "next";
import { securityHeaders } from "./lib/security-headers";

const nextConfig: NextConfig = {
  // Next.js would otherwise append its own notes to AGENTS.md every time the
  // dev server starts. That file is a deliberate one-line pointer to CLAUDE.md,
  // so keep it that way.
  agentRules: false,

  // The security headers, on every response. What each one does, and why the
  // full content policy only reports for now, is in lib/security-headers.ts.
  // Worked out when the deployment is built, from settings that are fixed for
  // that deployment.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({
          clerkPublishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
          vercelEnv: process.env.VERCEL_ENV,
          dev: process.env.NODE_ENV === "development",
        }),
      },
    ];
  },
};

export default nextConfig;
