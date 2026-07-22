import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Linking } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { color, font, radius, space, motion } from '../constants/design';
import { PawtchiButton } from './PawtchiButton';
import { haptic } from '../lib/haptics';
import type { ErrorCopy, RecoveryActionId } from '../lib/appError';

/**
 * The in-flow failure presenter — every recoverable failure renders through
 * this (or PawtchiModal for blocking ones), always fed by errorCopy().
 *
 * Two variants:
 *  - 'card'   — an empty-state-sized panel for failures that replace content
 *               (a scan that didn't run, an answer that didn't arrive).
 *  - 'banner' — a compact row for failures alongside intact content
 *               (a save that didn't go through under a filled form).
 *
 * Screens own the handlers: pass `onAction` and map the RecoveryActionId to
 * the flow's own retry / re-pick / navigate logic. 'open_settings' is handled
 * here (deep link to app settings); 'dismiss' falls back to onDismiss.
 */

const KIND_ICON: Record<string, keyof typeof MaterialIcons.glyphMap> = {
  retry: 'refresh',
  pick_again: 'photo-library',
  go_back: 'arrow-back',
  open_settings: 'settings',
  contact_support: 'mail-outline',
  dismiss: 'close',
};

interface Props {
  copy: ErrorCopy;
  variant?: 'card' | 'banner';
  /** MaterialIcons name for the soft icon circle. Default: cloud-off-ish calm. */
  icon?: keyof typeof MaterialIcons.glyphMap;
  onAction?: (action: RecoveryActionId) => void;
  onDismiss?: () => void;
}

export function ErrorState({ copy, variant = 'card', icon = 'wb-cloudy', onAction, onDismiss }: Props) {
  // One quiet haptic on arrival — the failure announces itself once.
  useEffect(() => {
    haptic.warning();
  }, []);

  const handle = (action: RecoveryActionId) => {
    if (action === 'open_settings') {
      Linking.openSettings().catch(() => {});
      return;
    }
    if (action === 'dismiss' && onDismiss) {
      onDismiss();
      return;
    }
    onAction?.(action);
  };

  if (variant === 'banner') {
    const primary = copy.actions[0];
    return (
      <Animated.View entering={FadeInDown.duration(motion.duration.base)} style={styles.banner}>
        <View style={styles.bannerIconWrap}>
          <MaterialIcons name={icon} size={16} color={color.alertDeep} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.bannerTitle}>{copy.title}</Text>
          <Text style={styles.bannerMessage}>{copy.message}</Text>
        </View>
        {primary && (
          <PawtchiButton
            title={primary.label}
            size="small"
            variant="outline"
            onPress={() => handle(primary.action)}
          />
        )}
      </Animated.View>
    );
  }

  return (
    <Animated.View entering={FadeInDown.duration(motion.duration.slow)} style={styles.card}>
      <View style={styles.iconCircle}>
        <MaterialIcons name={icon} size={28} color={color.alertDeep} />
      </View>
      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.message}>{copy.message}</Text>
      <View style={styles.actions}>
        {copy.actions.map((a, i) => (
          <PawtchiButton
            key={a.action}
            title={a.label}
            variant={i === 0 ? 'primary' : 'ghost'}
            size="medium"
            iconName={KIND_ICON[a.action]}
            onPress={() => handle(a.action)}
          />
        ))}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.hairline,
    paddingVertical: space.xxl,
    paddingHorizontal: space.xl,
    gap: space.sm,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.alertSoft,
    marginBottom: space.sm,
  },
  title: {
    fontFamily: font.bold,
    fontSize: 16.5,
    color: color.ink,
    textAlign: 'center',
  },
  message: {
    fontFamily: font.regular,
    fontSize: 13.5,
    lineHeight: 19,
    color: color.slateMuted,
    textAlign: 'center',
    maxWidth: 300,
  },
  actions: {
    marginTop: space.md,
    alignSelf: 'stretch',
    gap: space.sm,
  },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: color.alertSoft,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(217, 119, 6, 0.25)',
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  bannerIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface,
  },
  bannerTitle: {
    fontFamily: font.bold,
    fontSize: 13,
    color: color.alertDeep,
  },
  bannerMessage: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 16,
    color: color.slate,
    marginTop: 1,
  },
});
