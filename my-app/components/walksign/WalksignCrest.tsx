import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';
import { color as designColor } from '../../constants/design';
import type { WalksignId } from '../../lib/walksign/types';

// Walksign crests — seven route-pattern marks in the "two lines, one walk"
// language: every crest is a walk drawn from above, never an icon. Same
// stroke voice as the Paw Moment card (round caps, hand-drawn curves), so a
// crest on a share card reads as part of the route drawing beside it.
//
// One `color` prop, layered with opacity, keeps every crest legible on both
// grounds (ink on paper, cream on navy) without a second palette.

interface Props {
  sign: WalksignId;
  /** Rendered square size in px. */
  size?: number;
  /** Stroke color — defaults to ink for light surfaces. */
  color?: string;
}

const VB = 64; // shared viewBox side
const MAIN = 3; // primary stroke width in viewBox units
const SOFT = 0.38; // opacity of secondary strokes

/** The dog's final step — the paw dot every crest ends with. */
function PawDot({ x, y, stroke }: { x: number; y: number; stroke: string }) {
  return <Circle cx={x} cy={y} r={2.4} fill={stroke} />;
}

function crestPaths(sign: WalksignId, stroke: string): React.ReactNode {
  switch (sign) {
    case 'newbond':
      // Two paths beginning together: one departure point, two lines
      // learning to walk side by side.
      return (
        <>
          <Circle cx={12} cy={52} r={3.2} stroke={stroke} strokeWidth={2} fill="none" />
          <Path
            d="M12 52 C 22 46, 30 40, 38 30 S 50 16, 54 12"
            stroke={stroke}
            strokeWidth={MAIN}
            strokeLinecap="round"
            fill="none"
          />
          <Path
            d="M12 52 C 24 50, 34 44, 42 34 S 52 22, 56 18"
            stroke={stroke}
            strokeWidth={MAIN * 0.75}
            strokeLinecap="round"
            fill="none"
            opacity={SOFT}
          />
          <PawDot x={56} y={10} stroke={stroke} />
        </>
      );
    case 'loopkeeper':
      // The imperfect recurring loop — walked so often it almost closes.
      return (
        <>
          <Path
            d="M32 12 C 46 10, 56 22, 52 34 C 48 46, 36 54, 24 50 C 12 46, 8 32, 16 22 C 20 17, 25 13, 30 12"
            stroke={stroke}
            strokeWidth={MAIN}
            strokeLinecap="round"
            fill="none"
          />
          <Circle cx={32} cy={12} r={3.2} stroke={stroke} strokeWidth={2} fill="none" opacity={SOFT} />
          <PawDot x={30} y={12} stroke={stroke} />
        </>
      );
    case 'blockscout':
      // The city grid, interrupted by a wandering nose.
      return (
        <>
          <Path d="M20 10 V54 M44 10 V54 M10 24 H54 M10 42 H54" stroke={stroke} strokeWidth={1.6} strokeLinecap="round" opacity={SOFT * 0.7} fill="none" />
          <Path
            d="M12 50 C 20 48, 18 38, 26 36 C 34 34, 30 26, 38 22 C 44 19, 48 16, 53 13"
            stroke={stroke}
            strokeWidth={MAIN}
            strokeLinecap="round"
            fill="none"
          />
          <PawDot x={54} y={11} stroke={stroke} />
        </>
      );
    case 'packheart':
      // Several paths converging — everyone's walk arrives at the same dog.
      return (
        <>
          <Path d="M10 12 C 20 20, 26 28, 31 37" stroke={stroke} strokeWidth={MAIN * 0.75} strokeLinecap="round" fill="none" opacity={SOFT} />
          <Path d="M54 12 C 44 20, 38 28, 33 37" stroke={stroke} strokeWidth={MAIN * 0.75} strokeLinecap="round" fill="none" opacity={SOFT} />
          <Path d="M32 8 C 32 18, 32 28, 32 36" stroke={stroke} strokeWidth={MAIN * 0.75} strokeLinecap="round" fill="none" opacity={SOFT} />
          <Path
            d="M32 38 C 32 44, 32 48, 32 52"
            stroke={stroke}
            strokeWidth={MAIN}
            strokeLinecap="round"
            fill="none"
          />
          <PawDot x={32} y={55} stroke={stroke} />
        </>
      );
    case 'softstep':
      // Spacious marks with deliberate pauses — the route is mostly rests.
      return (
        <>
          <Path d="M10 50 C 16 46, 20 44, 24 42" stroke={stroke} strokeWidth={MAIN} strokeLinecap="round" fill="none" />
          <Circle cx={29} cy={39} r={3.4} stroke={stroke} strokeWidth={2} fill="none" opacity={SOFT} />
          <Path d="M34 36 C 38 33, 41 31, 44 29" stroke={stroke} strokeWidth={MAIN} strokeLinecap="round" fill="none" />
          <Circle cx={48} cy={26} r={3.4} stroke={stroke} strokeWidth={2} fill="none" opacity={SOFT} />
          <Path d="M51 22 C 53 20, 54 19, 55 18" stroke={stroke} strokeWidth={MAIN} strokeLinecap="round" fill="none" />
          <PawDot x={56} y={14} stroke={stroke} />
        </>
      );
    case 'storywalker':
      // Layered paths accumulated over years — the same way, walked deeper.
      return (
        <>
          <Path d="M8 46 C 20 40, 34 40, 56 34" stroke={stroke} strokeWidth={MAIN * 0.6} strokeLinecap="round" fill="none" opacity={SOFT * 0.6} />
          <Path d="M8 40 C 22 34, 36 34, 56 28" stroke={stroke} strokeWidth={MAIN * 0.75} strokeLinecap="round" fill="none" opacity={SOFT} />
          <Path
            d="M8 34 C 24 28, 38 28, 56 22"
            stroke={stroke}
            strokeWidth={MAIN}
            strokeLinecap="round"
            fill="none"
          />
          <PawDot x={56} y={19} stroke={stroke} />
        </>
      );
    case 'wonderbound':
      // An unfinished line already moving beyond the frame.
      return (
        <>
          <Circle cx={12} cy={52} r={3.2} stroke={stroke} strokeWidth={2} fill="none" opacity={SOFT} />
          <Path
            d="M12 52 C 22 50, 24 42, 30 38 C 38 33, 36 24, 44 18 C 50 14, 56 10, 62 6"
            stroke={stroke}
            strokeWidth={MAIN}
            strokeLinecap="round"
            fill="none"
          />
          <PawDot x={40} y={30} stroke={stroke} />
        </>
      );
  }
}

export function WalksignCrest({ sign, size = 64, color = designColor.ink }: Props) {
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`}>
      {crestPaths(sign, color)}
    </Svg>
  );
}
