/**
 * When a failed Supabase request may be sent again — and when it must not.
 *
 * ── Why this exists (4 Oct 2026) ────────────────────────────────────────────
 *
 * During a live walk the server stopped answering twice: PostgREST spent a
 * minute and a half re-reading its schema (every request got a 503
 * `PGRST002`), then the database stalled for four minutes (`PGRST003`, pool
 * timeouts, statement timeouts). Every one of those failures went straight to
 * a screen as "Timed out" or "This walk could not open". Most of them would
 * have succeeded a second or two later.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 *
 * A request is sent again only when doing so cannot cause anything twice:
 *
 *   - `PGRST002` / `PGRST003` on a 503 mean PostgREST never ran the request
 *     (no schema to plan with, no connection to run it on). Safe for ANY
 *     method, writes included.
 *   - A network failure, a gateway error or a statement timeout may have
 *     happened after the server acted, so only requests that are harmless to
 *     repeat are retried: reads, and RPCs on the read-only list below.
 *   - Auth, edge functions and storage uploads are never retried here. Auth-js
 *     retries its own refresh; the others have their own semantics.
 *
 * Bounded three ways: at most MAX_RETRIES, inside RETRY_BUDGET_MS, and paused
 * app-wide by RetryGovernor when failures pile up — a struggling server must
 * never be hammered by the app that is waiting on it.
 */

export const MAX_RETRIES = 3;
/** From the first send. Keeps the screens' own 12 s limits meaningful. */
export const RETRY_BUDGET_MS = 6_000;
const BASE_DELAYS_MS = [400, 1_200, 3_000];

/**
 * RPCs that only read. POST is how PostgREST calls a function, not a sign that
 * it writes — but only names listed here are treated as reads. Anything not
 * listed is a write, which keeps a new RPC safe by default.
 *
 * Every name here was checked to be declared STABLE in production (a STABLE
 * function cannot modify the database) on 2026-10-04. `lookup_community_username`
 * is deliberately absent: it is VOLATILE. Add a name only after the same check:
 *
 *   select proname, provolatile from pg_proc where proname = '<name>';  -- 's'
 */
export const READ_ONLY_RPCS: ReadonlySet<string> = new Set([
  'community_outing',
  'community_pack_detail',
  'community_memory',
  'community_trails_for_me',
  'community_trail_routes',
  'community_claims_for_packs',
  'community_previous_invitees',
  'community_invitation_preview',
  'community_username_available',
  'list_pack_invitations',
  'get_my_community_invitations',
  'list_external_community_claims',
  'get_pet_dashboard',
  'get_pro_offer_state',
  'get_pro_offer_config',
  'get_my_creator_code',
  // Live Walk v2 read (20261004000000), STABLE, checked 2026-10-05.
  'live_walk_positions',
]);

/**
 * Writes that are safe to send again because a repeat cannot do anything
 * twice — the server recognises it:
 *   begin_live_session    the same start token returns the same generation;
 *   publish_live_location the same (gen, seq) is answered `stale`, unchanged.
 * Treated like reads by the retry layer. Add a name only with that guarantee.
 */
export const IDEMPOTENT_WRITE_RPCS: ReadonlySet<string> = new Set([
  'begin_live_session',
  'publish_live_location',
]);

export type RequestKind = 'excluded' | 'repeatable' | 'write';

export type FailedAttempt =
  | { kind: 'network' }
  | { kind: 'status'; status: number; code: string | null };

/** What sending this request again would mean. */
export function requestKind(url: string, method: string): RequestKind {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return 'excluded';
  }
  const verb = method.toUpperCase();
  if (path.startsWith('/storage/')) {
    // Minting signed URLs is a read. Uploads, moves and deletes are not
    // repeated here.
    return path.startsWith('/storage/v1/object/sign/') ? 'repeatable' : 'excluded';
  }
  if (!path.startsWith('/rest/v1/')) return 'excluded';
  if (verb === 'GET' || verb === 'HEAD') return 'repeatable';
  const rpc = /^\/rest\/v1\/rpc\/([a-z0-9_]+)$/i.exec(path)?.[1];
  if (verb === 'POST' && rpc && (READ_ONLY_RPCS.has(rpc) || IDEMPOTENT_WRITE_RPCS.has(rpc))) return 'repeatable';
  return 'write';
}

/** PostgREST never ran the request: no schema cache, or no free connection. */
const NOT_EXECUTED = new Set(['PGRST002', 'PGRST003']);
/** Gateway and upstream failures, and Cloudflare's origin errors. */
const TRANSIENT_STATUS = new Set([502, 503, 504, 520, 521, 522, 523, 524, 544]);
/** Postgres `query_canceled` — a statement timeout during a stall. */
const STATEMENT_TIMEOUT = '57014';

export function shouldRetry(kind: RequestKind, failed: FailedAttempt): boolean {
  if (kind === 'excluded') return false;
  if (failed.kind === 'status' && failed.status === 503 && failed.code && NOT_EXECUTED.has(failed.code)) {
    return true;
  }
  if (kind !== 'repeatable') return false;
  if (failed.kind === 'network') return true;
  if (TRANSIENT_STATUS.has(failed.status)) return true;
  return failed.status === 500 && failed.code === STATEMENT_TIMEOUT;
}

/** Only these statuses are worth reading the body of (for the code above). */
export function bodyMayCarryCode(status: number): boolean {
  return status === 503 || status === 500;
}

/** PostgREST's error code from a response body, if it has one. */
export function parseErrorCode(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { code?: unknown };
    if (typeof parsed?.code === 'string') return parsed.code;
  } catch {
    // Not JSON — fall through to a plain search.
  }
  return /PGRST00[23]/.exec(body)?.[0] ?? null;
}

/** A failure of the connection itself, as opposed to an answer from the server. */
export function isNetworkError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === 'AbortError') return false;
  if (error instanceof TypeError) return true;
  return typeof message === 'string'
    && /network request failed|failed to fetch|fetch failed|network connection was lost|load failed/i.test(message);
}

/** The wait before retry number `retry` (1-based), with ±30% jitter. */
export function retryDelayMs(retry: number, random: number): number {
  const base = BASE_DELAYS_MS[Math.min(Math.max(retry, 1), BASE_DELAYS_MS.length) - 1];
  return Math.round(base * (0.7 + 0.6 * Math.min(Math.max(random, 0), 1)));
}

export const STORM_WINDOW_MS = 10_000;
export const STORM_THRESHOLD = 6;
export const STORM_PAUSE_MS = 15_000;

/**
 * App-wide brake on retries. Six retryable failures inside ten seconds means
 * the server is struggling, not blinking — retries stop for fifteen seconds
 * and failures go straight to the screens, which wait longer between tries.
 */
export class RetryGovernor {
  private failures: number[] = [];
  private pausedUntil = 0;

  noteFailure(now: number): void {
    this.failures = this.failures.filter(at => now - at < STORM_WINDOW_MS);
    this.failures.push(now);
    if (this.failures.length >= STORM_THRESHOLD) {
      this.pausedUntil = now + STORM_PAUSE_MS;
      this.failures = [];
    }
  }

  allows(now: number): boolean {
    return now >= this.pausedUntil;
  }

  reset(): void {
    this.failures = [];
    this.pausedUntil = 0;
  }
}
