/**
 * PackStoryCard — the shared walk as a 9:16 Instagram story.
 *
 * Light and sticker-led: the owner's own photos as tilted prints on warm paper,
 * every walker's line drawn over them like a marker, a ring where the lines
 * met, and the facts as stickers — minutes together, the dogs, the day. The
 * headline is built from the walk (lib/community/packStory), never typed.
 *
 * This view IS the image: `shareMoment` captures it pixel for pixel, so
 * everything in it must be safe to leave the phone. See packStory.ts for what
 * that means — own photos only, map-free lines, no start or end markers.
 *
 * Laid out in units of `s = width / 300` so the same composition holds at any
 * width the share sheet gives it, and the capture keeps its proportions.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Circle, Polyline } from 'react-native-svg';

import { color, font } from '../../constants/design';
import { projectCommunityRoutes, type ArtworkPoint } from '../../lib/communityRouteArtwork';
import { meetingPoint } from '../../lib/community/packStory';

export interface StoryWalkerLines {
  /** This walker's colour, from `storyLineColor`. */
  color: string;
  /** Their recorded segments — kept apart, never joined across a gap. */
  routes: ArtworkPoint[][];
}

export interface StoryPhoto {
  id: string;
  uri: string;
  /** Storage path, so the image cache survives a re-signed URL. */
  cacheKey?: string;
}

interface PackStoryCardProps {
  width: number;
  headline: string;
  subline: string;
  dateChip: string;
  dogsLine: string;
  /** One dot per walker in the dogs pill, in their line colour. */
  dogDots: string[];
  minutes: number | null;
  walkers: StoryWalkerLines[];
  photos: StoryPhoto[];
  showLines: boolean;
}

/** Where the prints sit, by how many there are. Fractions of the card. */
const PRINT_LAYOUTS: { left: number; top: number; w: number; h: number; rotate: number }[][] = [
  [],
  [{ left: 0.14, top: 0.11, w: 0.72, h: 0.44, rotate: -3 }],
  [
    { left: 0.07, top: 0.11, w: 0.56, h: 0.36, rotate: -5 },
    { left: 0.40, top: 0.24, w: 0.52, h: 0.33, rotate: 5 },
  ],
  [
    { left: 0.08, top: 0.10, w: 0.56, h: 0.34, rotate: -5 },
    { left: 0.45, top: 0.17, w: 0.48, h: 0.30, rotate: 6 },
    { left: 0.22, top: 0.36, w: 0.56, h: 0.30, rotate: -1.5 },
  ],
];

function parsePoints(points: string): { x: number; y: number }[] {
  return points.split(' ').map(pair => {
    const [x, y] = pair.split(',').map(Number);
    return { x, y };
  }).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
}

