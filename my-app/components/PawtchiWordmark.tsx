/**
 * PawtchiWordmark — the brand logotype, built from native primitives.
 *
 * "PAWTCH" is a native <Text> in the brand's geometric family (Montserrat
 * ExtraBold, used across the app); the signature dotted "i" is two <View>
 * bars — a square dot over a stem — so the whole glyph reaches cap height like
 * the other letters instead of sitting low as a lowercase "i".
 *
 * Alignment is deterministic, not metric-guesswork: the text line box is
 * pinned to `lineHeight = fontSize`, and the "i" lives in a column of the same
 * height aligned to its bottom. With the baseline ~0.8 of the em down, that
 * seats the stem foot on the baseline and the dot at the cap line.
 *
 * Native text/views (not SVG <Text>, whose fill rendered black on-device) so
 * the `color` tint is honoured exactly — white over the photo card, warm ink
 * on the map/paper grounds.
 *
 * `height` is the cap height in dp; the mark scales from it.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { font } from '../constants/design';

interface PawtchiWordmarkProps {
  /** Ink of the mark. Defaults to white for the photo card. */
  color?: string;
  /** Cap height in dp; the whole mark scales from it. */
  height?: number;
}

export function PawtchiWordmark({ color = '#FFFFFF', height = 20 }: PawtchiWordmarkProps) {
  // Montserrat's caps fill ~0.72 of the em, so this maps cap height → fontSize.
  const fontSize = Math.round(height / 0.72);
  const stemW = Math.max(2, Math.round(fontSize * 0.15));
  const radius = stemW * 0.35;

  // Fractions of the em, measured from the line box: baseline ≈ 0.8 down.
  const dotH = Math.round(fontSize * 0.2);
  const gap = Math.round(fontSize * 0.1);
  const stemH = Math.round(fontSize * 0.4);
  const footPad = Math.round(fontSize * 0.2); // baseline → line-box bottom

  return (
    <View style={styles.row}>
      <Text
        style={{
          fontFamily: font.extrabold,
          fontSize,
          lineHeight: fontSize,
          color,
          letterSpacing: -fontSize * 0.02,
          includeFontPadding: false,
        }}
      >
        PAWTCH
      </Text>
      <View
        style={{
          height: fontSize,
          justifyContent: 'flex-end',
          alignItems: 'center',
          paddingBottom: footPad,
          marginLeft: Math.round(fontSize * 0.12),
        }}
      >
        <View style={{ width: stemW, height: dotH, borderRadius: radius, backgroundColor: color, marginBottom: gap }} />
        <View style={{ width: stemW, height: stemH, borderRadius: radius, backgroundColor: color }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
});
