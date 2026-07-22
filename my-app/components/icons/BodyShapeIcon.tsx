import React from 'react';
import Svg, { Path, Circle, Ellipse, Rect } from 'react-native-svg';

export type BodyShape = 'thin' | 'ideal' | 'chunky' | 'heavy' | 'veryHeavy';

interface Props {
  shape: BodyShape;
  species?: 'dog' | 'cat';
  size?: number;
  color?: string;
}

// Torso geometry per body-condition band. The topline stays level while the
// belly drops — the same visual cue the WSAVA silhouette charts teach.
const TORSO: Record<BodyShape, { rx: number; ry: number }> = {
  thin: { rx: 15, ry: 6.5 },
  ideal: { rx: 16, ry: 8.5 },
  chunky: { rx: 18, ry: 11 },
  heavy: { rx: 20, ry: 12.5 },
  // BCS 9 — pronounced sag; belly rounder than at BCS 8 so the two chips read
  // as visually distinct instead of both looking the same.
  veryHeavy: { rx: 23, ry: 15 },
};

/**
 * Side-profile pet silhouette for body-condition selection — a visual
 * judgment deserves a visual input, not an abstract glyph. Species-aware:
 * cats get pointed ears and an upright tail, dogs a drop ear, muzzle and a
 * curved tail. Single-tone, recolored via `color` like the other brand icons.
 */
export function BodyShapeIcon({ shape, species = 'dog', size = 56, color = '#0B2A36' }: Props) {
  const { rx, ry } = TORSO[shape];
  const cy = 13 + ry; // level topline at y=13, belly drops with girth
  const backLegX = 30 - rx * 0.55;
  const frontLegX = 30 + rx * 0.45;

  return (
    <Svg width={size} height={size * (44 / 64)} viewBox="0 0 64 44" fill="none">
      {/* Tail */}
      {species === 'cat' ? (
        <Path d="M13 20 C8.5 14 9.5 8 13.5 4.5" stroke={color} strokeWidth={4} strokeLinecap="round" fill="none" />
      ) : (
        <Path d="M12 18 C6 14.5 4.5 9 8.5 5.5" stroke={color} strokeWidth={4} strokeLinecap="round" fill="none" />
      )}
      {/* Legs */}
      <Rect x={backLegX} y={cy} width={3.6} height={40 - cy} rx={1.8} fill={color} />
      <Rect x={frontLegX} y={cy} width={3.6} height={40 - cy} rx={1.8} fill={color} />
      {/* Torso */}
      <Ellipse cx={30} cy={cy} rx={rx} ry={ry} fill={color} />
      {/* Neck — thick stroke merges torso into head */}
      <Path d="M38 18 L49 13" stroke={color} strokeWidth={9} strokeLinecap="round" fill="none" />
      {/* Head */}
      <Circle cx={50} cy={13} r={6.5} fill={color} />
      {species === 'cat' ? (
        <>
          {/* Pointed ears */}
          <Path d="M45.5 8.5 L44 1.5 L50 5.5 Z" fill={color} />
          <Path d="M52 5 L56.5 0.5 L57.5 8 Z" fill={color} />
        </>
      ) : (
        <>
          {/* Muzzle + drop ear */}
          <Circle cx={56.5} cy={15} r={3.5} fill={color} />
          <Path d="M50 7 C46 4.5 43.5 8 45 12.5 C46 15 48.5 14.5 49.5 12 Z" fill={color} />
        </>
      )}
    </Svg>
  );
}
