import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { color, font, radius } from '../../constants/design';
import { PawtchiWordmark } from '../PawtchiWordmark';
import { MilestoneDef, milestoneSquigglePath, milestoneSubline } from '../../lib/pawPrints';

interface Props {
  def: MilestoneDef;
  petName: string;
  petGender?: string | null;
  /** "May" — grounds the distance sub-line; null omits the time anchor. */
  firstWalkMonth: string | null;
  /** Card width in dp; height follows the 4:5 portrait ratio. */
  width?: number;
}

/**
 * The milestone share card — a navy brand moment. Giant yellow number, calm
 * one-line credit to the pair who earned it, and a small seeded squiggle
 * (deterministic per milestone id, same rule as the Paw Moment weave).
 * Link-free by design: the wordmark is the only trace of the app.
 */
export function MilestoneCard({ def, petName, petGender, firstWalkMonth, width = 300 }: Props) {
  const height = Math.round((width * 5) / 4);
  // Longer values (100, 1000) shrink so the number never kisses the edges.
  const numberSize = def.value.length <= 2 ? width * 0.44 : def.value.length === 3 ? width * 0.34 : width * 0.27;
  const squiggleW = Math.round(width * 0.4);
  const squiggleH = 22;
  const squiggle = milestoneSquigglePath(def.id, squiggleW, squiggleH);
  const subline = milestoneSubline(def, petName, petGender, firstWalkMonth);

  return (
    <View style={[styles.card, { width, height }]}>
      <Text style={styles.eyebrow}>MILESTONE</Text>

      <View style={styles.center}>
        <Text style={[styles.number, { fontSize: numberSize, lineHeight: numberSize * 1.02 }]}>
          {def.value}
        </Text>
        <Text style={styles.unit}>{def.unit.toUpperCase()}</Text>
        <Text style={styles.subline}>{subline}</Text>
        {squiggle && (
          <Svg width={squiggleW} height={squiggleH} viewBox={`0 0 ${squiggleW} ${squiggleH}`} style={styles.squiggle}>
            <Path d={squiggle} fill="none" stroke={color.creamFaint} strokeWidth={2} strokeLinecap="round" />
          </Svg>
        )}
      </View>

      <View style={styles.footer}>
        <PawtchiWordmark color={color.cream} height={14} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.navy,
    borderRadius: radius.lg,
    overflow: 'hidden',
    paddingVertical: 22,
    paddingHorizontal: 20,
    justifyContent: 'space-between',
  },
  eyebrow: {
    fontFamily: font.semibold,
    fontSize: 10,
    letterSpacing: 2.6,
    color: color.creamFaint,
  },
  center: {
    alignItems: 'center',
  },
  number: {
    fontFamily: font.display,
    color: color.yellow,
    letterSpacing: 1,
  },
  unit: {
    fontFamily: font.display,
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: 3,
    color: color.cream,
    marginTop: 2,
  },
  subline: {
    fontFamily: font.medium,
    fontSize: 13,
    lineHeight: 19,
    color: color.creamDim,
    textAlign: 'center',
    marginTop: 14,
    maxWidth: '86%',
  },
  squiggle: {
    marginTop: 16,
  },
  footer: {
    alignItems: 'center',
  },
});
