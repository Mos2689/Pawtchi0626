/**
 * MapSkeleton — what Home shows while it works out where to put the camera.
 *
 * The wait is not the map drawing itself; it is the round trip that finds a
 * coordinate to point at. Until that returns there is nothing to frame, so the
 * screen used to sit on a flat warm rectangle that read as "empty" rather than
 * "coming".
 *
 * Deliberately map-shaped rather than a spinner. Two reasons: the brand's
 * motion language bans ActivityIndicator and asks for breathing while working,
 * and a skeleton that already has the silhouette of streets makes the real
 * tiles feel like they *resolved* rather than replaced something. The shapes
 * are abstract on purpose — inventing a plausible street layout would be a
 * small lie about a place we have not loaded yet.
 */

import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import Reanimated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { color } from '../../constants/design';

/** Slow enough to read as breathing rather than blinking. */
const BREATH_MS = 1600;

export function MapSkeleton() {
  const reducedMotion = useReducedMotion();
  const breath = useSharedValue(1);

  useEffect(() => {
    if (reducedMotion) return;
    breath.value = withRepeat(
      withSequence(
        withTiming(0.55, { duration: BREATH_MS / 2, easing: Easing.inOut(Easing.sin) }),
        withTiming(1, { duration: BREATH_MS / 2, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(breath);
  }, [reducedMotion, breath]);

  const breathStyle = useAnimatedStyle(() => ({ opacity: breath.value }));

  return (
    <View style={styles.root} pointerEvents="none">
      <Reanimated.View style={[StyleSheet.absoluteFill, breathStyle]}>
        <Svg width="100%" height="100%" viewBox="0 0 390 800" preserveAspectRatio="xMidYMid slice">
          <Rect width="390" height="800" fill={color.surfaceSubtle} />

          {/* Roads — the shapes a map has, without claiming to be one. */}
          <Path d="M-20 220 q160 -26 430 8" stroke={color.surface} strokeWidth={26} fill="none" />
          <Path d="M-20 470 q150 -22 430 10" stroke={color.surface} strokeWidth={20} fill="none" />
          <Path d="M120 -20 q-16 400 6 840" stroke={color.surface} strokeWidth={28} fill="none" />
          <Path d="M280 -20 q16 400 -6 840" stroke={color.surface} strokeWidth={18} fill="none" />

          {/* Blocks and a green — mass, so the skeleton has depth. */}
          <Rect x="40" y="270" width="60" height="150" rx="10" fill={color.hairline} />
          <Rect x="170" y="280" width="82" height="120" rx="10" fill={color.hairline} />
          <Rect x="40" y="520" width="120" height="130" rx="10" fill={color.hairline} />
          <Rect x="220" y="510" width="130" height="160" rx="10" fill={color.hairline} />
        </Svg>
      </Reanimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: color.surfaceSubtle,
  },
});
