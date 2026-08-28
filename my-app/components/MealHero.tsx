import React, { useMemo, useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { PawLoader } from './loader/PawLoader';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import type { PantryItem } from '../store/useActivePetStore';
import { AnimatedPressable } from './AnimatedPressable';
import { color, font, motion, radius, shadow, space } from '../constants/design';
import { getPortionPresets, type PortionPresets } from '../lib/pantryMath';
import { getSuggestion } from '../lib/portionLearning';

const FOOD_TYPE_ICONS: Record<string, keyof typeof MaterialIcons.glyphMap> = {
  kibble: 'pets',
  wet_food: 'soup-kitchen',
  treat: 'cookie',
  raw: 'egg-alt',
  supplement: 'medication',
  human_food: 'restaurant',
};

const MEALS_PER_DAY = 2;

type Phase = 'idle' | 'logging' | 'success';

interface Props {
  eyebrow: string;
  item: PantryItem;
  bowlSize?: 'small' | 'medium' | 'large' | 'xl';
  species?: 'dog' | 'cat';
  /** Used as a fallback for weight-mode chip baseline when the item has no per-serving label data. */
  dailyKcalTarget?: number;
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
 * an inline portion chip row, and one Log button.
 *
 * The chip vocabulary is unit-typed (see `getPortionPresets` in pantryMath):
 *   • fraction mode (cups, pouches, cans, …) — ¼ / ½ / Full / 1½ + text-link Custom
 *   • count mode (pieces)                    — 1 / 2 / 3 / Custom
 *   • weight mode (grams)                    — 0.5× / 1.0× / 1.5× baseline + Custom
 *
 * Internally the source of truth is `gramsFed`. At log time we send
 * `multiplier = gramsFed / gramsPerUnit` so `computePantryMacros` is
 * unchanged — kcal math stays single-sourced regardless of which vocabulary
 * the chips speak.
 */
export function MealHero({ eyebrow, item, bowlSize, species = 'dog', dailyKcalTarget = 0, onLog, isBusy }: Props) {
  // Resolve chip set + stepper for this item.
  const presets: PortionPresets = useMemo(() => {
    const kcalPer100g = item.kcal_per_100g_as_fed && item.kcal_per_100g_as_fed > 0 ? item.kcal_per_100g_as_fed : null;
    const labelGramsPerServing = item.kcal_per_serving && kcalPer100g
      ? (item.kcal_per_serving * 100) / kcalPer100g
      : null;
    const perMealKcalTarget = dailyKcalTarget > 0 ? dailyKcalTarget / MEALS_PER_DAY : null;
    return getPortionPresets(item.serving_unit, species, bowlSize ?? null, {
      labelGramsPerServing,
      perMealKcalTarget,
      kcalPer100g,
      kcalPerServing: item.kcal_per_serving ?? null,
    });
  }, [item.serving_unit, item.kcal_per_serving, item.kcal_per_100g_as_fed, species, bowlSize, dailyKcalTarget]);

  const { mode, gramsPerUnit, presets: chips, stepper } = presets;
  const stepperGramsDelta = stepper.step * gramsPerUnit;
  const stepperMinGrams = Math.max(1, Math.round(stepper.min * gramsPerUnit));
  const stepperMaxGrams = Math.round(stepper.max * gramsPerUnit);

  // The "Custom" chip belongs in the row only when mode is count/weight.
  // In fraction mode all 4 chips are real presets and Custom is a text-link below.
  const customChipIndex = mode === 'fraction' ? -1 : chips.findIndex(c => c.label === 'Custom');

  const [gramsFed, setGramsFed] = useState<number>(chips.find(c => c.label !== 'Custom')?.gramsFed ?? gramsPerUnit);
  const [isCustom, setIsCustom] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pre-fill the learned portion when this item changes. portionLearning stores
  // a multiplier (per-unit); convert to grams via the current presets and
  // match against any of the preset gram values.
  useEffect(() => {
    let cancelled = false;
    getSuggestion(item.id).then((learnedMult) => {
      if (cancelled) return;
      const learned = learnedMult ?? 1;
      const learnedGrams = Math.max(1, Math.round(learned * gramsPerUnit));
      setGramsFed(learnedGrams);
      const presetGrams = chips
        .filter(c => c.label !== 'Custom')
        .map(c => c.gramsFed);
      setIsCustom(!presetGrams.some(g => Math.abs(g - learnedGrams) < 1));
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, gramsPerUnit]);

  // Clean up any pending success-state timer on unmount.
  useEffect(() => () => {
    if (successTimer.current) clearTimeout(successTimer.current);
  }, []);

  const baseKcal = item.kcal_per_serving ?? 0;
  const multiplier = gramsPerUnit > 0 ? gramsFed / gramsPerUnit : 0;
  const displayKcal = Math.round(baseKcal * multiplier);

  const title = item.product_name
    ? `${item.brand} ${item.product_name}`
    : item.brand;

  const handlePressChip = (index: number) => {
    if (index === customChipIndex) {
      setIsCustom(true);
      return;
    }
    setIsCustom(false);
    setGramsFed(chips[index].gramsFed);
  };

  const handleCustom = () => {
    setIsCustom(true);
  };

  const handleStep = (delta: number) => {
    setGramsFed((g) => {
      const next = Math.max(stepperMinGrams, Math.min(stepperMaxGrams, Math.round(g + delta)));
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

  const renderChipSubLabel = (chip: { label: string; gramsFed: number }) => {
    if (chip.label === 'Custom') return null;
    if (mode === 'weight') {
      const k = Math.round((baseKcal * chip.gramsFed) / Math.max(1, gramsPerUnit));
      return baseKcal > 0 ? `≈ ${k} kcal` : null;
    }
    return `≈ ${chip.gramsFed} g`;
  };

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
              {gramsFed > 0 ? `${gramsFed} g · ` : ''}~{displayKcal} kcal
            </Text>
          </View>
        </View>

        {/* Chip row — four presets, with Custom sitting in the row for count/weight modes */}
        <View style={styles.chipRow}>
          {chips.map((chip, idx) => {
            const isCustomChip = idx === customChipIndex;
            const selected = isCustomChip
              ? isCustom
              : !isCustom && Math.abs(gramsFed - chip.gramsFed) < 1;
            const subLabel = renderChipSubLabel(chip);
            return (
              <Pressable
                key={chip.label + idx}
                style={({ pressed }) => [
                  styles.chip,
                  selected && styles.chipSelected,
                  pressed && styles.chipPressed,
                ]}
                onPress={() => handlePressChip(idx)}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]} numberOfLines={1}>
                  {chip.label}
                </Text>
                {subLabel && (
                  <Text style={[styles.chipSub, selected && styles.chipSubSelected]} numberOfLines={1}>
                    {subLabel}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>

        {/* Custom text-link — only in fraction mode (count/weight have a Custom chip) */}
        {mode === 'fraction' && (
          <Pressable onPress={handleCustom} style={styles.customLinkWrap}>
            <Text style={[styles.customLink, isCustom && styles.customLinkActive]}>
              {isCustom ? 'Custom amount' : 'Set custom amount'}
            </Text>
          </Pressable>
        )}

        {/* Portion summary + stepper */}
        <View style={styles.portionRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.portionValue}>
              {gramsFed} g
              {baseKcal > 0 && <Text style={styles.portionUnit}>  ·  {displayKcal} kcal</Text>}
            </Text>
            <Text style={styles.portionHint} numberOfLines={1}>
              {mode === 'weight'
                ? `Stepper · ${Math.round(stepperGramsDelta)} g`
                : `1 ${presets.unitLabel} ≈ ${gramsPerUnit} g`}
            </Text>
          </View>
          {isCustom && (
            <Animated.View entering={FadeInDown.duration(200)} style={styles.stepper}>
              <Pressable
                style={({ pressed }) => [
                  styles.stepperBtn,
                  gramsFed <= stepperMinGrams && { opacity: 0.3 },
                  pressed && styles.stepperBtnPressed,
                ]}
                onPress={() => handleStep(-stepperGramsDelta)}
                disabled={gramsFed <= stepperMinGrams}
              >
                <MaterialIcons name="remove" size={20} color={color.navy} />
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.stepperBtn,
                  gramsFed >= stepperMaxGrams && { opacity: 0.3 },
                  pressed && styles.stepperBtnPressed,
                ]}
                onPress={() => handleStep(stepperGramsDelta)}
                disabled={gramsFed >= stepperMaxGrams}
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
            <Text style={styles.ctaText}>Logging…</Text>
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
      <PawLoader visible={phase === 'logging'} message="Logging meal…" />
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
    gap: space.sm,
    marginBottom: space.sm,
  },
  chip: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.hairline,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
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
    lineHeight: 16,
  },
  chipTextSelected: {
    color: color.cream,
  },
  chipSub: {
    fontFamily: font.medium,
    fontSize: 10.5,
    color: color.slateFaint,
    textAlign: 'center',
    marginTop: 2,
    lineHeight: 13,
  },
  chipSubSelected: {
    color: color.creamDim,
  },

  customLinkWrap: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
    marginBottom: space.sm,
  },
  customLink: {
    fontFamily: font.semibold,
    fontSize: 12,
    color: color.slateMuted,
    textDecorationLine: 'underline',
  },
  customLinkActive: {
    color: color.navy,
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
