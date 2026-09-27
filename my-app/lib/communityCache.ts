/**
 * The Trails cold-start cache.
 *
 * Same trade as lib/activity/todayCache.ts: a screen whose content cannot be
 * drawn until several round trips land is a screen that opens empty. The last
 * answer is painted first and corrected behind.
 *
 * ── Why a Trail can be shown stale, briefly ─────────────────────────────────
 *
 * Because the alternative is worse, and because the staleness is bounded by a
 * refresh that is already in flight when the cached frame appears. Going back
 * from Invite to the trail you just left, to be shown a blank page while the
 * app re-derives what it displayed four seconds ago, reads as a bug in a way
 * that a four-second-old member count never does.
 *
 * ── Three deliberate limits ─────────────────────────────────────────────────
 *
 *   In memory only. Unlike the Activity cache this is not persisted: a Trail's
 *   whole point is the next date, and a plan restored from disk after a week in
 *   the background would be presented as current. A process restart should show
 *   a real answer or nothing.
 *
 *   Aged out. Past MAX_AGE_MS an entry is refused rather than painted. This is
 *   not about correctness — the refresh corrects it either way — but about how
 *   long a wrong frame may sit there if the network is slow to say otherwise.
 *
 *   Replaced wholesale, never merged. A half-cached screen would be a third
 *   state to reason about. The network is the authority the moment it answers.
 *
 * Cleared on sign-out through `clearAllUserState()`, with the rest of the
 * previous account's memory. A pack list belonging to someone else is exactly
 * the kind of leak that function exists to close.
 */

const MAX_AGE_MS = 5 * 60_000;

interface Entry {
  /** When this value was put here — what `readSnapshot` ages against. */
  at: number;
  /**
   * When the SERVER last answered for this key, or 0 for a value we made up.
   *
   * ── Why this is not just `at` ──────────────────────────────────────────
   *
   * `rememberNewPack` writes an optimistic entry so a host who just created a
   * trail sees it on the list immediately, and its whole contract is that the
   * refetch replaces it wholesale a moment later. Ageing the freshness window
   * off `at` would let that optimistic write suppress the very refetch it
   * depends on — the host would keep their invented row, with no dogs and a
   * member count of one, until the window expired.
   *
   * So: paintable is one question, and settled-with-the-server is another.
   */
  fetchedAt: number;
  value: unknown;
}

const entries = new Map<string, Entry>();

/** Cache keys. Functions rather than strings so a typo cannot silently miss. */
export const cacheKey = {
  packs: () => 'packs',
  pack: (packId: string) => `pack:${packId}`,
  outing: (walkId: string) => `outing:${walkId}`,
};

/**
 * The last known answer for a key, or null if there isn't a usable one.
 *
 * Exported separately from the age check so screens can call this during render
 * — it must stay synchronous and allocation-free, because it runs in a
 * `useState` initialiser on the first frame of every community screen.
 */
export function readSnapshot<T>(key: string, now: number = Date.now()): T | null {
  const entry = entries.get(key);
  if (!entry) return null;
  if (now - entry.at > MAX_AGE_MS) {
    entries.delete(key);
    return null;
  }
  return entry.value as T;
}

/**
 * Who may write, and in what order.
 *
 * ── The race this closes ───────────────────────────────────────────────────
 *
 * A read wrapped in `withTimeout` is abandoned by its CALLER, not stopped: the
 * request keeps going, and used to write its answer whenever it finally landed.
 * So a timed-out request could land after a newer one and put the older answer
 * back, and — worse — a request started under one account could land after
 * sign-out had cleared the cache and repopulate it for the next account.
 * Reproduced in isolation by an external audit (2026-09-26).
 *
 * A read takes a ticket BEFORE it asks, and commits through it. The commit is
 * refused if the cache has been cleared since (the epoch moved) or a newer
 * ticket for the same key has already written. Plain `writeSnapshot` counts as
 * the newest ticket, so a direct write always wins over anything in flight.
 */
let epoch = 0;
let sequence = 0;
const lastWrite = new Map<string, number>();

export interface WriteTicket {
  key: string;
  epoch: number;
  seq: number;
}

/** Take a ticket before the request goes out. */
export function beginWrite(key: string): WriteTicket {
  sequence += 1;
  return { key, epoch, seq: sequence };
}

/**
 * Commit a server answer through its ticket. Returns whether it was written;
 * callers still return the value to whoever asked — only the CACHE refuses it.
 */
export function commitSnapshot<T>(ticket: WriteTicket, value: T, now: number = Date.now()): boolean {
  if (ticket.epoch !== epoch) return false;
  if ((lastWrite.get(ticket.key) ?? 0) > ticket.seq) return false;
  lastWrite.set(ticket.key, ticket.seq);
  entries.set(ticket.key, { at: now, fetchedAt: now, value });
  return true;
}

/** A real answer from the server. Paintable AND fresh. */
export function writeSnapshot<T>(key: string, value: T, now: number = Date.now()): void {
  sequence += 1;
  lastWrite.set(key, sequence);
  entries.set(key, { at: now, fetchedAt: now, value });
}

