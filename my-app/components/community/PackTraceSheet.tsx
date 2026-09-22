/**
 * PackTraceSheet — who walked, on the memory of a shared walk.
 *
 * ── One row per phone ──────────────────────────────────────────────────────
 *
 * Collapsed it is a single line about the pack; lifted, it is a row per walker
 * with their own route as a sparkline in their own colour — the same colour
 * their line is drawn in on the map above. That pairing is the whole idea: it
 * is what lets "which of these lines is Mira's" be answered by looking rather
 * than by guessing.
 *
 * Tapping a row opens their numbers and focuses them everywhere at once — the
 * other lines fade and so do the photos that were not theirs. "Show me Mira's
 * walk" is a claim about the whole screen, not just the list.
 *
 * ── What the summary refuses to say ────────────────────────────────────────
 *
 * A distance. Three phones measured three of them and none is the walk's; see
 * lib/community/memoryTraces.ts. The summary carries only what belongs to the
 * group, and every distance on this screen sits in a row beside the name of
 * the person it is true of.
 *
 * The fold is the pattern from the live sheet, for the same reasons: the pan
 * lives on the grip alone, the gesture root wraps only the grip, and the fold
 * is a timing curve rather than a spring because a spring overshoots and
 * overshoot on a clipped height reads as a stutter.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';

import { color, font, makeShadow, radius, space, type } from '../../constants/design';
import { projectCommunityRoutes } from '../../lib/communityRouteArtwork';
import {
  distanceLabel,
  durationLabel,
  paceLabel,
  togetherSummary,
} from '../../lib/community/memoryTraces';
import type { WalkAttendance, WalkerTrace } from '../../lib/communityWalks';
import { DogStack } from './CommunityUI';

const SPARK = 34;
const ROW_H = 58;
const FOLD_MS = 220;
const FOLD_EASING = Easing.out(Easing.cubic);
/** Past this much of a drag, let go and the sheet changes its mind. */
const FOLD_THRESHOLD = 30;

export interface PackTraceRow {
  trace: WalkerTrace;
  person?: WalkAttendance;
  tint: string;
  /** Moments this walker contributed. Counted by the caller, which has them. */
  moments: number;
}

interface PackTraceSheetProps {
  rows: PackTraceRow[];
  walkSeconds: number | null;
  momentCount: number;
  focusId: string | null;
  onFocus: (userId: string | null) => void;
  bottomInset: number;
}

function firstName(person?: WalkAttendance): string {
  const raw = person?.person?.full_name || person?.person?.username || '';
  return raw.trim().split(/\s+/)[0] || 'A walker';
}

