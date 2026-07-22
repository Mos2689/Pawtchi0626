import React, { useEffect } from 'react';
import { View, Text, StyleSheet, LayoutChangeEvent } from 'react-native';
import Svg, { Rect, Line, Circle } from 'react-native-svg';
import Animated, {
  FadeIn,
  useSharedValue,
  useAnimatedProps,
  withDelay,
  withSpring,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { color, font, motion } from '../constants/design';
import { haptic } from '../lib/haptics';
import type { IdealWeightBand } from '../lib/idealWeight';

const ARect = Animated.createAnimatedComponent(Rect);
const ALine = Animated.createAnimatedComponent(Line);
const ACircle = Animated.createAnimatedComponent(Circle);

// Choreography beats (ms). The map builds in the order the user should learn
// it: zone ("what healthy looks like") → today ("where they are") → path +
// milestone ("the first step") → ideal ("the destination"). One-shot on mount;
// the parent remounts via `key` when a new estimate lands.
const BEAT = { zone: 0, dot: 350, path: 650, milestone: 1050, dash: 1250, ideal: 1450 } as const;

const PAD = 14; // horizontal inset so end markers + labels don't clip
const TRACK_Y = 24; // track centerline inside the 44-high svg
const SVG_TOP = 16; // room above the track for the first-stop tick
const LABEL_W = 64;

// Two surfaces, one component (Brand Book: navy brand moments vs warm light
// operational screens). The dark zone tint hand-raises viz.green's alpha —
// the 10% token tint vanishes on navy.
const PALETTE = {
  light: {
    zone: color.successSoft,
    zoneBorder: color.success,
    track: color.track,
    dash: color.slateFaint,
    path: color.yellow,
    tick: color.slateFaint,
    today: color.navy,
    mileFill: color.yellow,
    mileStroke: color.navy,
    idealFill: color.surface,
    idealStroke: color.success,
    legendText: color.slateMuted,
    firstStop: color.slate,
    title: color.ink,
    value: color.slateMuted,
    idealTitle: color.success,
  },
  dark: {
    zone: 'rgba(74, 222, 128, 0.16)', // color.viz.green @ 16%
    zoneBorder: color.viz.green,
    track: color.hairlineOnNavy,
    dash: color.creamFaint,
    path: color.yellow,
    tick: color.creamFaint,
    today: color.cream,
    mileFill: color.yellow,
    mileStroke: color.navy,
    idealFill: color.navyRaised,
    idealStroke: color.viz.green,
    legendText: color.creamDim,
    firstStop: color.creamDim,
    title: color.cream,
    value: color.creamDim,
    idealTitle: color.viz.green,
  },
} as const;

interface WeightJourneyBarProps {
  currentKg: number;
  /** Initial weight logged. */
  startKg?: number;
  /** First actionable stop — tracks the slider live. */
  milestoneKg: number;
  /** Reconciled final ideal (the destination marker). */
  idealKg: number;
  band: IdealWeightBand | null;
  /** Legend copy, e.g. "Healthy Labrador Retriever range". */
  zoneLabel: string;
  /** 'light' (default) for operational screens, 'dark' for navy brand moments. */
  variant?: 'light' | 'dark';
  /**
   * Slim layout for dense surfaces (e.g. the home journey card): single-line
   * end labels, no floating "First stop" caption, roughly half the height.
   */
  compact?: boolean;
}

// The journey map — current → first milestone → ideal on one spatial spectrum,
// with the healthy band as a shaded zone. Replaces number-first presentation:
// the eye reads "outside the zone, first stop is close, destination is known"
// before any copy is processed.
export function WeightJourneyBar({ currentKg, startKg, milestoneKg, idealKg, band, zoneLabel, variant = 'light', compact = false }: WeightJourneyBarProps) {
  const p = PALETTE[variant];
  const [w, setW] = React.useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);

  // Slim geometry: drop the top caption room and collapse the two-line end
  // labels into one line so the map costs ~half the vertical space.
  const svgTop = compact ? 14 : SVG_TOP;
  const labelTop = compact ? svgTop + 34 : SVG_TOP + 46;
  const mapH = compact ? 64 : 96;

  const atIdeal = Math.abs(idealKg - currentKg) < 0.05;
  const showMilestone = !atIdeal
    && Math.abs(milestoneKg - idealKg) >= 0.05
    && Math.abs(milestoneKg - currentKg) >= 0.05;

  // ── Domain: fit the journey points with breathing room, then reveal the
  // band continuing past the edge (square-cut = "the zone goes on"). ──
  const startToConsider = startKg ?? currentKg;
  const hasStart = startKg !== undefined && Math.abs(startKg - currentKg) >= 0.05;
  const lo = Math.min(currentKg, milestoneKg, idealKg, startToConsider);
  const hi = Math.max(currentKg, milestoneKg, idealKg, startToConsider);
  const span = Math.max(hi - lo, currentKg * 0.12, 0.6);
  let dMin = lo - span * 0.3;
  let dMax = hi + span * 0.35;
  if (band) {
    if (band.high > dMax) dMax = Math.min(band.high, hi + span * 0.8);
    if (band.low < dMin) dMin = Math.max(band.low, lo - span * 0.8);
  }
  const usable = Math.max(1, w - PAD * 2);
  const kgToX = (kg: number) => PAD + ((kg - dMin) / (dMax - dMin)) * usable;

  const xStart = kgToX(startToConsider);
  const xCur = kgToX(currentKg);
  const xMile = kgToX(milestoneKg);
  const xIdeal = kgToX(idealKg);
  const drawTo = showMilestone ? xMile : xIdeal;
  // Dash only when the milestone sits strictly between today and the ideal —
  // if the user drags the slider past the ideal it disappears rather than
  // drawing backwards over the solid path.
  const mileBetween = (idealKg - milestoneKg) * (milestoneKg - currentKg) > 0;
  const showDash = showMilestone && mileBetween && Math.abs(xIdeal - xMile) > 12;

  // Zone rect, clipped to the view; a clipped edge bleeds past the svg bounds
  // so the visible cut is square, signalling continuation.
  const zoneClipL = band ? band.low < dMin : false;
  const zoneClipR = band ? band.high > dMax : false;
  const zoneL = band ? (zoneClipL ? -8 : kgToX(band.low)) : 0;
  const zoneR = band ? (zoneClipR ? w + 8 : kgToX(band.high)) : 0;

  const clampLabel = (x: number) => Math.min(Math.max(x - LABEL_W / 2, 0), Math.max(0, w - LABEL_W));
  // Below-track labels collide when today and ideal are pixel-close (tiny
  // delta on a wide domain) — the headline carries the number in that case.
  const showIdealLabel = !atIdeal && Math.abs(xIdeal - xCur) >= LABEL_W + 8;
  const showStartLabel = hasStart && Math.abs(xStart - xCur) >= LABEL_W - 8 && (!showIdealLabel || Math.abs(xStart - xIdeal) >= LABEL_W - 8);

  // ── Choreography ──
  const zoneO = useSharedValue(0);
  const curR = useSharedValue(0);
  const startR = useSharedValue(0);
  const drawP = useSharedValue(0);
  const mileR = useSharedValue(0);
  const dashO = useSharedValue(0);
  const idealR = useSharedValue(0);

  useEffect(() => {
    zoneO.value = withTiming(1, { duration: motion.duration.slow });
    curR.value = withDelay(BEAT.dot, withSpring(7.5, motion.spring.bouncy));
    startR.value = withDelay(BEAT.dot, withSpring(4.5, motion.spring.bouncy));
    if (!atIdeal) {
      drawP.value = withDelay(BEAT.path, withTiming(1, {
        duration: motion.duration.slow, easing: Easing.out(Easing.cubic),
      }));
      mileR.value = withDelay(BEAT.milestone, withSpring(7, motion.spring.bouncy));
      dashO.value = withDelay(BEAT.dash, withTiming(1, { duration: motion.duration.base }));
      idealR.value = withDelay(BEAT.ideal, withSpring(7.5, motion.spring.bouncy));
    }
    const h1 = setTimeout(() => haptic.select(), BEAT.dot + 30);
    const h2 = atIdeal ? null : setTimeout(() => haptic.select(), BEAT.milestone + 30);
    return () => { clearTimeout(h1); if (h2) clearTimeout(h2); };
    // One-shot mount choreography by design — parent remounts per estimate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const zoneProps = useAnimatedProps(() => ({ opacity: zoneO.value }));
  const curProps = useAnimatedProps(() => ({ r: curR.value }));
  const startProps = useAnimatedProps(() => ({ r: startR.value }));
  const pathProps = useAnimatedProps(() => ({ x2: xCur + (drawTo - xCur) * drawP.value }));
  const mileProps = useAnimatedProps(() => ({ r: mileR.value }));
  const tickProps = useAnimatedProps(() => ({ opacity: mileR.value / 7 }));
  const dashProps = useAnimatedProps(() => ({ opacity: dashO.value }));
  const idealProps = useAnimatedProps(() => ({ r: idealR.value }));

  return (
    <View>
      {band && (
        <View style={[styles.legendRow, compact && styles.legendRowCompact]}>
          <View style={[styles.legendSwatch, { backgroundColor: p.zone, borderColor: p.zoneBorder }]} />
          <Text style={[styles.legendText, { color: p.legendText }]}>
            {zoneLabel} · {band.low.toFixed(1)}–{band.high.toFixed(1)} kg
          </Text>
        </View>
      )}

      <View style={[styles.mapArea, { height: mapH }]} onLayout={onLayout}>
        {w > 0 && (
          <>
            {showMilestone && (
              <Animated.Text
                entering={FadeIn.delay(BEAT.milestone).duration(motion.duration.base)}
                style={[styles.firstStopLabel, { left: clampLabel(xMile), color: p.firstStop }]}
              >
                {compact ? milestoneKg.toFixed(1) : `First stop ${milestoneKg.toFixed(1)}`}
              </Animated.Text>
            )}

            <Svg width={w} height={44} style={[styles.svg, { top: svgTop }]}>
              {band && (
                <ARect
                  animatedProps={zoneProps}
                  x={zoneL} y={TRACK_Y - 6} width={Math.max(0, zoneR - zoneL)} height={12}
                  rx={6} fill={p.zone}
                />
              )}
              <Line
                x1={PAD} y1={TRACK_Y} x2={w - PAD} y2={TRACK_Y}
                stroke={p.track} strokeWidth={6} strokeLinecap="round"
              />
              {showDash && (
                <ALine
                  animatedProps={dashProps}
                  x1={xMile} y1={TRACK_Y} x2={xIdeal} y2={TRACK_Y}
                  stroke={p.dash} strokeWidth={2} strokeDasharray="3 5"
                />
              )}
              {!atIdeal && (
                <ALine
                  animatedProps={pathProps}
                  x1={xCur} y1={TRACK_Y} x2={xCur} y2={TRACK_Y}
                  stroke={p.path} strokeWidth={6} strokeLinecap="round"
                />
              )}
              {showMilestone && (
                <ALine
                  animatedProps={tickProps}
                  x1={xMile} y1={2} x2={xMile} y2={TRACK_Y - 12}
                  stroke={p.tick} strokeWidth={1.5}
                />
              )}
              {!atIdeal && (
                <ACircle
                  animatedProps={idealProps}
                  cx={xIdeal} cy={TRACK_Y}
                  fill={p.idealFill} stroke={p.idealStroke} strokeWidth={2.5}
                />
              )}
              {showMilestone && (
                <ACircle
                  animatedProps={mileProps}
                  cx={xMile} cy={TRACK_Y}
                  fill={p.mileFill} stroke={p.mileStroke} strokeWidth={2}
                />
              )}
              {hasStart && (
                <ACircle animatedProps={startProps} cx={xStart} cy={TRACK_Y} fill={p.tick} />
              )}
              <ACircle animatedProps={curProps} cx={xCur} cy={TRACK_Y} fill={p.today} />
            </Svg>

            <View style={[styles.markerLabel, { left: clampLabel(xCur), top: labelTop }]}>
              {compact ? (
                <Text style={[styles.markerCompact, { color: p.title }]}>Today {currentKg.toFixed(1)}</Text>
              ) : (
                <>
                  <Text style={[styles.markerTitle, { color: p.title }]}>Today</Text>
                  <Text style={[styles.markerValue, { color: p.value }]}>{currentKg.toFixed(1)} kg</Text>
                </>
              )}
            </View>
            {showIdealLabel && (
              <Animated.View
                entering={FadeIn.delay(BEAT.ideal).duration(motion.duration.base)}
                style={[styles.markerLabel, { left: clampLabel(xIdeal), top: labelTop }]}
              >
                {compact ? (
                  <Text style={[styles.markerCompact, { color: p.idealTitle }]}>Ideal {idealKg.toFixed(1)}</Text>
                ) : (
                  <>
                    <Text style={[styles.markerTitle, { color: p.idealTitle }]}>Ideal</Text>
                    <Text style={[styles.markerValue, { color: p.value }]}>{idealKg.toFixed(1)} kg</Text>
                  </>
                )}
              </Animated.View>
            )}
            {showStartLabel && (
              <Animated.View
                entering={FadeIn.delay(BEAT.ideal).duration(motion.duration.base)}
                style={[styles.markerLabel, { left: clampLabel(xStart), top: labelTop }]}
              >
                {compact ? (
                  <Text style={[styles.markerCompact, { color: p.value }]}>Start {startToConsider.toFixed(1)}</Text>
                ) : (
                  <>
                    <Text style={[styles.markerTitle, { color: p.value }]}>Start</Text>
                    <Text style={[styles.markerValue, { color: p.value }]}>{startToConsider.toFixed(1)} kg</Text>
                  </>
                )}
              </Animated.View>
            )}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  legendRowCompact: {
    marginBottom: 0,
  },
  legendSwatch: {
    width: 10,
    height: 10,
    borderRadius: 3,
    borderWidth: 1,
  },
  legendText: {
    fontFamily: font.semibold,
    fontSize: 11,
  },
  mapArea: {
    height: 96,
  },
  svg: {
    position: 'absolute',
    top: SVG_TOP,
    left: 0,
  },
  firstStopLabel: {
    position: 'absolute',
    top: 0,
    width: LABEL_W,
    textAlign: 'center',
    fontFamily: font.bold,
    fontSize: 10.5,
  },
  markerLabel: {
    position: 'absolute',
    width: LABEL_W,
    alignItems: 'center',
    gap: 1,
  },
  markerTitle: {
    fontFamily: font.bold,
    fontSize: 11,
  },
  markerValue: {
    fontFamily: font.semibold,
    fontSize: 11,
  },
  markerCompact: {
    fontFamily: font.bold,
    fontSize: 11,
  },
});
