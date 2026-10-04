/**
 * The Supabase client's fetch: timed, retried when that is safe, and — in
 * development only — able to fail on purpose.
 *
 * Installed once as `global.fetch` in lib/supabase.ts, so every table read,
 * RPC and signed-URL request in the app passes through here and nothing at a
 * call site has to remember to retry. What may be retried, and when, is
 * decided by lib/net/retryPolicy.ts; this file only carries it out.
 *
 * ── Guarantees ──────────────────────────────────────────────────────────────
 *
 *   - The caller receives exactly the Response the last send produced, or
 *     exactly the error it threw. Nothing is reshaped.
 *   - A request is never repeated unless the policy says repeating it cannot
 *     cause anything twice.
 *   - An aborted request is never retried.
 *   - Retrying stops at the budget, at the attempt cap, while the governor
 *     says the server is struggling, and whenever `kill-net-retry` is on.
 *
 * Request timing (lib/apiTiming.ts) records the whole call — retries and their
 * waits included — once, with the number of sends it took.
 */

import { beginRequest, endRequest, recordRequest, urlOf } from '../apiTiming';
import { isPerfFlagOn } from '../perfFlags';
import { FAULT_BUSY_BODY, parseFaults, pickFault, type FaultPlan } from './faults';
import {
  MAX_RETRIES,
  RETRY_BUDGET_MS,
  RetryGovernor,
  bodyMayCarryCode,
  isNetworkError,
  parseErrorCode,
  requestKind,
  retryDelayMs,
  shouldRetry,
  type FailedAttempt,
  type RequestKind,
} from './retryPolicy';

type Fetch = typeof fetch;

export interface ResilientFetchDeps {
  now(): number;
  random(): number;
  sleep(ms: number): Promise<void>;
  governor: RetryGovernor;
  /** Read per call, so the kill switch can land mid-session after PostHog loads. */
  retriesEnabled(): boolean;
  /** Development fault plan; always null in release builds. */
  faults: FaultPlan | null;
}

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

export const appGovernor = new RetryGovernor();

const DEFAULT_DEPS: ResilientFetchDeps = {
  now: () => Date.now(),
  random: () => Math.random(),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  governor: appGovernor,
  retriesEnabled: () => {
    try {
      return !isPerfFlagOn('killNetRetry');
    } catch {
      return true;
    }
  },
  faults: isDev ? parseFaults(process.env.EXPO_PUBLIC_FAULTS) : null,
};

export function resilientFetch(base: Fetch, overrides: Partial<ResilientFetchDeps> = {}): Fetch {
  const deps: ResilientFetchDeps = { ...DEFAULT_DEPS, ...overrides };

  const call = async (input: Parameters<Fetch>[0], init?: Parameters<Fetch>[1]): Promise<Response> => {
    const url = urlOf(input);
    const kind = requestKind(url, init?.method ?? 'GET');
    const started = deps.now();
    const concurrent = beginRequest();
    let attempts = 0;
    try {
      for (;;) {
        attempts += 1;
        let response: Response | null = null;
        let failure: unknown = null;
        try {
          response = await sendOnce(base, input, init, kind, deps);
        } catch (error) {
          failure = error;
        }

        const failed = response ? await describeFailure(response) : isNetworkError(failure) ? { kind: 'network' as const } : null;
        if (failed && attempts <= MAX_RETRIES && !init?.signal?.aborted && shouldRetry(kind, failed) && deps.retriesEnabled()) {
          deps.governor.noteFailure(deps.now());
          const wait = retryDelayMs(attempts, deps.random());
          if (deps.governor.allows(deps.now()) && deps.now() - started + wait <= RETRY_BUDGET_MS) {
            await deps.sleep(wait);
            continue;
          }
        }

        recordRequest(
          { input, init, status: response?.status ?? 0, ms: deps.now() - started, response, concurrent, attempts },
          deps,
        );
        if (response) return response;
        throw failure;
      }
    } finally {
      endRequest();
    }
  };
  return call as Fetch;
}

async function sendOnce(
  base: Fetch,
  input: Parameters<Fetch>[0],
  init: Parameters<Fetch>[1],
  kind: RequestKind,
  deps: ResilientFetchDeps,
): Promise<Response> {
  if (deps.faults && kind !== 'excluded') {
    const fault = pickFault(deps.faults, deps.random());
    if (fault === 'busy') {
      return new Response(FAULT_BUSY_BODY, { status: 503, headers: { 'Content-Type': 'application/json' } });
    }
    if (fault === 'network') throw new TypeError('Network request failed');
    if (fault === 'slow') await deps.sleep(6_000 + Math.round(deps.random() * 4_000));
  }
  return base(input, init);
}

/** Null for a success. Reads the body (of a copy) only when it can carry a code. */
async function describeFailure(response: Response): Promise<FailedAttempt | null> {
  if (response.ok) return null;
  let code: string | null = null;
  if (bodyMayCarryCode(response.status)) {
    try {
      code = parseErrorCode(await response.clone().text());
    } catch {
      code = null;
    }
  }
  return { kind: 'status', status: response.status, code };
}
