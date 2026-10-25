/**
 * Whether new owners get sign-up v2.
 *
 * The PostHog flag `signup-v2` decides. It is asked before anyone is signed
 * in, so PostHog answers for an anonymous visitor: roll it out by percentage,
 * not by tester id.
 *
 * ── Why this does not use isPerfFlagOn ──
 * isPerfFlagOn answers from the flags PostHog persisted LAST launch and holds
 * the first answer for the session. The person this flag exists for is a
 * brand-new install, which has nothing persisted: read that way, a quick tap
 * on "Get started" would see "off" and show the old sign-up even at 100%.
 * So Welcome calls `prefetchSignupFlag()` as it opens (a fresh fetch), and the
 * tap reads PostHog's live answer, not a held one. Unknown still reads as off.
 *
 * Development builds can force it on with EXPO_PUBLIC_FORCE_SIGNUP_V2=1.
 */

import { posthog } from '../analytics';
import { PERF_FLAGS } from '../perfFlags';

const KEY = PERF_FLAGS.signupV2;

/** Ask PostHog for fresh flags now, so the answer is in by the time of the tap. */
export function prefetchSignupFlag(): void {
  try {
    void posthog?.reloadFeatureFlagsAsync().catch(() => {});
  } catch {
    // An SDK without the call leaves the flag reading off, which is safe.
  }
}

export function signupV2Enabled(): boolean {
  if (typeof __DEV__ !== 'undefined' && __DEV__ && process.env.EXPO_PUBLIC_FORCE_SIGNUP_V2 === '1') {
    return true;
  }
  try {
    return posthog?.isFeatureEnabled(KEY) === true;
  } catch {
    return false;
  }
}
