import React, { useMemo } from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { color, font, radius, space } from '../../constants/design';
import { projectRouteToSvg } from '../../lib/walk/routeSvg';
import type { GeoPoint } from '../../lib/walk/geo';

interface Props {
  route: GeoPoint[] | null;
  /** Tile edge in dp (tiles are square). */
  size: number;
  /** Slightly raised variant for tiles sitting ON a navy card (recap). */
  raised?: boolean;
  /**
   * How many moments were photographed on this walk. 0 shows nothing.
   *
   * A small badge rather than the photo itself: the tile's whole contract is
   * that a walk looks like ITSELF everywhere — gallery, teaser strip, recap
   * card — and swapping the route drawing for a photograph on some tiles and
   * not others would break the collection into two kinds of object.
   */
  momentCount?: number;
  style?: ViewStyle;
}

/**
 * One walk as a drawing — the collection unit of the Paw Prints suite.
 * Yellow route line on a navy tile; identical whether it sits in the gallery
 * grid, the Home teaser strip, or the monthly recap card, so a walk is
 * recognisably "itself" everywhere. Routes that can't draw (patchy GPS)
 * fall back to a quiet paw mark rather than an empty square.
 */
export function WalkTile({ route, size, raised = false, momentCount = 0, style }: Props) {
  const pad = Math.max(8, Math.round(size * 0.14));
  const proj = useMemo(
    () => (route && route.length >= 2 ? projectRouteToSvg(route, size, size, pad) : null),
    [route, size, pad],
  );
  const stroke = Math.max(2, Math.round(size * 0.035));

  return (
    <View
      style={[
        styles.tile,
        { width: size, height: size, backgroundColor: raised ? color.navyRaised : color.navy },
        style,
      ]}
    >
      {proj && proj.points ? (
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Polyline
            points={proj.points}
            fill="none"
            stroke={color.yellow}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {proj.start && (
            <Circle cx={proj.start.x} cy={proj.start.y} r={stroke * 0.9} fill={color.cream} />
          )}
        </Svg>
      ) : (
        <MaterialCommunityIcons name="paw" size={Math.round(size * 0.3)} color={color.hairlineOnNavy} />
      )}

      {momentCount > 0 && (
        <View style={styles.moments}>
          <MaterialCommunityIcons
            name="camera"
            size={Math.max(9, Math.round(size * 0.11))}
            color={color.navy}
          />
          <Text style={[styles.momentsText, { fontSize: Math.max(9, Math.round(size * 0.1)) }]}>
            {momentCount}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  moments: {
    position: 'absolute',
    top: space.xs,
    right: space.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: color.yellow,
  },
  momentsText: {
    fontFamily: font.bold,
    color: color.navy,
  },
});
