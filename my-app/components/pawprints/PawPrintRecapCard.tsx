import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { color, font, radius } from '../../constants/design';
import { PawtchiWordmark } from '../PawtchiWordmark';
import { WalkTile } from './WalkTile';
import type { MonthlyRecap } from '../../lib/pawPrints';
import type { GeoPoint } from '../../lib/walk/geo';

export interface RecapTile {
  id: string;
  route: GeoPoint[] | null;
}

interface Props {
  recap: MonthlyRecap;
  /** Routes for recap.tileSessionIds, same order. */
  tiles: RecapTile[];
  /** Card width in dp; height follows the 9:16 story ratio. */
  width?: number;
}

/**
 * The monthly Paw Print — the ritual card. A month of walks as a small
 * gallery of drawings, the pair's totals, and the month's own texture
 * (favourite place, longest walk). Navy brand ground, link-free.
 */
export function PawPrintRecapCard({ recap, tiles, width = 300 }: Props) {
  const height = Math.round((width * 16) / 9);
  const pad = 20;
  const gap = 10;
  const tileSize = Math.floor((width - pad * 2 - gap * 2) / 3);

  return (
    <View style={[styles.card, { width, height, padding: pad }]}>
      <View>
        <Text style={styles.eyebrow}>PAW PRINT · {recap.monthLabel}</Text>
        <Text style={styles.title}>{recap.title.toUpperCase()}</Text>
      </View>

      <View style={[styles.grid, { gap }]}>
        {tiles.slice(0, 6).map((t) => (
          <WalkTile key={t.id} route={t.route} size={tileSize} raised />
        ))}
      </View>

      <View>
        <View style={styles.statRow}>
          <View style={styles.stat}>
            <Text style={styles.statNumberYellow}>{recap.totalKm} KM</Text>
            <Text style={styles.statLabel}>TOGETHER</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statNumber}>{recap.walkCount}</Text>
            <Text style={styles.statLabel}>WALKS</Text>
          </View>
        </View>

        {(recap.favouritePlace || recap.longestLine) && (
          <Text style={styles.footnote}>
            {recap.favouritePlace ? `Favourite place: ${recap.favouritePlace}. ` : ''}
            {recap.longestLine ?? ''}
          </Text>
        )}

        <View style={styles.footer}>
          <PawtchiWordmark color={color.cream} height={13} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.navy,
    borderRadius: radius.lg,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  eyebrow: {
    fontFamily: font.semibold,
    fontSize: 10,
    letterSpacing: 2.6,
    color: color.creamFaint,
  },
  title: {
    fontFamily: font.display,
    fontSize: 40,
    lineHeight: 42,
    letterSpacing: 1,
    color: color.cream,
    marginTop: 10,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  statRow: {
    flexDirection: 'row',
    gap: 28,
    alignItems: 'flex-end',
  },
  stat: {},
  statNumberYellow: {
    fontFamily: font.display,
    fontSize: 34,
    lineHeight: 36,
    letterSpacing: 1,
    color: color.yellow,
  },
  statNumber: {
    fontFamily: font.display,
    fontSize: 34,
    lineHeight: 36,
    letterSpacing: 1,
    color: color.cream,
  },
  statLabel: {
    fontFamily: font.semibold,
    fontSize: 9,
    letterSpacing: 2,
    color: color.creamFaint,
    marginTop: 3,
  },
  footnote: {
    fontFamily: font.medium,
    fontSize: 12,
    lineHeight: 18,
    color: color.creamDim,
    marginTop: 14,
  },
  footer: {
    alignItems: 'center',
    marginTop: 16,
  },
});
