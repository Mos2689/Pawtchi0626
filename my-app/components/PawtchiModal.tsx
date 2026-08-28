import React, { useEffect } from 'react';
import {
  View, Text, TouchableOpacity, TouchableWithoutFeedback, Modal, StyleSheet,
  Dimensions, KeyboardAvoidingView, Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, font, motion, radius, shadow, space } from '../constants/design';
import { haptic } from '../lib/haptics';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Start the sheet a screen-half below the fold — far enough that the spring has
// real distance to settle, close enough that it never feels slow.
const SHEET_TRAVEL = Math.round(SCREEN_HEIGHT * 0.5);

interface ModalAction {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
}

interface PawtchiModalProps {
  visible: boolean;
  onClose?: () => void;
  title: string;
  message?: string;
  icon?: { name: keyof typeof MaterialIcons.glyphMap; color: string };
  actions?: ModalAction[];
  showCloseButton?: boolean;
  children?: React.ReactNode;
}

export function PawtchiModal({
  visible,
  onClose,
  title,
  message,
  icon,
  actions = [],
  showCloseButton = false,
  children,
}: PawtchiModalProps) {
  // Default action if none provided
  const defaultActions: ModalAction[] = actions.length > 0
    ? actions
    : [{ label: 'OK', onPress: () => onClose?.() }];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onClose}
        >
          {/* Absorb touches inside the card so they don't bubble to the backdrop. */}
          <TouchableWithoutFeedback onPress={() => {}}>
          <View style={styles.container}>
            {/* Card */}
            <View style={styles.card}>
              {/* Header */}
              <View style={styles.header}>
                {icon && (
                  <View style={[styles.iconBox, { backgroundColor: `${icon.color}20` }]}>
                    <MaterialIcons name={icon.name} size={28} color={icon.color} />
                  </View>
                )}
                <Text style={styles.title}>{title}</Text>
                {showCloseButton && onClose && (
                  <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                    <MaterialIcons name="close" size={22} color="#64748b" />
                  </TouchableOpacity>
                )}
              </View>

              {/* Message */}
              {message && (
                <Text style={styles.message}>{message}</Text>
              )}

              {/* Custom content */}
              {children}

              {/* Actions */}
              <View style={styles.actions}>
                {defaultActions.map((action, index) => (
                  action.variant === 'secondary' || action.variant === 'ghost' ? (
                    <TouchableOpacity
                      key={index}
                      style={styles.actionBtnSecondary}
                      onPress={action.onPress}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.actionBtnSecondaryText}>{action.label}</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      key={index}
                      style={styles.actionBtnPrimary}
                      onPress={action.onPress}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.actionBtnPrimaryText}>{action.label}</Text>
                    </TouchableOpacity>
                  )
                ))}
              </View>
            </View>
          </View>
          </TouchableWithoutFeedback>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * One bar of the week strip. `value` drives the bar height (relative to the
 * tallest bar in the set); `highlight` marks today — the only yellow bar, so
 * the eye lands on "what happens next" rather than on the whole week at once.
 */
export interface WeekStripDay {
  label: string;
  value: number;
  highlight?: boolean;
}

interface SuccessModalProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  lines: Array<{ text: string; type?: 'normal' | 'highlight' | 'sub' | 'burn' }>;
  primaryAction: { label: string; onPress: () => void };
  secondaryAction?: { label: string; onPress: () => void };
  icon?: { name: keyof typeof MaterialIcons.glyphMap; color: string };
  /**
   * Optional 7-day breakdown. When present the sheet SHOWS the plan instead of
   * describing it — the copy above can then stay short. Omit it and the sheet
   * degrades to a plain icon + title + lines confirmation.
   */
  strip?: WeekStripDay[];
}

const STRIP_MAX_H = 56;
const STRIP_MIN_H = 18;

/**
 * Success is a bottom sheet, not a centred alert box. It rises from the same
 * edge the thumb lives on, so confirming a plan feels like the screen handing
 * something up rather than an OS dialog interrupting.
 */
