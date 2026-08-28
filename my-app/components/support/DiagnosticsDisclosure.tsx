// "What we send with this" — the collapsed row above the send button.
//
// This exists to be seen, not to be read. Almost nobody opens it, and that is
// fine: the row itself does the work. An app that silently harvests your device
// details feels like surveillance; an app that says "here is exactly what goes
// with this, have a look" feels thorough. Same data, opposite feeling, one
// component.
//
// It renders from `describeDiagnostics()`, which is fed the same object that is
// actually submitted — so the list cannot drift from what is sent. A disclosure
// that has gone stale is worse than none, because it is now a false statement
// about the owner's data rather than a missing one.

import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, LayoutAnimation } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

import { Typography } from '../Typography';
import { color, radius, space } from '../../constants/design';
import { haptic } from '../../lib/haptics';
import { COMPOSER_COPY } from '../../lib/support/copy';

interface Props {
  lines: string[];
  onExpand?: () => void;
}

export function DiagnosticsDisclosure({ lines, onExpand }: Props) {
  const [open, setOpen] = useState(false);

  const toggle = () => {
    const next = !open;
    haptic.select();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen(next);
    if (next) onExpand?.();
  };

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={styles.header}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={toggle}
      >
        <MaterialIcons name="privacy-tip" size={18} color={color.letter.accent} />
        <Typography variant="label" color={color.navy} style={styles.headerText}>
          {COMPOSER_COPY.diagnosticsLabel}
        </Typography>
        <MaterialIcons
          name={open ? 'expand-less' : 'expand-more'}
          size={20}
          color={color.letter.accent}
        />
      </TouchableOpacity>

      {open && (
        <View style={styles.body}>
          {lines.map((line) => (
            <View key={line} style={styles.lineRow}>
              <View style={styles.bullet} />
              <Typography variant="caption" color={color.slate} style={styles.lineText}>
                {line}
              </Typography>
            </View>
          ))}
          <Typography variant="caption" color={color.slateFaint} style={styles.hint}>
            {COMPOSER_COPY.diagnosticsHint}
          </Typography>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.letter.hairline,
    backgroundColor: color.letter.accentSoft,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  headerText: { flex: 1 },
  body: { paddingHorizontal: space.md, paddingBottom: space.md, gap: space.xs },
  lineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  bullet: {
    width: 3,
    height: 3,
    borderRadius: 2,
    marginTop: 6,
    backgroundColor: color.letter.accent,
  },
  // Caption is a letter-spaced label preset; these are sentences, so the
  // tracking is reset to let them read as prose.
  lineText: { flex: 1, letterSpacing: 0, lineHeight: 17 },
  hint: { letterSpacing: 0, lineHeight: 16, marginTop: space.sm },
});
