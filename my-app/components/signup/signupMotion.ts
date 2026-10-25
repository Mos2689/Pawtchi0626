/**
 * Sign-up v2's motion — smooth, never springy.
 *
 * First device pass found it "too bouncy": spring-in tags, a spring photo
 * pop, spring presses and a full-width slide between steps. Everything here is
 * timing on a strong ease-out instead (Emil: no overshoot in UI, never animate
 * from scale 0, small distances), so a step glides 24 pt into place and an
 * answer settles rather than bounces. Steps and blocks reveal through
 * Reveal.tsx (an animated style, not an `entering` layout animation, which
 * clips TextInputs on iOS); this file holds the rest.
 */

import { Easing, Keyframe } from 'react-native-reanimated';

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

/** A tag or tick appearing: a short fade from 92%, no overshoot. */
export function settleIn() {
  return new Keyframe({
    0: { opacity: 0, transform: [{ scale: 0.92 }] },
    100: { opacity: 1, transform: [{ scale: 1 }], easing: EASE_OUT },
  }).duration(240);
}

/** Press feedback: quick and flat. */
export const PRESS_TIMING = { duration: 120, easing: EASE_OUT } as const;
export const PRESS_SCALE = 0.97;

/** The photo's arrival swell: up a hair, then back, no bounce. */
export const SWELL_UP = { duration: 160, easing: EASE_OUT } as const;
export const SWELL_DOWN = { duration: 260, easing: Easing.bezier(0.77, 0, 0.175, 1) } as const;
export const SWELL_SCALE = 1.03;