export function PawtchiSuccessModal({
  visible,
  onClose,
  title,
  lines,
  primaryAction,
  secondaryAction,
  icon,
  strip,
}: SuccessModalProps) {
  const insets = useSafeAreaInsets();

  // Sheet rises on a spring; the backdrop fades on a timing curve so the wash
  // never lags behind the sheet it belongs to.
  const sheetY = useSharedValue(SHEET_TRAVEL);
  const fade = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      sheetY.value = SHEET_TRAVEL;
      fade.value = 0;
      sheetY.value = withSpring(0, motion.spring.gentle);
      fade.value = withTiming(1, { duration: motion.duration.base });
      // ONE beat on arrival — the plan committed, so this is a completion.
      haptic.success();
    }
  }, [visible, sheetY, fade]);

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetY.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  // Bars are scaled against the busiest day, not an absolute activity count —
  // a light week still reads as a week, not as a flat row of stubs.
  const stripMax = strip && strip.length > 0
    ? Math.max(...strip.map((d) => d.value), 1)
    : 1;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.sheetOverlay}
      >
        <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
          <TouchableOpacity
            style={styles.sheetBackdrop}
            activeOpacity={1}
            onPress={onClose}
            accessibilityLabel="Dismiss"
          />
        </Animated.View>

        {/* Absorb touches inside the sheet so they don't bubble to the backdrop. */}
        <TouchableWithoutFeedback onPress={() => {}}>
          <Animated.View
            style={[styles.sheet, { paddingBottom: space.xxl + insets.bottom }, sheetStyle]}
          >
            <View style={styles.grabber} />

            <View style={styles.sheetHeader}>
              {icon && (
                <View style={styles.sheetIcon}>
                  <MaterialIcons name={icon.name} size={18} color={icon.color} />
                </View>
              )}
              <Text style={styles.sheetTitle}>{title}</Text>
            </View>

            {strip && strip.length > 0 && (
              <View style={styles.strip}>
                {strip.map((day, idx) => (
                  <View key={`${day.label}-${idx}`} style={styles.stripCol}>
                    <View
                      style={[
                        styles.stripBar,
                        {
                          height: Math.max(
                            STRIP_MIN_H,
                            Math.round((day.value / stripMax) * STRIP_MAX_H),
                          ),
                        },
                        day.highlight && styles.stripBarToday,
                      ]}
                    >
                      <Text
                        style={[styles.stripValue, day.highlight && styles.stripValueToday]}
                      >
                        {day.value}
                      </Text>
                    </View>
                    <Text style={styles.stripLabel}>{day.label}</Text>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.linesContainer}>
              {lines.map((line, idx) => {
                if (line.type === 'burn') {
                  return (
                    <View key={idx} style={styles.burnLine}>
                      <MaterialIcons
                        name="local-fire-department"
                        size={16}
                        color={color.slateMuted}
                      />
                      <Text style={styles.burnText}>{line.text}</Text>
                    </View>
                  );
                }
                if (line.type === 'highlight') {
                  return (
                    <View key={idx} style={styles.highlightBox}>
                      <Text style={styles.highlightText}>{line.text}</Text>
                    </View>
                  );
                }
                if (line.type === 'sub') {
                  return <Text key={idx} style={styles.subText}>{line.text}</Text>;
                }
                return <Text key={idx} style={styles.lineText}>{line.text}</Text>;
              })}
            </View>

            <TouchableOpacity
              style={styles.sheetPrimaryBtn}
              onPress={primaryAction.onPress}
              activeOpacity={0.85}
            >
              <Text style={styles.actionBtnPrimaryText}>{primaryAction.label}</Text>
            </TouchableOpacity>

            {secondaryAction && (
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={secondaryAction.onPress}
                activeOpacity={0.7}
              >
                <Text style={styles.secondaryBtnText}>{secondaryAction.label}</Text>
              </TouchableOpacity>
            )}
          </Animated.View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    flex: 1,
    width: '100%',
    backgroundColor: 'rgba(4, 16, 21, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  container: {
    width: SCREEN_WIDTH - 48,
    maxWidth: 380,
    position: 'relative',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    padding: 28,
    ...shadow.raised,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 14,
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconBoxSuccess: {
    width: 56,
    height: 56,
    borderRadius: 16,
  },
  title: {
    fontFamily: font.extrabold,
    fontSize: 20,
    color: color.ink,
    flex: 1,
  },
  closeBtn: {
    padding: 4,
    marginLeft: 'auto',
  },
  message: {
    fontFamily: font.regular,
    fontSize: 15,
    color: color.slate,
    lineHeight: 22,
    marginBottom: 24,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  // Flat brand yellow — the one yellow, no gradient (design system §4.02).
  actionBtnPrimary: {
    backgroundColor: color.yellow,
    borderRadius: 16,
    flex: 1,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnPrimaryText: {
    fontFamily: font.extrabold,
    fontSize: 15,
    color: color.navy,
  },
  actionBtnSecondary: {
    backgroundColor: color.track,
    borderRadius: 16,
    flex: 1,
  },
  actionBtnSecondaryText: {
    fontFamily: font.bold,
    fontSize: 15,
    color: color.slateMuted,
    textAlign: 'center',
    paddingVertical: 16,
  },

  // ── Success sheet ─────────────────────────────────────────────────────────
  sheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(4, 16, 21, 0.55)',
  },
  sheet: {
    backgroundColor: color.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: space.xxl,
    paddingTop: space.md,
    ...shadow.raised,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: color.track,
    alignSelf: 'center',
    marginBottom: space.xl,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginBottom: space.lg,
  },
  // Yellow is the accent, never the whole chip — the CTA below is the one
  // yellow surface on this sheet (design system §4.02).
  sheetIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: color.yellowSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetTitle: {
    fontFamily: font.extrabold,
    fontSize: 18,
    lineHeight: 24,
    color: color.navy,
    flex: 1,
  },
  strip: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: space.lg,
  },
  stripCol: {
    flex: 1,
    alignItems: 'stretch',
  },
  stripBar: {
    backgroundColor: color.track,
    borderRadius: radius.sm,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 5,
  },
  stripBarToday: {
    backgroundColor: color.yellow,
  },
  stripValue: {
    fontFamily: font.semibold,
    fontSize: 12,
    color: color.slateMuted,
  },
  stripValueToday: {
    color: color.navy,
  },
  stripLabel: {
    fontFamily: font.medium,
    fontSize: 11,
    color: color.slateFaint,
    textAlign: 'center',
    marginTop: 6,
  },
  linesContainer: {
    marginBottom: space.xl,
    gap: space.sm,
  },
  lineText: {
    fontFamily: font.regular,
    fontSize: 14,
    color: color.slate,
    lineHeight: 21,
  },
  subText: {
    fontFamily: font.regular,
    fontSize: 13,
    color: color.slateFaint,
    lineHeight: 20,
  },
  highlightBox: {
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  highlightText: {
    fontFamily: font.semibold,
    fontSize: 14,
    color: color.navy,
    lineHeight: 20,
  },
  // Supporting detail, not a second headline — a quiet row on warm paper
  // instead of the old black slab that fought the title for attention.
  burnLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  burnText: {
    fontFamily: font.medium,
    fontSize: 13,
    color: color.slate,
    flex: 1,
    lineHeight: 19,
  },
  // Same recipe as actionBtnPrimary minus the `flex: 1` — the sheet stacks in a
  // column, where flex would stretch the button to eat the leftover height.
  sheetPrimaryBtn: {
    backgroundColor: color.yellow,
    borderRadius: radius.lg,
    paddingVertical: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtn: {
    paddingVertical: space.md,
    alignItems: 'center',
    marginTop: space.xs,
  },
  secondaryBtnText: {
    fontFamily: font.semibold,
    fontSize: 15,
    color: color.slateMuted,
  },
});