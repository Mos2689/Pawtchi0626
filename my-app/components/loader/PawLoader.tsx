import React, { useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
  Easing,
  SharedValue,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { color, font } from '../../constants/design';
import { MOMENT_COUNT, PAW_REST, evalMoment, lerp } from '../../lib/loaderTimeline';

// ─────────────────────────────────────────────────────────────────────────────
// Pawtchi's one and only loader.
//
// Contract:
//   visible=true  → Modal appears immediately, paw starts moving
//   visible=false → Modal unmounts immediately, next frame the caller's
//                   content is on screen. Zero delay, zero ceremony.
//
// Safety valve (Layer 1):
//   After `timeoutMs` (default 30s), a "Taking longer than expected" message
//   appears with a Dismiss button. The user is NEVER permanently locked out,
//   regardless of what happens upstream.
//
// Visual: solid opaque white, five navy paw dots. That's it.
// The pose math lives in lib/loaderTimeline.ts (pure, unit-tested).
// ─────────────────────────────────────────────────────────────────────────────

const PAW_SIZE = 180;
const START_OFFSET = 3000;
const TEMPO = 1.5;

function Moment({
  index,
  clock,
  seed,
}: {
  index: number;
  clock: SharedValue<number>;
  seed: number;
}) {
  const rest = PAW_REST[index];
  const unit = PAW_SIZE / 100;
  const dotSize = rest.r * 2 * unit;

  const style = useAnimatedStyle(() => {
    const pose = evalMoment(START_OFFSET + clock.value * TEMPO, index, seed, 'generic');
    return {
      opacity: pose.opacity,
      transform: [
        { translateX: (pose.x - 50) * unit },
        { translateY: (pose.y - 50) * unit },
        { scaleX: pose.scaleX },
        { scaleY: pose.scaleY },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        styles.moment,
        { width: dotSize, height: dotSize, marginLeft: -dotSize / 2, marginTop: -dotSize / 2 },
        style,
      ]}
    >
      <View style={[styles.pad, { width: dotSize, height: dotSize }]} />
    </Animated.View>
  );
}

export function PawLoader({
  visible,
  message = 'Loading\u2026',
  timeoutMs = 30000,
  onTimeout,
}: {
  visible?: boolean;
  message?: string | string[];
  timeoutMs?: number;
  onTimeout?: () => void;
}) {
  const clock = useSharedValue(0);
  const seed = useRef(((Date.now() % 100000) | 0) + 1).current;

  const [messageIndex, setMessageIndex] = useState(0);

  // Escape-hatch state
  const [showEscape, setShowEscape] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Reset escape/dismiss and message index when visibility changes
  useEffect(() => {
    setShowEscape(false);
    setDismissed(false);
    setMessageIndex(0);
  }, [visible]);

  // Cycle messages if an array is provided
  useEffect(() => {
    if (!visible || !Array.isArray(message) || message.length <= 1) return;
    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % message.length);
    }, 2500); // 2.5 seconds per message
    return () => clearInterval(interval);
  }, [visible, message]);

  // Start the paw animation
  useEffect(() => {
    if (!visible) return;
    clock.value = 0;
    clock.value = withTiming(600000, { duration: 600000, easing: Easing.linear });
    return () => cancelAnimation(clock);
  }, [visible]);

  // Timeout → show escape hatch
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      setShowEscape(true);
      onTimeout?.();
    }, timeoutMs);
    return () => clearTimeout(timer);
  }, [visible, timeoutMs]);

  if (!visible || dismissed) return null;

  return (
    <Modal transparent visible statusBarTranslucent animationType="none" onRequestClose={() => {}}>
      <View style={styles.overlay}>
        <View style={styles.pawWrap}>
          <View style={styles.centerAnchor}>
            {Array.from({ length: MOMENT_COUNT }, (_, i) => (
              <Moment key={i} index={i} clock={clock} seed={seed} />
            ))}
          </View>
        </View>

        <Text style={styles.loadingText}>
          {Array.isArray(message) ? message[messageIndex] : message}
        </Text>

        {showEscape && (
          <View style={styles.escapeContainer}>
            <Text style={styles.escapeText}>Taking longer than expected…</Text>
            <TouchableOpacity
              style={styles.escapeButton}
              onPress={() => setDismissed(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.escapeButtonText}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

// `lerp` is re-exported from loaderTimeline for the Moment worklet — silence
// the unused-import warning without altering the barrel.
void lerp;

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pawWrap: { width: PAW_SIZE, height: PAW_SIZE },
  centerAnchor: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 0,
    height: 0,
  },
  moment: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  pad: { borderRadius: 999, backgroundColor: color.navy },
  loadingText: {
    marginTop: 24,
    fontFamily: font.medium,
    fontSize: 15,
    color: color.slateMuted,
    letterSpacing: 0.3,
  },
  // ── Escape hatch ──
  escapeContainer: {
    position: 'absolute',
    bottom: 120,
    alignItems: 'center',
    gap: 16,
  },
  escapeText: {
    fontFamily: font.medium,
    fontSize: 14,
    color: color.slateMuted,
    textAlign: 'center',
  },
  escapeButton: {
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: color.navy,
  },
  escapeButtonText: {
    fontFamily: font.bold,
    fontSize: 14,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
});
