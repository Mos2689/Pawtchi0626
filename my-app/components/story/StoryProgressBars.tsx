/** One quiet segment per generated beat. */

import React from 'react';
import { StyleSheet, View } from 'react-native';

interface StoryProgressBarsProps {
  count: number;
  index: number;
  /** Fill of the active bar, 0–1. */
  progress: number;
  inkColor: string;
  trackColor: string;
}

export function StoryProgressBars({
  count,
  index,
  progress,
  inkColor,
  trackColor,
}: StoryProgressBarsProps) {
  return (
    <View style={styles.row} accessibilityRole="progressbar">
      {Array.from({ length: count }).map((_, barIndex) => {
        const fill =
          barIndex < index
            ? 1
            : barIndex === index
              ? Math.min(1, Math.max(0, progress))
              : 0;
        return (
          <View key={barIndex} style={[styles.track, { backgroundColor: trackColor }]}>
            <View
              style={[
                styles.fill,
                { width: `${fill * 100}%`, backgroundColor: inkColor },
              ]}
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 5,
    alignSelf: 'stretch',
  },
  track: {
    flex: 1,
    height: 2.5,
    borderRadius: 99,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 99,
  },
});

