/**
 * Who is signed in, without asking the server.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * `supabase.auth.getUser()` is not a local read. It is a `GET /auth/v1/user`
 * over the network, taken under the auth lock, every single time it is called.
 * The rest of this app already knows that and uses `getSession()` — which reads
 * the token from storage — but the community data layer had twelve `getUser()`
 * calls, one at the head of nearly every query it makes.
 *
 * Two costs, and the second is the one that hurt:
 *
 *   A round trip before the first real query. Opening a Trail could not begin
 *   until the auth server had answered a question whose answer was already on
 *   the device.
 *
 *   Serialisation. This client uses `processLock` (see the Android login-hang
 *   fix), so concurrent auth calls queue. Two functions doing `getUser()` inside
 *   one `Promise.all` are not parallel at all — they are two sequential network
 *   round trips wearing a `Promise.all` costume.
 *
 * The id is memoised because it cannot change without a sign-out, and a
 * sign-out calls `resetSessionUser()` from `clearAllUserState()`.
 *
 * A null answer is deliberately NOT memoised. Caching "nobody is signed in"
 * would survive the sign-in that follows it, and every caller here treats null
 * as "do nothing" — so the one wrong answer this could give is the one that
 * silently does nothing forever. Re-reading is a storage hit, not a request.
 */

import { supabase } from './supabase';

let knownId: string | null = null;

export async function currentUserId(): Promise<string | null> {
  if (knownId) return knownId;
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user?.id ?? null;
  if (id) knownId = id;
  return id;
}

/** Called from `clearAllUserState()` so the next account never inherits this. */
export function resetSessionUser(): void {
  knownId = null;
}
