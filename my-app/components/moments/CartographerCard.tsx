/**
 * CartographerCard — earned template, gate: 50 walks ("the walk as a survey
 * chart").
 *
 * Coordinate grid, plate border, compass rose, a coordinates line, and the
 * map-true scale bar the shared projection already computes — the same
 * instruments a real chart carries, all earned by the data. The walk is the
 * terrain; the title block gives it the walk's own headline and stats.
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { color, font, radius } from '../../constants/design';
import { PawtchiWordmark } from '../PawtchiWordmark';
import {
  buildCompanionPath,
  buildMomentHeadline,
  buildMomentStats,
  buildOwnerPath,
  routeScaleBar,
} from '../../lib/momentCard';
import { PawGlyph } from './PawGlyph';
import type { TemplateCardProps } from './types';

const ink = color.moment;

/** "51.492 N · 0.061 W" from the route's midpoint; null with no fix. */
function coordinatesLine(route: TemplateCardProps['route']): string | null {
  if (route.length === 0) return null;
  let latSum = 0;
  let lngSum = 0;
  for (const p of route) {
    latSum += p.lat;
    lngSum += p.lng;
  }
  const lat = latSum / route.length;
  const lng = lngSum / route.length;
  return `${Math.abs(lat).toFixed(3)} ${lat >= 0 ? 'N' : 'S'} · ${Math.abs(lng).toFixed(3)} ${lng >= 0 ? 'E' : 'W'}`;
}

