/**
 * How long every Supabase request takes, as the phone sees it (perf Train 2).
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The performance work so far was judged from the server's side: edge logs
 * and pg_stat_statements. They showed requests waiting 0.5–2 s inside Supabase
 * (2026-10-01), but they cannot see the rest — the trip from the phone, how
 * many requests were already in flight, whether a fix helped a real device.
 * This is that half: wall-clock per request, the server's own share of it
 * (`x-envoy-upstream-service-time`), and how many other requests were in the
 * air when it left.
 *
 * ── Where it goes, and what it may never carry ──────────────────────────────
 *
 * Development builds: a console line per request, nothing sent anywhere.
 *
 * Release builds: nothing at all unless perf-api-timing is on in PostHog —
 * then a sample of requests (API_TIMING_SAMPLE_RATE, at most
 * API_TIMING_SESSION_CAP per launch) is sent to PostHog as `api_timing`. The
 * properties are the endpoint's NAME (a table, an RPC, an auth or storage
 * verb), the method, the status and three numbers. Never a URL, a query
 * string, an id, a bucket or an object path: those carry who and which pet.
 *
 * Sent with `posthog.capture`, NOT `track()`. `track()` also feeds Firebase,
 * Meta and the support breadcrumb buffer, and request timings belong in none
 * of them — they would crowd real breadcrumbs out of a support report.
 *
 * lib/community/perf.ts keeps its own timer dev-only for the same privacy
 * reasons; this one may report only because it is flagged, sampled, capped
 * and stripped down to endpoint names, and it should be switched off again
 * once the scoreboard has what it needs.
 *
 * ── Pass-through, always ────────────────────────────────────────────────────
 *
 * The wrapper hands `fetch` exactly what it was given and returns exactly what
 * came back, or re-throws exactly what was thrown. All of its own work happens
 * inside a try/catch, so instrumentation can never be why a request failed.
 */

import { posthog } from './analytics';
import { isPerfFlagOn } from './perfFlags';

/** One request in ten, while the flag is on. */
export const API_TIMING_SAMPLE_RATE = 0.1;
/** Per launch, so one long session cannot dominate the sample. */
export const API_TIMING_SESSION_CAP = 200;

type Fetch = typeof fetch;

let inFlight = 0;
let reported = 0;

/** Wrap a fetch so each request is timed. See the file header for where it goes. */
export function timedFetch(
  base: Fetch,
  clock: { now(): number; random(): number } = { now: () => Date.now(), random: () => Math.random() },
): Fetch {
  const timed = async (input: Parameters<Fetch>[0], init?: Parameters<Fetch>[1]): Promise<Response> => {
    const started = clock.now();
    const concurrent = beginRequest();
    let response: Response;
    try {
      response = await base(input, init);
    } catch (error) {
      endRequest();
      recordRequest({ input, init, status: 0, ms: clock.now() - started, response: null, concurrent, attempts: 1 }, clock);
      throw error;
    }
    endRequest();
    recordRequest({ input, init, status: response.status, ms: clock.now() - started, response, concurrent, attempts: 1 }, clock);
    return response;
  };
  return timed as Fetch;
}

/** Count a request in; returns how many were already in the air. */
export function beginRequest(): number {
  const concurrent = inFlight;
  inFlight += 1;
  return concurrent;
}

export function endRequest(): void {
  inFlight = Math.max(0, inFlight - 1);
}

export interface RequestRecord {
  input: Parameters<Fetch>[0];
  init: Parameters<Fetch>[1];
  /** 0 when no answer arrived (a network failure). */
  status: number;
  ms: number;
  response: Response | null;
  concurrent: number;
  /** Sends it took, retries included (lib/net/resilientFetch.ts). */
  attempts: number;
}

/** Log or sample one finished request. Never throws. */
export function recordRequest(entry: RequestRecord, clock: { random(): number }): void {
  note(entry.input, entry.init, entry.status, entry.ms, entry.response, entry.concurrent, entry.attempts, clock);
}

function note(
  input: Parameters<Fetch>[0],
  init: Parameters<Fetch>[1],
  status: number,
  ms: number,
  response: Response | null,
  concurrent: number,
  attempts: number,
  clock: { random(): number },
): void {
  try {
    const dev = typeof __DEV__ !== 'undefined' && __DEV__;
    if (!dev && (reported >= API_TIMING_SESSION_CAP || !isPerfFlagOn('apiTiming'))) return;
    if (!dev && clock.random() >= API_TIMING_SAMPLE_RATE) return;

    const endpoint = endpointLabel(urlOf(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const serverMs = upstreamMs(response);

    if (dev) {
      console.log(
        `[api] ${method.padEnd(6)} ${endpoint.padEnd(36)} ${String(status || 'ERR').padStart(3)} ${String(ms).padStart(5)}ms`
          + (serverMs !== null ? `  server ${serverMs}ms` : '')
          + (concurrent ? `  +${concurrent} in flight` : '')
          + (attempts > 1 ? `  ${attempts} attempts` : ''),
      );
      return;
    }
    if (!posthog) return;
    reported += 1;
    posthog.capture('api_timing', {
      endpoint,
      method,
      status,
      ms,
      server_ms: serverMs,
      inflight: concurrent,
      attempts,
    });
  } catch {
    // Instrumentation never affects the request it measures.
  }
}

export function urlOf(input: Parameters<Fetch>[0]): string {
  if (typeof input === 'string') return input;
  const candidate = input as { url?: unknown; href?: unknown };
  if (typeof candidate.url === 'string') return candidate.url;
  if (typeof candidate.href === 'string') return candidate.href;
  return '';
}

/** Supabase's own time for the request, when the gateway reports it. */
function upstreamMs(response: Response | null): number | null {
  const raw = response?.headers?.get?.('x-envoy-upstream-service-time');
  const value = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(value) ? value : null;
}

/** A Postgres identifier, which is all a table or RPC name can be. */
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/i;
/** Edge function names may also carry hyphens. */
const FUNCTION_NAME = /^[a-z][a-z0-9_-]{0,62}$/i;
/** Eight hex digits in a row: part of a uuid or a token, never a name. */
const LOOKS_LIKE_ID = /[0-9a-f]{8}/i;
const STORAGE_VERBS = new Set(['sign', 'public', 'upload', 'list', 'info', 'authenticated', 'move', 'copy']);

/**
 * The endpoint's name and nothing else — the only part of a URL that leaves
 * the phone. `/rest/v1/rpc/community_outing?x=…` is `rpc/community_outing`;
 * a storage object path is `storage/object`, never the bucket or the path.
 * Anything that is not a plain identifier where one is expected becomes `?`.
 */
export function endpointLabel(url: string): string {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return 'other';
  }
  const [service, version, first, second] = path.split('/').filter(Boolean);
  if (version !== 'v1') return 'other';
  const name = (segment: string | undefined, pattern = IDENTIFIER) =>
    (segment && pattern.test(segment) && !LOOKS_LIKE_ID.test(segment) ? segment : '?');
  switch (service) {
    case 'rest':
      return first === 'rpc' ? `rpc/${name(second)}` : `rest/${name(first)}`;
    case 'auth':
      return `auth/${name(first)}`;
    case 'functions':
      return `fn/${name(first, FUNCTION_NAME)}`;
    case 'storage':
      return first === 'object' && second && STORAGE_VERBS.has(second)
        ? `storage/object/${second}`
        : `storage/${name(first)}`;
    default:
      return 'other';
  }
}

/** Tests only. */
export function resetApiTimingForTests(): void {
  inFlight = 0;
  reported = 0;
}
