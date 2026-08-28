/**
 * The keyboard's height and the curve it travels on.
 *
 * `KeyboardAvoidingView` is deliberately not used anywhere this hook is: it
 * pads the container it wraps, which on our onboarding screens meant squeezing
 * the scroll viewport *and* shoving the sticky Continue bar onto the keyboard.
 * Knowing the height ourselves lets exactly one element move.
 *
 * Platform note, and it is the whole reason this returns what it does:
 * Android's activity is `adjustResize` (see AndroidManifest.xml), so the window
 * is already smaller by the time we hear about the keyboard — anything we add
 * on top of that double-counts. iOS keeps the window full height and owes us
 * the inset. Callers get the raw height and decide; `keyboardLift` below is
 * that decision, made once.
 */

import { useEffect, useState } from 'react';
import { Keyboard, Platform, type KeyboardEvent } from 'react-native';

/** iOS's default keyboard curve is ~250ms; used when an event omits one. */
const FALLBACK_DURATION = 250;

export interface KeyboardInset {
  /** Keyboard height in dp, 0 when closed. Raw — see the note above. */
  height: number;
  visible: boolean;
  /** The OS's own animation duration in ms, so our bar rides the same curve. */
  duration: number;
}

/**
 * The distance UI must move to clear the keyboard.
 *
 * Zero on Android because the window already shrank. Use this for transforms
 * and padding; use `height` only if you genuinely want the raw number.
 */
export function keyboardLift(height: number): number {
  return Platform.OS === 'ios' ? height : 0;
}

export function useKeyboardInset(): KeyboardInset {
  const [inset, setInset] = useState<KeyboardInset>({
    height: 0,
    visible: false,
    duration: FALLBACK_DURATION,
  });

  useEffect(() => {
    // iOS emits the `will` pair *before* the keyboard moves and carries the
    // duration with it — that is what makes a bar look attached to the keyboard
    // rather than chasing it. Android only ever emits `did`.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = (e: KeyboardEvent) => {
      setInset({
        height: e.endCoordinates?.height ?? 0,
        visible: true,
        duration: e.duration || FALLBACK_DURATION,
      });
    };
    const onHide = (e: KeyboardEvent) => {
      setInset({
        height: 0,
        visible: false,
        duration: e?.duration || FALLBACK_DURATION,
      });
    };

    const showSub = Keyboard.addListener(showEvent, onShow);
    const hideSub = Keyboard.addListener(hideEvent, onHide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return inset;
}