export const PackStoryCard = React.forwardRef<View, PackStoryCardProps>(function PackStoryCard(
  { width, headline, subline, dateChip, dogsLine, dogDots, minutes, walkers, photos, showLines },
  ref,
) {
  const s = width / 300;
  const height = Math.round((width * 16) / 9);

  // The lines live in the upper two-thirds, over the prints; the text block
  // below stays clean. One projection for everyone, so the lines keep their
  // true positions relative to each other — that IS the story.
  const lineTop = height * 0.1;
  const lineHeight = height * 0.6;
  const lines = React.useMemo(() => {
    if (!showLines) return { segments: [] as { color: string; points: string; walker: number }[], meet: null };
    const flat = walkers.flatMap((walker, walkerIndex) =>
      walker.routes.map(route => ({ walkerIndex, color: walker.color, route })));
    const projected = projectCommunityRoutes(flat.map(item => item.route), width, lineHeight, 28 * s);
    // projectCommunityRoutes drops empty routes; re-align by filtering the same way.
    const kept = flat.filter(item => item.route.some(p => Number.isFinite(p.lat) && Number.isFinite(p.lng)));
    const segments = projected.map((route, index) => ({
      color: kept[index]?.color ?? walkers[0]?.color ?? color.navy,
      points: route.points,
      walker: kept[index]?.walkerIndex ?? 0,
    }));
    const pointsOf = (walker: number) =>
      segments.filter(seg => seg.walker === walker).flatMap(seg => parsePoints(seg.points));
    const meet = walkers.length > 1 ? meetingPoint(pointsOf(0), pointsOf(1), 18 * s) : null;
    return { segments, meet };
  }, [lineHeight, s, showLines, walkers, width]);

  const layout = PRINT_LAYOUTS[Math.min(photos.length, 3)];
  const stroke = 6.5 * s;
  const casing = 10 * s;

  return (
    <View
      ref={ref}
      collapsable={false}
      style={[styles.card, { width, height, borderRadius: 18 * s }]}
      accessibilityLabel={`${headline}. ${subline}`}
    >
      <View style={[styles.topRow, { top: 16 * s, left: 16 * s, right: 16 * s }]}>
        {dateChip ? (
          <View style={[styles.chip, { paddingHorizontal: 10 * s, paddingVertical: 5 * s }]}>
            <Text style={[styles.chipText, { fontSize: 11 * s }]}>{dateChip}</Text>
          </View>
        ) : <View />}
        <Text style={[styles.wordmark, { fontSize: 13 * s }]}>pawtchi</Text>
      </View>

      {photos.slice(0, 3).map((photo, index) => {
        const spot = layout[index];
        return (
          <View
            key={photo.id}
            style={[
              styles.print,
              {
                left: spot.left * width,
                top: spot.top * height,
                width: spot.w * width,
                height: spot.h * height,
                padding: 7 * s,
                borderRadius: 12 * s,
                transform: [{ rotate: `${spot.rotate}deg` }],
              },
            ]}
          >
            <Image
              source={{ uri: photo.uri, cacheKey: photo.cacheKey }}
              style={[styles.photo, { borderRadius: 8 * s }]}
              contentFit="cover"
              transition={0}
            />
          </View>
        );
      })}

      {lines.segments.length ? (
        <Svg
          width={width}
          height={lineHeight}
          style={{ position: 'absolute', left: 0, top: lineTop }}
          pointerEvents="none"
        >
          {/* Casings first, under every line, so crossings read cleanly over
              the prints. Yellow gets navy: bare yellow does not hold as ink on
              paper. Everyone else gets white. */}
          {lines.segments.map((seg, index) => (
            <Polyline
              key={`c${index}`}
              points={seg.points}
              fill="none"
              stroke={seg.color === color.yellow ? color.navy : color.surface}
              strokeWidth={casing}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {lines.segments.map((seg, index) => (
            <Polyline
              key={`l${index}`}
              points={seg.points}
              fill="none"
              stroke={seg.color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {lines.meet ? (
            <Circle
              cx={lines.meet.x}
              cy={lines.meet.y}
              r={11 * s}
              fill={color.surface}
              stroke={color.navy}
              strokeWidth={3 * s}
            />
          ) : null}
        </Svg>
      ) : null}

      {lines.meet ? (
        <View
          style={[
            styles.meetTag,
            {
              left: Math.min(lines.meet.x + 14 * s, width - 96 * s),
              top: lineTop + lines.meet.y + 12 * s,
              paddingHorizontal: 8 * s,
              paddingVertical: 4 * s,
              borderRadius: 8 * s,
            },
          ]}
        >
          <Text style={[styles.meetText, { fontSize: 11 * s }]}>we met here</Text>
        </View>
      ) : null}

      {minutes ? (
        <View
          style={[
            styles.sticker,
            {
              right: 16 * s,
              top: 44 * s,
              paddingHorizontal: 11 * s,
              paddingVertical: 7 * s,
              borderRadius: 11 * s,
            },
          ]}
        >
          <Text style={[styles.stickerBig, { fontSize: 21 * s, lineHeight: 23 * s }]}>{minutes} min</Text>
          <Text style={[styles.stickerSmall, { fontSize: 11 * s }]}>together</Text>
        </View>
      ) : null}

      <View style={[styles.foot, { left: 18 * s, right: 18 * s, bottom: 20 * s }]}>
        {dogsLine ? (
          <View style={[styles.dogsPill, { paddingLeft: 5 * s, paddingRight: 12 * s, paddingVertical: 5 * s, gap: 8 * s }]}>
            <View style={styles.dots}>
              {dogDots.slice(0, 4).map((dot, index) => (
                <View
                  key={`${dot}-${index}`}
                  style={{
                    width: 22 * s,
                    height: 22 * s,
                    borderRadius: 11 * s,
                    backgroundColor: dot,
                    borderWidth: 2 * s,
                    borderColor: dot === color.yellow ? color.navy : color.surface,
                    marginLeft: index === 0 ? 0 : -9 * s,
                  }}
                />
              ))}
            </View>
            <Text style={[styles.dogsText, { fontSize: 12 * s }]} numberOfLines={1}>{dogsLine}</Text>
          </View>
        ) : null}
        <Text
          style={[styles.headline, { fontSize: 30 * s, lineHeight: 35 * s, marginTop: 10 * s }]}
          numberOfLines={3}
        >
          {headline}
        </Text>
        {subline ? (
          <Text style={[styles.subline, { fontSize: 12 * s, marginTop: 6 * s }]} numberOfLines={2}>
            {subline}
          </Text>
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    backgroundColor: color.moment.paper,
    borderWidth: 1,
    borderColor: color.moment.hairline,
    alignSelf: 'center',
  },
  topRow: {
    position: 'absolute',
    zIndex: 5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chip: {
    backgroundColor: color.surface,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: color.moment.hairline,
  },
  chipText: { fontFamily: font.medium, color: color.navy },
  wordmark: { fontFamily: font.bold, color: color.navy, letterSpacing: 0.3 },
  print: {
    position: 'absolute',
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.moment.hairline,
  },
  photo: { width: '100%', height: '100%', backgroundColor: color.moment.hairline },
  meetTag: { position: 'absolute', backgroundColor: color.navy, transform: [{ rotate: '-4deg' }] },
  meetText: { fontFamily: font.medium, color: color.surface },
  sticker: {
    position: 'absolute',
    zIndex: 6,
    backgroundColor: color.yellow,
    alignItems: 'center',
    transform: [{ rotate: '8deg' }],
  },
  stickerBig: { fontFamily: font.bold, color: color.navy },
  stickerSmall: { fontFamily: font.medium, color: color.navy },
  foot: { position: 'absolute' },
  dogsPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.surface,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: color.moment.hairline,
    maxWidth: '100%',
  },
  dots: { flexDirection: 'row' },
  dogsText: { fontFamily: font.semibold, color: color.navy, flexShrink: 1 },
  headline: { fontFamily: font.memoryTitle, color: color.navy },
  subline: { fontFamily: font.regular, color: color.moment.inkSoft },
});
