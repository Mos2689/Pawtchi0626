import { useEffect, useRef } from 'react';
import { track } from './analytics';

// Stable step identifiers — keep these strings, the funnel charts depend on them.
// `index` / `total` make it trivial to compute progress in any BI tool.
//
// ── 'species' was removed here (Aug 2026) ──
// Pawtchi is dog-only now, so the species picker no longer exists and identity
// is the first screen an owner sees. Dropping it from this list is what makes
// the header read "1" rather than "2" on the very first screen.
//
// ANALYTICS NOTE: this shifts `step_index` down by one for every step after it,
// and `total` from 7 to 6. The step ID STRINGS are unchanged, so any funnel
// built on `step` keeps working across the cut; a funnel built on `step_index`
// will show a discontinuity on the release date. The ids are the stable
// contract — that is what the comment above has always meant.
export type OnboardingStepId =
  | 'identity'
  | 'body_basics'
  | 'energy'
  | 'allergies'
  | 'body_check'
  | 'goal'
  | 'reveal';

const STEP_ORDER: OnboardingStepId[] = [
  'identity',
  'body_basics',
  'energy',
  'allergies',
  'body_check',
  'goal',
  'reveal',
];

export const ONBOARDING_TOTAL_STEPS = STEP_ORDER.length - 1; // reveal is a transition, not a numbered step

export function stepIndex(id: OnboardingStepId): number {
  return STEP_ORDER.indexOf(id) + 1; // 1-based for display
}

// Fire view-on-mount + duration-on-unmount. Always pair the two so we can
// chart median dwell time per step and surface where users hesitate.
export function useOnboardingStepTracking(step: OnboardingStepId) {
  const mountedAt = useRef<number>(Date.now());
  useEffect(() => {
    track('onboarding_step_viewed', { step, step_index: stepIndex(step), total: ONBOARDING_TOTAL_STEPS });
    // Intentionally not tracking unmount duration here — the next 'viewed' event
    // implicitly defines the dwell of the previous one in any BI tool.
    // (Unmount can fire during navigation in ways that double-count.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function trackStepCompleted(step: OnboardingStepId, props: Record<string, string | number | boolean | null | undefined> = {}) {
  track('onboarding_step_completed', { step, step_index: stepIndex(step), ...props });
}

export function trackStepBack(step: OnboardingStepId) {
  track('onboarding_back_pressed', { step, step_index: stepIndex(step) });
}

export function trackFieldSkipped(step: OnboardingStepId, field: string) {
  track('onboarding_field_skipped', { step, step_index: stepIndex(step), field });
}

// ── Fresh-signup routing latch ──
// Signup is the one moment we KNOW the account has no pet yet, so the auth
// gate can route straight to /onboarding/identity without mounting the tabs
// boot gate — whose only job would be to discover "no pet" over the network
// behind a full-screen loader. Set BEFORE supabase.auth.signUp (the session
// event can land, and the gate can navigate, before the await resumes),
// consumed once by the gate, cleared on failure or verification-required.
// Deliberately in-memory: after an app restart the normal fetch-then-redirect
// path is the correct behavior anyway.
let freshSignup = false;

export function markFreshSignup(): void {
  freshSignup = true;
}

export function clearFreshSignup(): void {
  freshSignup = false;
}

/** Read-and-clear — true exactly once per marked signup. */
export function consumeFreshSignup(): boolean {
  const value = freshSignup;
  freshSignup = false;
  return value;
}
