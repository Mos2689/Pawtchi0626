// Postal motifs for the Write to Founder flow.
//
// The letter screens had no personality: a plain card of body copy on a flat
// ground, indistinguishable from a settings page. These give the surface an
// identity borrowed from actual correspondence — a franked stamp, a perforated
// tear line, a hand-drawn signature rule — so the screen reads as a letter
// before a single word is.
//
// (An airmail chevron band across the card's top edge was tried and cut: at a
// realistic 9px it read as a dashed border rather than as edging.)
//
// All three are pure SVG, take their colours from `color.letter.*`, and are
// decorative: nothing here carries information, so screen readers skip it.

import React from 'react';
import { View, StyleSheet, type ViewStyle } from 'react-native';
import Svg, { Circle, Line, Path, Rect, G } from 'react-native-svg';
import { MaterialIcons } from '@expo/vector-icons';
import { color, radius } from '../../constants/design';

/**
 * A franked postage stamp: perforated yellow square, the animal's silhouette,
 * and a blue postmark ring struck across one corner.
 *
 * The perforations are punched by drawing circles in `punchColor` over the
 * edges, so this only reads correctly on a ground of that colour — white by
 * default, which is what every letter screen uses.
 */
export function PostageStamp({
  size = 92,
  punchColor = color.letter.paper,
  style,
}: {
  size?: number;
  punchColor?: string;
  style?: ViewStyle;
}) {
  const perfR = size * 0.038;
  const perfCount = 7;
  const step = size / perfCount;
  const perfs = Array.from({ length: perfCount }, (_, i) => step * i + step / 2);

  return (
    <View style={[{ width: size, height: size }, style]} pointerEvents="none">
      <Svg width={size} height={size}>
        <Rect x={0} y={0} width={size} height={size} rx={3} fill={color.letter.yellow} />

        {/* Inner keyline, the way a real stamp frames its artwork. */}
        <Rect
          x={size * 0.11}
          y={size * 0.11}
          width={size * 0.78}
          height={size * 0.78}
          rx={2}
          fill="none"
          stroke={color.navy}
          strokeWidth={1}
          strokeOpacity={0.35}
        />

        {/* Postmark — two rings and three cancellation bars, struck off-centre
            so it looks stamped by hand rather than printed. */}
        <G opacity={0.9}>
          <Circle
            cx={size * 0.72}
            cy={size * 0.28}
            r={size * 0.2}
            fill="none"
            stroke={color.letter.accent}
            strokeWidth={1.6}
          />
          <Circle
            cx={size * 0.72}
            cy={size * 0.28}
            r={size * 0.145}
            fill="none"
            stroke={color.letter.accent}
            strokeWidth={0.9}
          />
          {[0, 1, 2].map((i) => (
            <Line
              key={i}
              x1={size * 0.58}
              y1={size * 0.23 + i * size * 0.05}
              x2={size * 0.86}
              y2={size * 0.23 + i * size * 0.05}
              stroke={color.letter.accent}
              strokeWidth={0.9}
              strokeOpacity={0.75}
            />
          ))}
        </G>

        {/* Perforations, punched last so they sit over every edge. */}
        {perfs.map((p) => (
          <React.Fragment key={p}>
            <Circle cx={p} cy={0} r={perfR} fill={punchColor} />
            <Circle cx={p} cy={size} r={perfR} fill={punchColor} />
            <Circle cx={0} cy={p} r={perfR} fill={punchColor} />
            <Circle cx={size} cy={p} r={perfR} fill={punchColor} />
          </React.Fragment>
        ))}
      </Svg>

      {/* The paw sits in the stamp's lower-left, clear of the postmark. */}
      <MaterialIcons
        name="pets"
        size={size * 0.34}
        color={color.navy}
        style={{ position: 'absolute', left: size * 0.18, top: size * 0.46 }}
      />
    </View>
  );
}

/**
 * A tear-line: the dashed perforation that separates a stub from a ticket.
 * Used instead of a plain hairline wherever the letter needs a divider.
 */
export function PerforatedDivider({ style }: { style?: ViewStyle }) {
  return <View style={[styles.perforated, style]} pointerEvents="none" />;
}

/**
 * The wobble under a signature. Hand-drawn on purpose — a straight rule reads
 * as a form field, and the whole point of the signature is that a person wrote
 * it. Fixed path, so it is identical on every render.
 */
export function SignatureRule({ width = 150, style }: { width?: number; style?: ViewStyle }) {
  const h = 12;
  return (
    <View style={[{ width, height: h }, style]} pointerEvents="none">
      <Svg width={width} height={h} viewBox="0 0 150 12">
        <Path
          d="M2 8 C 22 2, 40 11, 58 6 S 96 1, 114 7 S 138 10, 148 4"
          stroke={color.letter.accent}
          strokeWidth={2.2}
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  perforated: {
    height: 1,
    borderRadius: radius.sm,
    borderBottomWidth: 1.5,
    borderStyle: 'dashed',
    borderBottomColor: color.letter.hairline,
  },
});
