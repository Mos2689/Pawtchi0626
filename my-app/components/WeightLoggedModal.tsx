import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, TouchableWithoutFeedback, Modal, StyleSheet,
  Dimensions, KeyboardAvoidingView, Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring,
} from 'react-native-reanimated';
import { color, font, radius, space, motion, makeShadow } from '../constants/design';
import { useActivePetStore } from '../store/useActivePetStore';
import { BreathingPaw } from './BreathingPaw';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// The weight-log moment. A branded success card that makes the recalibration
// legible: it shows what changed (weight + calorie target) and then narrates
// the plan rebuild happening in the background — a breathing paw while the
// work runs, a single settled heartbeat when it lands (Living Paw motion).
interface WeightLoggedModalProps {
  visible: boolean;
  onClose: () => void;
  petName: string;
  weight: number;
  /** new − previous weight (kg); null when there was no prior weight. */
  weightDiff: number | null;
  prevCalories: number;
  newCalories: number;
  /** new − previous kcal; null when unchanged / no prior target. */
  calorieDiff: number | null;
  goal: string;
  /** True when this log triggers an activity-schedule rebuild. */
  willRecalibrate: boolean;
  /** Progress toward the final ideal (0–100), when known. */
  progressPct?: number | null;
}

export function WeightLoggedModal({
  visible,
  onClose,
  petName,
  weight,
  weightDiff,
  prevCalories,
  newCalories,
  calorieDiff,
  goal,
  willRecalibrate,
  progressPct,
}: WeightLoggedModalProps) {
  const recalibrating = useActivePetStore((s) => s.recalibrating);

  // Card springs up from a slight scale so success reads as a "pop".
  const cardScale = useSharedValue(0.96);
  useEffect(() => {
    if (visible) {
      cardScale.value = 0.96;
      cardScale.value = withSpring(1, motion.spring.bouncy);
    }
  }, [visible, cardScale]);
  const cardAnimatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: cardScale.value }] }));

  // Latch "done" once the rebuild finishes so the settled line + heartbeat
  // stick even though the store flag is momentary. Reset on each open.
  const [settled, setSettled] = useState(false);
  const wasRecalibrating = useRef(false);
  useEffect(() => {
    if (!visible) return;
    // If recalibration already finished (or never needed), start settled.
    setSettled(!willRecalibrate || !recalibrating);
    wasRecalibrating.current = recalibrating;
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!visible || !willRecalibrate) return;
    if (wasRecalibrating.current && !recalibrating) setSettled(true);
    wasRecalibrating.current = recalibrating;
  }, [recalibrating, visible, willRecalibrate]);

  const prevWeight = weightDiff !== null ? weight - weightDiff : null;
  const showWeightDelta = weightDiff !== null && Math.abs(weightDiff) >= 0.1 && prevWeight !== null;
  const weightUp = (weightDiff ?? 0) > 0;
  const showKcalDelta = calorieDiff !== null && calorieDiff !== 0;
  const kcalUp = (calorieDiff ?? 0) > 0;

  // Direction language keyed to the goal, not the raw sign — for a "lose" plan a
  // drop is good news, for a "gain" plan a rise is.
  const weightHelper = goal === 'lose'
    ? (weightUp ? 'A small bump — the plan adjusts to keep the trend down.' : 'Trending down, right on plan.')
    : goal === 'gain'
      ? (weightUp ? 'Gaining steadily — nice work.' : 'A small dip — the plan nudges intake up.')
      : 'Holding steady — right where we want it.';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
          <TouchableWithoutFeedback onPress={() => {}}>
            <Animated.View style={[styles.container, cardAnimatedStyle]}>
              <View style={styles.glow} />
              <View style={styles.card}>
                {/* Header */}
                <View style={styles.header}>
                  <View style={styles.iconBox}>
                    <MaterialIcons name="monitor-weight" size={30} color={color.navy} />
                  </View>
                  <Text style={styles.title}>{weight} kg logged</Text>
                  <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <MaterialIcons name="close" size={20} color={color.slateFaint} />
                  </TouchableOpacity>
                </View>

                {/* Weight delta chip */}
                {showWeightDelta ? (
                  <View style={styles.deltaRow}>
                    <View style={styles.deltaChip}>
                      <Text style={styles.deltaFrom}>{prevWeight!.toFixed(1)}</Text>
                      <MaterialIcons name="arrow-right-alt" size={18} color={color.slateFaint} />
                      <Text style={styles.deltaTo}>{weight.toFixed(1)} kg</Text>
                      <MaterialIcons
                        name={weightUp ? 'north-east' : 'south-east'}
                        size={14}
                        color={weightUp ? color.alert : color.success}
                      />
                    </View>
                  </View>
                ) : (
                  <Text style={styles.recordedLine}>Recorded for {petName}.</Text>
                )}

                <Text style={styles.helper}>{weightHelper}</Text>

                {/* Kcal recalibration — the headline "what changed". */}
                {showKcalDelta ? (
                  <View style={styles.kcalBox}>
                    <Text style={styles.kcalLabel}>DAILY TARGET</Text>
                    <View style={styles.kcalValueRow}>
                      <Text style={styles.kcalPrev}>{prevCalories}</Text>
                      <MaterialIcons name="arrow-right-alt" size={20} color={color.creamFaint} />
                      <Text style={styles.kcalNew}>{newCalories}</Text>
                      <Text style={styles.kcalUnit}>kcal</Text>
                      <MaterialIcons
                        name={kcalUp ? 'trending-up' : 'trending-down'}
                        size={16}
                        color={color.yellow}
                      />
                    </View>
                  </View>
                ) : (
                  <View style={styles.kcalBox}>
                    <Text style={styles.kcalLabel}>DAILY TARGET</Text>
                    <View style={styles.kcalValueRow}>
                      <Text style={styles.kcalNew}>{newCalories}</Text>
                      <Text style={styles.kcalUnit}>kcal · unchanged</Text>
                    </View>
                  </View>
                )}

                {/* Live recalibration status */}
                {willRecalibrate ? (
                  <View style={styles.statusRow}>
                    <BreathingPaw settled={settled} />
                    <Text style={styles.statusText}>
                      {settled
                        ? `Plan updated — activities and calories tuned to ${weight} kg.`
                        : `Recalibrating ${petName}'s plan for the new weight…`}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.statusRow}>
                    <MaterialIcons name="check-circle" size={18} color={color.success} />
                    <Text style={styles.statusText}>{petName} is on track — no plan changes needed.</Text>
                  </View>
                )}

                {/* Milestone hint */}
                {progressPct != null && progressPct > 0 && (
                  <Text style={styles.milestoneHint}>
                    {progressPct}% of the way to {petName}&apos;s ideal weight
                  </Text>
                )}

                {/* Action */}
                <LinearGradient
                  colors={[color.yellow, '#fac129']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.actionBtnGradient}
                >
                  <TouchableOpacity style={styles.actionBtnTouchable} onPress={onClose} activeOpacity={0.85}>
                    <Text style={styles.actionBtnText}>Done</Text>
                  </TouchableOpacity>
                </LinearGradient>
              </View>
            </Animated.View>
          </TouchableWithoutFeedback>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  backdrop: {
    flex: 1,
    width: '100%',
    backgroundColor: 'rgba(4, 16, 21, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: space.xxl,
  },
  container: { width: SCREEN_WIDTH - 48, maxWidth: 380, position: 'relative' },
  glow: {
    position: 'absolute',
    top: -20, left: -20, right: -20, bottom: -20,
    backgroundColor: color.yellowSoft,
    borderRadius: 32,
    transform: [{ scale: 1.05 }],
  },
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.xxl + 4,
    padding: space.xxl + 4,
    ...makeShadow(0, 24, 0.3, color.yellow),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: space.lg,
  },
  iconBox: {
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    backgroundColor: color.yellowSoft,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontFamily: font.extrabold,
    fontSize: 21,
    color: color.navy,
    flex: 1,
  },
  closeBtn: { padding: 2 },
  deltaRow: {
    flexDirection: 'row',
    marginBottom: space.sm,
  },
  deltaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  deltaFrom: {
    fontFamily: font.semibold,
    fontSize: 15,
    color: color.slateFaint,
  },
  deltaTo: {
    fontFamily: font.bold,
    fontSize: 15,
    color: color.ink,
  },
  recordedLine: {
    fontFamily: font.regular,
    fontSize: 14.5,
    color: color.slate,
    marginBottom: space.sm,
  },
  helper: {
    fontFamily: font.medium,
    fontSize: 13,
    lineHeight: 19,
    color: color.slateMuted,
    marginBottom: space.lg,
  },
  kcalBox: {
    backgroundColor: color.navy,
    borderRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    gap: 6,
    marginBottom: space.lg,
  },
  kcalLabel: {
    fontFamily: font.semibold,
    fontSize: 10,
    letterSpacing: 1.6,
    color: color.creamFaint,
  },
  kcalValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  kcalPrev: {
    fontFamily: font.semibold,
    fontSize: 18,
    color: color.creamDim,
    textDecorationLine: 'line-through',
  },
  kcalNew: {
    fontFamily: font.extrabold,
    fontSize: 22,
    color: color.yellow,
  },
  kcalUnit: {
    fontFamily: font.medium,
    fontSize: 13,
    color: color.creamDim,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: space.md,
  },
  statusText: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 13,
    lineHeight: 18,
    color: color.slate,
  },
  milestoneHint: {
    fontFamily: font.semibold,
    fontSize: 12.5,
    color: color.slateMuted,
    marginBottom: space.md,
  },
  actionBtnGradient: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginTop: space.xs,
  },
  actionBtnTouchable: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnText: {
    fontFamily: font.extrabold,
    fontSize: 15,
    color: color.navy,
  },
});
