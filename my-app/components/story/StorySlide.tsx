/**
 * Scent Spectrum Walk Story slides.
 *
 * Each beat owns a distinct editorial composition. Shared primitives keep the
 * typography and rhythm coherent, while the route, sniff, weather, pace and
 * distance drawings remain native SVG generated from the recorded walk.
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Reanimated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { Image } from 'expo-image';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { MaterialIcons } from '@expo/vector-icons';

import { useKeepsakeImage } from '../../hooks/useKeepsakeImage';
import { projectOntoRoute, projectRouteToSvg } from '../../lib/walk/routeSvg';
import type { Keepsake } from '../../lib/walk/keepsake';

import type { StoryBeat } from '../../lib/walkStory';
import type { MomentRoutePoint, MomentStats, SniffStop } from '../../lib/momentCard';
import type { WalkLabels } from '../../lib/walk/geoLabels';
import {
  CloserArtwork,
  GoldenHourArtwork,
  JourneyArtwork,
  SniffArtwork,
  WeatherArtwork,
} from './StoryArtwork';
import { TemplateRenderer } from '../moments/TemplateRenderer';
import {
  displaySizeFor,
  scaledStorySize,
  storyColor,
  storyFont,
  storyMetric,
} from './storyTheme';

export interface StoryContext {
  petName: string;
  petGender: string | null;
  startedAt: number;
  route: MomentRoutePoint[];
  sniffStops: SniffStop[];
  labels: WalkLabels;
  stats: MomentStats;
  sessionId: string;
  slideW: number;
  slideH: number;
  /** Archive walk number for the quiet edition line. */
  walkNumber?: number | null;
  /** Kept for public-contract compatibility with existing story callers. */
  breedLine?: string | null;
  /** Safe-area + story chrome clearance. */
  topInset?: number;
}

