/**
 * The body of an onboarding step: a scrolling form with one bar pinned to the
 * bottom, which is the sticky CTA until the keyboard opens and the accessory
 * bar while it is up.
 *
 * ── Why this replaced KeyboardAvoidingView ──────────────────────────────────
 * Every typing step used to be `<KeyboardAvoidingView behavior="padding">`
 * wrapping *both* the ScrollView and the sticky Continue bar, with a hardcoded
 * `keyboardVerticalOffset={20}`. Three things were wrong with that:
 *
 *   1. Padding the wrapper squeezes the flex column, so the form's viewport
 *      shrank AND the CTA was pushed up onto the keyboard — the CTA and the
 *      status row together ate ~110dp of an already-halved screen.
 *   2. The offset has to equal the distance from the window top to the KAV's
 *      top. OnboardingHeader renders *outside* it, so 20 was wrong on every
 *      device, and wrong by a different amount on each.
 *   3. Android ran `behavior="height"` on top of an `adjustResize` activity,
 *      re-laying out a window the OS had already resized. That was the jump.
 *
 * Here, the scroll content never reflows when the keyboard moves. The bar is
 * absolutely positioned and is the only thing that translates; the content
 * keeps a constant bottom padding big enough to clear it. The focused field is
 * brought into view by scrolling, not by resizing anything.
 *
 * ── Platform ────────────────────────────────────────────────────────────────
 * `keyboardLift()` is 0 on Android because the activity is `adjustResize`: the
 * window is already shorter, so this component's own height already excludes
 * the keyboard and translating again would lift the bar into mid-screen.
 */

import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, Platform,
  ScrollView, StyleSheet, View, Keyboard,
  type StyleProp, type ViewStyle,
} from 'react-native';
import Animated, {
  Easing, FadeIn, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';

import { keyboardLift, useKeyboardInset } from '../../hooks/useKeyboardInset';
import { KEYBOARD_ACCESSORY_HEIGHT, KeyboardAccessoryBar } from './KeyboardAccessoryBar';
import { space } from '../../constants/design';

/** Breathing room left between the focused field and the accessory bar. */
const FIELD_GAP = 14;

/**
 * Bottom padding held on the scroll content at all times.
 *
 * Constant on purpose. Animating it to match the bar would reflow the form
 * every time the keyboard moved, which is the layout jump we are removing.
 * It only has to be tall enough that the last field can scroll clear of the
 * tallest bar we ever show.
 */
const CONTENT_CLEARANCE = 168;

interface ActiveField {
  id: string;
  label: string;
  actionLabel?: string;
  /** Always stable — see the note on the ref in ScaffoldField. */
  onAction: () => void;
  /** Measures the field's offset inside the scaffold, in dp from its top. */
  measure: (done: (top: number, height: number) => void) => void;
}

interface ScaffoldApi {
  onFieldFocus: (field: ActiveField) => void;
  onFieldBlur: (id: string) => void;
  /** Fields measure against this so "how far down am I" is scroll-independent. */
  rootRef: React.RefObject<View | null>;
}

const ScaffoldContext = createContext<ScaffoldApi | null>(null);

export function useFormScaffold(): ScaffoldApi | null {
  return useContext(ScaffoldContext);
}

export interface OnboardingFormScaffoldProps {
  children: React.ReactNode;
  /** The sticky bottom bar — status row, CTA, whatever the step needs. */
  footer: React.ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  scrollViewProps?: React.ComponentProps<typeof ScrollView>;
}

export function OnboardingFormScaffold({
  children,
  footer,
  contentContainerStyle,
  scrollViewProps,
}: OnboardingFormScaffoldProps) {
  const { height: keyboardHeight, visible: keyboardVisible, duration } = useKeyboardInset();
  const lift = keyboardLift(keyboardHeight);

  const rootRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);
  const scrollOffset = useRef(0);
  const rootHeight = useRef(0);

  const [active, setActive] = useState<ActiveField | null>(null);

  // The bar travels on the OS's own curve and duration, which is what sells it
  // as attached to the keyboard rather than chasing it.
  const barLift = useSharedValue(0);
  useEffect(() => {
    barLift.value = withTiming(lift, {
      duration,
      easing: Easing.bezier(0.17, 0.59, 0.4, 0.77),
    });
  }, [lift, duration, barLift]);

  const barStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -barLift.value }],
  }));

  const onFieldFocus = useCallback((field: ActiveField) => setActive(field), []);
  const onFieldBlur = useCallback((id: string) => {
    setActive((cur) => (cur?.id === id ? null : cur));
  }, []);
  const api = useMemo<ScaffoldApi>(
    () => ({ onFieldFocus, onFieldBlur, rootRef }),
    [onFieldFocus, onFieldBlur],
  );

  // Bring the focused field above the accessory bar. Runs when the field
  // changes and again once the keyboard height is known, because on Android the
  // height only arrives after the keyboard has finished opening.
  useEffect(() => {
    if (!active || !keyboardVisible) return;
    const handle = setTimeout(() => {
      active.measure((top, height) => {
        const visibleBottom =
          rootHeight.current - lift - KEYBOARD_ACCESSORY_HEIGHT - FIELD_GAP;
        if (visibleBottom <= 0) return;
        const overshoot = top + height - visibleBottom;
        if (overshoot > 1) {
          scrollRef.current?.scrollTo({
            y: Math.max(0, scrollOffset.current + overshoot),
            animated: true,
          });
        }
      });
    }, 60); // let the keyboard frame settle before measuring against it
    return () => clearTimeout(handle);
  }, [active, keyboardVisible, lift]);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollOffset.current = e.nativeEvent.contentOffset.y;
  }, []);

  const handleRootLayout = useCallback((e: LayoutChangeEvent) => {
    rootHeight.current = e.nativeEvent.layout.height;
  }, []);

  const showAccessory = keyboardVisible && !!active;

  return (
    <ScaffoldContext.Provider value={api}>
      <View ref={rootRef} style={styles.root} onLayout={handleRootLayout} collapsable={false}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[styles.content, contentContainerStyle]}
          showsVerticalScrollIndicator={false}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          // Dragging the form puts the keyboard away — on iOS it tracks the
          // finger, on Android it dismisses on drag start (interactive is iOS-only).
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          // Without this, the first tap on a chip while the keyboard is open is
          // swallowed by the dismissal instead of selecting anything.
          keyboardShouldPersistTaps="handled"
          {...scrollViewProps}
        >
          {children}
        </ScrollView>

        {/* The two bars swap; they are never both up. Entering-only, with no
            exiting animation: an exiting Reanimated view stays mounted for the
            length of its animation, and since these are normal-flow children
            of the same box, an overlap would briefly stack them and make the
            bar jump to their combined height. */}
        <Animated.View style={[styles.bar, barStyle]} pointerEvents="box-none">
          {showAccessory ? (
            <Animated.View key="accessory" entering={FadeIn.duration(140)}>
              <KeyboardAccessoryBar
                label={active.label}
                actionLabel={active.actionLabel}
                onAction={active.onAction}
              />
            </Animated.View>
          ) : (
            <Animated.View key="footer" entering={FadeIn.duration(160)}>
              {footer}
            </Animated.View>
          )}
        </Animated.View>
      </View>
    </ScaffoldContext.Provider>
  );
}

