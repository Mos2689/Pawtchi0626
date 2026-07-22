import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableWithoutFeedback, TouchableOpacity, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { color, font, radius, space, motion } from '../constants/design';
import { PawtchiButton } from './PawtchiButton';
import { BodyShapeIcon } from './icons/BodyShapeIcon';
import { BCS_OPTIONS } from '../lib/bcsOptions';
import { haptic } from '../lib/haptics';

export type RescoreTrigger = 'stage_reached' | 'final_reached' | 'bcs_stale';

interface Props {
  visible: boolean;
  petName: string;
  species: 'dog' | 'cat';
  /** Why the sheet opened — drives the header tone. */
  trigger: RescoreTrigger;
  /** 0–100 toward the final ideal; shown on milestone triggers. */
  progressPct: number | null;
  /**
   * Owner picked a silhouette. The caller applies the re-score (new target,
   * calories, schedule) — this sheet is presentational only.
   */
  onSelect: (bcs: number) => void;
  /** Owner skipped — the caller advances using the drift-predicted BCS. */
  onDismiss: () => void;
}

/**
 * The recheck moment of the weight program: celebrate the milestone (when
 * there is one), then ask for a 10-second body-shape re-pick — the same
 * re-assessment a vet performs at every weight-management recheck. Skipping
 * is allowed; the plan advances on the predicted score instead of stalling.
 */
export function BcsRescoreSheet({
  visible, petName, species, trigger, progressPct, onSelect, onDismiss,
}: Props) {
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    if (visible) {
      setSelected(null);
      if (trigger === 'bcs_stale') haptic.select();
      else haptic.success();
    }
  }, [visible, trigger]);

  const header = trigger === 'final_reached'
    ? `${petName} reached the healthy target! 🎉`
    : trigger === 'stage_reached'
      ? `Milestone reached${progressPct != null ? ` — ${progressPct}% of the way` : ''}!`
      : 'Quick body check';

  const sub = trigger === 'bcs_stale'
    ? `It's been a while since ${petName}'s shape was updated. A quick re-check keeps the plan honest.`
    : `Time for the same re-check a vet would do: which shape looks most like ${petName} now?`;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <TouchableWithoutFeedback onPress={onDismiss}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.xl }]}>
          <View style={styles.grabber} />

          <Animated.View entering={FadeInDown.duration(motion.duration.base)}>
            <Text style={styles.title}>{header}</Text>
            <Text style={styles.body}>{sub}</Text>
          </Animated.View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionsRow}>
            {BCS_OPTIONS.map((opt) => {
              const isSelected = selected === opt.bcs;
              return (
                <TouchableOpacity
                  key={opt.bcs}
                  activeOpacity={0.7}
                  style={[styles.optionCard, isSelected && styles.optionCardSelected]}
                  onPress={() => {
                    haptic.select();
                    setSelected(opt.bcs);
                  }}
                >
                  <BodyShapeIcon
                    shape={opt.shape}
                    species={species}
                    size={56}
                    color={isSelected ? color.navy : color.slateFaint}
                  />
                  <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View style={styles.actions}>
            <PawtchiButton
              title="Update the plan"
              variant="primary"
              disabled={selected == null}
              onPress={() => {
                if (selected != null) onSelect(selected);
              }}
            />
            <TouchableOpacity activeOpacity={0.7} onPress={onDismiss} style={styles.skipBtn}>
              <Text style={styles.skipText}>Skip for now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(11, 42, 54, 0.45)',
  },
  sheet: {
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingHorizontal: space.xxl,
    paddingTop: space.md,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: color.track,
    marginBottom: space.lg,
  },
  title: {
    fontFamily: font.display,
    fontSize: 24,
    lineHeight: 28,
    color: color.ink,
    marginBottom: space.sm,
  },
  body: {
    fontFamily: font.regular,
    fontSize: 14,
    lineHeight: 20,
    color: color.slateMuted,
    marginBottom: space.lg,
  },
  optionsRow: {
    gap: 10,
    paddingVertical: space.sm,
    paddingHorizontal: 2,
  },
  optionCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    gap: space.sm,
    minWidth: 100,
    backgroundColor: color.surfaceSubtle,
    borderWidth: 1,
    borderColor: color.hairline,
  },
  optionCardSelected: {
    backgroundColor: color.surface,
    borderColor: color.yellow,
    borderWidth: 2,
  },
  optionText: {
    fontFamily: font.bold,
    fontSize: 11.5,
    textAlign: 'center',
    color: color.slateMuted,
  },
  optionTextSelected: { color: color.ink },
  actions: {
    marginTop: space.lg,
    gap: space.md,
  },
  skipBtn: {
    alignSelf: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  skipText: {
    fontFamily: font.semibold,
    fontSize: 13,
    color: color.slateMuted,
    textDecorationLine: 'underline',
  },
});
