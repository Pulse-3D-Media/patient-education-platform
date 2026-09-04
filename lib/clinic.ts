/**
 * Which clinic is using the app right now.
 *
 * Phase 1: there is exactly one clinic, our own test clinic. Its id lives in
 * the CLINIC_ID environment variable (printed by: npm run db:seed).
 *
 * Phase 2: this will read the signed-in user's clinic from Clerk instead.
 * Only this function changes. Every lib/db function already takes the
 * clinicId it returns, so nothing else has to.
 *
 * Returns null when CLINIC_ID is missing so the caller can show a plain
 * "set this up" message instead of crashing.
 */
export function getCurrentClinicId(): string | null {
  const id = process.env.CLINIC_ID?.trim();
  return id ? id : null;
}
