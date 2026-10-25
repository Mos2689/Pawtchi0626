/**
 * SignupRouteProgress — the sign-up progress bar, drawn as a little walk.
 *
 * A dotted route from left to right; the walked part fills in brand yellow and
 * an electric-blue marker (the sanctioned exception, see constants/design.ts)
 * walks toward a home pin as each question is answered. One animated number
 * drives both, so the line and the marker can never disagree.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, G, Path } from 'react-native-svg';

import { color } from '../../constants/design';
import { pointAlong, sampleRoute } from '../../lib/signup/routeGeometry';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const HEIGHT = 26;
const HOME_R = 10;
const MARKER_R = 9;
/** Room on the right for the home pin, so the route ends at its edge. */
const HOME_GAP = HOME_R * 2 + 6;

interface Props {
  /** 0–1. */
  progress: number;
}

export function SignupRouteProgress({ progress }: Props) {
  const [width, setWidth] = useState(0);
  const reduceMotion = useReducedMotion();
  const value = useSharedValue(progress);

  const routeWidth = Math.max(0, width - HOME_GAP);
  const route = useMemo(() => sampleRoute(routeWidth || 1, HEIGHT, MARKER_R + 1), [routeWidth]);

  useEffect(() => {
    value.value = reduceMotion
      ? progress
      : withTiming(progress, { duration: 600, easing: Easing.bezier(0.23, 1, 0.32, 1) });
  }, [progress, reduceMotion, value]);

  const { xs, ys, lengths, total } = route;
  const fillProps = useAnimatedProps(() => ({
    strokeDashoffset: total * (1 - value.value),
  }));
  const markerOuter = useAnimatedProps(() => {
    const p = pointAlong(xs, ys, lengths, value.value);
    return { cx: p.x, cy: p.y };
  });
  const markerInner = useAnimatedProps(() => {
    const p = pointAlong(xs, ys, lengths, value.value);
    return { cx: p.x, cy: p.y };
  });

  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));

  return (
    <View
      style={styles.wrap}
      onLayout={onLayout}
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
    >
      {width > 0 && (
        <Svg width={width} height={HEIGHT}>
          <Path
            d={route.d}
            stroke={color.track}
            strokeWidth={5}
            strokeLinecap="round"
            strokeDasharray="1 9"
            fill="none"
          />
          <AnimatedPath
            d={route.d}
            stroke={color.yellow}
            strokeWidth={5}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${total} ${total}`}
            animatedProps={fillProps}
          />
          <G>
            <Circle cx={width - HOME_R} cy={HEIGHT / 2} r={HOME_R} fill={color.electricSoft} />
            <Path
              d={`M ${width - HOME_R - 5} ${HEIGHT / 2 + 1} L ${width - HOME_R} ${HEIGHT / 2 - 4} L ${width - HOME_R + 5} ${HEIGHT / 2 + 1} M ${width - HOME_R - 3.5} ${HEIGHT / 2} V ${HEIGHT / 2 + 5} H ${width - HOME_R + 3.5} V ${HEIGHT / 2}`}
              stroke={color.electric}
              strokeWidth={1.6}
              strokeLinejoin="round"
              fill="none"
            />
          </G>
          <AnimatedCircle r={MARKER_R} fill={color.electric} animatedProps={markerOuter} />
          <AnimatedCircle r={3.2} fill={color.yellow} animatedProps={markerInner} />
        </Svg>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, height: HEIGHT },
});
