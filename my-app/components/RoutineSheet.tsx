/**
 * RoutineSheet — owner-routine bottom sheet for the activity tab.
 *
 * Used in two contexts:
 *   1. First-time plan generation — appears when the user lands on the activity
 *      tab without owner_preferences and without any AI-generated activities.
 *   2. Profile editing — opens pre-populated with current prefs.
 *
 * Single screen, no paging. Smart defaults so most users tap one button and
 * ship. Primary CTA is "Build Buddy's plan" (or "Save changes" when editing) —
 * either way, saving and (optionally) regenerating happen in the same handler.
 */

import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal, Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import Slider from '@react-native-community/slider';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { color, radius, shadow, space, type } from '../constants/design';
import { PawLoader } from './loader/PawLoader';
import { defaultRoutine, routineToRow, rowToForm, type RoutineFormState, type WalkWindow } from '../lib/routineDefaults';
import type { OwnerPrefsRow } from '../lib/routineDefaults';

interface Props {
  visible: boolean;
  onClose: () => void;
  petName: string;
  species: 'dog' | 'cat';
  existingPrefs: OwnerPrefsRow | null;
  primaryLabel: string;        // 'Build Buddy's plan' | 'Save changes'
  onSubmit: (row: OwnerPrefsRow) => Promise<void>;
  isSubmitting?: boolean;
}

const WALK_WINDOW_OPTIONS: { id: WalkWindow; label: string }[] = [
  { id: 'morning', label: 'Morning' },
  { id: 'lunch',   label: 'Lunch' },
  { id: 'evening', label: 'Evening' },
  { id: 'night',   label: 'Night' },
];

