import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { color, font, radius } from '../../constants/design';
import { WALKSIGN_COPY, buildWalksignLockup } from '../../lib/walksign/copy';
import type { WalksignId } from '../../lib/walksign/types';
import { PawtchiWordmark } from '../PawtchiWordmark';
import { WalksignCrest } from './WalksignCrest';

interface Props {
  sign: WalksignId;
  petName?: string | null;
  /** Card width in dp; height follows the 9:16 story ratio. */
  width?: number;
}

function identityLine(petName?: string | null): string {
  const name = petName?.trim();
  return name ? `${name.toUpperCase()} WALKS AS A` : 'THIS DOG WALKS AS A';
}

/**
 * The shareable Walksign identity: deliberately one fixed composition so the
 * live preview and exported pixels always match.
 */
export function WalksignShareCard({ sign, petName, width = 300 }: Props) {
  const height = Math.round((width * 16) / 9);
  const pad = Math.round(width * 0.075);
  const emblemSize = Math.round(width * 0.7);
  const lockup = buildWalksignLockup(sign);

  return (
    <View style={[styles.card, { width, height, padding: pad }]}>
      <View style={styles.header}>
        <PawtchiWordmark color={color.navy} height={Math.round(width * 0.046)} />
        <View style={[styles.headerRule, { marginLeft: Math.round(width * 0.055) }]} />
        <Text style={[styles.headerLabel, { fontSize: Math.max(7, width * 0.027) }]}>
          WALKSIGN
        </Text>
      </View>

      <View style={styles.emblemStage}>
        <WalksignCrest
          sign={sign}
          size={emblemSize}
          resolution="share"
          accessibilityLabel={`${lockup.title} Walksign emblem`}
        />
      </View>

      <View>
        <Text
          style={[
            styles.identity,
            {
              fontSize: Math.max(8, width * 0.034),
              lineHeight: Math.max(11, width * 0.048),
            },
          ]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.68}
        >
          {identityLine(petName)}
        </Text>
        <Text
          style={[
            styles.signName,
            {
              fontSize: width * 0.16,
              lineHeight: width * 0.158,
              marginTop: Math.round(width * 0.012),
            },
          ]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.72}
        >
          {lockup.title}
        </Text>
        <Text
          style={[
            styles.tagline,
            {
              fontSize: Math.max(10, width * 0.041),
              lineHeight: Math.max(15, width * 0.058),
              marginTop: Math.round(width * 0.026),
            },
          ]}
          numberOfLines={2}
        >
          {WALKSIGN_COPY[sign].tagline}
        </Text>
      </View>

      <View style={styles.footer}>
        <View style={styles.footerRule} />
        <Text style={[styles.footerText, { fontSize: Math.max(7, width * 0.026) }]}>
          A PAWTCHI WALKSIGN
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.moment.paper,
    borderRadius: radius.xl,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerRule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.moment.hairline,
  },
  headerLabel: {
    fontFamily: font.semibold,
    letterSpacing: 2,
    color: color.moment.inkFaint,
    marginLeft: 10,
  },
  emblemStage: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  identity: {
    fontFamily: font.semibold,
    letterSpacing: 2.2,
    color: color.moment.inkSoft,
  },
  signName: {
    fontFamily: font.display,
    letterSpacing: 1,
    color: color.navy,
  },
  tagline: {
    fontFamily: font.medium,
    color: color.moment.inkSoft,
    maxWidth: '92%',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  footerRule: {
    width: 28,
    height: 2,
    borderRadius: 1,
    backgroundColor: color.yellow,
    marginRight: 10,
  },
  footerText: {
    fontFamily: font.bold,
    letterSpacing: 1.7,
    color: color.navy,
  },
});
