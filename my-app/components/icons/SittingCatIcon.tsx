import React from 'react';
import Svg, { Path, Circle } from 'react-native-svg';

interface Props {
  size?: number;
  color?: string;
}

/**
 * Sitting-cat silhouette icon — the feline counterpart to RunningDogIcon.
 * Same treatment: a solid single-tone silhouette recolored via the `color`
 * prop so it inherits the surrounding swatch tone. Front-facing pose (ears,
 * round head, bell body, wrapped tail) so it reads clearly at chip sizes.
 */
export function SittingCatIcon({ size = 22, color = '#0B2A36' }: Props) {
  return (
    <Svg width={size} height={size * (80 / 64)} viewBox="0 0 64 80" fill="none">
      {/* Ears — triangles merged into the head circle below */}
      <Path d="M18 22 L14 4 L29 12 Z" fill={color} />
      <Path d="M46 22 L50 4 L35 12 Z" fill={color} />
      {/* Head */}
      <Circle cx={32} cy={24} r={15} fill={color} />
      {/* Body — a bell that tapers from the chest to the haunches */}
      <Path
        d="M32 34 C19 41 12 54 12 66 C12 72.6 16.9 77 23.5 77 L40.5 77 C47.1 77 52 72.6 52 66 C52 54 45 41 32 34 Z"
        fill={color}
      />
      {/* Tail — wraps around the base */}
      <Path
        d="M44 76 C56 77 62 69 59.5 59"
        stroke={color}
        strokeWidth={5.5}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}
