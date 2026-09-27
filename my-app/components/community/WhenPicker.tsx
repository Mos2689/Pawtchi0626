/**
 * WhenPicker — a day and a time, as two compact pills, on both platforms.
 *
 * ── Why Android needed its own path ─────────────────────────────────────────
 *
 * iOS's `display="compact"` DateTimePicker is an inline control: a grey pill
 * that opens a small popover when tapped. Android has no such thing — its
 * `<DateTimePicker>` IS a dialog, shown the moment the component mounts. The
 * meetup screens rendered two of them side by side, so on Android opening the
 * date row threw a date dialog AND a clock dialog on screen at once, stacked,
 * and re-opened them on re-renders (device report, 2026-09-26).
 *
 * On Android this draws the same two pills iOS shows and opens the native
 * dialog imperatively (`DateTimePickerAndroid.open`) only when one is tapped —
 * one dialog, when asked for, closed by its own OK or Cancel.
 */

import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';

import { color, font, radius, space } from '../../constants/design';
import { dateFormat } from '../../lib/dateFormats';

interface WhenPickerProps {
  value: Date;
  onChange: (next: Date) => void;
  /** Earliest day that can be picked. Time is not clamped — see below. */
  minimumDate?: Date;
  /** Placement — each screen keeps the spacing it already had. */
  style?: StyleProp<ViewStyle>;
}

/** Keep the chosen day, take the time from `time`. */
function withTime(day: Date, time: Date): Date {
  const next = new Date(day);
  next.setHours(time.getHours(), time.getMinutes(), 0, 0);
  return next;
}

/** Keep the chosen time, take the day from `day`. */
function withDay(current: Date, day: Date): Date {
  const next = new Date(day);
  next.setHours(current.getHours(), current.getMinutes(), 0, 0);
  return next;
}

export function WhenPicker({ value, onChange, minimumDate, style }: WhenPickerProps) {
  if (Platform.OS === 'ios') {
    return (
      <View style={[styles.row, style]}>
        <DateTimePicker
          value={value}
          mode="date"
          minimumDate={minimumDate}
          display="compact"
          onChange={(_, picked) => picked && onChange(withDay(value, picked))}
        />
        <DateTimePicker
          value={value}
          mode="time"
          display="compact"
          onChange={(_, picked) => picked && onChange(withTime(value, picked))}
        />
      </View>
    );
  }

  const openDate = () => {
    DateTimePickerAndroid.open({
      value,
      mode: 'date',
      minimumDate,
      onChange: (event, picked) => {
        if (event.type === 'set' && picked) onChange(withDay(value, picked));
      },
    });
  };
  const openTime = () => {
    DateTimePickerAndroid.open({
      value,
      mode: 'time',
      onChange: (event, picked) => {
        if (event.type === 'set' && picked) onChange(withTime(value, picked));
      },
    });
  };

  const dayLabel = dateFormat({ weekday: 'short', day: 'numeric', month: 'short' }).format(value);
  const timeLabel = dateFormat({ hour: 'numeric', minute: '2-digit' }).format(value);

  return (
    <View style={[styles.row, style]}>
      <Pressable
        onPress={openDate}
        style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`Date, ${dayLabel}. Change date`}
      >
        <Ionicons name="calendar-outline" size={16} color={color.navy} />
        <Text style={styles.pillText}>{dayLabel}</Text>
      </Pressable>
      <Pressable
        onPress={openTime}
        style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`Time, ${timeLabel}. Change time`}
      >
        <Ionicons name="time-outline" size={16} color={color.navy} />
        <Text style={styles.pillText}>{timeLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.sm,
  },
  pill: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: color.surfaceSubtle,
    borderWidth: 1,
    borderColor: color.hairline,
  },
  pillText: { fontFamily: font.semibold, fontSize: 15, color: color.navy },
  pressed: { opacity: 0.8 },
});