/**
 * A value we constructed ourselves, to be shown until the server corrects it.
 *
 * Paintable, deliberately NOT fresh: `isFresh` stays false, so the refetch
 * this is standing in for still happens. Writing one of these must never be
 * the reason the truth does not arrive.
 */
export function writeOptimistic<T>(key: string, value: T, now: number = Date.now()): void {
  entries.set(key, { at: now, fetchedAt: 0, value });
}

/**
 * Say that a key is out of date, without blanking what it is showing.
 *
 * ── The gap this closes ────────────────────────────────────────────────────
 *
 * Screens skip their refetch inside the freshness window, which is only safe
 * while nothing has CHANGED in it. Inviting somebody and pressing back takes
 * about four seconds: the write lands, the trail screen regains focus, sees a
 * snapshot fetched moments ago, and skips — so the person just invited is
 * missing from the roster until the window runs out.
 *
 * Every mutation that another screen displays has to say so. That is this.
 *
 * The entry is kept and only its freshness is cleared — exactly the state
 * `writeOptimistic` creates. Deleting it instead would empty the screen on the
 * way back and then fill it again, which is the blank frame the snapshot cache
 * exists to prevent.
 */
export function invalidate(key: string): void {
  const entry = entries.get(key);
  if (entry) entry.fetchedAt = 0;
}

/**
 * How recently a key must have been fetched for a refetch to be skipped.
 *
 * Distinct from MAX_AGE_MS above, and the two answer different questions.
 * MAX_AGE is "may this be PAINTED" — five minutes, because a slightly old
 * member count is better than a blank screen. This is "must this be FETCHED
 * again" — twenty seconds, because within twenty seconds of asking the server,
 * asking it again cannot tell you anything you do not already have.
 *
 * Twenty seconds is chosen against the gesture it exists for: toggling the
 * Home chips, or opening a trail and coming straight back. Both happen in
 * two or three seconds, and both used to re-fire every request on the screen.
 */
const FRESH_MS = 20_000;

/**
 * The longest a Together read may take before the app stops waiting for it.
 *
 * ── Why every Together read needs one ──────────────────────────────────────
 *
 * `lib/supabase.ts` sets no fetch timeout, and React Native's fetch has none of
 * its own. A request on a connection that died mid-flight — a network change is
 * enough — can stay pending indefinitely without ever rejecting.
 *
 * Combined with `share()` below that is a session-long hang, not a slow load:
 * `share()` holds its in-flight entry until the promise settles, so every later
 * Together focus is handed the same dead promise. The list keeps painting from
 * its snapshot, so nothing looks broken — it simply never updates again until
 * the app is killed.
 *
 * Twelve seconds matches `hooks/useRecentWalks.ts`, which hit the same problem
 * first. Generous rather than snappy: this is Goa to Tokyo over mobile data, and
 * abandoning a request that was about to land would cost the refresh.
 *
 * The timeout must wrap the runner INSIDE `share()`, so that the promise
 * `share()` stores is the one that settles.
 */
export const TOGETHER_READ_TIMEOUT_MS = 12_000;

/**
 * True when the SERVER answered recently enough that asking again is waste.
 *
 * Reads `fetchedAt`, not `at`: a value we invented is worth painting and is
 * never worth trusting instead of the network.
 */
export function isFresh(key: string, now: number = Date.now()): boolean {
  const entry = entries.get(key);
  return !!entry && entry.fetchedAt > 0 && now - entry.fetchedAt <= FRESH_MS;
}

/**
 * In-flight requests, so the same question is never asked twice at once.
 *
 * ── The race this closes ───────────────────────────────────────────────────
 *
 * `useFocusEffect` on Home re-runs whenever the segment changes, and a focus
 * event can land while a previous load is still in the air. Both would call
 * `listPacks`, both would hit the network, and both would write a snapshot —
 * with no guarantee about which landed last. Two answers to one question,
 * resolved by whichever network was slower.
 *
 * Sharing the promise makes the second caller wait for the first rather than
 * start a second. The entry is removed on settle, success or failure, so a
 * failed load never wedges the key.
 */
const inFlight = new Map<string, Promise<unknown>>();

export function share<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = run().finally(() => {
    // Only if it is still ours: a later call that replaced this entry must not
    // have its own promise deleted by an earlier one settling late.
    if (inFlight.get(key) === promise) inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

/** Whether a fetch for this key is already on its way. */
export function isInFlight(key: string): boolean {
  return inFlight.has(key);
}

export function clearCommunityCache(): void {
  entries.clear();
  // Every ticket issued before this line is now void — see `commitSnapshot`.
  epoch += 1;
  lastWrite.clear();
  // Deliberately NOT cancelling what is in the air — nothing here can. What
  // this prevents is a request started under the previous account resolving
  // into a cache the next account will read.
  inFlight.clear();
}

/** Only for tests that need to assert ageing without waiting five minutes. */
export const MAX_SNAPSHOT_AGE_MS = MAX_AGE_MS;
/** Same, for the refetch window. */
export const FRESH_SNAPSHOT_MS = FRESH_MS;
