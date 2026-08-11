/**
 * PostcardCard — earned template, gate: 15 walks ("the walk as a travel
 * artifact").
 *
 * The place name set large in the display face, a rotated circular postmark
 * carrying the walk's date, the two-line drawing as the postcard's picture,
 * and the walk's words ruled like address lines behind a dashed divider.
 * Same walk data as every template — the card just pretends the walk was a
 * journey worth writing home about, because it was.
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { color, font, radius } from '../../constants/design';
import { PawtchiWordmark } from '../PawtchiWordmark';
import {
  buildCompanionPath,
  buildMomentHeadline,
  buildMomentJourneyLine,
  buildMomentStats,
  buildOwnerPath,
} from '../../lib/momentCard';
import { PawGlyph } from './PawGlyph';
import type { TemplateCardProps } from './types';

const ink = color.moment;

export function PostcardCard({
  petName,
  petGender,
  startedAt,
  route,
  sniffStops,
  labels,
  stats,
  sessionId,
  width = 320,
}: TemplateCardProps) {
  const height = Math.round((width * 5) / 4);
  const pad = Math.round(width * 0.06);

  const zoneW = width - pad * 2;
  const zoneH = Math.round(height * 0.36);
  const routePad = Math.round(width * 0.04);

  const ownerPath = useMemo(
    () => buildOwnerPath(route, zoneW, zoneH, routePad),
    [route, zoneW, zoneH, routePad],
  );
  const companion = useMemo(
    () => buildCompanionPath(route, sniffStops, zoneW, zoneH, routePad, sessionId),
    [route, sniffStops, zoneW, zoneH, routePad, sessionId],
  );

  const sniffCount = sniffStops.length;
  const headline = useMemo(
    () => buildMomentHeadline(petName, petGender, sniffCount, stats.durationS),
    [petName, petGender, sniffCount, stats.durationS],
  );
  const statsLine = useMemo(
    () =>
      buildMomentStats(stats, sniffCount)
        .map((s) => (s.label === 'Sniffs' ? `${s.value} sniffs` : s.value))
        .join(' · '),
    [stats, sniffCount],
  );
  const journeyLine = useMemo(() => buildMomentJourneyLine(labels), [labels]);
  const place = labels.startLabel ?? (labels.isLoop ? labels.farthestLabel : labels.endLabel);

  const d = new Date(startedAt);
  const stampDay = `${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase()}`;
  const stampYear = String(d.getFullYear());

  const stampSize = Math.round(width * 0.22);
  const addressLines = [headline, statsLine, journeyLine].filter(Boolean) as string[];

  return (
    <View style={[styles.card, { width, height, padding: pad }]}>
      <View style={styles.topRow}>
        <Text
          style={[styles.place, { fontSize: width * 0.115, lineHeight: width * 0.115, maxWidth: width * 0.6 }]}
          numberOfLines={2}
        >
          {(place ?? petName).toUpperCase()}
        </Text>
        {/* The postmark — the walk's date, franked. */}
        <View
          style={[
            styles.stamp,
            { width: stampSize, height: stampSize, borderRadius: stampSize / 2 },
          ]}
        >
          <Text style={[styles.stampMicro, { fontSize: width * 0.028 }]}>WALKED</Text>
          <Text style={[styles.stampDay, { fontSize: width * 0.042 }]}>{stampDay}</Text>
          <Text style={[styles.stampYear, { fontSize: width * 0.028 }]}>{stampYear}</Text>
        </View>
      </View>

      <View style={{ width: zoneW, height: zoneH }}>
        {ownerPath && companion && (
          <Svg width={zoneW} height={zoneH} viewBox={`0 0 ${zoneW} ${zoneH}`}>
            <Path d={ownerPath} fill="none" stroke={ink.ink} strokeWidth={1.3} strokeLinecap="round" opacity={0.7} />
            <Path d={companion.path} fill="none" stroke={ink.yellow} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
            {companion.loops.map((loop, i) => (
              <Circle key={i} cx={loop.x} cy={loop.y} r={loop.r} fill="none" stroke={ink.yellow} strokeWidth={2.4} />
            ))}
            <Circle cx={companion.start.x} cy={companion.start.y} r={2.8} fill={ink.ink} />
            <PawGlyph x={companion.paw.x} y={companion.paw.y} fill={ink.yellow} stroke={ink.ink} />
          </Svg>
        )}
      </View>

      {/* The writing side — the walk's words as address lines. */}
      <View style={[styles.writing, { paddingTop: Math.round(width * 0.03) }]}>
        <View style={{ flex: 1 }}>
          {addressLines.map((line, i) => (
            <Text
              key={i}
              style={[styles.addressLine, { fontSize: width * 0.033, lineHeight: width * 0.062 }]}
              numberOfLines={1}
            >
              {line}
            </Text>
          ))}
        </View>
        <View style={{ justifyContent: 'flex-end', paddingBottom: 2 }}>
          <PawtchiWordmark color={ink.ink} height={Math.round(width * 0.032)} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.moment.paper,
    borderRadius: radius.lg,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  place: {
    fontFamily: font.display,
    color: color.moment.ink,
    letterSpacing: 0.5,
  },
  stamp: {
    borderWidth: 1.6,
    borderColor: color.moment.inkFaint,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '8deg' }],
  },
  stampMicro: {
    fontFamily: font.momentMedium,
    color: color.moment.inkSoft,
    letterSpacing: 1,
  },
  stampDay: {
    fontFamily: font.momentBold,
    color: color.moment.ink,
    marginTop: 1,
  },
  stampYear: {
    fontFamily: font.momentRegular,
    color: color.moment.inkSoft,
    marginTop: 1,
  },
  writing: {
    flexDirection: 'row',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: color.moment.inkFaint,
    borderStyle: 'dashed',
  },
  addressLine: {
    fontFamily: font.momentRegular,
    color: color.moment.inkSoft,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.moment.hairline,
  },
});
