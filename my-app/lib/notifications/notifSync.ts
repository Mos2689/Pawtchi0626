/**
 * What this phone last told the server about notifications, so an unchanged
 * value is not re-sent on every launch.
 *
 * ── Why ─────────────────────────────────────────────────────────────────────
 *
 * Every launch registered the push token again (`register_push_token`), every
 * mounted copy of useNotificationPermission recorded the OS permission again
 * (`record_notification_permission`), and every foreground re-read
 * `owner_preferences.push_enabled`. All of it lands in the launch burst, on a
 * server where requests were queueing for seconds (perf baseline 2026-10-01).
 * None of those values usually changes between launches.
 *
 * ── The safety rules ────────────────────────────────────────────────────────
 *
 * - A value is remembered only AFTER the server accepted it. A failed send is
 *   simply tried again next time.
 * - Anything older than RESYNC_AFTER_MS is sent again anyway, so a server-side
 *   change this phone cannot see heals within a week.
 * - Entries are per user, and the whole ledger is wiped on sign-out. That is
 *   load-bearing: the server re-binds a device's token to whoever registers it,
 *   so if user A signs out, B signs in, then A returns, A MUST register again.
 *   A remembered "already sent" there would silently route A's pushes to B.
 * - Skipping is behind the `pushChangeDetection` perf flag at the call sites;
 *   with the flag off every caller sends exactly as build 98 did. Successes are
 *   recorded either way, so turning the flag on starts from a primed ledger.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export type SyncKind = 'push_token' | 'notification_permission';

export interface LedgerEntry {
  value: string;
  at: number;
}

/** A value is re-sent at least this often, changed or not. */
export const RESYNC_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** How long a read of `push_enabled` is reused before asking the server again. */
export const PUSH_ENABLED_TTL_MS = 10 * 60 * 1000;

const KEY = 'notif-sync-ledger:v1';

/** Pure: whether `value` must be sent, given what was last sent. */
export function needsSync(last: LedgerEntry | null, value: string, now: number): boolean {
  if (!last) return true;
  if (last.value !== value) return true;
  // A clock that went backwards proves nothing about freshness — send.
  if (now < last.at) return true;
  return now - last.at >= RESYNC_AFTER_MS;
}

let memory: Record<string, LedgerEntry> | null = null;
let loading: Promise<Record<string, LedgerEntry>> | null = null;
/** Bumped on clear, so a write begun before sign-out cannot land after it. */
let generation = 0;

function sanitize(raw: unknown): Record<string, LedgerEntry> {
  const out: Record<string, LedgerEntry> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
    const e = entry as Partial<LedgerEntry> | null;
    if (e && typeof e.value === 'string' && typeof e.at === 'number' && Number.isFinite(e.at)) {
      out[key] = { value: e.value, at: e.at };
    }
  }
  return out;
}

function load(): Promise<Record<string, LedgerEntry>> {
  if (memory) return Promise.resolve(memory);
  if (!loading) {
    const started = generation;
    loading = AsyncStorage.getItem(KEY)
      .then(raw => {
        let parsed: unknown = null;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch {
          parsed = null;
        }
        const next = sanitize(parsed);
        if (started === generation) memory = next;
        return memory ?? {};
      })
      .catch(() => {
        if (started === generation) memory = {};
        return memory ?? {};
      })
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

const entryKey = (kind: SyncKind, userId: string) => `${kind}:${userId}`;

/** Whether `value` should be sent now for this user. Errors answer yes. */
export async function shouldSync(
  kind: SyncKind,
  userId: string,
  value: string,
  now: number = Date.now(),
): Promise<boolean> {
  try {
    const all = await load();
    return needsSync(all[entryKey(kind, userId)] ?? null, value, now);
  } catch {
    return true;
  }
}

/** Remember a value the server ACCEPTED. Never call this before success. */
export async function markSynced(
  kind: SyncKind,
  userId: string,
  value: string,
  now: number = Date.now(),
): Promise<void> {
  const started = generation;
  const all = await load();
  if (started !== generation) return;
  memory = { ...all, [entryKey(kind, userId)]: { value, at: now } };
  await AsyncStorage.setItem(KEY, JSON.stringify(memory)).catch(() => {});
}

// ── push_enabled, reused for a few minutes ───────────────────────────────────

let pushEnabled: { ownerId: string; value: boolean; at: number } | null = null;

/** The remembered in-app switch, if it is this owner's and still fresh. */
export function readPushEnabled(ownerId: string, now: number = Date.now()): boolean | undefined {
  if (!pushEnabled || pushEnabled.ownerId !== ownerId) return undefined;
  if (now < pushEnabled.at || now - pushEnabled.at > PUSH_ENABLED_TTL_MS) return undefined;
  return pushEnabled.value;
}

/** Record the switch: after a read, and after the settings screen saves it. */
export function rememberPushEnabled(ownerId: string, value: boolean, now: number = Date.now()): void {
  pushEnabled = { ownerId, value, at: now };
}

/** Sign-out: forget everything this phone remembered about notifications. */
export function clearNotifSync(): void {
  generation += 1;
  memory = {};
  loading = null;
  pushEnabled = null;
  void AsyncStorage.removeItem(KEY).catch(() => {});
}

/** Tests only: as if the process had just started, disk left as it is. */
export function resetNotifSyncForTests(): void {
  generation += 1;
  memory = null;
  loading = null;
  pushEnabled = null;
}
