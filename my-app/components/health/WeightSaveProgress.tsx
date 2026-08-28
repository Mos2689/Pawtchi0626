/**
 * WeightSaveProgress — what the app is actually doing while a weigh-in saves.
 *
 * A weigh-in is three pieces of work, not one, and the last of them rebuilds a
 * week of activities through an AI-backed edge function. With a single spinner
 * on the Save button, that wait looked like the cost of writing one number, and
 * people reasonably concluded the app had hung.
 *
 * So this names the work instead. Every line corresponds to a real await in
 * recordWeightMeasurement and appears when that step genuinely begins — the
 * same rule the Spots loader follows. No fake steps, and no progress bar:
 * the schedule rebuild is an LLM call whose duration is not knowable, and a bar
 * that stalls at 90% is worse than no bar.
 *
 * The active line breathes (Living Paw motion language); finished lines settle
 * to a check. Completed steps stay on screen rather than disappearing, because
 * "weigh-in saved" is exactly the reassurance someone needs while the slow step
 * is still running.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { color, font, motion, space } from '../../constants/design';
import { BreathingPaw } from '../BreathingPaw';
import {
  STAGE_DONE_LABEL,
  STAGE_LABEL,
  stageState,
  visibleStages,
  type WeightSaveStage,
} from '../../lib/weightSaveStages';

interface WeightSaveProgressProps {
  /** Null before the save starts; the running stage while it does. */
  stage: WeightSaveStage | null;
}

export function WeightSaveProgress({ stage }: WeightSaveProgressProps) {
  if (!stage) return null;

  return (
    <View style={styles.wrap} accessibilityLiveRegion="polite">
      {visibleStages(stage).map((s, i) => {
        const state = stageState(s, stage);
        const done = state === 'done';
        return (
          <Animated.View
            key={s}
            entering={FadeInDown.duration(motion.duration.base).delay(i * 40)}
            style={styles.row}
          >
            <View style={styles.marker}>
              {done ? (
                <MaterialIcons name="check-circle" size={16} color={color.success} />
              ) : state === 'active' ? (
                <BreathingPaw size={16} workingColor={color.navy} />
              ) : (
                <View style={styles.pendingDot} />
              )}
            </View>
            <Text
              style={[
                styles.label,
                done && styles.labelDone,
                state === 'pending' && styles.labelPending,
              ]}
              numberOfLines={1}
            >
              {done ? STAGE_DONE_LABEL[s] : STAGE_LABEL[s]}
            </Text>
          </Animated.View>
        );
      })}

      {/* Only shown for the step that is genuinely slow, and only while it is
          the one running — it is the answer to "why is this taking so long". */}
      {stage === 'rebuilding' && (
        <Text style={styles.note}>
          This part takes a few seconds — the whole week gets redrawn.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space.sm,
    paddingVertical: space.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  marker: {
    width: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: color.hairline,
  },
  label: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 13.5,
    color: color.ink,
  },
  labelDone: {
    color: color.slateMuted,
  },
  labelPending: {
    color: color.slateFaint,
  },
  note: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 17,
    color: color.slateMuted,
    marginLeft: 18 + space.sm,
  },
});
