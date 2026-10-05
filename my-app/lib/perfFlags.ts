/**
 * Remote kill switches for the performance work (Train 2, October 2026).
 *
 * ── Why these exist ─────────────────────────────────────────────────────────
 *
 * This app has no over-the-air updates. A client change that misbehaves in
 * production can only be undone by a new store build and its review. So every
 * medium-risk performance change ships behind one of these flags, the OLD code
 * path stays intact behind it, and a flag that is off (or unknown) means "do
 * exactly what build 98 did". Turning a flag off in PostHog restores the old
 * behaviour on the next launch, with no build.
 *
 * ── The three rules ─────────────────────────────────────────────────────────
 *
 * 1. Off unless PostHog says on. No API key, no network, a flag nobody created,
 *    a throw from the SDK: all of them read as off.
 * 2. Nothing is decided before PostHog has loaded the flags it persisted last
 *    launch. Until `ready()` resolves, every flag reads off and the answer is
 *    NOT remembered, so a later read can still see the real value.
 * 3. Once read after ready, a flag keeps that value for the rest of the
 *    session. Fresh values PostHog fetches mid-session apply on the next
 *    launch, so no feature switches path halfway through somebody's walk.
 *
 * Create each key below in PostHog as a boolean flag, released to 0%, before
 * the build ships. Roll out internal testers → 10% → 50% → 100%.
 */

import { posthog } from './analytics';

export const PERF_FLAGS = {
  /** Send the push token / permission only when it changed (or weekly). */
  pushChangeDetection: 'perf-push-change-detection',
  /** Meetup → walk: seeded dogs, press-in prefetch, complete prime. */
  walkInstantOpen: 'perf-walk-instant-open',
  /** Pet context (health dashboard) cached per day, not fetched at boot. */
  lazyPetContext: 'perf-lazy-pet-context',
  /** Sampled per-request timings to analytics (dev logs are always on). */
  apiTiming: 'perf-api-timing',
  /**
   * INVERTED — a kill switch, not a feature. Automatic retries of failed
   * requests (lib/net/resilientFetch.ts) are ON unless this flag is on.
   * Off, unknown or unreachable all mean "keep retrying", because retrying is
   * the safe behaviour; turn it on only if retries themselves misbehave.
   */
  killNetRetry: 'kill-net-retry',
  /** Live walk: apply position events directly; fewer close-check polls. */
  liveDeltas: 'perf-live-deltas',
} as const;

export type PerfFlag = keyof typeof PERF_FLAGS;

const held = new Map<PerfFlag, boolean>();
const overrides = new Map<PerfFlag, boolean>();
let ready = false;

if (posthog) {
  try {
    posthog
      .ready()
      .then(() => { ready = true; })
      .catch(() => {});
  } catch {
    // An SDK without ready() leaves every flag off, which is the safe answer.
  }
}

/** Whether a performance change is switched on for this session. */
export function isPerfFlagOn(flag: PerfFlag): boolean {
  const forced = overrides.get(flag);
  if (forced !== undefined) return forced;

  const known = held.get(flag);
  if (known !== undefined) return known;

  if (!posthog || !ready) return false;

  let on = false;
  try {
    on = posthog.isFeatureEnabled(PERF_FLAGS[flag]) === true;
  } catch {
    on = false;
  }
  held.set(flag, on);
  return on;
}

/**
 * Force a flag for this process: tests, and local development of the new path
 * before PostHog has the flag. Pass `undefined` to clear.
 */
export function setPerfFlagOverride(flag: PerfFlag, value: boolean | undefined): void {
  if (value === undefined) overrides.delete(flag);
  else overrides.set(flag, value);
}

/** Tests only: forget held values, overrides and readiness. */
export function resetPerfFlagsForTests(state: { ready?: boolean } = {}): void {
  held.clear();
  overrides.clear();
  ready = state.ready ?? false;
}
