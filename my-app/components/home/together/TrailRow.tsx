/**
 * TrailRow — one trail, one line.
 *
 * This replaced a card with a 150px map hero, and the trade was deliberate:
 * six trails now fit where one and a half did. The hero treatment did not
 * disappear, it was promoted — the walk that is actually next gets it, and
 * everything else becomes a list you can scan. A screen where every trail
 * shouted equally was a screen with no hierarchy at all.
 *
 * ── The thumbnail ladder ────────────────────────────────────────────────────
 *
 * Same honesty ladder the trail cards used, at 52px:
 *
 *   1. A photo the pack contributed.
 *   2. A map tile of the meeting point.
 *   3. A quiet glyph — no photo, no coordinate, and the row says so by
 *      showing nothing rather than a picture of somewhere else.
 *
 * ── The badge ───────────────────────────────────────────────────────────────
 *
 * HOSTING / GOING / ASKED, in that order of precedence, and every one of them
 * is read from data rather than guessed. A trail with no badge is one you are
 * simply a member of, which is not a status worth a chip.
 *
 * Deliberately NOT in electric blue, which the mockup used. Electric is fenced
 * to discovery in this app — Nearby, spots, things you have not met yet. A
 * badge saying you are hosting on Sunday is identity, and borrowing the
 * discovery colour for it would quietly dissolve the one rule that makes
 * electric mean anything.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';

import { color, font, space, type } from '../../../constants/design';
import { heroTiles } from '../../../lib/communityMapTile';
import { projectCommunityRoutes } from '../../../lib/communityRouteArtwork';
import type { CommunityPack } from '../../../lib/communityWalks';
import type { GeoPoint } from '../../../lib/walk/geo';
import { DogStack } from '../../community/CommunityUI';

export type TrailBadge = 'hosting' | 'going' | 'asked' | null;

const THUMB = 52;
const TILE_CACHE = 'memory-disk' as const;

const BADGE_LABEL: Record<Exclude<TrailBadge, null>, string> = {
  hosting: 'HOSTING',
  going: 'GOING',
  asked: 'ASKED',
};

interface TrailRowProps {
  pack: CommunityPack;
  coverUrl?: string;
  /** The trail's most recent recorded route, if it has walked one. */
  route?: readonly GeoPoint[];
  /** This trail's identity colour — the same one its line uses on the map. */
  tint: string;
  badge: TrailBadge;
  /** "Sun 7:15 AM · Foreshore Path", already composed by the caller. */
  meta: string;
  footnote: string;
  onOpen: (pack: CommunityPack) => void;
}

