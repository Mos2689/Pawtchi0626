/**
 * One finished walk on the meetup screen, as a card you want to open — the
 * listing-page shape: a big picture, then a title and two quiet lines.
 *
 * The picture is the best thing the walk left behind, in this order:
 *   1. a photo somebody shared on it (signed URL, cached by storage path);
 *   2. everyone's routes, drawn together on warm map paper — the pack's lines
 *      in the pack-story colours, cased in navy like every route in the app;
 *   3. a navy ticket with the date, for a walk that left neither.
 *
 * Everything here is display; the screen supplies the walk, its card data
 * (lib/community/walkCards) when known, and the cover URL when signed.
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';

import { color, font, radius, space } from '../../constants/design';
import { dateFormat } from '../../lib/dateFormats';
import { projectCommunityRoutes } from '../../lib/communityRouteArtwork';
import { walkCardStats, type WalkCard } from '../../lib/community/walkCards';
import type { CommunityWalk } from '../../lib/communityWalks';

/** The picture's height as a share of the card's width. */
const PICTURE_RATIO = 0.64;
/** The pack-story order, minus the two inks that vanish into the casing. */
const LINE_COLOURS = color.packStoryLines.filter(line => line !== color.navy && line !== '#000000');

export function WalkMemoryCard({
  walk,
  card,
  coverUrl,
  width,
  onOpen,
}: {
  walk: CommunityWalk;
  card?: WalkCard | null;
  coverUrl?: string;
  width: number;
  onOpen: () => void;
}) {
  const height = Math.round(width * PICTURE_RATIO);
  const iso = walk.ended_at ?? walk.scheduled_for;
  const date = iso ? new Date(iso) : null;
  const dated = !!date && !Number.isNaN(date.getTime());
  const artwork = useMemo(
    () => (!coverUrl && card?.routes.length ? projectCommunityRoutes(card.routes, width, height, 28) : []),
    [card?.routes, coverUrl, height, width],
  );
  const stats = walkCardStats(card);
  const photos = card?.photoCount ?? 0;
  const datePill = dated ? dateFormat({ weekday: 'short', day: 'numeric', month: 'short' }).format(date).replace(/,/g, '').toUpperCase() : null;

  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => [{ width }, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Open the memory of ${walk.title}${datePill ? `, ${datePill}` : ''}${stats ? `. ${stats}` : ''}`}
    >
      <View style={[styles.picture, { height }, coverUrl ? null : artwork.length ? styles.pictureMap : styles.pictureTicket]}>
        {coverUrl ? (
          <Image
            // Keyed by the storage PATH: every signing mints a new URL for the
            // same photo, so keyed by URL the disk cache would miss every time.
            source={{ uri: coverUrl, cacheKey: card?.coverPath ?? undefined }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={180}
          />
        ) : artwork.length ? (
          <Svg width={width} height={height}>
            {artwork.map((route, index) => (
              <React.Fragment key={index}>
                <Polyline points={route.points} fill="none" stroke={color.navy} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
                <Polyline
                  points={route.points}
                  fill="none"
                  stroke={LINE_COLOURS[index % LINE_COLOURS.length]}
                  strokeWidth={3.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </React.Fragment>
            ))}
            {artwork.map((route, index) => (route.start ? (
              <Circle
                key={`start-${index}`}
                cx={route.start.x}
                cy={route.start.y}
                r={4.6}
                fill={LINE_COLOURS[index % LINE_COLOURS.length]}
                stroke={color.navy}
                strokeWidth={2}
              />
            ) : null))}
          </Svg>
        ) : (
          // The ticket: the date, said large, on the pass's ground.
          <View style={styles.ticket}>
            <Text style={styles.ticketMonth}>{dated ? dateFormat({ month: 'short' }).format(date).toUpperCase() : 'WALK'}</Text>
            <Text style={styles.ticketDay}>{dated ? dateFormat({ day: 'numeric' }).format(date) : '—'}</Text>
          </View>
        )}

        {datePill && (coverUrl || artwork.length) ? (
          <View style={styles.datePill}>
            <Text style={styles.datePillText}>{datePill}</Text>
          </View>
        ) : null}
        {photos > 0 ? (
          <View style={styles.photoPill}>
            <Ionicons name="images-outline" size={12} color={color.navy} />
            <Text style={styles.photoPillText}>{photos}</Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.title} numberOfLines={1}>{walk.title}</Text>
      {walk.meeting_label ? <Text style={styles.meta} numberOfLines={1}>{walk.meeting_label}</Text> : null}
      <Text style={styles.meta} numberOfLines={1}>{stats || 'Shared memory'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.88 },
  picture: { borderRadius: radius.xl, overflow: 'hidden', backgroundColor: color.pass.mapGround },
  pictureMap: { backgroundColor: color.pass.mapGround },
  pictureTicket: { backgroundColor: color.navy, alignItems: 'center', justifyContent: 'center' },
  ticket: { alignItems: 'center', gap: 2 },
  ticketMonth: { fontFamily: font.bold, fontSize: 11, letterSpacing: 1.6, color: color.pass.onNavyFaint },
  ticketDay: { fontFamily: font.bold, fontSize: 44, lineHeight: 50, color: color.yellow },
  datePill: {
    position: 'absolute',
    top: space.md,
    left: space.md,
    height: 24,
    paddingHorizontal: 9,
    borderRadius: radius.pill,
    backgroundColor: color.navy,
    justifyContent: 'center',
  },
  datePillText: { fontFamily: font.bold, fontSize: 9.5, letterSpacing: 1.1, color: color.pass.paper },
  photoPill: {
    position: 'absolute',
    right: space.md,
    bottom: space.md,
    height: 26,
    paddingHorizontal: 9,
    borderRadius: radius.pill,
    backgroundColor: color.pass.paper,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  photoPillText: { fontFamily: font.bold, fontSize: 11.5, color: color.navy },
  title: { fontFamily: font.bold, fontSize: 15.5, letterSpacing: -0.3, color: color.navy, marginTop: space.md },
  meta: { fontFamily: font.regular, fontSize: 12, lineHeight: 17, color: color.pass.muted, marginTop: 2 },
});
