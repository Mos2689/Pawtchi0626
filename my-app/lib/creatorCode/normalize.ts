/**
 * Creator code normalisation.
 *
 * Mirrors public.normalize_creator_code() in
 * supabase/migrations/20260906000000_creator_codes.sql. Postgres is
 * authoritative — its version is what a lookup actually matches on — so a
 * disagreement between the two can only ever produce a miss, never a wrong hit.
 * This copy exists so the field can show the canonical form as the user types,
 * and so the client can reject obvious nonsense without a round trip.
 *
 * People will type a code they HEARD, not one they copied: "sarah k",
 * "SARAH-K", "sarahk.". Stripping everything that is not alphanumeric and
 * upper-casing turns all of those into one code, which is the difference
 * between a redemption and a support ticket.
 */

/** Same bounds as the CHECK constraint on creator_codes.code. */
export const CREATOR_CODE_MIN_LENGTH = 3;
export const CREATOR_CODE_MAX_LENGTH = 24;

/** Uppercase alphanumerics only. Safe to call on anything, including null. */
export function normalizeCreatorCode(input?: string | null): string {
  return (input ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

/**
 * Whether a normalised code is worth sending to the server.
 *
 * Deliberately only a length check. Guessing at any further shape here would
 * mean the client could refuse a code the database would have accepted — and
 * the person holding it has no way to know which of us is wrong.
 */
export function isPlausibleCreatorCode(input?: string | null): boolean {
  const code = normalizeCreatorCode(input);
  return code.length >= CREATOR_CODE_MIN_LENGTH && code.length <= CREATOR_CODE_MAX_LENGTH;
}
