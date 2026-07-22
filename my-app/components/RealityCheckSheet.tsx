import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Modal, Image, TouchableWithoutFeedback } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { color, font, radius, space, motion } from '../constants/design';
import { PawtchiButton } from './PawtchiButton';
import { haptic } from '../lib/haptics';

interface Props {
  visible: boolean;
  petName: string;
  species: 'dog' | 'cat';
  imageUri?: string | null;
  breed: string;
  /** The level the owner just tapped, e.g. "Athlete". */
  proposedLabel: string;
  proposedClinical: string;
  /** What's typical for the breed, e.g. "Casual walker" / "30–60 min/day". */
  typicalLabel: string;
  typicalDescription: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The activity reality-check, as a branded sheet instead of a system alert.
 * Over-claimed activity inflates the daily kcal target 60–100%; this moment
 * should read as care, not a nag — so it gets the pet's face, the clinical
 * definition, and a calm default toward the safer choice.
 */
export function RealityCheckSheet({
  visible, petName, species, imageUri, breed,
  proposedLabel, proposedClinical, typicalLabel, typicalDescription,
  onConfirm, onCancel,
}: Props) {
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) haptic.warning();
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <TouchableWithoutFeedback onPress={onCancel}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.xl }]}>
          <View style={styles.grabber} />

          <Animated.View entering={FadeInDown.duration(motion.duration.base)} style={styles.head}>
            <View style={styles.avatar}>
              {imageUri ? (
                <Image source={{ uri: imageUri }} style={styles.avatarImg} />
              ) : (
                <View style={[styles.avatarImg, styles.avatarFallback]}>
                  <Text style={styles.avatarInitial}>
                    {(petName?.[0] || (species === 'cat' ? 'C' : 'D')).toUpperCase()}
                  </Text>
                </View>
              )}
            </View>
            <Text style={styles.title}>
              Is {petName} really {proposedLabel.toLowerCase()}?
            </Text>
          </Animated.View>

          <Text style={styles.body}>
            {breed}s are usually {typicalLabel.toLowerCase()} ({typicalDescription.toLowerCase()}).
          </Text>
          <View style={styles.definitionCard}>
            <Text style={styles.definitionLabel}>{proposedLabel.toUpperCase()} MEANS</Text>
            <Text style={styles.definitionText}>{proposedClinical}</Text>
          </View>
          <Text style={styles.body}>
            If this isn&apos;t accurate, we&apos;ll overshoot {petName}&apos;s daily calorie target — and that
            quietly leads to weight gain.
          </Text>

          <View style={styles.actions}>
            <PawtchiButton
              title="Pick a calmer level"
              variant="primary"
              onPress={onCancel}
            />
            <PawtchiButton
              title={`Yes, ${petName} is ${proposedLabel.toLowerCase()}`}
              variant="outline"
              onPress={onConfirm}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(7, 32, 42, 0.55)',
  },
  sheet: {
    backgroundColor: color.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: space.xxl,
    paddingTop: space.md,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: color.hairline,
    marginBottom: space.lg,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginBottom: space.lg,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: color.yellow,
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarFallback: {
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: font.display,
    fontSize: 24,
    color: color.navy,
  },
  title: {
    flex: 1,
    fontFamily: font.display,
    fontSize: 26,
    lineHeight: 27,
    letterSpacing: 0.4,
    color: color.ink,
  },
  body: {
    fontFamily: font.regular,
    fontSize: 14,
    lineHeight: 20,
    color: color.slateMuted,
    marginBottom: space.md,
  },
  definitionCard: {
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.hairline,
    padding: space.lg,
    marginBottom: space.md,
  },
  definitionLabel: {
    fontFamily: font.semibold,
    fontSize: 10.5,
    letterSpacing: 1.6,
    color: color.slateFaint,
    marginBottom: 4,
  },
  definitionText: {
    fontFamily: font.medium,
    fontSize: 13.5,
    lineHeight: 19,
    color: color.slate,
  },
  actions: {
    gap: space.sm,
    marginTop: space.sm,
  },
});
