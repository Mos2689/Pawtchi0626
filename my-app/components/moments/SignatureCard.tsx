/**
 * SignatureCard — earned template, gate: 100 walks (the flagship).
 *
 * Navy ground, the dog's line in gilded gold, the pet's name set in the
 * display face, gold-accented stats and a gold paw seal. The only template
 * allowed the gold ink and the only one on the brand's navy — the scarcity
 * is the design, so the card never needs to say what it took to earn.
 * Still just today's walk: name, journey, drawing, stats, wordmark.
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

export function SignatureCard({
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
  const height = Math.round((width * 16) / 9);
  const pad = Math.round(width * 0.07);

  const zoneW = width - pad * 2;
  const zoneH = Math.round(height * 0.4);
  const routePad = Math.round(width * 0.06);

  const ownerPath = useMemo(
    () => buildOwnerPath(route, zoneW, zoneH, routePad),
    [route, zoneW, zoneH, routePad],
  );
  const companion = useMemo(
    () => buildCompanionPath(route, sniffStops, zoneW, zoneH, routePad, sessionId),
    [route, sniffStops, zoneW, zoneH, routePad, sessionId],
  );

  const sniffCount = sniffStops.length;
  const subline = useMemo(() => {
    const journey = buildMomentJourneyLine(labels);
    return (journey ?? buildMomentHeadline(petName, petGender, sniffCount, stats.durationS)).toUpperCase();
  }, [labels, petName, petGender, sniffCount, stats.durationS]);
  const statBlocks = useMemo(() => buildMomentStats(stats, sniffCount), [stats, sniffCount]);

  const d = new Date(startedAt);
  const eyebrow = [
    labels.startLabel ?? (labels.isLoop ? labels.farthestLabel : labels.endLabel),
    `${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'long' })}`,
  ]
    .filter(Boolean)
    .join(' · ')
    .toUpperCase();

  const name = (petName.trim() || 'One good dog').toUpperCase();

  return (
    <View style={[styles.card, { width, height, paddingVertical: Math.round(height * 0.045), paddingHorizontal: pad }]}>
      <View style={[styles.goldRule, { width: Math.round(width * 0.14) }]} />
      <Text style={[styles.eyebrow, { fontSize: width * 0.03, marginTop: Math.round(height * 0.02) }]} numberOfLines={1}>
        {eyebrow}
      </Text>
      <Text
        style={[styles.name, { fontSize: width * 0.17, lineHeight: width * 0.18, marginTop: Math.round(height * 0.012) }]}
        numberOfLines={1}
      >
        {name}
      </Text>

      <View style={{ width: zoneW, height: zoneH, marginTop: Math.round(height * 0.01) }}>
        {ownerPath && companion && (
          <Svg width={zoneW} height={zoneH} viewBox={`0 0 ${zoneW} ${zoneH}`}>
            <Path d={ownerPath} fill="none" stroke={color.creamFaint} strokeWidth={1.1} strokeLinecap="round" />
            <Path d={companion.path} fill="none" stroke={ink.gold} strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" />
            {companion.loops.map((loop, i) => (
              <Circle key={i} cx={loop.x} cy={loop.y} r={loop.r} fill="none" stroke={ink.gold} strokeWidth={2.6} />
            ))}
            <Circle cx={companion.start.x} cy={companion.start.y} r={3} fill={color.cream} />
            <PawGlyph x={companion.paw.x} y={companion.paw.y} fill={ink.gold} />
          </Svg>
        )}
      </View>

      <Text style={[styles.subline, { fontSize: width * 0.03 }]} numberOfLines={1}>
        {subline}
      </Text>

      <View style={[styles.statRow, { marginTop: Math.round(height * 0.03), gap: Math.round(width * 0.06) }]}>
        {statBlocks.map((s, idx) => {
          const [num, ...unit] = s.value.split(' ');
          return (
            <React.Fragment key={s.label}>
              {idx > 0 && <View style={styles.statDivider} />}
              <View style={{ alignItems: 'center' }}>
                <Text style={[styles.statNumber, { fontSize: width * 0.055 }]}>
                  {num}
                  {unit.length > 0 && (
                    <Text style={[styles.statUnit, { fontSize: width * 0.033 }]}> {unit.join(' ')}</Text>
                  )}
                </Text>
                <Text style={[styles.statLabel, { fontSize: width * 0.026 }]}>{s.label.toUpperCase()}</Text>
              </View>
            </React.Fragment>
          );
        })}
      </View>

      <View style={styles.footer}>
        <Svg width={22} height={20} viewBox="-9 -8 18 16">
          <PawGlyph x={0} y={0} fill={ink.gold} />
        </Svg>
        <PawtchiWordmark color={color.cream} height={Math.round(width * 0.038)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.navy,
    borderRadius: radius.lg,
    overflow: 'hidden',
    alignItems: 'center',
  },
  goldRule: {
    borderTopWidth: 1.6,
    borderTopColor: color.moment.gold,
  },
  eyebrow: {
    fontFamily: font.momentSemibold,
    color: color.creamFaint,
    letterSpacing: 3,
  },
  name: {
    fontFamily: font.display,
    color: color.cream,
    letterSpacing: 2,
  },
  subline: {
    fontFamily: font.momentMedium,
    color: color.creamDim,
    letterSpacing: 2.2,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: color.hairlineOnNavy,
  },
  statNumber: {
    fontFamily: font.momentBold,
    color: color.cream,
    fontVariant: ['tabular-nums'],
  },
  statUnit: {
    fontFamily: font.momentMedium,
    color: color.creamDim,
  },
  statLabel: {
    fontFamily: font.momentSemibold,
    color: color.moment.gold,
    letterSpacing: 1.8,
    marginTop: 3,
  },
  footer: {
    marginTop: 'auto',
    alignItems: 'center',
    gap: 8,
  },
});
