import React, { useMemo } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { color, radius } from '../../constants/design';
import { projectRouteToSvg } from '../../lib/walk/routeSvg';
import type { GeoPoint } from '../../lib/walk/geo';

interface Props {
  route: GeoPoint[] | null;
  /** Tile edge in dp (tiles are square). */
  size: number;
  /** Slightly raised variant for tiles sitting ON a navy card (recap). */
  raised?: boolean;
  style?: ViewStyle;
}

/**
 * One walk as a drawing — the collection unit of the Paw Prints suite.
 * Yellow route line on a navy tile; identical whether it sits in the gallery
 * grid, the Home teaser strip, or the monthly recap card, so a walk is
 * recognisably "itself" everywhere. Routes that can't draw (patchy GPS)
 * fall back to a quiet paw mark rather than an empty square.
 */
export function WalkTile({ route, size, raised = false, style }: Props) {
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
});
