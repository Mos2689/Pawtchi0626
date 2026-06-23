import React, { useMemo, useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import type { PantryItem } from '../store/useActivePetStore';
import { AnimatedPressable } from './AnimatedPressable';
import { color, font, motion, radius, shadow, space } from '../constants/design';
import { BOWL_SIZE_GRAMS } from '../lib/pantryMath';
import { getSuggestion } from '../lib/portionLearning';

const FOOD_TYPE_ICONS: Record<string, keyof typeof MaterialIcons.glyphMap> = {
  kibble: 'pets',
  wet_food: 'soup-kitchen',
  treat: 'cookie',
  raw: 'egg-alt',
  supplement: 'medication',
  human_food: 'restaurant',
};

const CUSTOM_STEP = 0.25;
const CUSTOM_MIN = 0.25;
const CUSTOM_MAX = 5;

type Phase = 'idle' | 'logging' | 'success';

interface Props {
  eyebrow: string;
  item: PantryItem;
  bowlSize?: 'small' | 'medium' | 'large' | 'xl';
  /**
   * Returns a promise that resolves once the log has committed. The hero
   * shows a spinner while it's pending and a "Logged" pulse on success.
   */
  onLog: (multiplier: number) => Promise<void> | void;
  /** Externally-driven disable (e.g. parent is mid-flight from another path). */
  isBusy?: boolean;
}

/**
 * The hero of the meal tab: a single image-led card with the predicted food,
 * an inline portion chip row (Less / Usual / More + Custom stepper), and one
 * big Log button that surfaces logging + success feedback in place.
 *
 * The default chip is the learned portion for this item (via portionLearning)
 * so the owner usually just confirms.
 */
export function MealHero({ eyebrow, item, bowlSize, onLog, isBusy }: Props) {
  const isBowlMode = !!bowlSize && (item.serving_unit === 'cup' || !item.serving_unit);
  const portionOptions = useMemo(
    () => (isBowlMode
      ? [
          { label: 'Quarter bowl', value: 0.25 },
          { label: 'Half bowl', value: 0.5 },
          { label: 'Full bowl', value: 1 },
        ]
      : [
          { label: 'A little less', value: 0.75 },
          { label: 'Usual', value: 1 },
          { label: 'A little more', value: 1.25 },
        ]),
    [isBowlMode],
  );

  const [multiplier, setMultiplier] = useState<number>(1);
  const [isCustom, setIsCustom] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pre-fill the learned portion when this item changes — if the owner has
  // been feeding less/more, that becomes the default.
  useEffect(() => {
    let cancelled = false;
    getSuggestion(item.id).then((learned) => {
      if (cancelled) return;
      setMultiplier(learned ?? 1);
      setIsCustom(false);
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  // Clean up any pending success-state timer on unmount or item change.
  useEffect(() => () => {
    if (successTimer.current) clearTimeout(successTimer.current);
  }, []);

  const baseKcal = item.kcal_per_serving ?? 0;
  const portionGrams = bowlSize && isBowlMode ? BOWL_SIZE_GRAMS[bowlSize] : null;
  const displayKcal = Math.round(baseKcal * multiplier);
  const portionUnit = isBowlMode ? 'bowl' : (item.serving_unit || 'serving');
  const portionLabel = isBowlMode
    ? `${bowlSize} bowl`
    : item.serving_unit
      ? `1 ${item.serving_unit}`
      : '1 serving';

  const title = item.product_name
    ? `${item.brand} ${item.product_name}`
    : item.brand;

  const formatMult = (m: number) => (m % 1 === 0 ? `${m}` : m.toFixed(2));

  const handlePressChip = (value: number) => {
    setIsCustom(false);
    setMultiplier(value);
  };

  const handleCustom = () => {
    // Toggling into custom keeps the current multiplier so the stepper
    // continues from the same starting point.
    setIsCustom(true);
  };

  const handleStep = (delta: number) => {
    setMultiplier((m) => {
      const next = Math.max(CUSTOM_MIN, Math.min(CUSTOM_MAX, +(m + delta).toFixed(2)));
      return next;
    });
  };

  const handleLogPress = async () => {
    if (phase !== 'idle' || isBusy) return;
    setPhase('logging');
    try {
      await onLog(multiplier);
      setPhase('success');
      successTimer.current = setTimeout(() => {
        setPhase('idle');
      }, 1500);
    } catch {
      setPhase('idle');
    }
  };

  const isDisabled = phase !== 'idle' || !!isBusy;

  return (
    <Animated.View entering={FadeIn.duration(360)} style={styles.wrap}>
      <Text style={styles.eyebrow}>{eyebrow.toUpperCase()}</Text>

      <View style={styles.card}>
        <View style={styles.row}>
          {item.image_url ? (
            <Image
              source={{ uri: item.image_url }}
              style={styles.thumb}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={180}
            />
          ) : (
            <View style={[styles.thumb, styles.thumbFallback]}>
              <MaterialIcons name={FOOD_TYPE_ICONS[item.food_type] || 'pets'} size={28} color={color.navy} />
            </View>
          )}
          <View style={styles.text}>
            <Text style={styles.title} numberOfLines={2}>{title}</Text>
            <Text style={styles.sub} numberOfLines={1}>
              {portionGrams ? `${portionGrams} g · ` : ''}~{displayKcal} kcal
            </Text>
          </View>
        </View>

        {/* Chip row — three descriptive presets + Custom */}
        <View style={styles.chipRow}>
          {portionOptions.map((opt) => {
            const selected = !isCustom && Math.abs(multiplier - opt.value) < 0.01;
            return (
              <Pressable
                key={opt.label}
                style={({ pressed }) => [
                  styles.chip,
                  selected && styles.chipSelected,
                  pressed && styles.chipPressed,
                ]}
                onPress={() => handlePressChip(opt.value)}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]} numberOfLines={1}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            style={({ pressed }) => [
              styles.chip,
              isCustom && styles.chipSelected,
              pressed && styles.chipPressed,
            ]}
            onPress={handleCustom}
          >
            <Text style={[styles.chipText, isCustom && styles.chipTextSelected]}>Custom</Text>
          </Pressable>
        </View>

        {/* Portion summary + custom stepper */}
        <View style={styles.portionRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.portionValue}>
              {formatMult(multiplier)}
              <Text style={styles.portionUnit}> × {portionUnit}{multiplier !== 1 && !isBowlMode ? 's' : ''}</Text>
            </Text>
            {portionGrams && (
              <Text style={styles.portionHint} numberOfLines={1}>
                Full bowl ≈ {portionGrams} g
              </Text>
            )}
            {baseKcal > 0 && (
              <Text style={styles.portionHint} numberOfLines={1}>
                {Math.round(baseKcal)} × {formatMult(multiplier)} = {displayKcal} kcal
              </Text>
            )}
          </View>
          {isCustom && (
            <Animated.View entering={FadeInDown.duration(200)} style={styles.stepper}>
              <Pressable
                style={({ pressed }) => [
                  styles.stepperBtn,
                  multiplier <= CUSTOM_MIN && { opacity: 0.3 },
                  pressed && styles.stepperBtnPressed,
                ]}
                onPress={() => handleStep(-CUSTOM_STEP)}
                disabled={multiplier <= CUSTOM_MIN}
              >
                <MaterialIcons name="remove" size={20} color={color.navy} />
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.stepperBtn,
                  multiplier >= CUSTOM_MAX && { opacity: 0.3 },
                  pressed && styles.stepperBtnPressed,
                ]}
                onPress={() => handleStep(CUSTOM_STEP)}
                disabled={multiplier >= CUSTOM_MAX}
              >
                <MaterialIcons name="add" size={20} color={color.navy} />
              </Pressable>
            </Animated.View>
          )}
        </View>

        {/* Single CTA — cycles idle → logging → success */}
        <AnimatedPressable
          style={[
            styles.cta,
            phase === 'success' && styles.ctaSuccess,
            isDisabled && phase === 'idle' && { opacity: 0.6 },
          ]}
          scaleTo={motion.scale.press}
          haptic={phase === 'idle' ? 'medium' : 'none'}
          disabled={isDisabled}
          onPress={handleLogPress}
        >
          {phase === 'logging' && (
            <>
              <ActivityIndicator size="small" color={color.navy} />
              <Text style={styles.ctaText}>Logging…</Text>
            </>
          )}
          {phase === 'success' && (
            <Animated.View entering={FadeIn.duration(200)} style={styles.ctaInner}>
              <MaterialIcons name="check-circle" size={20} color={color.navy} />
              <Text style={styles.ctaText}>Logged · +coins</Text>
            </Animated.View>
          )}
          {phase === 'idle' && (
            <>
              <MaterialIcons name="check-circle-outline" size={20} color={color.navy} />
              <Text style={styles.ctaText}>Log meal</Text>
            </>
          )}
        </AnimatedPressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: space.xxl,
    paddingTop: space.lg,
  },
  eyebrow: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: 2.4,
    color: color.slateFaint,
    marginBottom: space.sm,
  },
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.xxl,
    borderWidth: 1,
    borderColor: color.hairline,
    padding: space.lg,
    ...shadow.card,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginBottom: space.lg,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: color.yellowSoft,
  },
  thumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, minWidth: 0 },
  title: {
    fontFamily: font.bold,
    fontSize: 17,
    color: color.ink,
    letterSpacing: -0.3,
    lineHeight: 22,
  },
  sub: {
    fontFamily: font.medium,
    fontSize: 13,
    color: color.slateMuted,
    marginTop: 4,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    marginBottom: space.md,
  },
  chip: {
    flexGrow: 1,
    flexBasis: '22%',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.hairline,
    backgroundColor: color.surface,
    alignItems: 'center',
  },
  chipSelected: {
    borderColor: color.navy,
    backgroundColor: color.navy,
  },
  chipPressed: {
    transform: [{ scale: 0.97 }],
  },
  chipText: {
    fontFamily: font.semibold,
    fontSize: 12.5,
    color: color.ink,
    textAlign: 'center',
  },
  chipTextSelected: {
    color: color.cream,
  },

  portionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginBottom: space.lg,
  },
  portionValue: {
    fontFamily: font.bold,
    fontSize: 18,
    color: color.ink,
    letterSpacing: -0.3,
  },
  portionUnit: {
    fontFamily: font.medium,
    fontSize: 13,
    color: color.slateMuted,
    letterSpacing: 0,
  },
  portionHint: {
    fontFamily: font.medium,
    fontSize: 12,
    color: color.slateFaint,
    marginTop: 2,
  },
  stepper: {
    flexDirection: 'row',
    gap: 6,
  },
  stepperBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: color.surfaceSubtle,
    borderWidth: 1,
    borderColor: color.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnPressed: {
    transform: [{ scale: 0.92 }],
    backgroundColor: color.track,
  },

  cta: {
    height: 54,
    borderRadius: radius.lg,
    backgroundColor: color.yellow,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  ctaSuccess: {
    backgroundColor: color.viz.green,
  },
  ctaInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  ctaText: {
    fontFamily: font.extrabold,
    fontSize: 16,
    color: color.navy,
    letterSpacing: 0.1,
  },
});