export interface ScaffoldFieldProps {
  /** Stable id so a blur from an already-replaced field can't clear the bar. */
  id: string;
  /** Shown on the accessory bar, e.g. "Weight · kg". */
  label: string;
  actionLabel?: string;
  /** Defaults to dismissing the keyboard. */
  onAction?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  style?: StyleProp<ViewStyle>;
  /** Spread the given handlers onto the input this wraps. */
  children: (handlers: { onFocus: () => void; onBlur: () => void }) => React.ReactNode;
}

/**
 * Wraps one keyboard-opening input so the scaffold knows it exists.
 *
 * Render-prop rather than cloneElement: the inputs here are wrapped in
 * TextField, and reaching through a wrapper to graft handlers onto whatever it
 * renders is the kind of thing that breaks silently the next time TextField
 * changes. Handing the handlers back and letting the caller spread them is
 * explicit and survives refactors.
 */
export function ScaffoldField({
  id, label, actionLabel, onAction, onFocus, onBlur, style, children,
}: ScaffoldFieldProps) {
  const scaffold = useFormScaffold();
  const ref = useRef<View>(null);

  // The action is registered once, on focus, but it closes over state that
  // keeps changing while the field is being typed into — allergies' "Add"
  // reads `customInput`. Registering the callback directly would freeze it at
  // whatever the value was when the field gained focus, i.e. empty. The ref is
  // re-pointed every render; the function handed to the scaffold is stable.
  const actionRef = useRef(onAction);
  actionRef.current = onAction;
  const stableAction = useCallback(() => {
    if (actionRef.current) actionRef.current();
    else Keyboard.dismiss();
  }, []);

  const measure = useCallback((done: (top: number, height: number) => void) => {
    const root = scaffold?.rootRef.current;
    const node = ref.current;
    if (!root || !node) return;
    try {
      node.measureLayout(
        root as never,
        (_x, y, _w, h) => done(y, h),
        () => { /* view detached mid-measure — leave the scroll where it is */ },
      );
    } catch {
      // Older/!Fabric hosts can reject a ref here. Not scrolling is a far
      // better failure than throwing during focus.
    }
  }, [scaffold]);

  const handleFocus = useCallback(() => {
    onFocus?.();
    scaffold?.onFieldFocus({ id, label, actionLabel, onAction: stableAction, measure });
  }, [scaffold, id, label, actionLabel, stableAction, measure, onFocus]);

  const handleBlur = useCallback(() => {
    onBlur?.();
    scaffold?.onFieldBlur(id);
  }, [scaffold, id, onBlur]);

  return (
    <View ref={ref} style={style} collapsable={false}>
      {children({ onFocus: handleFocus, onBlur: handleBlur })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: {
    paddingHorizontal: space.xxl,
    paddingBottom: CONTENT_CLEARANCE,
  },
  // No background of its own: footers bring theirs (allergies fades in with a
  // gradient, which a white plate behind it would flatten). box-none above
  // keeps the transparent margin from swallowing taps meant for the form.
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
});