interface StorySlideProps {
  beat: StoryBeat;
  ctx: StoryContext;
  onShare: () => void;
  onClose: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatKm(distanceM: number): string {
  const km = Math.max(0, distanceM) / 1000;
  if (km >= 10) return km.toFixed(0);
  return km.toFixed(1);
}

function formatMinutes(durationS: number): string {
  return String(Math.max(1, Math.round(Math.max(0, durationS) / 60)));
}

function compactDate(startedAt: number): string {
  return new Date(startedAt)
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    .toUpperCase();
}

function compactTime(startedAt: number): string {
  const date = new Date(startedAt);
  return `${date.getHours().toString().padStart(2, '0')}:${date
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
}

function placeLabel(ctx: StoryContext): string {
  return (
    ctx.labels.startLabel?.trim() ||
    ctx.labels.farthestLabel?.trim() ||
    ctx.labels.endLabel?.trim() ||
    'OUTSIDE'
  ).toUpperCase();
}

function walkMeta(ctx: StoryContext): string {
  const chapter = ctx.walkNumber ? `WALK ${ctx.walkNumber}` : 'TODAY';
  return `${chapter}  /  ${compactDate(ctx.startedAt)}  /  ${placeLabel(ctx)}`;
}

function summaryMetrics(ctx: StoryContext, speedLabel?: string | null): string {
  const sniffLabel = ctx.sniffStops.length === 1 ? 'SNIFF' : 'SNIFFS';
  const base = `${formatMinutes(ctx.stats.durationS)} MIN  ·  ${formatKm(ctx.stats.distanceM)} KM  ·  ${ctx.sniffStops.length} ${sniffLabel}`;
  return speedLabel ? `${base}  ·  ${speedLabel.toUpperCase()}` : base;
}

function Entrance({
  children,
  delay = 0,
  down = false,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  down?: boolean;
  style?: object | object[];
}) {
  const reducedMotion = useReducedMotion();
  const entering = reducedMotion
    ? undefined
    : down
      ? FadeInDown.duration(520).delay(delay)
      : FadeIn.duration(520).delay(delay);
  return (
    <Reanimated.View entering={entering} style={style}>
      {children}
    </Reanimated.View>
  );
}

function Meta({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <Text
      style={[styles.meta, muted && styles.metaMuted]}
      maxFontSizeMultiplier={1.15}
      numberOfLines={2}
    >
      {children}
    </Text>
  );
}

function Headline({
  children,
  width,
  base = 58,
  lines = 3,
  center = false,
}: {
  children: string;
  width: number;
  base?: number;
  lines?: number;
  center?: boolean;
}) {
  const fontSize = displaySizeFor(children, width, base);
  return (
    <Text
      style={[
        styles.headline,
        {
          fontSize,
          // RN clips custom-font ascenders when the line box is tighter than
          // the font. Keep real leading here and recover the optical rhythm
          // with spacing on the surrounding stack instead.
          lineHeight: Math.ceil(fontSize * 1.08),
        },
        center && styles.centerText,
      ]}
      numberOfLines={lines}
      adjustsFontSizeToFit
      minimumFontScale={0.74}
      maxFontSizeMultiplier={1.1}
    >
      {children}
    </Text>
  );
}

function SupportingCopy({
  children,
  center = false,
}: {
  children: React.ReactNode;
  center?: boolean;
}) {
  return (
    <Text
      style={[styles.support, center && styles.centerText]}
      maxFontSizeMultiplier={1.15}
      numberOfLines={3}
    >
      {children}
    </Text>
  );
}

function Metrics({ children, center = false }: { children: React.ReactNode; center?: boolean }) {
  return (
    <Text
      style={[styles.metrics, center && styles.centerText]}
      maxFontSizeMultiplier={1.1}
      numberOfLines={2}
    >
      {children}
    </Text>
  );
}

function SlideRoot({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.root} accessibilityRole="summary">
      {children}
    </View>
  );
}

function OpenerSlide({ beat, ctx }: { beat: Extract<StoryBeat, { id: 'opener' }>; ctx: StoryContext }) {
  const width = ctx.slideW;
  const height = ctx.slideH;
  const compact = height < 740;
  const top = (ctx.topInset ?? 72) + (compact ? 10 : 22);
  const artHeight = height * (compact ? 0.63 : 0.68);

  return (
    <SlideRoot>
      <Entrance delay={40} style={[styles.artwork, { top, left: 20, width: width - 40, height: artHeight }]}>
        <JourneyArtwork ctx={ctx} width={width - 40} height={artHeight} />
      </Entrance>
      <Entrance
        delay={250}
        down
        style={[
          styles.copyBlock,
          {
            left: storyMetric.horizontalPad,
            right: width * 0.18,
            bottom: clamp(height * 0.04, 24, 48),
          },
        ]}
      >
        <Meta>{walkMeta(ctx)}</Meta>
        <Headline width={width}>{beat.headline.toUpperCase()}</Headline>
        <Metrics>{summaryMetrics(ctx, beat.speedLabel)}</Metrics>
      </Entrance>
    </SlideRoot>
  );
}

function SniffSlide({ beat, ctx }: { beat: Extract<StoryBeat, { id: 'sniff_spot' }>; ctx: StoryContext }) {
  const width = ctx.slideW;
  const height = ctx.slideH;
  const top = (ctx.topInset ?? 72) + 10;
  const artHeight = height * 0.61;
  const headline = `${beat.count} ${beat.count === 1 ? 'STOP' : 'STOPS'} TODAY`;

  return (
    <SlideRoot>
      <Entrance delay={30} style={[styles.artwork, { top, left: 12, width: width - 24, height: artHeight }]}>
        <SniffArtwork ctx={ctx} width={width - 24} height={artHeight} />
      </Entrance>
      <Entrance
        delay={250}
        down
        style={[
          styles.copyBlock,
          {
            left: storyMetric.horizontalPad,
            right: width * 0.18,
            bottom: clamp(height * 0.035, 22, 42),
          },
        ]}
      >
        <Meta>GOOD SMELLS</Meta>
        <Headline width={width} lines={2}>{headline}</Headline>
        <SupportingCopy>{beat.line}</SupportingCopy>
        <Metrics>{`${(ctx.petName || 'THE WALK').toUpperCase()}  ·  ${placeLabel(ctx)}`}</Metrics>
      </Entrance>
    </SlideRoot>
  );
}

/**
 * One photo, positioned on the drawn route where it was taken.
 *
 * Split out so each moment owns its own image resolution — the ladder in
 * useKeepsakeImage is a hook, and hooks cannot run in a loop body.
 */
function KeepsakeRoutePin({
  keepsake,
  at,
  size,
}: {
  keepsake: Keepsake;
  at: { x: number; y: number };
  size: number;
}) {
  const image = useKeepsakeImage(keepsake);
  // Portrait card, like the photo pins people already recognise from map
  // products — a square reads as an avatar, and this is a photograph.
  const cardW = size;
  const cardH = Math.round(size * 1.24);

  return (
    <View
      style={[
        styles.keepsakePinAnchor,
        {
          // The tip marks the spot, so the card sits above the coordinate.
          left: at.x - cardW / 2,
          top: at.y - cardH - KEEPSAKE_PIN_TIP,
          width: cardW,
        },
      ]}
      pointerEvents="none"
    >
      <View style={[styles.keepsakePinCard, { width: cardW, height: cardH }]}>
        {image.uri ? (
          <Image source={{ uri: image.uri }} style={styles.keepsakePinPhoto} contentFit="cover" />
        ) : (
          <View style={styles.keepsakePinEmpty} />
        )}
      </View>
      <View style={styles.keepsakePinTip} />
    </View>
  );
}

/** Height of the stem joining a photo card to the point it marks. */
const KEEPSAKE_PIN_TIP = 7;

/**
 * The walk as a line, with the moments sitting on it.
 *
 * This is the storyline: the route says where, the photos say what happened,
 * and putting them in one frame is the whole point of recording a walk rather
 * than just taking pictures. Photos are placed with `projectOntoRoute`, which
 * shares the route's own transform — a separately-computed projection would
 * drift a few pixels and float every pin beside the line instead of on it.
 *
 * Falls back to the plain sniff artwork when the walk has no drawable route
 * (patchy GPS), so a moment is never lost to a missing trace.
 */
function KeepsakeRouteArtwork({
  ctx,
  keepsakes,
  width,
  height,
}: {
  ctx: StoryContext;
  keepsakes: Keepsake[];
  width: number;
  height: number;
}) {
  const pad = Math.max(28, Math.round(Math.min(width, height) * 0.16));

  // Only moments with an observed coordinate can be placed. An estimated
  // position is good enough for a pin on a map with streets under it; on a bare
  // line with nothing to check it against, it would just be a claim.
  const located = useMemo(
    () => keepsakes.filter((k) => k.lat != null && k.lng != null),
    [keepsakes],
  );

  const proj = useMemo(
    () => (ctx.route.length >= 2 ? projectRouteToSvg(ctx.route, width, height, pad) : null),
    [ctx.route, width, height, pad],
  );

  const pins = useMemo(
    () =>
      proj
        ? projectOntoRoute(
            ctx.route,
            located.map((k) => ({ lat: k.lat as number, lng: k.lng as number })),
            width,
            height,
            pad,
          )
        : [],
    [proj, ctx.route, located, width, height, pad],
  );

  if (!proj || !proj.points) {
    return <SniffArtwork ctx={ctx} width={width} height={height} />;
  }

  const pinSize = Math.max(38, Math.round(Math.min(width, height) * 0.17));

  return (
    <View style={{ width, height }}>
      <Svg width={width} height={height}>
        {/* Casing then brand line — the same two-stroke treatment the live map
            and the share card use, so a walk looks like itself everywhere. */}
        <Polyline
          points={proj.points}
          fill="none"
          stroke={storyColor.ink}
          strokeWidth={7}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.18}
        />
        <Polyline
          points={proj.points}
          fill="none"
          stroke={storyColor.route}
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {proj.start && <Circle cx={proj.start.x} cy={proj.start.y} r={5} fill={storyColor.ink} />}
        {proj.end && <Circle cx={proj.end.x} cy={proj.end.y} r={5} fill={storyColor.route} />}
      </Svg>

      {located.map((k, i) =>
        pins[i] ? (
          <KeepsakeRoutePin key={k.id} keepsake={k} at={pins[i]} size={pinSize} />
        ) : null,
      )}
    </View>
  );
}

/**
 * The moments slide.
 *
 * Every other slide draws itself from the walk's numbers, which is why they
 * repeat: the same loop produces the same art with different figures. This one
 * shows the thing the data could not have predicted, so it gets the largest
 * uninterrupted frame in the story and the least type over it.
 *
 * The hero is the first moment of the walk. If its image cannot be resolved —
 * original gone, thumbnail not uploaded, permission refused — the slide falls
 * back to the sniff artwork rather than a hole, and the line still holds.
 */
function KeepsakeSlide({
  beat,
  ctx,
}: {
  beat: Extract<StoryBeat, { id: 'keepsake' }>;
  ctx: StoryContext;
}) {
  const width = ctx.slideW;
  const height = ctx.slideH;
  const top = (ctx.topInset ?? 72) + 10;
  const artHeight = height * 0.61;
  const artWidth = width - 24;

  const headline = beat.count === 1 ? 'A MOMENT KEPT' : `${beat.count} MOMENTS KEPT`;

  return (
    <SlideRoot>
      <Entrance
        delay={30}
        style={[styles.artwork, { top, left: 12, width: artWidth, height: artHeight }]}
      >
        <KeepsakeRouteArtwork
          ctx={ctx}
          keepsakes={beat.keepsakes}
          width={artWidth}
          height={artHeight}
        />
      </Entrance>
      <Entrance
        delay={250}
        down
        style={[
          styles.copyBlock,
          {
            left: storyMetric.horizontalPad,
            right: width * 0.18,
            bottom: clamp(height * 0.035, 22, 42),
          },
        ]}
      >
        <Meta>WHAT HAPPENED</Meta>
        <Headline width={width} lines={2}>{headline}</Headline>
        <SupportingCopy>{beat.line}</SupportingCopy>
        <Metrics>{`${(ctx.petName || 'THE WALK').toUpperCase()}  ·  ${placeLabel(ctx)}`}</Metrics>
      </Entrance>
    </SlideRoot>
  );
}

function WeatherSlide({ beat, ctx }: { beat: Extract<StoryBeat, { id: 'weather' }>; ctx: StoryContext }) {
  const width = ctx.slideW;
  const height = ctx.slideH;
  const top = (ctx.topInset ?? 72) + 30;
  const artHeight = height * 0.47;
  const heroSize = scaledStorySize(width, 112);

  return (
    <SlideRoot>
      <Entrance delay={30} style={[styles.artwork, { top, left: 16, width: width - 32, height: artHeight }]}>
        <WeatherArtwork ctx={ctx} width={width - 32} height={artHeight} />
      </Entrance>
      <Entrance
        delay={250}
        down
        style={[
          styles.copyBlock,
          {
            left: storyMetric.horizontalPad,
            right: storyMetric.horizontalPad,
            bottom: clamp(height * 0.04, 28, 48),
          },
        ]}
      >
        <Meta>TODAY&apos;S AIR</Meta>
        <Text
          style={[
            styles.heroNumber,
            { fontSize: heroSize, lineHeight: Math.ceil(heroSize * 1.08) },
          ]}
          maxFontSizeMultiplier={1.05}
        >
          {beat.tempLabel}
        </Text>
        <Text style={styles.unitLabel} maxFontSizeMultiplier={1.1}>
          {beat.conditionLabel.toUpperCase()}
        </Text>
        <SupportingCopy>Out you went anyway.</SupportingCopy>
        <Metrics>{`${compactTime(ctx.startedAt)}  ·  ${placeLabel(ctx)}`}</Metrics>
      </Entrance>
    </SlideRoot>
  );
}

function GoldenHourSlide({
  beat,
  ctx,
}: {
  beat: Extract<StoryBeat, { id: 'golden_hour' }>;
  ctx: StoryContext;
}) {
  const width = ctx.slideW;
  const height = ctx.slideH;
  const top = (ctx.topInset ?? 72) + 26;
  const artHeight = height * 0.48;
  const headline = beat.phase === 'sunrise' ? 'FIRST LIGHT' : 'GOLDEN HOUR';

  return (
    <SlideRoot>
      <Entrance delay={30} style={[styles.artwork, { top, left: 18, width: width - 36, height: artHeight }]}>
        <GoldenHourArtwork phase={beat.phase} width={width - 36} height={artHeight} />
      </Entrance>
      <Entrance
        delay={250}
        down
        style={[
          styles.copyBlock,
          {
            left: storyMetric.horizontalPad,
            right: storyMetric.horizontalPad,
            bottom: clamp(height * 0.045, 30, 52),
          },
        ]}
      >
        <Meta>{beat.phase === 'sunrise' ? 'TODAY’S FIRST LIGHT' : 'TODAY’S LAST LIGHT'}</Meta>
        <Headline width={width} lines={2}>{headline}</Headline>
        <SupportingCopy>{beat.line}</SupportingCopy>
        <Metrics>{`${compactTime(ctx.startedAt)}  ·  ${placeLabel(ctx)}`}</Metrics>
      </Entrance>
    </SlideRoot>
  );
}

function CloserSlide({
  beat,
  ctx,
  onShare,
  onClose,
}: {
  beat: Extract<StoryBeat, { id: 'closer' }>;
  ctx: StoryContext;
  onShare: () => void;
  onClose: () => void;
}) {
  const width = ctx.slideW;
  const height = ctx.slideH;
  const compact = height < 740;
  const top = (ctx.topInset ?? 72) + (compact ? 10 : 24);

  const bottomChrome = clamp(height * 0.045, 28, 48) + 58 + 42 + 8;
  const availableH = height - top - bottomChrome - 32;
  const cardH = Math.round(Math.min(availableH, height * 0.62));
  const cardW = Math.round((cardH * 9) / 16);
  const cardAreaH = cardH + 8;

  return (
    <SlideRoot>
      <Entrance delay={30} style={[styles.closerCardPreview, { top, width, height: cardAreaH }]}>
        <View style={styles.closerCardShadow}>
          <TemplateRenderer
            templateId="fieldbook"
            petName={ctx.petName}
            petGender={ctx.petGender}
            startedAt={ctx.startedAt}
            route={ctx.route}
            sniffStops={ctx.sniffStops}
            labels={ctx.labels}
            stats={ctx.stats}
            sessionId={ctx.sessionId}
            width={cardW}
          />
        </View>
      </Entrance>

      <Entrance
        delay={320}
        down
        style={[
          styles.closerActions,
          {
            left: storyMetric.horizontalPad,
            right: storyMetric.horizontalPad,
            bottom: clamp(height * 0.045, 28, 48),
          },
        ]}
      >
        <TouchableOpacity
          style={styles.shareButton}
          onPress={onShare}
          activeOpacity={0.86}
          accessibilityRole="button"
          accessibilityLabel="Share this walk"
        >
          <Text style={styles.shareButtonText} maxFontSizeMultiplier={1.1}>Share this walk</Text>
          <MaterialIcons name="ios-share" size={22} color={storyColor.ink} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.doneButton}
          onPress={onClose}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Done"
        >
          <Text style={styles.doneText} maxFontSizeMultiplier={1.1}>Done</Text>
        </TouchableOpacity>
      </Entrance>
    </SlideRoot>
  );
}

export function StorySlide({ beat, ctx, onShare, onClose }: StorySlideProps) {
  switch (beat.id) {
    case 'opener':
      return <OpenerSlide beat={beat} ctx={ctx} />;
    case 'keepsake':
      return <KeepsakeSlide beat={beat} ctx={ctx} />;
    case 'sniff_spot':
      return <SniffSlide beat={beat} ctx={ctx} />;
    case 'weather':
      return <WeatherSlide beat={beat} ctx={ctx} />;
    case 'golden_hour':
      return <GoldenHourSlide beat={beat} ctx={ctx} />;
    case 'closer':
      return <CloserSlide beat={beat} ctx={ctx} onShare={onShare} onClose={onClose} />;
  }
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: storyColor.canvas,
    overflow: 'hidden',
  },
  artwork: {
    position: 'absolute',
  },
  keepsakePinAnchor: {
    position: 'absolute',
    alignItems: 'center',
  },
  keepsakePinCard: {
    overflow: 'hidden',
    borderRadius: 10,
    backgroundColor: storyColor.canvas,
    borderWidth: 3,
    borderColor: storyColor.canvas,
    // Shadow, not a border colour: on a white canvas a pale photo would
    // otherwise dissolve into the page it is pinned to.
    shadowColor: storyColor.ink,
    shadowOpacity: 0.22,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  keepsakePinTip: {
    width: 3,
    height: KEEPSAKE_PIN_TIP,
    backgroundColor: storyColor.canvas,
  },
  keepsakePinPhoto: { width: '100%', height: '100%' },
  keepsakePinEmpty: { width: '100%', height: '100%', backgroundColor: storyColor.inkGhost },
  copyBlock: {
    position: 'absolute',
    gap: 8,
  },
  closerCardPreview: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closerCardShadow: {
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
  },
  closerCopy: {
    position: 'absolute',
    alignItems: 'center',
    gap: 10,
  },
  meta: {
    color: storyColor.ink,
    fontFamily: storyFont.mono,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 1.35,
    includeFontPadding: false,
  },
  metaMuted: {
    color: storyColor.inkSoft,
  },
  headline: {
    color: storyColor.ink,
    fontFamily: storyFont.display,
    letterSpacing: 0.15,
    includeFontPadding: false,
    paddingTop: 3,
  },
  heroNumber: {
    color: storyColor.ink,
    fontFamily: storyFont.display,
    letterSpacing: -0.4,
    includeFontPadding: false,
    paddingTop: 3,
    marginTop: -2,
    marginBottom: -10,
  },
  unitLabel: {
    color: storyColor.ink,
    fontFamily: storyFont.mono,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: 1.25,
    includeFontPadding: false,
  },
  support: {
    color: storyColor.ink,
    fontFamily: storyFont.body,
    fontSize: 16,
    lineHeight: 22,
    letterSpacing: 0.1,
    includeFontPadding: false,
  },
  metrics: {
    color: storyColor.ink,
    fontFamily: storyFont.mono,
    fontSize: 11.5,
    lineHeight: 17,
    letterSpacing: 1.1,
    marginTop: 8,
    includeFontPadding: false,
  },
  centerText: {
    textAlign: 'center',
  },
  closerActions: {
    position: 'absolute',
    alignItems: 'stretch',
    gap: 8,
  },
  shareButton: {
    minHeight: 58,
    borderRadius: storyMetric.buttonRadius,
    backgroundColor: storyColor.route,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 22,
  },
  shareButtonText: {
    color: storyColor.ink,
    fontFamily: storyFont.bodyMedium,
    fontSize: 17,
    lineHeight: 22,
  },
  doneButton: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneText: {
    color: storyColor.ink,
    fontFamily: storyFont.body,
    fontSize: 16,
    lineHeight: 22,
  },
  wordmark: {
    color: storyColor.ink,
    fontFamily: storyFont.mono,
    fontSize: 10.5,
    lineHeight: 16,
    letterSpacing: 5,
    textAlign: 'center',
    marginTop: 2,
  },
});
