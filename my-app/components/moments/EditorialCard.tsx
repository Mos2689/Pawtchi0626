/**
 * EditorialCard — earned template, gate: 30 walks ("the walk as a magazine
 * cover").
 *
 * Masthead rule up top, the walk's own headline set enormous in the display
 * face, the two-line drawing as cover art, and a refined stat strip along
 * the base. The headline is the same deterministic line every template gets
 * from lib/momentCard — this card just gives it front-page billing.
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { color, font, radius } from '../../constants/design';
import { PawtchiWordmark } from '../PawtchiWordmark';
import {
  buildCompanionPath,
  buildMomentHeadline,
  buildMomentStats,
  buildOwnerPath,
  momentDateLine,
} from '../../lib/momentCard';
import { PawGlyph } from './PawGlyph';
import type { TemplateCardProps } from './types';

const ink = color.moment;

export function EditorialCard({
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
  const pad = Math.round(width * 0.075);

  const zoneW = width - pad * 2;
  const zoneH = Math.round(height * 0.26);
  const routePad = Math.round(width * 0.035);

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
    () => buildMomentHeadline(petName, petGender, sniffCount, stats.durationS).toUpperCase(),
    [petName, petGender, sniffCount, stats.durationS],
  );
  const dateLine = useMemo(
    () => momentDateLine(startedAt).toUpperCase(),
    [startedAt],
  );
  const place = labels.startLabel ?? (labels.isLoop ? labels.farthestLabel : labels.endLabel);
  const statBlocks = useMemo(() => buildMomentStats(stats, sniffCount), [stats, sniffCount]);

  return (
    <View style={[styles.card, { width, height, padding: pad }]}>
      {/* Masthead */}
      <View style={styles.masthead}>
        <PawtchiWordmark color={ink.ink} height={Math.round(width * 0.036)} />
        <Text style={[styles.mastheadDate, { fontSize: width * 0.03 }]}>{dateLine}</Text>
      </View>

      {/* Cover line */}
      <Text
        style={[
          styles.headline,
          { fontSize: width * 0.135, lineHeight: width * 0.135, marginTop: Math.round(width * 0.05) },
        ]}
        numberOfLines={3}
      >
        {headline}
      </Text>

      {/* Cover art */}
      <View style={{ width: zoneW, height: zoneH, marginTop: Math.round(width * 0.04) }}>
        {ownerPath && companion && (
          <Svg width={zoneW} height={zoneH} viewBox={`0 0 ${zoneW} ${zoneH}`}>
            <Path d={ownerPath} fill="none" stroke={ink.ink} strokeWidth={1.2} strokeLinecap="round" opacity={0.7} />
            <Path d={companion.path} fill="none" stroke={ink.yellow} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
            {companion.loops.map((loop, i) => (
              <Circle key={i} cx={loop.x} cy={loop.y} r={loop.r} fill="none" stroke={ink.yellow} strokeWidth={2.4} />
            ))}
            <Circle cx={companion.start.x} cy={companion.start.y} r={2.8} fill={ink.ink} />
            <PawGlyph x={companion.paw.x} y={companion.paw.y} fill={ink.yellow} stroke={ink.ink} />
          </Svg>
        )}
      </View>

      {/* Base strip */}
      <View style={[styles.baseStrip, { paddingTop: Math.round(width * 0.03) }]}>
        <Text style={[styles.baseText, { fontSize: width * 0.036 }]} numberOfLines={1}>
          {place ? `${place}  ·  ` : ''}
          {statBlocks.map((s, i) => (
            <Text key={s.label}>
              {i > 0 ? '  ·  ' : ''}
              <Text style={styles.baseValue}>{s.value}</Text>
              {s.label === 'Sniffs' ? <Text style={styles.baseUnit}> sniffs</Text> : null}
            </Text>
          ))}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.moment.paper,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  masthead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    borderBottomWidth: 1.6,
    borderBottomColor: color.moment.ink,
    paddingBottom: 8,
  },
  mastheadDate: {
    fontFamily: font.momentMedium,
    color: color.moment.inkFaint,
    letterSpacing: 1.2,
  },
  headline: {
    fontFamily: font.display,
    color: color.moment.ink,
    letterSpacing: 0.5,
  },
  baseStrip: {
    marginTop: 'auto',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.moment.hairline,
  },
  baseText: {
    fontFamily: font.momentRegular,
    color: color.moment.inkSoft,
  },
  baseValue: {
    fontFamily: font.momentBold,
    color: color.moment.ink,
  },
  baseUnit: {
    fontFamily: font.momentRegular,
    color: color.moment.inkSoft,
  },
});
