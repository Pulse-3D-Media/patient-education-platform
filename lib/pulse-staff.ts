/**
 * Is this Clerk metadata a Pulse staff mark? Only the exact boolean true
 * counts (see lib/pulse.ts for how a person becomes Pulse staff).
 *
 * In a file of its own, with no imports, so the demo clean-up script
 * (prisma/clear-demo-clinics.ts, through lib/people.ts) can ask it without
 * loading Next.js's page machinery, which lib/pulse.ts needs and a script
 * cannot load. lib/pulse.ts passes it on, so every other caller is unchanged.
 */
export function pulseStaffFromMetadata(metadata: Record<string, unknown> | null | undefined): boolean {
  return metadata?.pulseStaff === true;
}
