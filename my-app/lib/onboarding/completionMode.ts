/**
 * completionMode — one helper for "am I onboarding, or filling in gaps?"
 *
 * The health completion flow reuses the onboarding screens rather than cloning
 * them: same questions, same validation, same copy. The only difference is how
 * the chain starts (draft hydrated from the live pet) and how it ends (back to
 * the feature that asked, not the reveal).
 *
 * That difference travels as a `mode=complete` route param. This module exists
 * so the check and the forwarding are written once — five screens each doing
 * their own `params.mode === 'complete'` is exactly how one of them ends up
 * dropping the param and silently stranding an owner in onboarding.
 */

import type { HealthFeature } from '../health/featureRequirements';

export interface CompletionParams {
  mode?: string;
  feature?: string;
}

/** True when the screen is being used to fill gaps in an existing profile. */
export function isCompletionMode(params: CompletionParams): boolean {
  return params.mode === 'complete';
}

/**
 * The params to carry to the next screen in the chain.
 *
 * Spread into every `router.push` between onboarding screens. Returns an empty
 * object during normal onboarding, so the call site reads identically in both
 * modes and cannot forget one.
 */
export function forwardCompletionParams(
  params: CompletionParams,
): Record<string, string> {
  if (!isCompletionMode(params)) return {};
  return params.feature
    ? { mode: 'complete', feature: params.feature }
    : { mode: 'complete' };
}

/** Where to send someone once their profile can support what they wanted. */
export function completionReturnPath(feature?: string): string {
  switch (feature as HealthFeature | undefined) {
    case 'meal_logging':
      return '/(tabs)/meal';
    case 'activity_plan':
      return '/(tabs)/activity';
    // health_insights, calorie_target, weight_plan and anything unrecognised
    // all live on the Health tab.
    default:
      return '/(tabs)/health';
  }
}
