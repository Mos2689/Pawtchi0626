/**
 * PawGlyph — the drawn paw print the companion line ends in, shared by the
 * earned templates. Same geometry as the Fieldbook card's local PawMark
 * (four toes and a pad, drawn not fonted), parameterised so the Signature
 * card can gild it and the Dusk colorway can re-ink it.
 */

import React from 'react';
import { Circle, G, Path } from 'react-native-svg';

interface PawGlyphProps {
  x: number;
  y: number;
  fill: string;
  /** Outline ink; omit for a flat mark (navy/dark grounds). */
  stroke?: string;
  scale?: number;
}

export function PawGlyph({ x, y, fill, stroke, scale = 1 }: PawGlyphProps) {
  const sw = stroke ? 0.7 : 0;
  return (
    <G transform={`translate(${x},${y}) scale(${scale})`}>
      <Circle cx={-4.6} cy={-2.6} r={1.8} fill={fill} stroke={stroke} strokeWidth={sw} />
      <Circle cx={-1.5} cy={-4.6} r={1.8} fill={fill} stroke={stroke} strokeWidth={sw} />
      <Circle cx={1.9} cy={-4.4} r={1.8} fill={fill} stroke={stroke} strokeWidth={sw} />
      <Circle cx={5} cy={-2.2} r={1.8} fill={fill} stroke={stroke} strokeWidth={sw} />
      <Path
        d="M0,-0.6 C2.6,-0.6 4.2,1.4 4.2,3.2 C4.2,5.2 2.2,6.4 0,6.4 C-2.2,6.4 -4.2,5.2 -4.2,3.2 C-4.2,1.4 -2.6,-0.6 0,-0.6 Z"
        fill={fill}
        stroke={stroke}
        strokeWidth={sw}
      />
    </G>
  );
}