export function RoutineSheet({
  visible, onClose, petName, species, existingPrefs, primaryLabel, onSubmit, isSubmitting,
}: Props) {
  const [form, setForm] = useState<RoutineFormState>(() =>
    existingPrefs ? rowToForm(existingPrefs, species) : defaultRoutine(species),
  );
  const [picking, setPicking] = useState<null | 'wake' | 'bedtime' | 'work_start' | 'work_end'>(null);

  const setField = useCallback(<K extends keyof RoutineFormState>(key: K, value: RoutineFormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  }, []);

  const toggleWalkWindow = useCallback((win: WalkWindow) => {
    setForm((f) => ({
      ...f,
      walk_windows: f.walk_windows.includes(win)
        ? f.walk_windows.filter((w) => w !== win)
        : [...f.walk_windows, win],
    }));
  }, []);

  const handlePick = (event: any, date?: Date) => {
    if (Platform.OS === 'android') setPicking(null);
    if (!date) return;
    const t = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    if (picking === 'wake')        setField('wake_time', t);
    if (picking === 'bedtime')     setField('bedtime', t);
    if (picking === 'work_start')  setField('work_start', t);
    if (picking === 'work_end')    setField('work_end', t);
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;
    const row = routineToRow(form);
    await onSubmit(row);
  };

  // Build a Date for the OS picker from a 'HH:MM' string.
  const dateFor = (t: string): Date => {
    const [h, m] = t.split(':').map(Number);
    const d = new Date();
    d.setHours(h || 0, m || 0, 0, 0);
    return d;
  };

  const heading = existingPrefs ? `${petName}'s routine` : `${petName}'s day`;
  const subhead = existingPrefs ? 'Update anything that\'s changed.' : 'A few quick taps and we\'ll fit the plan around your day.';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <TouchableOpacity activeOpacity={1} style={styles.backdrop} onPress={onClose} />
        <Animated.View entering={FadeInDown.duration(220)} style={styles.sheet}>
          <View style={styles.handle} />

          <Text style={styles.title}>{heading}</Text>
          <Text style={styles.subtitle}>{subhead}</Text>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* 1 — Wake / Sleep chips */}
            <View style={styles.timeRow}>
              <TimeChip label="Wake" value={form.wake_time} onPress={() => setPicking('wake')} />
              <TimeChip label="Sleep" value={form.bedtime} onPress={() => setPicking('bedtime')} />
            </View>

            {/* 2 — Home vs Working segmented toggle */}
            <Text style={styles.sectionLabel}>During the day</Text>
            <View style={styles.segmentRow}>
              <SegmentBtn
                active={!form.has_work_window}
                label="Home"
                onPress={() => setField('has_work_window', false)}
              />
              <SegmentBtn
                active={form.has_work_window}
                label="Working hours"
                onPress={() => setField('has_work_window', true)}
              />
            </View>
            {form.has_work_window && (
              <Animated.View entering={FadeIn.duration(180)} style={styles.timeRow}>
                <TimeChip label="Start" value={form.work_start} onPress={() => setPicking('work_start')} />
                <TimeChip label="End"   value={form.work_end}   onPress={() => setPicking('work_end')} />
              </Animated.View>
            )}

            {/* 3 — Walk windows */}
            <Text style={styles.sectionLabel}>Best walk times</Text>
            <View style={styles.chipRow}>
              {WALK_WINDOW_OPTIONS.map((opt) => {
                const active = form.walk_windows.includes(opt.id);
                return (
                  <TouchableOpacity
                    key={opt.id}
                    onPress={() => toggleWalkWindow(opt.id)}
                    style={[styles.chip, active && styles.chipActive]}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{opt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* 4 — Weekend accordion */}
            <TouchableOpacity
              onPress={() => setField('weekend_different', !form.weekend_different)}
              style={styles.accordionRow}
              activeOpacity={0.85}
            >
              <Text style={styles.sectionLabel}>Different on weekends?</Text>
              <MaterialIcons
                name={form.weekend_different ? 'expand-less' : 'expand-more'}
                size={22}
                color={color.slateMuted}
              />
            </TouchableOpacity>
            {form.weekend_different && (
              <Animated.View entering={FadeIn.duration(180)} style={styles.weekendInner}>
                <Text style={styles.weekendValue}>
                  {form.weekend_shifts_hours === 0
                    ? 'Same as weekday'
                    : `${form.weekend_shifts_hours > 0 ? '+' : ''}${form.weekend_shifts_hours}h ${form.weekend_shifts_hours > 0 ? 'later' : 'earlier'}`}
                </Text>
                <Slider
                  minimumValue={-2}
                  maximumValue={4}
                  step={1}
                  value={form.weekend_shifts_hours}
                  onValueChange={(v) => setField('weekend_shifts_hours', Math.round(v))}
                  minimumTrackTintColor={color.yellow}
                  maximumTrackTintColor={color.track}
                  thumbTintColor={color.navy}
                />
              </Animated.View>
            )}
          </ScrollView>

          <TouchableOpacity
            style={[styles.primaryBtn, isSubmitting && styles.primaryBtnDisabled]}
            onPress={handleSubmit}
            disabled={isSubmitting}
            activeOpacity={0.9}
          >
            <Text style={styles.primaryBtnText}>{primaryLabel}</Text>
          </TouchableOpacity>
        </Animated.View>

        {picking && (
          Platform.OS === 'ios' ? (
            <Modal transparent animationType="fade" onRequestClose={() => setPicking(null)}>
              <View style={styles.pickerOverlay}>
                <View style={styles.pickerCard}>
                  <DateTimePicker
                    value={dateFor(
                      picking === 'wake' ? form.wake_time :
                      picking === 'bedtime' ? form.bedtime :
                      picking === 'work_start' ? form.work_start : form.work_end,
                    )}
                    mode="time"
                    display="spinner"
                    onChange={handlePick}
                  />
                  <TouchableOpacity onPress={() => setPicking(null)} style={styles.pickerDoneBtn}>
                    <Text style={styles.pickerDoneText}>Done</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </Modal>
          ) : (
            <DateTimePicker
              value={dateFor(
                picking === 'wake' ? form.wake_time :
                picking === 'bedtime' ? form.bedtime :
                picking === 'work_start' ? form.work_start : form.work_end,
              )}
              mode="time"
              display="default"
              onChange={handlePick}
            />
          )
        )}
      </KeyboardAvoidingView>
      <PawLoader visible={isSubmitting} message="Saving routine…" />
    </Modal>
  );
}

// ── Small composables ──────────────────────────────────────────────────────

function TimeChip({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.timeChip} onPress={onPress} activeOpacity={0.85}>
      <Text style={styles.timeChipLabel}>{label}</Text>
      <Text style={styles.timeChipValue}>{formatDisplay(value)}</Text>
    </TouchableOpacity>
  );
}

function SegmentBtn({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.segmentBtn, active && styles.segmentBtnActive]}
      onPress={onPress}
      activeOpacity={0.9}
    >
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function formatDisplay(t: string): string {
  const [hRaw, mRaw] = t.split(':').map(Number);
  const h = hRaw % 12 === 0 ? 12 : hRaw % 12;
  const m = String(mRaw).padStart(2, '0');
  const ampm = hRaw >= 12 ? 'PM' : 'AM';
  return `${h}:${m} ${ampm}`;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  backdrop: { ...StyleSheet.absoluteFillObject },
  sheet: {
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.lg,
    maxHeight: '88%',
    ...shadow.raised,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: color.hairline,
    marginBottom: space.md,
  },
  title: { ...type.title, color: color.ink, marginBottom: 4 },
  subtitle: { ...type.body, color: color.slateMuted, marginBottom: space.md },
  scroll: { maxHeight: 480 },
  scrollContent: { paddingBottom: space.md },

  timeRow: { flexDirection: 'row', gap: space.sm, marginBottom: space.md },
  timeChip: {
    flex: 1,
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
  },
  timeChipLabel: { ...type.caption, color: color.slateMuted, marginBottom: 4 },
  timeChipValue: { ...type.heading, color: color.ink },

  sectionLabel: { ...type.label, color: color.slate, marginBottom: space.xs, marginTop: space.sm },

  segmentRow: {
    flexDirection: 'row',
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.md,
    padding: 4,
    marginBottom: space.sm,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  segmentBtnActive: { backgroundColor: color.surface, ...shadow.card },
  segmentText: { ...type.bodyMedium, color: color.slateMuted },
  segmentTextActive: { ...type.bodyMedium, color: color.ink },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginBottom: space.md },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: color.surfaceSubtle,
  },
  chipActive: { backgroundColor: color.navy },
  chipText: { ...type.bodyMedium, color: color.slate },
  chipTextActive: { ...type.bodyMedium, color: color.cream },

  accordionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: space.sm,
  },
  weekendInner: {
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.md,
    padding: space.md,
    marginTop: space.xs,
  },
  weekendValue: { ...type.heading, color: color.ink, textAlign: 'center', marginBottom: space.xs },

  primaryBtn: {
    backgroundColor: color.yellow,
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.md,
    minHeight: 52,
  },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: { ...type.heading, color: color.navy },

  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  pickerCard: {
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: space.md,
  },
  pickerDoneBtn: {
    alignSelf: 'flex-end',
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  pickerDoneText: { ...type.heading, color: color.navy },
});
