/**
 * Sign-up v2's motion — smooth, never springy.
 *
 * First device pass found it "too bouncy": spring-in tags, a spring photo
 * pop, spring presses and a full-width slide between steps. Everything here is
 * timing on a strong ease-out instead (Emil: no overshoot in UI, never animate
 * from scale 0, small distances), so a step glides 24 pt into place and an
 * answer settles rather than bounces.
 */

import { Easing, Keyframe } from 'react-native-reanimated';

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

/** How far a step travels when it arrives. */
const STEP_SHIFT = 24;
/** How far an item rises while it fades in. */
const ITEM_RISE = 8;

/** A whole step arriving, from the side it came from. */
export function stepEntering(direction: 1 | -1) {
  return new Keyframe({
    0: { opacity: 0, transform: [{ translateX: STEP_SHIFT * direction }] },
    100: { opacity: 1, transform: [{ translateX: 0 }], easing: EASE_OUT },
  }).duration(340);
}

/** One block inside a step, 50 ms behind the one above it. */
export function itemEntering(index: number) {
  return new Keyframe({
    0: { opacity: 0, transform: [{ translateY: ITEM_RISE }] },
    100: { opacity: 1, transform: [{ translateY: 0 }], easing: EASE_OUT },
  })
    .duration(360)
    .delay(60 + index * 50);
}

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
