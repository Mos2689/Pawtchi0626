/**
 * BrandLasso — the wandering yellow line, at UI scale.
 *
 * The campaign's lasso and the walk line on the map are the same object: the
 * path a dog and their human actually took, which never goes straight. This
 * draws it small enough to sit inside a card, so a surface that talks about
 * getting somewhere can say so in the brand's own mark rather than in a generic
 * dotted rule.
 *
 * ── One stroke, uncased ──
 * WalkMap cases this line in navy on the basemap, and it was cased here too for
 * a moment. It is bare on purpose now: the casing is a legibility device for a
 * line crossing photographic map tiles, and on a flat card it turned the mark
 * into an outlined sticker rather than the loose yellow line the campaigns run.
 *
 * The trade is real and accepted — brand yellow is a low-contrast mark on a
 * light ground (constants/design.ts, the brand book's rule about yellow as
 * ink). This is a decorative connector carrying no information the labels at
 * either end do not already state, which is the only reason it is a fair trade
 * here; it is NOT licence to draw yellow hairlines that have to be read.
 *
 * ── Why `width` is a prop rather than a percentage ──
 * SVG scaled with `preserveAspectRatio="none"` stretches the stroke with the
 * geometry, so the same lasso would be a fat line in a wide gap and a thin one
 * in a narrow gap. The caller measures and passes real pixels; the curve is
 * generated at that size and the stroke stays constant.
 */

import React, { useMemo } from 'react';
import Svg, { Path } from 'react-native-svg';

import { color } from '../constants/design';

/**
 * A double S-bend across `w`, entering and leaving level.
 *
 * Both ends sit exactly on the vertical centre so the line meets whatever it
 * connects at a predictable height, and the wandering happens in between —
 * a route that arrives crooked reads as an error rather than as a walk.
 *
 * Deliberately fixed rather than seeded per place (cf. `milestoneSquigglePath`,
 * which is random-per-milestone on purpose). This one is a brand mark: it has
 * to be the same shape every time an owner sees it.
 */
export function lassoPath(w: number, h: number, amplitude: number): string {
  const cy = h / 2;
  const a = amplitude;
  return [
    `M 0 ${cy}`,
    `C ${w * 0.16} ${cy - a} ${w * 0.3} ${cy + a} ${w * 0.48} ${cy}`,
    `C ${w * 0.66} ${cy - a} ${w * 0.82} ${cy + a * 0.9} ${w} ${cy}`,
  ].join(' ');
}

interface BrandLassoProps {
  /** Measured drawing width in dp. Nothing renders below 2. */
  width: number;
  height?: number;
  strokeWidth?: number;
  /** How far the curve wanders from centre. Clamped to fit the height. */
  amplitude?: number;
}

export function BrandLasso({
  width,
  height = 24,
  strokeWidth = 3,
  amplitude = 4.5,
}: BrandLassoProps) {
  // The curve has to stay half a stroke clear of the top and bottom edges, or
  // the crests get clipped flat.
  const room = Math.max(0, (height - strokeWidth) / 2);
  const amp = Math.min(amplitude, room);

  const d = useMemo(() => lassoPath(width, height, amp), [width, height, amp]);

  if (width < 2) return null;

  return (
    <Svg width={width} height={height} pointerEvents="none">
      <Path
        d={d}
        fill="none"
        stroke={color.yellow}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </Svg>
  );
}
