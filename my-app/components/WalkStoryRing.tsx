/**
 * WalkStoryRing — the Home avatar as the app's daily engine.
 *
 * Two modes:
 *   • story — a walk from the last 24h has a story waiting. A bright gradient
 *     ring rotates around the avatar (the universal "story here" cue) and stays
 *     lit for the whole window, viewed or not. Tapping opens the story.
 *   • nudge — no recent walk. A calm dashed ring breathes around the avatar, an
 *     empty frame asking to be filled; tapping starts a walk.
 *
 * A white gap sits between ring and photo (Instagram-style). Resting look for a
 * cat / disabled feature is the plain avatar the caller renders instead.
 */

import React, { useEffect } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import Reanimated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { color } from '../constants/design';
import { haptic } from '../lib/haptics';

const SPIN_MS = 2600;
const BREATHE_MS = 2200;
const GAP = 3; // white gap between the ring and the photo

export type WalkStoryRingMode = 'story' | 'nudge';

interface WalkStoryRingProps {
  imageUri: string;
  mode: WalkStoryRingMode;
  onPress?: () => void;
  size?: number;
  petName?: string | null;
}

export function WalkStoryRing({ imageUri, mode, onPress, size = 40, petName }: WalkStoryRingProps) {
  const spin = useSharedValue(0);
  const breathe = useSharedValue(1);

  useEffect(() => {
    if (mode === 'story') {
      breathe.value = 1;
      cancelAnimation(breathe);
      spin.value = withRepeat(withTiming(1, { duration: SPIN_MS, easing: Easing.linear }), -1, false);
      return () => cancelAnimation(spin);
    }
    // nudge — a slow breath on the empty ring, inviting a tap.
    cancelAnimation(spin);
    spin.value = 0;
    breathe.value = withRepeat(
      withSequence(
        withTiming(0.5, { duration: BREATHE_MS / 2, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: BREATHE_MS / 2, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(breathe);
  }, [mode, spin, breathe]);

  const spinStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }] }));
  const breatheStyle = useAnimatedStyle(() => ({ opacity: breathe.value }));

  const ring = size + GAP * 2 + 6;
  const r = (ring - 5) / 2; // leave room for the thickest stroke, no clipping
  const c = ring / 2;
  const dimension = { width: size, height: size, borderRadius: size / 2 };

  const inner = (
    <View style={{ width: ring, height: ring, alignItems: 'center', justifyContent: 'center' }}>
      {mode === 'story' ? (
        <Reanimated.View style={[StyleSheet.absoluteFill, spinStyle]}>
          <Svg width={ring} height={ring}>
            <Defs>
              {/* A warm→cool sweep that rotates round-robin — vivid on the white
                  header where a flat yellow ring disappears. All design tokens. */}
              <LinearGradient id="storyRing" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={color.yellow} />
                <Stop offset="0.28" stopColor={color.viz.amber} />
                <Stop offset="0.52" stopColor={color.viz.calories} />
                <Stop offset="0.78" stopColor={color.viz.purple} />
                <Stop offset="1" stopColor={color.viz.hydrate} />
              </LinearGradient>
            </Defs>
            <Circle cx={c} cy={c} r={r} stroke="url(#storyRing)" strokeWidth={3.5} strokeLinecap="round" fill="none" />
          </Svg>
        </Reanimated.View>
      ) : (
        <Reanimated.View style={[StyleSheet.absoluteFill, breatheStyle]}>
          <Svg width={ring} height={ring}>
            <Circle
              cx={c}
              cy={c}
              r={r}
              stroke={color.viz.amber}
              strokeOpacity={0.9}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeDasharray="3 5"
              fill="none"
            />
          </Svg>
        </Reanimated.View>
      )}
      {/* White gap + the photo. */}
      <View style={[dimension, styles.photoWrap]}>
        <Image
          source={{ uri: imageUri }}
          style={styles.img}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={200}
        />
      </View>
    </View>
  );

  if (!onPress) return inner;

  const label =
    mode === 'story'
      ? `See ${petName ? `${petName}'s` : 'your'} walk story`
      : `Take a walk with ${petName ?? 'your dog'} to start a story`;

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {inner}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  photoWrap: {
    overflow: 'hidden',
    borderWidth: GAP,
    borderColor: color.surface,
  },
  img: {
    width: '100%',
    height: '100%',
  },
});
