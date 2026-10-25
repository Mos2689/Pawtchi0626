/**
 * Whether new owners get sign-up v2.
 *
 * The PostHog flag `signup-v2` decides, read with isPerfFlagOn at the moment
 * someone taps "Get started". That is before any sign-in, so PostHog answers
 * for an anonymous visitor: roll the flag out by percentage, not by tester id.
 *
 * Development builds can force it on with EXPO_PUBLIC_FORCE_SIGNUP_V2=1, so
 * the flow can be tried on a dev client without touching the flag.
 */

import { isPerfFlagOn } from '../perfFlags';

export function signupV2Enabled(): boolean {
  if (typeof __DEV__ !== 'undefined' && __DEV__ && process.env.EXPO_PUBLIC_FORCE_SIGNUP_V2 === '1') {
    return true;
  }
  return isPerfFlagOn('signupV2');
}
