// The FAQ, inline on the support hub.
//
// Inline rather than behind a fourth door, because the entire value of an FAQ
// is being read before someone writes to us — and a list nobody opens deflects
// nothing. One entry open at a time keeps the page short enough to scan.
//
// There is deliberately no "was this helpful?" control. A thumbs-down is a dead
// end dressed up as a feature: it collects a complaint and offers no way out of
// it. If an answer does not land, the doors above are still right there.

import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, LayoutAnimation, Platform, UIManager } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

import { Typography } from '../Typography';
import { PawtchiButton } from '../PawtchiButton';
import { color, radius, space } from '../../constants/design';
import { haptic } from '../../lib/haptics';
import type { FaqEntry, FaqActionId } from '../../lib/support/faqs';

// LayoutAnimation is opt-in on Android's old architecture. Harmless where it is
// already enabled, so it is set unconditionally rather than version-sniffed.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface Props {
  entries: FaqEntry[];
  onExpand?: (id: string) => void;
  onAction?: (action: FaqActionId, faqId: string) => void;
}

export function FaqAccordion({ entries, onExpand, onAction }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);

  const toggle = (entry: FaqEntry) => {
    const next = openId === entry.id ? null : entry.id;
    haptic.select();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpenId(next);
    // Fired on open only — collapsing is not a second read.
    if (next) onExpand?.(entry.id);
  };

  return (
    <View style={styles.list}>
      {entries.map((entry, i) => {
        const open = openId === entry.id;
        return (
          <View key={entry.id} style={[styles.item, i === entries.length - 1 && styles.itemLast]}>
            <TouchableOpacity
              style={styles.question}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              onPress={() => toggle(entry)}
            >
              <Typography
                variant="body"
                weight={open ? 'bold' : 'medium'}
                color={color.navy}
                style={styles.questionText}
              >
                {entry.question}
              </Typography>
              <MaterialIcons
                name={open ? 'expand-less' : 'expand-more'}
                size={22}
                color={color.letter.accent}
              />
            </TouchableOpacity>

            {open && (
              <View style={styles.answer}>
                <Typography variant="body" color={color.slate} style={styles.answerText}>
                  {entry.answer}
                </Typography>
                {entry.action && (
                  <View style={styles.action}>
                    <PawtchiButton
                      title={entry.action.label}
                      variant="outline"
                      size="small"
                      onPress={() => onAction?.(entry.action!.id, entry.id)}
                    />
                  </View>
                )}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.letter.hairline,
    backgroundColor: color.letter.paper,
    overflow: 'hidden',
  },
  item: { borderBottomWidth: 1, borderBottomColor: color.letter.hairline },
  itemLast: { borderBottomWidth: 0 },
  question: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.lg,
    paddingHorizontal: space.lg,
  },
  questionText: { flex: 1, lineHeight: 21 },
  answer: { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.md },
  answerText: { lineHeight: 22 },
  action: { alignSelf: 'flex-start' },
});
