import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import Reanimated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInUp,
  FadeOut,
  FadeOutDown,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  withRepeat,
} from 'react-native-reanimated';
import { color, font, motion, radius, shadow, space, type } from '../../constants/design';
import { routeProgressPresentation } from '../../lib/walk/routeProgress';

/** Camera breathing room while this card occupies the lower map. */
export const ROUTE_PROGRESS_MAP_INSET = 140;

type RouteProgressCardProps = {
  destinationName: string;
  distanceLabel?: string | null;
  etaLabel?: string | null;
  ready: boolean;
  bottom: number;
};

const DOTS = [0, 1, 2, 3, 4];

export function RouteProgressCard({
  destinationName,
  distanceLabel,
  etaLabel,
  ready,
  bottom,
}: RouteProgressCardProps) {
  const reducedMotion = useReducedMotion();
  const journey = useSharedValue(0);
  const [trackWidth, setTrackWidth] = useState(0);
  const [barWidth, setBarWidth] = useState(0);
  const presentation = routeProgressPresentation({
    ready,
    destinationName,
    distanceLabel,
    etaLabel,
  });

  useEffect(() => {
    cancelAnimation(journey);

    if (reducedMotion) {
      journey.value = ready ? 1 : 0.5;
      return;
    }

    if (ready) {
      journey.value = withTiming(1, {
        duration: motion.route.resolve,
        easing: Easing.out(Easing.cubic),
      });
      return;
    }

    journey.value = 0;
    journey.value = withRepeat(
      withTiming(1, {
        duration: motion.route.travelCycle,
        easing: Easing.linear,
      }),
      -1,
      false,
    );

    return () => cancelAnimation(journey);
  }, [journey, ready, reducedMotion]);

  const travelerStyle = useAnimatedStyle(() => {
    const distance = Math.max(0, trackWidth - 20);
    const opacity = ready
      ? 1
      : interpolate(journey.value, [0, 0.08, 0.9, 1], [0, 1, 1, 0]);
    const scale = ready
      ? 1
      : interpolate(journey.value, [0, 0.5, 1], [0.9, 1, 0.9]);
    return {
      opacity,
      transform: [{ translateX: journey.value * distance }, { scale }],
    };
  });

  const destinationStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale: interpolate(journey.value, [0, 0.82, 1], [1, 1, ready ? 1.1 : 1.04]),
      },
    ],
  }));

  const sweepStyle = useAnimatedStyle(() => ({
    opacity: interpolate(journey.value, [0, 0.08, 0.9, 1], [0, 1, 1, 0]),
    transform: [{ translateX: journey.value * Math.max(0, barWidth * 0.68) }],
  }));

  const onTrackLayout = (event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  };
  const onBarLayout = (event: LayoutChangeEvent) => {
    setBarWidth(event.nativeEvent.layout.width);
  };

  const entering = reducedMotion
    ? FadeIn.duration(motion.duration.fast)
    : FadeInUp.duration(motion.duration.base).easing(Easing.out(Easing.cubic));
  const exiting = reducedMotion
    ? FadeOut.duration(motion.duration.instant)
    : FadeOutDown.duration(motion.duration.fast).easing(Easing.out(Easing.cubic));

  return (
    <Reanimated.View
      entering={entering}
      exiting={exiting}
      pointerEvents="none"
      accessibilityRole="progressbar"
      accessibilityLiveRegion="polite"
      accessibilityLabel={presentation.accessibilityLabel}
      style={[styles.card, { bottom }]}
    >
      <View style={styles.journeyRow}>
        <View style={styles.endpoint}>
          <View style={styles.youDotHalo}>
            <View style={styles.youDot} />
          </View>
          <Text style={styles.endpointLabel}>You</Text>
        </View>

        <View style={styles.track} onLayout={onTrackLayout}>
          <View style={styles.dotRow}>
            {DOTS.map(dot => <View key={dot} style={styles.routeDot} />)}
          </View>
          <Reanimated.View style={[styles.traveler, travelerStyle]}>
            <MaterialIcons name="pets" size={18} color={color.electric} />
          </Reanimated.View>
        </View>

        <View style={styles.endpoint}>
          <Reanimated.View style={destinationStyle}>
            <MaterialIcons
              name={ready ? 'check-circle' : 'location-on'}
              size={29}
              color={ready ? color.success : color.yellow}
            />
          </Reanimated.View>
          <Text style={styles.endpointLabel} numberOfLines={1}>{destinationName}</Text>
        </View>
      </View>

      <Reanimated.Text
        key={presentation.title}
        entering={FadeInDown.duration(motion.duration.fast)}
        style={styles.title}
      >
        {presentation.title}
      </Reanimated.Text>
      <Reanimated.Text
        key={presentation.subtitle}
        entering={FadeInDown.duration(motion.duration.fast)}
        style={styles.subtitle}
        numberOfLines={1}
      >
        {presentation.subtitle}
      </Reanimated.Text>

      <View style={styles.progressTrack} onLayout={onBarLayout}>
        {ready ? (
          <Reanimated.View
            entering={FadeIn.duration(motion.route.resolve)}
            style={styles.progressReady}
          />
        ) : (
          <Reanimated.View style={[styles.progressSweep, sweepStyle]} />
        )}
      </View>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: space.xxl,
    right: space.xxl,
    minHeight: 130,
    backgroundColor: color.surface,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.hairline,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.md,
    ...shadow.raised,
  },
  journeyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: space.sm,
  },
  endpoint: {
    width: 72,
    alignItems: 'center',
    gap: 2,
  },
  endpointLabel: {
    fontFamily: font.semibold,
    fontSize: 11.5,
    lineHeight: 14,
    color: color.slateMuted,
    maxWidth: 72,
  },
  youDotHalo: {
    width: 29,
    height: 29,
    borderRadius: radius.pill,
    backgroundColor: color.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  youDot: {
    width: 14,
    height: 14,
    borderRadius: radius.pill,
    backgroundColor: color.navy,
  },
  track: {
    flex: 1,
    height: 30,
    justifyContent: 'center',
  },
  dotRow: {
    position: 'absolute',
    left: 5,
    right: 5,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  routeDot: {
    width: 5,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: color.electric,
    opacity: 0.46,
  },
  traveler: {
    position: 'absolute',
    left: 0,
    top: 5,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface,
    borderRadius: radius.pill,
  },
  title: {
    ...type.heading,
    color: color.navy,
    textAlign: 'center',
  },
  subtitle: {
    ...type.label,
    color: color.slateMuted,
    textAlign: 'center',
    marginTop: 1,
  },
  progressTrack: {
    height: 4,
    overflow: 'hidden',
    borderRadius: radius.pill,
    backgroundColor: color.track,
    marginTop: space.sm,
  },
  progressSweep: {
    width: '32%',
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: color.electric,
  },
  progressReady: {
    width: '100%',
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: color.success,
  },
});
