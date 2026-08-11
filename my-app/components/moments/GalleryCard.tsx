/**
 * GalleryCard — earned template, gate: 7 walks ("the walk as framed art").
 *
 * A wide warm mat around a paper panel holding the two-line drawing, with a
 * dark plaque beneath carrying the walk's own headline and stats — an
 * exhibition label, not a caption. Same walk data as every template; the
 * framing is the whole statement. Supports the premium Dusk colorway: the
 * artwork panel turns to night, the mat and plaque hold.
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
} from '../../lib/momentCard';
import { PawGlyph } from './PawGlyph';
import type { TemplateCardProps } from './types';

const ink = color.moment;

/** "23 July" — the plaque's compact date. */
function shortDate(startedAt: number): string {
  const d = new Date(startedAt);
  return `${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'long' })}`;
}

export function GalleryCard({
  petName,
  petGender,
  startedAt,
  route,
  sniffStops,
  labels,
  stats,
  sessionId,
  width = 320,
  colorway = 'classic',
}: TemplateCardProps) {
  const height = Math.round((width * 5) / 4);
  const dusk = colorway === 'dusk';

  const matPad = Math.round(width * 0.07);
  const artW = width - matPad * 2;
  const artH = Math.round(height * 0.6);
  const routePad = Math.round(width * 0.06);

  const ownerPath = useMemo(
    () => buildOwnerPath(route, artW, artH, routePad),
    [route, artW, artH, routePad],
  );
  const companion = useMemo(
    () => buildCompanionPath(route, sniffStops, artW, artH, routePad, sessionId),
    [route, sniffStops, artW, artH, routePad, sessionId],
  );

  const sniffCount = sniffStops.length;
  const headline = useMemo(
    () => buildMomentHeadline(petName, petGender, sniffCount, stats.durationS),
    [petName, petGender, sniffCount, stats.durationS],
  );
  const metaLine = useMemo(() => {
    const place = labels.startLabel ?? (labels.isLoop ? labels.farthestLabel : labels.endLabel);
    const statBits = buildMomentStats(stats, sniffCount).map((s) =>
      s.label === 'Sniffs' ? `${s.value} sniffs` : s.value,
    );
    return [place, shortDate(startedAt), ...statBits]
      .filter(Boolean)
      .join(' · ')
      .toUpperCase();
  }, [labels, startedAt, stats, sniffCount]);

  const ground = dusk ? ink.duskGround : ink.paper;
  const artBorder = dusk ? ink.duskHairline : ink.hairline;
  const line = dusk ? ink.duskLine : ink.yellow;
  const ownerStroke = dusk ? color.creamFaint : ink.ink;
  const startDot = dusk ? color.cream : ink.ink;

  return (
    <View style={[styles.mat, { width, height, padding: matPad }]}>
      <View style={{ width: artW, height: artH, backgroundColor: ground, borderWidth: 1, borderColor: artBorder }}>
        {ownerPath && companion && (
          <Svg width={artW} height={artH} viewBox={`0 0 ${artW} ${artH}`}>
            <Path d={ownerPath} fill="none" stroke={ownerStroke} strokeWidth={1.4} strokeLinecap="round" opacity={dusk ? 1 : 0.75} />
            <Path d={companion.path} fill="none" stroke={line} strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" />
            {companion.loops.map((loop, i) => (
              <Circle key={i} cx={loop.x} cy={loop.y} r={loop.r} fill="none" stroke={line} strokeWidth={2.6} />
            ))}
            <Circle cx={companion.start.x} cy={companion.start.y} r={3} fill={startDot} />
            <PawGlyph x={companion.paw.x} y={companion.paw.y} fill={line} stroke={dusk ? undefined : ink.ink} />
          </Svg>
        )}
      </View>

      {/* The exhibition plaque — the walk's own words, set small and formal. */}
      <View style={[styles.plaque, { paddingVertical: Math.round(width * 0.034), paddingHorizontal: Math.round(width * 0.05) }]}>
        <Text style={[styles.plaqueHeadline, { fontSize: width * 0.045 }]} numberOfLines={1}>
          {headline}
        </Text>
        <Text style={[styles.plaqueMeta, { fontSize: width * 0.03 }]} numberOfLines={1}>
          {metaLine}
        </Text>
        <View style={{ marginTop: Math.round(width * 0.028), alignItems: 'center' }}>
          <PawtchiWordmark color={color.creamFaint} height={Math.round(width * 0.028)} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mat: {
    backgroundColor: color.cream,
    justifyContent: 'space-between',
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  plaque: {
    backgroundColor: color.moment.ink,
    borderRadius: 3,
    alignItems: 'center',
  },
  plaqueHeadline: {
    fontFamily: font.momentSemibold,
    color: color.cream,
    letterSpacing: 0.3,
  },
  plaqueMeta: {
    fontFamily: font.momentMedium,
    color: color.creamDim,
    letterSpacing: 1.1,
    marginTop: 4,
  },
});
