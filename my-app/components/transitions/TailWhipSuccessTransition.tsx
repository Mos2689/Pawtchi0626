/**
 * TailWhipSuccessTransition — Pawtchi's signature walk-finish transition.
 *
 * A flowing brand ribbon is painted across the screen in a left→right→left wag
 * (an animated SVG stroke drawn via strokeDashoffset — the same primitive as
 * PulseMark / HealthRings, so it's robust on both platforms), the current
 * screen crossfades to the success screen underneath it, then the ribbon flows
 * off and the content settles in. No flat colour cover, no blocking loader.
 *
 *   <View>
 *     <CurrentScreen/>                          // behind, rendered by the host
 *     {visible && (
 *       <TailWhipSuccessTransition visible onReveal onComplete>
 *         {successScreen}
 *       </TailWhipSuccessTransition>
 *     )}
 *   </View>
 *
 * The success screen (`children`) crossfades in over the current screen (which
 * the host renders behind this transparent overlay). Always plays the full
 * sequence; every timing uses ReduceMotion.Never so the OS Reduce Motion
 * setting can never collapse it to 0ms. Path/particle math is pure + tested in
 * lib/tailWhipTimeline.ts.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { color, motion } from '../../constants/design';
import { haptic } from '../../lib/haptics';
import {
  FurDustSpec,
  RIBBON_HALO,
  RIBBON_STROKE,
  RIBBON_VIEWBOX,
  makeFurDust,
  ribbonLength,
  ribbonPathD,
} from '../../lib/tailWhipTimeline';

const NEVER = ReduceMotion.Never;
const AnimatedPath = Animated.createAnimatedComponent(Path);
const D = ribbonPathD();
const LEN = ribbonLength();

// ── Fur dust ─────────────────────────────────────────────────────────────────

function FurDustDot({ spec }: { spec: FurDustSpec }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withTiming(1, {
      duration: motion.tailWhip.particleFade,
      easing: Easing.out(Easing.quad),
      reduceMotion: NEVER,
    });
    return () => cancelAnimation(p);
  }, [p]);
  const style = useAnimatedStyle(() => ({
    opacity: spec.opacity * (1 - p.value),
    transform: [{ translateX: spec.dx * p.value }, { translateY: spec.dy * p.value }],
  }));
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: spec.x,
          top: spec.y,
          width: spec.size,
          height: spec.size,
          borderRadius: spec.size / 2,
          backgroundColor: color.yellow,
        },
        style,
      ]}
    />
  );
}

// ── The overlay ──────────────────────────────────────────────────────────────

export interface TailWhipSuccessTransitionProps {
  /** One-shot trigger. Set true to play; ignored after it starts until remount. */
  visible: boolean;
  /** The success screen, crossfaded in under the ribbon. The host renders the
   *  current (old) screen BEHIND this overlay so it shows before the crossfade. */
  children: React.ReactNode;
  /** Auto-stop walks: no tap happened, skip the anticipation beat. */
  skipAnticipation?: boolean;
  /** Fires once the ribbon has mostly passed and the success screen is showing —
   *  a good hook to start the success screen's own content stagger. */
  onReveal?: () => void;
  /** Fires when the ribbon has flowed off and the fur dust has faded. */
  onComplete?: () => void;
}

export function TailWhipSuccessTransition({
  visible,
  children,
  skipAnticipation,
  onReveal,
  onComplete,
}: TailWhipSuccessTransitionProps) {
  const { width: W, height: H } = useWindowDimensions();

  const sweep = useSharedValue(0);
  const [engaged, setEngaged] = useState(false);
  const [dust, setDust] = useState<FurDustSpec[] | null>(null);

  const startedRef = useRef(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const cbRef = useRef({ onReveal, onComplete });
  cbRef.current = { onReveal, onComplete };
  const dimsRef = useRef({ W, H });
  dimsRef.current = { W, H };

  const finish = useCallback(() => {
    setEngaged(false);
    cbRef.current.onComplete?.();
  }, []);

  useEffect(() => {
    if (!visible || startedRef.current) return;
    startedRef.current = true;
    setEngaged(true);
    const delay = skipAnticipation ? 0 : motion.tailWhip.anticipation;
    const dur = motion.tailWhip.sweep;
    sweep.value = withDelay(
      delay,
      withTiming(1, { duration: dur, easing: Easing.inOut(Easing.quad), reduceMotion: NEVER }),
    );
    // Soft "whoosh" haptic at the middle of the sweep.
    timersRef.current.push(setTimeout(() => haptic.soft(), delay + dur * 0.45));
    // The ribbon has mostly passed — reveal the content.
    timersRef.current.push(setTimeout(() => cbRef.current.onReveal?.(), delay + dur * 0.6));
    // Fur dust as the ribbon flows off.
    timersRef.current.push(
      setTimeout(() => {
        const d = dimsRef.current;
        setDust(makeFurDust(Math.floor(Math.random() * 1e9), d.W, d.H));
      }, delay + dur * 0.72),
    );
    // The whole thing is done a beat after the content has settled.
    timersRef.current.push(setTimeout(finish, delay + dur + 640));
  }, [visible, skipAnticipation, sweep, finish]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach(clearTimeout);
      cancelAnimation(sweep);
    };
  }, [sweep]);

  // ── Ribbon draw (strokeDashoffset flows LEN → -LEN) + soft crossfade ──
  const flow = (v: number) => {
    'worklet';
    const e = v * v * (3 - 2 * v); // smoothstep flow
    return LEN - 2 * LEN * e;
  };
  const mainProps = useAnimatedProps(() => ({ strokeDashoffset: flow(sweep.value) }));
  const haloProps = useAnimatedProps(() => ({ strokeDashoffset: flow(sweep.value) }));

  const childStyle = useAnimatedStyle(() => {
    const s = sweep.value;
    const o = Math.max(0, Math.min(1, (s - 0.4) / 0.24));
    return { opacity: o * o * (3 - 2 * o) };
  });

  const svgSize = useMemo(() => ({ width: W, height: H }), [W, H]);

  return (
    <View
      style={styles.root}
      pointerEvents={engaged ? 'auto' : 'none'}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* Success screen — crossfades in over the current screen the host
          rendered behind this transparent overlay. */}
      <Animated.View style={[StyleSheet.absoluteFill, childStyle]}>{children}</Animated.View>

      {/* The ribbon: a soft halo + the solid stroke, painted across. */}
      <Svg
        {...svgSize}
        viewBox={`0 0 ${RIBBON_VIEWBOX.w} ${RIBBON_VIEWBOX.h}`}
        preserveAspectRatio="none"
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      >
        <AnimatedPath
          d={D}
          fill="none"
          stroke={color.yellow}
          strokeOpacity={0.32}
          strokeWidth={RIBBON_STROKE + RIBBON_HALO}
          strokeLinecap="round"
          strokeDasharray={LEN}
          animatedProps={haloProps}
        />
        <AnimatedPath
          d={D}
          fill="none"
          stroke={color.yellow}
          strokeWidth={RIBBON_STROKE}
          strokeLinecap="round"
          strokeDasharray={LEN}
          animatedProps={mainProps}
        />
      </Svg>

      {dust?.map((spec, i) => <FurDustDot key={i} spec={spec} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
});
