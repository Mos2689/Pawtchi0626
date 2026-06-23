import { useEffect, useRef } from 'react';
import { track } from './analytics';

// Stable step identifiers — keep these strings, the funnel charts depend on them.
// `index` / `total` make it trivial to compute progress in any BI tool.
export type OnboardingStepId =
  | 'species'
  | 'identity'
  | 'body_basics'
  | 'energy'
  | 'allergies'
  | 'goal'
  | 'reveal';

const STEP_ORDER: OnboardingStepId[] = [
  'species',
  'identity',
  'body_basics',
  'energy',
  'allergies',
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