export function PackTraceSheet({
  rows,
  walkSeconds,
  momentCount,
  focusId,
  onFocus,
  bottomInset,
}: PackTraceSheetProps) {
  /**
   * How tall the list is when open. Derived rather than fixed, because this
   * sheet's content is a list — a fixed number would clip a fourth walker or
   * leave a gap under a second one.
   */
  const openHeight = Math.min(rows.length, 4) * ROW_H + (focusId ? 58 : 0);

  const [open, setOpen] = React.useState(false);
  const fold = useSharedValue(0);
  const foldAtGrab = useSharedValue(0);

  React.useEffect(() => {
    if (open) fold.value = withTiming(openHeight, { duration: FOLD_MS, easing: FOLD_EASING });
  }, [fold, open, openHeight]);

  const pan = React.useMemo(
    () =>
      Gesture.Pan()
        .onStart(() => { foldAtGrab.value = fold.value; })
        .onUpdate(event => {
          fold.value = Math.min(openHeight, Math.max(0, foldAtGrab.value - event.translationY));
        })
        .onEnd(() => {
          const wasOpen = foldAtGrab.value > openHeight / 2;
          const moved = fold.value - foldAtGrab.value;
          const next = wasOpen ? moved > -FOLD_THRESHOLD : moved > FOLD_THRESHOLD;
          fold.value = withTiming(next ? openHeight : 0, { duration: FOLD_MS, easing: FOLD_EASING });
          runOnJS(setOpen)(next);
        }),
    [fold, foldAtGrab, openHeight],
  );

  const toggle = React.useCallback(() => {
    const next = !open;
    fold.value = withTiming(next ? openHeight : 0, { duration: FOLD_MS, easing: FOLD_EASING });
    setOpen(next);
    if (!next) onFocus(null);
  }, [fold, onFocus, open, openHeight]);

  const foldStyle = useAnimatedStyle(() => ({ height: fold.value }));

  return (
    <View style={[styles.sheet, { paddingBottom: bottomInset + 12 }]}>
      {/* The gesture root wraps the grip and nothing else. It must not contain
          the height that changes every frame, or each frame of the fold
          re-lays-out the gesture root and everything under it. */}
      <GestureHandlerRootView style={styles.gripRoot}>
        <GestureDetector gesture={pan}>
          <View style={styles.gripStrip}>
            <Pressable
              onPress={toggle}
              hitSlop={14}
              accessibilityRole="button"
              accessibilityLabel={open ? 'Hide who walked' : 'Show who walked'}
            >
              <View style={styles.grip} />
            </Pressable>
          </View>
        </GestureDetector>
      </GestureHandlerRootView>

      <Pressable onPress={toggle} style={styles.summary} accessibilityRole="button">
        <DogStack dogs={rows.flatMap(row => row.person?.dogs ?? [])} max={3} />
        <Text style={styles.summaryText} numberOfLines={1}>
          {togetherSummary({ walkers: rows.length, seconds: walkSeconds, moments: momentCount })}
        </Text>
        <Ionicons
          name={open ? 'chevron-down' : 'chevron-up'}
          size={17}
          color={color.creamFaint}
        />
      </Pressable>

      <Animated.View style={[styles.fold, foldStyle]}>
        {rows.map(row => {
          const selected = focusId === row.trace.userId;
          const pace = paceLabel(row.trace.distanceM, row.trace.durationS);
          return (
            <Pressable
              key={row.trace.userId}
              onPress={() => onFocus(selected ? null : row.trace.userId)}
              style={styles.row}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${firstName(row.person)}, ${distanceLabel(row.trace.distanceM)}`}
            >
              <View style={styles.rowTop}>
                <Spark routes={row.trace.routes} tint={row.tint} />
                <View style={styles.rowCopy}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {firstName(row.person)}
                    {row.person?.dogs?.length ? ` & ${row.person.dogs.map(dog => dog.name).join(' & ')}` : ''}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {distanceLabel(row.trace.distanceM)} · {durationLabel(row.trace.durationS)}
                  </Text>
                </View>
                <Ionicons
                  name={selected ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={selected ? color.yellow : color.creamFaint}
                />
              </View>

              {selected ? (
                <View style={styles.chips}>
                  {/* Pace is omitted rather than faked on a walk too short to
                      have one — see paceLabel. */}
                  <Chip label="PACE" value={pace ?? '—'} />
                  <Chip label="MOMENTS" value={String(row.moments)} />
                  <Chip label="SNIFFS" value={String(row.trace.sniffs)} />
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </Animated.View>
    </View>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipValue}>{value}</Text>
      <Text style={styles.chipLabel}>{label}</Text>
    </View>
  );
}

/**
 * The walker's own route, as a mark rather than a map.
 *
 * `projectCommunityRoutes` throws the coordinates away and keeps the shape,
 * which is what makes a route safe to put in a list. A recording with one
 * point has no shape, and draws as a dot instead of nothing.
 */
function Spark({ routes, tint }: { routes: { lat: number; lng: number }[][]; tint: string }) {
  // All of a walker's segments projected together, so they share one frame and
  // keep their real positions relative to each other rather than each being
  // stretched to fill the square on its own.
  const art = React.useMemo(
    () => projectCommunityRoutes(routes, SPARK, SPARK, 7),
    [routes],
  );
  return (
    <View style={[styles.spark, { backgroundColor: `${tint}22` }]}>
      {art.length ? (
        <Svg width={SPARK} height={SPARK}>
          {art.map((seg, i) => (
            <Polyline key={`c${i}`} points={seg.points} fill="none" stroke={color.navy} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {art.map((seg, i) => (
            <Polyline key={`t${i}`} points={seg.points} fill="none" stroke={tint} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {art[0]?.start ? <Circle cx={art[0].start.x} cy={art[0].start.y} r={2.6} fill={tint} stroke={color.navy} strokeWidth={1.4} /> : null}
        </Svg>
      ) : (
        <View style={[styles.sparkDot, { backgroundColor: tint }]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.lg,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    backgroundColor: color.navy,
    ...makeShadow(-14, 34, 0.24),
  },
  gripRoot: { alignSelf: 'stretch' },
  gripStrip: { paddingTop: 9, paddingBottom: 7, alignItems: 'center' },
  grip: { width: 44, height: 4, borderRadius: 999, backgroundColor: color.hairlineOnNavy },

  summary: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 40 },
  summaryText: { ...type.body, fontSize: 12.5, color: color.cream, flex: 1 },

  fold: { overflow: 'hidden' },
  row: { borderTopWidth: 1, borderTopColor: color.hairlineOnNavy, paddingVertical: 9 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowCopy: { flex: 1, minWidth: 0 },
  rowName: { ...type.label, fontSize: 12.5, color: color.cream },
  rowMeta: { ...type.caption, fontSize: 10.5, letterSpacing: 0, color: color.creamFaint, marginTop: 2 },

  spark: { width: SPARK, height: SPARK, borderRadius: 9, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  sparkDot: { width: 7, height: 7, borderRadius: 4 },

  chips: { flexDirection: 'row', gap: 5, marginTop: 8 },
  chip: { flex: 1, backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 9, paddingVertical: 7, alignItems: 'center' },
  chipValue: { fontFamily: font.bold, fontSize: 12.5, color: color.cream },
  chipLabel: { fontFamily: font.bold, fontSize: 8.5, letterSpacing: 1, color: color.creamFaint, marginTop: 2 },
});

export const PACK_SHEET_RADIUS = radius.xxl;
