/**
 * The expiry choices in the admin dropdown, in days.
 *
 * This is its own small file because both the dropdown (browser) and the
 * Server Action that checks the submitted value (server) import it. Keeping
 * one list means they can never disagree.
 */
export const EXPIRY_DAYS = [3, 7, 14, 30] as const;

export const DEFAULT_EXPIRY_DAYS = 7;
