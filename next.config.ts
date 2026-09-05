import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js would otherwise append its own notes to AGENTS.md every time the
  // dev server starts. That file is a deliberate one-line pointer to CLAUDE.md,
  // so keep it that way.
  agentRules: false,
};

export default nextConfig;
