/**
 * PawTrailFlourish — what the map shows before a trail has been walked.
 *
 * ── The constraint this is built around ────────────────────────────────────
 *
 * A brand-new trail has a meeting point and no route, so the Together map
 * opened as empty streets with a dot on them. It needed something. But the
 * obvious something — a pretty line — is the one thing it must never be:
 * every other line on this map is a real GPS recording, and a decorative curve
 * in the same visual language would be indistinguishable from a walk somebody
 * actually took. That is not a pretty map, it is a lie about where a dog has
 * been.
 *
 * So the placeholder is made of paw prints. Not a stroke — discrete marks,
 * spaced apart, each rotated to face the way it is going. Nothing in this app
 * draws a real route that way, so the difference is legible at a glance and at
 * any zoom, and it reads as illustration rather than data even to somebody who
 * has never been told the rule.
 *
 * Two more things keep it honest:
 *
 *   It is not anchored to coordinates. It floats in the viewport and does not
 *   move when the map pans, because it is not about anywhere.
 *
 *   It says so. A line of copy under the prints names it as an empty state
 *   instead of leaving a pretty shape to be interpreted.
 *
 * It disappears the moment a single trail has a real route to draw. The good
 * version of this screen is the one where this component never renders.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { G, Ellipse } from 'react-native-svg';

import { color, font, type } from '../../../constants/design';

/**
 * Where the prints fall, as fractions of the band they are drawn into.
 *
 * Hand-placed rather than sampled from a curve: an even machine arc reads as a
 * graph, and the whole point is that this looks drawn. The spacing tightens
 * slightly toward the end the way a dog slows into a sniff.
 */
const STEPS: { x: number; y: number; angle: number; scale: number }[] = [
  { x: 0.06, y: 0.78, angle: -28, scale: 0.86 },
  { x: 0.19, y: 0.62, angle: -34, scale: 0.94 },
  { x: 0.32, y: 0.50, angle: -18, scale: 1 },
  { x: 0.46, y: 0.44, angle: 4, scale: 1 },
  { x: 0.60, y: 0.46, angle: 20, scale: 0.98 },
  { x: 0.73, y: 0.38, angle: 8, scale: 0.92 },
  { x: 0.85, y: 0.26, angle: -12, scale: 0.84 },
];

/** One paw: four toes over a pad, at the size a print wants to be. */
function Paw({ size, opacity }: { size: number; opacity: number }) {
  const toe = size * 0.17;
  return (
    <G opacity={opacity}>
      <Ellipse cx={size * 0.28} cy={size * 0.30} rx={toe * 0.8} ry={toe} fill={color.navy} />
      <Ellipse cx={size * 0.50} cy={size * 0.20} rx={toe * 0.8} ry={toe} fill={color.navy} />
      <Ellipse cx={size * 0.72} cy={size * 0.26} rx={toe * 0.8} ry={toe} fill={color.navy} />
      <Ellipse cx={size * 0.88} cy={size * 0.46} rx={toe * 0.72} ry={toe * 0.9} fill={color.navy} />
      <Ellipse cx={size * 0.52} cy={size * 0.68} rx={size * 0.30} ry={size * 0.26} fill={color.navy} />
    </G>
  );
}

export function PawTrailFlourish({
  width,
  height,
  caption = 'Meet up and your walks draw themselves here',
}: {
  width: number;
  height: number;
  caption?: string;
}) {
  if (width <= 0 || height <= 0) return null;
  const pawSize = Math.max(18, Math.min(30, width * 0.072));

  return (
    <View style={styles.wrap} pointerEvents="none">
      <Svg width={width} height={height}>
        {STEPS.map((step, index) => {
          const size = pawSize * step.scale;
          const x = step.x * width;
          const y = step.y * height;
          return (
            <G
              key={`${step.x}-${step.y}`}
              transform={`translate(${x}, ${y}) rotate(${step.angle}) translate(${-size / 2}, ${-size / 2})`}
            >
              {/* Fading forward, so the trail reads as going somewhere rather
                  than as a static pattern. */}
              <Paw size={size} opacity={0.20 - index * 0.016} />
            </G>
          );
        })}
      </Svg>
      <Text style={styles.caption} numberOfLines={2}>{caption}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  caption: {
    ...type.caption,
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: 0.2,
    color: color.slateFaint,
    textAlign: 'center',
    marginTop: -6,
    paddingHorizontal: 40,
  },
});