export const TrailRow = React.memo(function TrailRow({
  pack,
  coverUrl,
  route,
  tint,
  badge,
  meta,
  footnote,
  onOpen,
}: TrailRowProps) {
  const walk = pack.nextWalk ?? null;
  /**
   * The trail's own shape, drawn from its last recorded walk.
   *
   * Outranks the map tile: a 52px crop of a street map is a grey smudge at
   * this size, while the route is a mark you can tell apart from the one above
   * it at a glance. `projectCommunityRoutes` throws away the coordinates and
   * keeps only the shape, which is also why this is safe to show on a list.
   */
  const artwork = React.useMemo(
    () => (route && route.length > 1
      ? projectCommunityRoutes([route], THUMB, THUMB, 11)[0] ?? null
      : null),
    [route],
  );
  const tiles = React.useMemo(
    () =>
      !coverUrl && !artwork && walk?.meeting_lat != null && walk?.meeting_lng != null
        ? heroTiles(walk.meeting_lat, walk.meeting_lng, THUMB, THUMB)
        : null,
    [artwork, coverUrl, walk?.meeting_lat, walk?.meeting_lng],
  );

  return (
    <Pressable
      onPress={() => onOpen(pack)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${pack.name}. ${meta}. ${footnote}.`}
    >
      <View style={[styles.thumb, artwork ? { backgroundColor: `${tint}22` } : null]}>
        {artwork ? (
          <Svg width={THUMB} height={THUMB}>
            {/* Cased, like every route line in this app: a bare stroke
                disappears into a tinted panel at small sizes. */}
            <Polyline points={artwork.points} fill="none" stroke={color.navy} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
            <Polyline points={artwork.points} fill="none" stroke={tint} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
            {artwork.start ? (
              <Circle cx={artwork.start.x} cy={artwork.start.y} r={3.4} fill={tint} stroke={color.navy} strokeWidth={1.8} />
            ) : null}
          </Svg>
        ) : coverUrl ? (
          <Image
            // Keyed by the storage PATH, not the signed URL. Every signing mints
            // a new URL for the same unchanging photo (paths are per media id),
            // so keyed by URL the disk cache missed on every cold start and the
            // cover re-downloaded. Keyed by path, a fresh signature is a hit.
            source={{ uri: coverUrl, cacheKey: pack.coverPath ?? undefined }}
            style={styles.thumbFill}
            contentFit="cover"
            cachePolicy={TILE_CACHE}
            transition={160}
          />
        ) : tiles ? (
          <>
            {tiles.map(tile => (
              <Image
                key={tile.key}
                source={{ uri: tile.url }}
                style={[
                  styles.tile,
                  { width: tile.size, height: tile.size, left: tile.left, top: tile.top },
                ]}
                cachePolicy={TILE_CACHE}
                transition={0}
              />
            ))}
            <View style={styles.tileWash} />
            <View style={styles.tilePin} />
          </>
        ) : (
          <Ionicons name="paw-outline" size={20} color={color.slateFaint} />
        )}
      </View>

      <View style={styles.copy}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>{pack.name}</Text>
          {badge ? (
            <View style={[
              styles.badge,
              badge === 'hosting' && styles.badgeHosting,
              badge === 'going' && styles.badgeGoing,
              badge === 'asked' && styles.badgeAsked,
            ]}>
              <Text style={[
                styles.badgeText,
                badge === 'going' && styles.badgeTextGoing,
                badge === 'asked' && styles.badgeTextAsked,
              ]}>
                {BADGE_LABEL[badge]}
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.meta} numberOfLines={1}>{meta}</Text>
        <View style={styles.footRow}>
          {pack.dogs?.length ? <DogStack dogs={pack.dogs} max={3} /> : null}
          <Text style={styles.footnote} numberOfLines={1}>{footnote}</Text>
        </View>
      </View>

      <Ionicons name="chevron-forward" size={18} color={color.slateFaint} />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: space.lg,
    borderTopWidth: 1,
    borderTopColor: color.hairline,
  },
  pressed: { opacity: 0.85 },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: 15,
    overflow: 'hidden',
    backgroundColor: color.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  thumbFill: { width: '100%', height: '100%' },
  tile: { position: 'absolute' },
  tileWash: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(248,247,244,0.28)' },
  tilePin: {
    position: 'absolute',
    left: THUMB / 2 - 4,
    top: THUMB / 2 - 4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: color.navy,
    borderWidth: 2,
    borderColor: color.surface,
  },

  copy: { flex: 1, minWidth: 0, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  title: { fontFamily: font.bold, fontSize: 15, letterSpacing: -0.15, color: color.navy, flexShrink: 1 },
  badge: {
    minHeight: 18,
    paddingHorizontal: 6,
    justifyContent: 'center',
    borderRadius: 5,
    borderWidth: 1,
    borderColor: color.navy,
  },
  badgeHosting: { backgroundColor: color.yellow, borderColor: color.yellow },
  // Outlined in electric, which the design asked for and which survives the
  // "discovery only" rule on a technicality worth stating: GOING marks a walk
  // you have not been on yet. It is the one badge about something ahead of you.
  badgeGoing: { borderColor: color.electric },
  badgeAsked: { borderStyle: 'dashed', borderColor: color.slateFaint },
  badgeText: { ...type.caption, fontSize: 9, letterSpacing: 0.9, color: color.navy },
  badgeTextGoing: { color: color.electric },
  badgeTextAsked: { color: color.slateMuted },
  meta: { ...type.caption, fontSize: 11, letterSpacing: 0, color: color.slateMuted },
  footRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  footnote: { ...type.caption, fontSize: 10.5, letterSpacing: 0, color: color.slateFaint, flex: 1 },

});
