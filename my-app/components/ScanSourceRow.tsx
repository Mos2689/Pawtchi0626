import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { color, font, radius, space } from '../constants/design';
import { AnimatedPressable } from './AnimatedPressable';
import type { PantryItem } from '../store/useActivePetStore';

type SourceKind =
  | 'explicit'      // user explicitly picked this pantry item before scanning
  | 'auto'          // server matched against the pantry
  | 'new'           // brand-new food — will be saved to pantry
  | 'unmatched';    // scan happened but nothing was matched

interface Props {
  matchedItem: PantryItem | null;
  /** How the matchedItem was chosen — drives the badge + copy. */
  kind: SourceKind;
  /** Show the "different food?" banner above the row. */
  showTypeMismatchHint?: boolean;
  /** Open the pantry picker (Change…). */
  onChange: () => void;
  /** "Log as new food" — only relevant for type-mismatch + auto matches. */
  onUseAsNew?: () => void;
}

/**
 * The first row on the scan result screen. Tells the user — calmly and
 * unambiguously — which pantry item this log will be recorded against, and
 * lets them change it before committing. Solves the "silent wrong source"
 * failure mode: every log surfaces its source.
 */
export function ScanSourceRow({
  matchedItem,
  kind,
  showTypeMismatchHint,
  onChange,
  onUseAsNew,
}: Props) {
  const itemLabel = matchedItem
    ? (matchedItem.product_name
        ? `${matchedItem.brand} ${matchedItem.product_name}`.trim()
        : matchedItem.brand)
    : 'New food';
  const subline =
    kind === 'explicit' ? 'Logging against this pantry item'
    : kind === 'auto' ? 'Auto-matched — tap Change if this isn’t right'
    : kind === 'new' ? 'Will be saved to the pantry'
    : 'No pantry match — logging as new';

  const badgeText =
    kind === 'auto' ? 'AUTO' :
    kind === 'new' ? 'NEW' :
    kind === 'unmatched' ? 'NEW' : null;

  return (
    <View>
      {showTypeMismatchHint && (
        <View style={styles.mismatchBanner}>
          <MaterialIcons name="info-outline" size={16} color={color.alert} />
          <Text style={styles.mismatchText}>
            Looks like a different food than what you picked.
          </Text>
          {onUseAsNew && (
            <AnimatedPressable style={styles.mismatchCta} onPress={onUseAsNew} haptic="select">
              <Text style={styles.mismatchCtaText}>Log as new</Text>
            </AnimatedPressable>
          )}
        </View>
      )}
      <View style={styles.sectionHead}>
        <Text style={styles.sectionLabel}>SOURCE</Text>
        <View style={styles.sectionRule} />
      </View>
      <View style={styles.row}>
        <View style={styles.iconBox}>
          <MaterialIcons
            name={matchedItem ? 'inventory-2' : 'add-circle-outline'}
            size={18}
            color={color.navy}
          />
        </View>
        <View style={styles.text}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1}>{itemLabel}</Text>
            {!!badgeText && (
              <View style={[styles.badge, kind === 'auto' && styles.badgeAuto]}>
                <Text style={[styles.badgeText, kind === 'auto' && styles.badgeTextAuto]}>{badgeText}</Text>
              </View>
            )}
          </View>
          <Text style={styles.sub} numberOfLines={1}>{subline}</Text>
        </View>
        <AnimatedPressable style={styles.changeBtn} onPress={onChange} haptic="select">
          <Text style={styles.changeBtnText}>Change</Text>
        </AnimatedPressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHead: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    marginTop: space.xl, marginBottom: space.sm,
  },
  sectionLabel: {
    fontFamily: font.semibold, fontSize: 10.5,
    letterSpacing: 2.2, color: color.slateFaint,
  },
  sectionRule: { flex: 1, height: 1, backgroundColor: color.hairline },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingVertical: space.md,
  },
  iconBox: {
    width: 36, height: 36, borderRadius: 12,
    backgroundColor: color.surfaceSubtle,
    borderWidth: 1, borderColor: color.hairline,
    alignItems: 'center', justifyContent: 'center',
  },
  text: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { flexShrink: 1, fontFamily: font.bold, fontSize: 14.5, color: color.ink, letterSpacing: -0.2 },
  badge: {
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: color.track,
  },
  badgeAuto: { backgroundColor: color.yellowSoft },
  badgeText: { fontFamily: font.bold, fontSize: 9, letterSpacing: 1.2, color: color.slateMuted },
  badgeTextAuto: { color: color.navy },
  sub: { fontFamily: font.medium, fontSize: 12, color: color.slateMuted, marginTop: 2 },

  changeBtn: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1, borderColor: color.hairline,
    backgroundColor: color.surface,
  },
  changeBtnText: { fontFamily: font.semibold, fontSize: 12.5, color: color.navy },

  // Type-mismatch banner
  mismatchBanner: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    backgroundColor: '#FEF3C7',
    borderRadius: radius.lg,
    paddingHorizontal: space.md, paddingVertical: space.sm,
    marginTop: space.lg,
  },
  mismatchText: { flex: 1, fontFamily: font.medium, fontSize: 12.5, color: '#92400e', lineHeight: 17 },
  mismatchCta: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: color.navy,
  },
  mismatchCtaText: { fontFamily: font.bold, fontSize: 11.5, color: color.cream, letterSpacing: 0.3 },
});
