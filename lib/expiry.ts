/**
 * How long every share link works, in days.
 *
 * One number, in one place. Both places that create a link import it: the
 * admin console's "Create share link" button and the library's Send button.
 * Keeping one constant means the two can never drift apart.
 *
 * Changing it only affects links made from then on. Existing links keep the
 * expiry date they were created with.
 */
export const SHARE_EXPIRY_DAYS = 90;
