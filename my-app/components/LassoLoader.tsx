/**
 * The lasso loader — the brand line travelling, for a wait worth dressing.
 *
 * Born on the creator-code screen, where redeeming a code is a short, real wait
 * that deserved more than a spinner. Lifted out so the end of a Trail walk can
 * use the same beat while the pack's memory is put together: one waiting
 * language across the app, not two that drift (see [[living-paw-motion-language]]
 * for the rule on spinners — ActivityIndicator is banned).
 *
 * Two pieces:
 *   - `LassoJourney`: the line itself. `working` loops a yellow dash along it;
 *     `complete` draws it once and lands a check at the end.
 *   - `LassoWorkingContent`: title, body, the line, and a status pill, laid out
 *     for a navy ground. The caller owns the ground and the chrome around it.
 */

import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  ZoomIn,
  cancelAnimation,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { MaterialIcons } from '@expo/vector-icons';

import { color, displayLine, font, motion, radius, space } from '../constants/design';
import { lassoPath } from './BrandLasso';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const LASSO_LENGTH = 430;
const LASSO_D = lassoPath(320, 120, 38);

export function LassoJourney({ mode }: { mode: 'working' | 'complete' }) {
  const reducedMotion = useReducedMotion();
  const dashOffset = useSharedValue(mode === 'complete' ? LASSO_LENGTH : 0);

  useEffect(() => {
    if (reducedMotion) {
      dashOffset.value = mode === 'complete' ? 0 : -145;
      return;
    }

    if (mode === 'complete') {
      dashOffset.value = withTiming(0, {
        duration: motion.duration.ring,
        easing: Easing.out(Easing.cubic),
      });
    } else {
      dashOffset.value = withRepeat(
        withTiming(-LASSO_LENGTH, { duration: 1450, easing: Easing.linear }),
        -1,
        false,
      );
    }
    return () => cancelAnimation(dashOffset);
  }, [dashOffset, mode, reducedMotion]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: dashOffset.value,
  }));

  return (
    <Animated.View
      entering={FadeIn.duration(motion.duration.base)}
      style={[styles.lassoStage, mode === 'complete' && styles.lassoStageComplete]}
    >
      <Svg width="100%" height="100%" viewBox="0 0 320 120">
        <Path
          d={LASSO_D}
          fill="none"
          stroke={color.yellow}
          strokeOpacity={mode === 'working' ? 0.14 : 0.18}
          strokeWidth={mode === 'working' ? 2 : 7}
          strokeLinecap="round"
        />
        <AnimatedPath
          animatedProps={animatedProps}
          d={LASSO_D}
          fill="none"
          stroke={color.yellow}
          strokeWidth={mode === 'complete' ? 5 : 6}
          strokeLinecap="round"
          strokeDasharray={mode === 'complete' ? `${LASSO_LENGTH} ${LASSO_LENGTH}` : '92 338'}
        />
      </Svg>
      {mode === 'complete' && (
        <Animated.View entering={ZoomIn.delay(650).duration(motion.duration.fast)} style={styles.lassoCheck}>
          <MaterialIcons name="check" size={16} color={color.navy} />
        </Animated.View>
      )}
    </Animated.View>
  );
}

/** Title, body, the travelling line and a status pill — on a navy ground. */
export function LassoWorkingContent({
  title,
  body,
  status,
}: {
  title: string;
  body: string;
  status: string;
}) {
  return (
    <View style={styles.workingContent} accessibilityLiveRegion="polite">
      <Animated.View
        entering={FadeInDown.duration(motion.duration.base).delay(80)}
        style={styles.intro}
      >
        <Text style={styles.workingTitle}>{title}</Text>
        <Text style={styles.workingBody}>{body}</Text>
        <LassoJourney mode="working" />
        <View style={styles.workingPill}>
          <View style={styles.workingPillDot} />
          <Text style={styles.workingPillText}>{status}</Text>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  workingContent: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: space.xxl,
    paddingBottom: 72,
  },
  intro: {
    width: '100%',
    alignItems: 'center',
  },
  workingTitle: {
    ...displayLine(38),
    textAlign: 'center',
    letterSpacing: 0.5,
    color: color.cream,
    marginBottom: space.md,
  },
  workingBody: {
    alignSelf: 'center',
    maxWidth: 310,
    fontFamily: font.regular,
    fontSize: 14.5,
    lineHeight: 22,
    textAlign: 'center',
    color: color.creamDim,
  },
  lassoStage: {
    position: 'relative',
    width: '100%',
    height: 150,
    alignSelf: 'center',
    marginTop: space.xxl,
  },
  lassoStageComplete: {
    height: 96,
    marginTop: 0,
    marginBottom: space.sm,
  },
  lassoCheck: {
    position: 'absolute',
    right: 0,
    top: 43,
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.cream,
    borderWidth: 3,
    borderColor: color.navy,
  },
  workingPill: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.xl,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    backgroundColor: color.yellowSoft,
  },
  workingPillDot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: color.yellow,
  },
  workingPillText: {
    fontFamily: font.semibold,
    fontSize: 12,
    color: color.cream,
  },
});