export function CartographerCard({
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

  const platePad = Math.round(width * 0.045);
  const plateW = width - platePad * 2;
  const plateH = Math.round(height * 0.72);
  const routePad = Math.round(width * 0.1);

  const ownerPath = useMemo(
    () => buildOwnerPath(route, plateW, plateH, routePad),
    [route, plateW, plateH, routePad],
  );
  const companion = useMemo(
    () => buildCompanionPath(route, sniffStops, plateW, plateH, routePad, sessionId),
    [route, sniffStops, plateW, plateH, routePad, sessionId],
  );
  const scaleBar = useMemo(
    () => routeScaleBar(route, plateW, plateH, routePad, Math.round(plateW * 0.32)),
    [route, plateW, plateH, routePad],
  );
  const coords = useMemo(() => coordinatesLine(route), [route]);

  const sniffCount = sniffStops.length;
  const headline = useMemo(
    () => buildMomentHeadline(petName, petGender, sniffCount, stats.durationS).toUpperCase(),
    [petName, petGender, sniffCount, stats.durationS],
  );
  const metaLine = useMemo(() => {
    const place = labels.startLabel ?? (labels.isLoop ? labels.farthestLabel : labels.endLabel);
    const d = new Date(startedAt);
    const date = `${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'long' })} ${d.getFullYear()}`;
    const statBits = buildMomentStats(stats, sniffCount).map((s) =>
      s.label === 'Sniffs' ? `${s.value} sniffs` : s.value,
    );
    return [place, ...statBits, date].filter(Boolean).join(' · ');
  }, [labels, startedAt, stats, sniffCount]);

  // Grid pitch — a steady survey lattice, indifferent to the route.
  const gridX = Math.round(width * 0.215);
  const gridY = Math.round(height * 0.17);
  const vLines = [];
  for (let x = gridX; x < width; x += gridX) vLines.push(x);
  const hLines = [];
  for (let y = gridY; y < height; y += gridY) hLines.push(y);

  const compass = { x: width - platePad - Math.round(width * 0.085), y: platePad + Math.round(width * 0.1), r: Math.round(width * 0.055) };
  const scaleBarPos = {
    x: platePad + Math.round(width * 0.04),
    y: platePad + plateH - Math.round(width * 0.05),
  };

  return (
    <View style={[styles.card, { width, height }]}>
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={StyleSheet.absoluteFill}>
        {vLines.map((x) => (
          <Line key={`v${x}`} x1={x} y1={0} x2={x} y2={height} stroke={ink.hairline} strokeWidth={0.7} />
        ))}
        {hLines.map((y) => (
          <Line key={`h${y}`} x1={0} y1={y} x2={width} y2={y} stroke={ink.hairline} strokeWidth={0.7} />
        ))}

        <Rect x={platePad} y={platePad} width={plateW} height={plateH} fill="none" stroke={ink.inkFaint} strokeWidth={1} />

        {ownerPath && companion && (
          <G x={platePad} y={platePad}>
            <Path d={ownerPath} fill="none" stroke={ink.ink} strokeWidth={1.3} strokeLinecap="round" opacity={0.7} />
            <Path d={companion.path} fill="none" stroke={ink.yellow} strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" />
            {companion.loops.map((loop, i) => (
              <Circle key={i} cx={loop.x} cy={loop.y} r={loop.r} fill="none" stroke={ink.yellow} strokeWidth={2.6} />
            ))}
            <Circle cx={companion.start.x} cy={companion.start.y} r={3} fill={ink.ink} />
            <PawGlyph x={companion.paw.x} y={companion.paw.y} fill={ink.yellow} stroke={ink.ink} />
          </G>
        )}

        {/* Compass rose */}
        <G x={compass.x} y={compass.y}>
          <Circle r={compass.r} fill={ink.paperMap} stroke={ink.inkSoft} strokeWidth={1} />
          <Path
            d={`M0,${-compass.r * 0.7} L${compass.r * 0.22},0 L0,${compass.r * 0.7} L${-compass.r * 0.22},0 Z`}
            fill={ink.inkSoft}
          />
          <SvgText
            y={-compass.r - 5}
            textAnchor="middle"
            fontFamily={font.momentMedium}
            fontSize={width * 0.032}
            fill={ink.inkSoft}
          >
            N
          </SvgText>
        </G>

        {/* Map-true scale bar — the projection's own honesty. */}
        {scaleBar && (
          <G x={scaleBarPos.x} y={scaleBarPos.y}>
            <Line x1={0} y1={0} x2={scaleBar.px} y2={0} stroke={ink.ink} strokeWidth={1.6} />
            <Line x1={0} y1={-4} x2={0} y2={4} stroke={ink.ink} strokeWidth={1.2} />
            <Line x1={scaleBar.px} y1={-4} x2={scaleBar.px} y2={4} stroke={ink.ink} strokeWidth={1.2} />
            <SvgText
              x={scaleBar.px / 2}
              y={Math.round(width * 0.04)}
              textAnchor="middle"
              fontFamily={font.momentMedium}
              fontSize={width * 0.03}
              fill={ink.inkSoft}
            >
              {scaleBar.label}
            </SvgText>
          </G>
        )}

        {coords && (
          <SvgText
            x={platePad + Math.round(width * 0.04)}
            y={platePad + plateH + Math.round(width * 0.055)}
            fontFamily={font.momentRegular}
            fontSize={width * 0.028}
            letterSpacing={1}
            fill={ink.inkFaint}
          >
            {coords}
          </SvgText>
        )}
      </Svg>

      {/* Title block */}
      <View style={[styles.titleBlock, { left: platePad + 2, right: platePad + 2, bottom: Math.round(width * 0.05) }]}>
        <View style={{ flex: 1, paddingRight: 8 }}>
          <Text style={[styles.titleHeadline, { fontSize: width * 0.04 }]} numberOfLines={1}>
            {headline}
          </Text>
          <Text style={[styles.titleMeta, { fontSize: width * 0.03 }]} numberOfLines={1}>
            {metaLine}
          </Text>
        </View>
        <PawtchiWordmark color={ink.ink} height={Math.round(width * 0.034)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.moment.paperMap,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  titleBlock: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderTopWidth: 1.4,
    borderTopColor: color.moment.ink,
    paddingTop: 8,
  },
  titleHeadline: {
    fontFamily: font.momentBold,
    color: color.moment.ink,
    letterSpacing: 0.6,
  },
  titleMeta: {
    fontFamily: font.momentRegular,
    color: color.moment.inkSoft,
    marginTop: 3,
  },
});
