import React, { useEffect } from 'react';
import {
  View, Text, TouchableOpacity, TouchableWithoutFeedback, Modal, StyleSheet,
  Dimensions, KeyboardAvoidingView, Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { motion } from '../constants/design';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

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
            {/* Glow accent */}
            <View style={styles.glow} />

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
                    <LinearGradient
                      key={index}
                      colors={['#F7F602', '#fac129']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.actionBtnGradient}
                    >
                      <TouchableOpacity
                        style={styles.actionBtnTouchable}
                        onPress={action.onPress}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.actionBtnPrimaryText}>{action.label}</Text>
                      </TouchableOpacity>
                    </LinearGradient>
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

interface SuccessModalProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  lines: Array<{ text: string; type?: 'normal' | 'highlight' | 'sub' | 'burn' }>;
  primaryAction: { label: string; onPress: () => void };
  secondaryAction?: { label: string; onPress: () => void };
  icon?: { name: keyof typeof MaterialIcons.glyphMap; color: string };
}

export function PawtchiSuccessModal({
  visible,
  onClose,
  title,
  lines,
  primaryAction,
  secondaryAction,
  icon,
}: SuccessModalProps) {
  // The card springs up from a slight scale so success reads as a "pop", not a
  // cross-fade. Re-runs each time the modal becomes visible.
  const cardScale = useSharedValue(0.96);
  useEffect(() => {
    if (visible) {
      cardScale.value = 0.96;
      cardScale.value = withSpring(1, motion.spring.bouncy);
    }
  }, [visible, cardScale]);
  const cardAnimatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: cardScale.value }] }));

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
          <Animated.View style={[styles.container, cardAnimatedStyle]}>
            <View style={[styles.card, styles.successCard]}>
              {/* Header with close button */}
              <View style={styles.successHeader}>
                {icon && (
                  <View style={[styles.iconBox, styles.iconBoxSuccess, { backgroundColor: `${icon.color}20` }]}>
                    <MaterialIcons name={icon.name} size={32} color={icon.color} />
                  </View>
                )}
                <Text style={styles.successTitle}>{title}</Text>
                <TouchableOpacity onPress={onClose} style={styles.successCloseBtn}>
                  <MaterialIcons name="close" size={20} color="#94a3b8" />
                </TouchableOpacity>
              </View>

              {/* Lines */}
              <View style={styles.linesContainer}>
                {lines.map((line, idx) => {
                  if (line.type === 'burn') {
                    return (
                      <View key={idx} style={styles.burnLine}>
                        <MaterialIcons name="local-fire-department" size={16} color="#F7F602" />
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

              {/* Actions */}
              <View style={styles.successActions}>
                <LinearGradient
                  colors={['#F7F602', '#fac129']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.actionBtnGradient}
                >
                  <TouchableOpacity
                    style={styles.actionBtnTouchable}
                    onPress={primaryAction.onPress}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.actionBtnPrimaryText}>{primaryAction.label}</Text>
                  </TouchableOpacity>
                </LinearGradient>

                {secondaryAction && (
                  <TouchableOpacity
                    style={styles.secondaryBtn}
                    onPress={secondaryAction.onPress}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.secondaryBtnText}>{secondaryAction.label}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </Animated.View>
          </TouchableWithoutFeedback>
        </TouchableOpacity>
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
  glow: {
    position: 'absolute',
    top: -20,
    left: -20,
    right: -20,
    bottom: -20,
    backgroundColor: 'rgba(255, 252, 0, 0.15)',
    borderRadius: 32,
    transform: [{ scale: 1.05 }],
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    padding: 28,
    shadowColor: '#F7F602',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 20,
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
    fontFamily: 'Montserrat_800ExtraBold',
    fontSize: 20,
    color: '#0f172a',
    flex: 1,
  },
  closeBtn: {
    padding: 4,
    marginLeft: 'auto',
  },
  message: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 15,
    color: '#475569',
    lineHeight: 22,
    marginBottom: 24,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  actionBtnGradient: {
    borderRadius: 16,
    overflow: 'hidden',
    flex: 1,
  },
  actionBtnTouchable: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnPrimaryText: {
    fontFamily: 'Montserrat_800ExtraBold',
    fontSize: 15,
    color: '#041015',
  },
  actionBtnSecondary: {
    backgroundColor: '#f1f5f9',
    borderRadius: 16,
    flex: 1,
  },
  actionBtnSecondaryText: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 15,
    color: '#64748b',
    textAlign: 'center',
    paddingVertical: 16,
  },

  // Success Modal specific styles
  successHeader: {
    alignItems: 'center',
    marginBottom: 20,
  },
  successTitle: {
    fontFamily: 'Montserrat_800ExtraBold',
    fontSize: 22,
    color: '#041015',
    marginTop: 12,
    textAlign: 'center',
  },
  linesContainer: {
    marginBottom: 24,
    gap: 6,
  },
  lineText: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 15,
    color: '#475569',
    lineHeight: 22,
  },
  subText: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 13,
    color: '#94a3b8',
    lineHeight: 20,
    marginTop: 4,
  },
  highlightBox: {
    backgroundColor: '#041015',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginVertical: 8,
  },
  highlightText: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 15,
    color: '#F7F602',
    textAlign: 'center',
  },
  burnLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#041015',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 8,
  },
  burnText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 13,
    color: '#F7F602',
    flex: 1,
    lineHeight: 18,
  },
  successActions: {
    gap: 12,
  },
  secondaryBtn: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryBtnText: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 15,
    color: '#64748b',
  },
  successCard: {
    paddingTop: 20,
  },
  successCloseBtn: {
    position: 'absolute',
    top: 0,
    right: 0,
    padding: 8,
  },
});