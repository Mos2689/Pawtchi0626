import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, Pressable, Alert, Modal, BackHandler, InteractionManager } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { color, font, motion, radius, shadow, space, makeShadow } from '../../constants/design';
import { useActivePetStore } from '../../store/useActivePetStore';
import { HealthProfileGate } from '../../components/health/HealthProfileGate';
import { useStreakStore } from '../../store/useStreakStore';
import { usePetContextStore } from '../../store/usePetContextStore';
import { useAuth } from '../../providers/AuthProvider';
import { supabase } from '../../lib/supabase';
import { computeHealthScore } from '../../lib/healthScore';
import { findToxicIngredients } from '../../lib/toxicIngredients';
import { getAgeMonths } from '../../lib/lifeStage';
import { getLocalYMD } from '../../lib/dateUtils';
import { analyzeFood, type FoodAnalysis } from '../../lib/foodVerdict';
import {
  buildVerdictBundle, deriveVerdictCategory, deterministicVerdict,
  fetchVerdictLLM, fetchVerdictWithFallback, estimateMealGrams,
} from '../../lib/verdictPipeline';
import {
  BOWL_SIZE_GRAMS,
  computePantryMacros,
  getPortionBounds,
  getPortionPresets,
  MEALS_PER_DAY,
  type BowlSize,
} from '../../lib/pantryMath';
import {
  resolveCanonicalMeal,
  resolveLoggedTotals,
  resolvePantrySourceId,
  resolveScanKcal,
} from '../../lib/mealLogKcal';
import { mapMedicalConditionsToAdjustmentKeys } from '../../lib/clinicalMapping';
import { deriveGoal } from '../../lib/healthMath';
import { useSubscription } from '../../hooks/useSubscription';
import PantryPillSelector from '../../components/PantryPillSelector';
import { PantryLabelEditor, type PantryLabelPatch } from '../../components/PantryLabelEditor';
import { PawtchiButton } from '../../components/PawtchiButton';
import { PawLoader } from '../../components/loader/PawLoader';
import { AnimatedPressable } from '../../components/AnimatedPressable';
import { ScanSourceRow } from '../../components/ScanSourceRow';
import { MealHero } from '../../components/MealHero';
import { BreathingPaw } from '../../components/BreathingPaw';
import { Image as ExpoImage } from 'expo-image';
import { predictMeal, currentSlot } from '../../lib/mealPrediction';
import { recordServing, getSuggestion } from '../../lib/portionLearning';
import {
  boundsInGrams,
  learnedPortionToMultiplier,
  multiplierToLearnedPortion,
} from '../../lib/resolveInitialPortion';
import { markNearestFeedingActivityComplete } from '../../lib/feedingActivityLink';
import { haptic } from '../../lib/haptics';
import { randomUUID } from '../../lib/uuid';
import { pantryItemToScanResult } from '../../lib/pantryToScanResult';
import { prepareImageForUpload } from '../../lib/imagePrep';
import { FailureModal } from '../../components/FailureModal';
import type { FailureMeta } from '../../lib/support/handoff';
import {
  errorCopy, extractInvokeErrorCode, fromEdgeBody, isAppError, reportError, toAppError,
  type ErrorContext, type ErrorCopy, type RecoveryActionId,
} from '../../lib/appError';
import type { PantryItem } from '../../store/useActivePetStore';
import { trackFirebaseEvent } from '../../lib/firebaseAnalytics';
import { weightPlanViewModelFromRecord } from '../../lib/weightPlanRecord';
import { TAB_BAR_CLEARANCE } from '../../components/navigation/SplitTabBar';
import { useNotificationCenterStore } from '../../store/useNotificationCenterStore';
import { dayScope, stableId } from '../../lib/notificationCenter/stableId';

async function isFirstFoodLogForUser(userId: string | undefined): Promise<boolean> {
  if (!userId) return false;

  const { data: pets, error: petsError } = await supabase
    .from('pets')
    .select('id')
    .eq('owner_id', userId);
  if (petsError || !pets?.length) return false;

  const { data: existingScans, error: scansError } = await supabase
    .from('food_scans')
    .select('id')
    .in('pet_id', pets.map((pet) => pet.id))
    .limit(1);

  // Fail closed: a lookup error must never turn an ordinary log into a false
  // acquisition milestone.
  return !scansError && existingScans?.length === 0;
}

interface ScanResult {
  food_name: string;
  brand?: string | null;
  product_name?: string | null;
  food_type?: 'kibble' | 'wet_food' | 'treat' | 'raw' | 'supplement' | 'human_food';
  calories_per_serving: number;
  serving_size: string;
  /**
   * The weight the packet states for one serving. Read by the extractor and,
   * until now, dropped on the floor here — which is why a label that prints
   * "475 kcal/100 g" and "120 g tray" could not be priced.
   */
  serving_grams?: number | null;
  serving_unit?: string | null;
  protein_pct?: number | null;
  fat_pct?: number | null;
  fibre_pct?: number | null;
  moisture_pct?: number | null;
  kcal_per_100g_as_fed?: number | null;
  key_ingredients?: string[] | null;
  is_treat: boolean;
  is_allergy_trigger: boolean;
  allergy_warnings: string[];
  ingredients_of_concern: string[];
  recommendation: string;
  confidence: number;
  is_labeled_product?: boolean;
  /** Server-side pantry auto-match, carried onto the result for the Source row. */
  matched_pantry_id?: string | null;
  match_confidence?: number;
  food_type_mismatch?: boolean;
  needs_owner_review?: boolean;
  extraction_flags?: string[];
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  health_score?: number;
  ingredients?: string[];
  verdict?: string;
  verdict_category?: 'unsafe' | 'poor' | 'fair' | 'good' | 'excellent';
  food_analysis?: FoodAnalysis | null;
}

/**
 * Meal needs a real weight, age, body score, a bowl and something in the
 * pantry — none of which a walk-first dog profile has. The gate replaces the
 * screen's content until they exist, rather than letting every portion and
 * calorie number on this screen render off a zero weight.
 */
export default function MealScreen() {
  const activePet = useActivePetStore(s => s.activePet);
  const pantry = useActivePetStore(s => s.foodPantry);
  return (
    <HealthProfileGate
      feature="meal_logging"
      pet={activePet}
      petName={activePet?.name}
      pantryCount={pantry?.length ?? 0}
    >
      <MealScreenContent />
    </HealthProfileGate>
  );
}

function MealScreenContent() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // Fine-grained selectors: this 2 800-line screen must re-render only when the
  // specific value changes, not on any unrelated store mutation (coin ticks,
  // isTailoring, isLoading…). Zustand actions are stable references, so
  // selecting them individually is free.
  const activePet = useActivePetStore(s => s.activePet);
  const foodPantry = useActivePetStore(s => s.foodPantry);
  const incrementPantryScan = useActivePetStore(s => s.incrementPantryScan);
  const archivePantryItem = useActivePetStore(s => s.archivePantryItem);
  const addPantryItem = useActivePetStore(s => s.addPantryItem);
  const fetchPantry = useActivePetStore(s => s.fetchPantry);
  const recalibrating = useActivePetStore(s => s.recalibrating);
  const pawCoins = useStreakStore(s => s.pawCoins);
  const awardCoins = useStreakStore(s => s.awardCoins);
  const { user } = useAuth();
  const { hasFullAccess } = useSubscription();
  // Subscribe to today's calorie state so the canopy reflects updates live.
  // Must be at top of the component — never after a conditional return.
  const consumedToday = usePetContextStore((s) => s.todayCalories) ?? 0;

  const checkAccess = () => {
    if (!hasFullAccess) {
      router.push('/paywall' as any);
      return false;
    }
    return true;
  };

  /**
   * Idempotency key for the meal currently being logged.
   *
   * Generated once per user ACTION, not per attempt: `retryRef` re-runs
   * confirmLog on failure, and a fresh key each time would turn one tap plus a
   * flaky network into two meals. Cleared once the log commits, and whenever
   * the result screen resets, so the next meal gets its own key.
   */
  const logKeyRef = useRef<string | null>(null);

  // Pantry awareness state
  const [selectedPantryId, setSelectedPantryId] = useState<string | null>(null);
  // "Change source" picker visible on the result screen.
  const [sourcePickerVisible, setSourcePickerVisible] = useState(false);

  // Centered popups rendered as inline absolute overlays — NOT as <Modal>.
  // RN's Modal on Android can leave native touch handlers in a stale state
  // after the first dismiss; rendering inline sidesteps that lifecycle
  // entirely. Camera/library/log are deferred via InteractionManager so the
  // overlay's unmount commits before the next intent fires.
  const [sourcePopupVisible, setSourcePopupVisible] = useState(false);

  // The user can override the predicted hero by tapping an alternative row.
  // null = use the prediction; otherwise this pantry item id sits in the hero.
  const [heroOverrideId, setHeroOverrideId] = useState<string | null>(null);

  // Reset pantry selection when pet changes
  useEffect(() => {
    setSelectedPantryId(null);
    setSourcePopupVisible(false);
    setHeroOverrideId(null);
  }, [activePet?.id]);

  // Scanner state
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("Ai analysing...");

  // ── The label-gap handoff ───────────────────────────────────────────────────
  //
  // A scan that read the packet fine but found no calorie figure on it pauses
  // here instead of failing: the pantry row it created opens in the label
  // editor, and the scan waits in the ref for the owner to supply the number.
  // Held in a ref rather than state because nothing renders from it — it is a
  // continuation, and re-rendering the screen for it would be noise.
  const [labelGapItem, setLabelGapItem] = useState<PantryItem | null>(null);
  const pendingScanRef = useRef<ScanResult | null>(null);

  // Branded failure sheet — ALL failure paths on this screen land here,
  // always via errorCopy(). OS alerts remain only for confirmations
  // (toxin block, overage, hide-food).
  const [failure, setFailure] = useState<ErrorCopy | null>(null);
  // What the failure was, for the support composer: the area chip arrives
  // preselected and the kind rides along into diagnostics.
  const [failureMeta, setFailureMeta] = useState<FailureMeta | null>(null);
  // Replays whatever operation failed — set at the entry of each top-level
  // action (scan / confirm-log / quick-log), read by "Try again".
  const retryRef = useRef<null | (() => void)>(null);
  const presentFailure = useCallback((err: unknown, context: ErrorContext) => {
    const appErr = isAppError(err) ? err : toAppError(err);
    reportError(appErr, context);
    setFailureMeta({ kind: appErr.kind, context });
    setFailure(errorCopy(appErr, { context, petName: activePet?.name }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePet?.name]);
  // Only the actions this screen owns — FailureModal handles contact support,
  // settings and back, so none of them can go dead here.
  const handleRecovery = useCallback((action: RecoveryActionId) => {
    if (action === 'retry') retryRef.current?.();
    else if (action === 'pick_again') setSourcePopupVisible(true);
  }, []);

  // Serving count multiplier — lets users adjust portions
  const [servingCount, setServingCount] = useState(1);
  // Show the precise +/- stepper only when the user taps Custom. The three
  // Less/Usual/More chips cover ~95% of real intent.
  const [showCustomPortion, setShowCustomPortion] = useState(false);
  // Learned-portion pre-fill for the current pantry source. This only ever
  // pre-selects a portion — it no longer offers to rewrite the pantry item's
  // calories, because a portion is not a label fact (see the note on the
  // learned-portion effect below).

  // Rotate spinner words during analysis
  useEffect(() => {
    if (!isAnalyzing) {
      setLoadingMessage("Analysing food...");
      return;
    }

    const messages = [
      "Reading the label...",
      "Checking ingredients...",
      "Counting the macros...",
      "Calibrating portions...",
      "Assessing the verdict...",
      "Matching against pantry...",
      "Preparing the result..."
    ];
    
    let i = 0;
    const interval = setInterval(() => {
      i = (i + 1) % messages.length;
      setLoadingMessage(messages[i]);
    }, 2000);
    
    return () => clearInterval(interval);
  }, [isAnalyzing]);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [isLogging, setIsLogging] = useState(false);
  const [hasLogged, setHasLogged] = useState(false);
  const [isPendingConfirm, setIsPendingConfirm] = useState(false);

  // Reset hasLogged flag on new scan so Add to Bowl re-enables
  useEffect(() => {
    if (scanResult) {
      setHasLogged(false);
      setIsPendingConfirm(false);
    }
  }, [scanResult]);

  /**
   * The portion vocabulary for a pantry item — the same call MealHero makes.
   *
   * Both places that read or write a learned portion resolve it through this,
   * so the bounds applied at record time and at replay time are identical. Two
   * copies of this call drifting apart is precisely how a portion that one
   * screen considers impossible becomes another screen's opening value.
   */
  const petSpecies = (activePet?.species as 'dog' | 'cat') ?? 'dog';
  const petBowlSize = (activePet?.bowl_size as BowlSize | undefined) ?? null;
  const petDailyKcal = activePet?.target_daily_calories ?? 0;
  const presetsForItem = useCallback((item: PantryItem) => {
    const kcalPer100g = item.kcal_per_100g_as_fed && item.kcal_per_100g_as_fed > 0
      ? item.kcal_per_100g_as_fed
      : null;
    const labelGramsPerServing = item.kcal_per_serving && kcalPer100g
      ? (item.kcal_per_serving * 100) / kcalPer100g
      : null;
    const perMealKcalTarget = petDailyKcal > 0 ? petDailyKcal / MEALS_PER_DAY : null;
    return getPortionPresets(item.serving_unit, petSpecies, petBowlSize, {
      labelGramsPerServing,
      perMealKcalTarget,
      kcalPer100g,
      kcalPerServing: item.kcal_per_serving ?? null,
    });
  }, [petSpecies, petBowlSize, petDailyKcal]);

  /**
   * Re-derive everything a scan result shows from a given pantry source.
   *
   * Nutrition, label percentages, health score and the verdict panel all come
   * from the source, so all of them have to be recomputed together when the
   * source changes. Previously only the calories were reactive: picking a
   * different food on the result screen updated the kcal while the verdict,
   * the health score and the guaranteed-analysis figures carried on describing
   * the food you had just deselected.
   *
   * Used by the scan path AND by the source picker, so the two cannot drift.
   * Pure with respect to state — returns a new scan result, mutates nothing.
   */
  const deriveScanFromSource = useCallback((scan: ScanResult, item: PantryItem | null): ScanResult => {
    if (!activePet) return scan;
    const next: ScanResult = { ...scan };
    const opts = {
      species: activePet.species as 'dog' | 'cat',
      bowl: activePet.bowl_size ? { size: activePet.bowl_size as BowlSize } : undefined,
    };

    if (item) {
      // Always ONE serving. The portion multiplier is applied once, at log
      // time, by the canonical resolver — baking it in here read a stale
      // servingCount and left the preview double-counting it.
      const macros = computePantryMacros(item, 1, opts);
      next.calories_per_serving = macros.total_kcal;
      next.protein_g = macros.protein_g;
      next.fat_g = macros.fat_g;
      next.carbs_g = macros.carbs_g;
      next.kcal_per_100g_as_fed = macros.kcal_per_100g;
      next.moisture_pct = macros.moisture_pct;
      // Label percentages too, so the preview verdict reads the same data
      // executeLog will — otherwise preview and stored verdict disagree.
      next.protein_pct = item.protein_pct ?? null;
      next.fat_pct = item.fat_pct ?? null;
      next.fibre_pct = item.fibre_pct ?? null;
    }

    try {
      const { score, reasons } = computeHealthScore({
        food: {
          food_type: next.food_type,
          is_treat: next.is_treat === true,
          is_allergy_trigger: next.is_allergy_trigger === true,
          allergy_warnings: next.allergy_warnings ?? [],
          ingredients_of_concern: next.ingredients_of_concern ?? [],
          calories_per_serving: next.calories_per_serving,
          protein_pct: next.protein_pct ?? null,
          fat_pct: next.fat_pct ?? null,
          fibre_pct: next.fibre_pct ?? null,
          moisture_pct: next.moisture_pct ?? null,
          kcal_per_100g_as_fed: next.kcal_per_100g_as_fed ?? null,
          confidence: next.confidence,
          name_and_ingredients: [next.food_name, ...(next.key_ingredients ?? [])],
        },
        pet: {
          species: activePet.species as 'dog' | 'cat',
          age_months: getAgeMonths(activePet) ?? null,
          daily_kcal_target: activePet.target_daily_calories ?? null,
          allergies: activePet.allergies ?? null,
          medical_conditions: activePet.medical_conditions ?? null,
          weight_kg: activePet.current_weight_kg ?? null,
          target_weight_kg: activePet.target_weight_kg ?? null,
        },
      });
      next.health_score = score;
      (next as any)._healthScoreReasons = reasons;
    } catch {
      // Keep whatever the extractor gave us if scoring fails.
    }

    try {
      // Meal weight comes from the canonical resolver when a pantry item backs
      // the scan. The protein-derived estimate survives only for an unmatched
      // scan, where there genuinely is no serving weight to know.
      const canonical = resolveCanonicalMeal(next, item, 1, opts);
      const proteinPct = next.protein_pct ?? null;
      const proteinG = next.protein_g ?? 0;
      const mealGrams =
        canonical.mealGrams ??
        (proteinPct && proteinPct > 0 && proteinG > 0
          ? Math.round((proteinG / proteinPct) * 100)
          : Math.max(1, Math.round(next.calories_per_serving / 3.5)));

      next.food_analysis = analyzeFood({
        food: {
          product_name: next.food_name,
          food_type: next.food_type ?? 'kibble',
          kcal_per_100g_as_fed: next.kcal_per_100g_as_fed ?? null,
          moisture_pct: next.moisture_pct ?? null,
          protein_pct: next.protein_pct ?? null,
          fat_pct: next.fat_pct ?? null,
          fiber_pct: next.fibre_pct ?? null,
          calcium_pct: null,
          phosphorus_pct: null,
        },
        pet: {
          name: activePet.name,
          species: activePet.species,
          weight_kg: activePet.current_weight_kg,
          target_weight_kg: activePet.target_weight_kg ?? null,
          age_months: getAgeMonths(activePet) ?? null,
          activity_level: activePet.activity_level,
          is_neutered: activePet.is_neutered,
          goal: deriveGoal(
            activePet.current_weight_kg ?? 0,
            activePet.target_weight_kg ?? null,
            activePet.body_condition_score,
          ),
          confirmed_condition_keys: mapMedicalConditionsToAdjustmentKeys(activePet.medical_conditions),
          breed: activePet.breed ?? null,
          age_years: activePet.age_years ?? null,
          body_condition_score: activePet.body_condition_score ?? null,
        },
        meal_grams: mealGrams,
      });
    } catch {
      // Panel simply won't render if verdict computation fails.
    }

    return next;
  }, [activePet]);

  /**
   * Changing the source re-resolves the whole result, not just the calories.
   *
   * `selectedPantryId` is the owner saying "this is actually a different food".
   * Everything the old food contributed has to go with it.
   */
  const sourceReresolvedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!scanResult || isAnalyzing) return;
    const key = `${selectedPantryId ?? 'none'}`;
    if (sourceReresolvedFor.current === null) {
      // First render for this scan — the scan path already derived it.
      sourceReresolvedFor.current = key;
      return;
    }
    if (sourceReresolvedFor.current === key) return;
    sourceReresolvedFor.current = key;
    const item = selectedPantryId ? foodPantry.find(p => p.id === selectedPantryId) ?? null : null;
    setScanResult(prev => (prev ? deriveScanFromSource(prev, item) : prev));
  }, [selectedPantryId, scanResult, isAnalyzing, foodPantry, deriveScanFromSource]);

  // Clear the re-resolution marker when the result screen closes, so the next
  // scan starts from its own derivation rather than inheriting this one's.
  useEffect(() => {
    if (!scanResult) {
      sourceReresolvedFor.current = null;
      // A new scan is a new meal, so it must not inherit the previous one's
      // idempotency key — that would make the second log look like a retry of
      // the first and silently drop it.
      logKeyRef.current = null;
    }
  }, [scanResult]);

  // When a result opens for a pantry-sourced food, pre-default the portion to
  // what the owner has been feeding.
  //
  // This is the second of the two places a learned portion is applied (the
  // other is MealHero). It reads through the same bounded helpers for the same
  // reason: the stored portion is typed, validated against this item's current
  // stepper range, and discarded outright if its mode no longer matches — a
  // saved "3 pieces" means nothing once the food is measured in grams.
  useEffect(() => {
    if (!scanResult) return;
    const sourceId = resolvePantrySourceId(scanResult, selectedPantryId);
    if (!sourceId) return;
    const sourceItem = foodPantry.find(p => p.id === sourceId);
    if (!sourceItem) return;

    const presets = presetsForItem(sourceItem);
    const bounds = getPortionBounds(presets);
    let cancelled = false;
    getSuggestion(sourceId, bounds).then((learned) => {
      if (cancelled || !learned) return;
      const mult = learnedPortionToMultiplier(learned, presets);
      if (!Number.isFinite(mult) || mult <= 0) return;
      setServingCount(mult);
      const isBowl = !!activePet?.bowl_size &&
        (sourceItem.serving_unit === 'cup' || !sourceItem.serving_unit);
      const chipValues = isBowl ? [0.25, 0.5, 1] : [0.75, 1, 1.25];
      setShowCustomPortion(!chipValues.some(p => Math.abs(mult - p) < 0.01));
    });
    return () => { cancelled = true; };
  }, [scanResult, selectedPantryId, foodPantry, presetsForItem, activePet?.bowl_size]);

  // Branded log success modal state — no longer used (replaced by CoinToast)

  // Quick Log: tap a pantry chip → land on the same result screen as a scan,
  // pre-populated from pantry data. Skips the camera + Gemini food-ID call,
  // but still computes health score, food_analysis, and verdict so the result
  // screen has the full review UX. The user adjusts servings and taps
  // "Add to Bowl" → confirmLog runs through the regular logging pipeline.
  // Long-press a non-primary pantry pill → hide it from the rail (history kept).
  // Structural param so it accepts the pill selector's narrower PantryItem too.
  const promptArchivePantry = (item: { id: string; brand: string; product_name?: string | null }) => {
    const label = item.product_name ? `${item.brand} ${item.product_name}` : item.brand;
    Alert.alert(
      'Hide this food',
      `${label} will leave the meal rail and quick log. Past logs stay in ${activePet?.name || 'your pet'}’s history.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Hide',
          style: 'destructive',
          onPress: () => {
            if (selectedPantryId === item.id) setSelectedPantryId(null);
            archivePantryItem(item.id);
          },
        },
      ],
    );
  };

  const handleQuickLog = useCallback(async (item: PantryItem) => {
    if (!checkAccess() || !activePet) return;
    retryRef.current = () => handleQuickLog(item);

    setIsAnalyzing(true);
    setLoadingMessage('Preparing meal...');
    setSelectedPantryId(item.id);
    setServingCount(1);
    setCapturedImage(null);

    try {
      // 1. Synthesize the scanResult, then apply pantry macros for 1 serving
      // so the preview totals match what executeLog will store. Pass the pet's
      // current allergies so the matcher flags `is_allergy_trigger` and
      // populates warnings — keeps Quick Log consistent with the scan path,
      // which gets these from Gemini.
      const synthetic = pantryItemToScanResult(
        item,
        activePet.allergies ?? null,
        activePet.name,
      ) as ScanResult;
      const macros = computePantryMacros(item, 1, {
        species: activePet?.species,
        bowl: activePet?.bowl_size ? { size: activePet.bowl_size as any } : undefined,
      });
      synthetic.calories_per_serving = macros.total_kcal;
      synthetic.protein_g = macros.protein_g;
      synthetic.fat_g = macros.fat_g;
      synthetic.carbs_g = macros.carbs_g;
      synthetic.kcal_per_100g_as_fed = macros.kcal_per_100g;
      synthetic.moisture_pct = macros.moisture_pct;

      const previewGoal = deriveGoal(
        activePet.current_weight_kg ?? 0,
        activePet.target_weight_kg ?? null,
        activePet.body_condition_score,
      );
      const previewConditionKeys = mapMedicalConditionsToAdjustmentKeys(
        activePet.medical_conditions,
      );

      // 2. Health score (deterministic, same as scan flow's preview)
      let healthReasons: string[] = [];
      try {
        const { score, reasons } = computeHealthScore({
          food: {
            food_type: synthetic.food_type,
            is_treat: synthetic.is_treat === true,
            is_allergy_trigger: synthetic.is_allergy_trigger === true,
            allergy_warnings: synthetic.allergy_warnings ?? [],
            ingredients_of_concern: synthetic.ingredients_of_concern ?? [],
            calories_per_serving: synthetic.calories_per_serving,
            protein_pct: synthetic.protein_pct ?? null,
            fat_pct: synthetic.fat_pct ?? null,
            fibre_pct: synthetic.fibre_pct ?? null,
            moisture_pct: synthetic.moisture_pct ?? null,
            kcal_per_100g_as_fed: synthetic.kcal_per_100g_as_fed ?? null,
            confidence: synthetic.confidence,
            name_and_ingredients: [synthetic.food_name, ...(synthetic.key_ingredients ?? [])],
          },
          pet: {
            species: activePet.species as 'dog' | 'cat',
            age_months: getAgeMonths(activePet) ?? null,
            daily_kcal_target: activePet.target_daily_calories ?? null,
            allergies: activePet.allergies ?? null,
            medical_conditions: activePet.medical_conditions ?? null,
            weight_kg: activePet.current_weight_kg ?? null,
            target_weight_kg: activePet.target_weight_kg ?? null,
          },
        });
        synthetic.health_score = score;
        healthReasons = reasons;
      } catch {
        // health score stays unset; result screen falls back to 5
      }

      // 3. Food analysis (powers the Nutrition Reference panel)
      try {
        const proteinPct = synthetic.protein_pct ?? null;
        const proteinG = synthetic.protein_g ?? 0;
        const previewKcal = synthetic.calories_per_serving;
        const estimatedMealGrams =
          proteinPct && proteinPct > 0 && proteinG > 0
            ? Math.round((proteinG / proteinPct) * 100)
            : Math.max(1, Math.round(previewKcal / 3.5));
        synthetic.food_analysis = analyzeFood({
          food: {
            product_name: synthetic.food_name,
            food_type: synthetic.food_type ?? 'kibble',
            kcal_per_100g_as_fed: synthetic.kcal_per_100g_as_fed ?? null,
            moisture_pct: synthetic.moisture_pct ?? null,
            protein_pct: synthetic.protein_pct ?? null,
            fat_pct: synthetic.fat_pct ?? null,
            fiber_pct: synthetic.fibre_pct ?? null,
            calcium_pct: null,
            phosphorus_pct: null,
          },
          pet: {
            name: activePet.name,
            species: activePet.species,
            weight_kg: activePet.current_weight_kg,
            target_weight_kg: activePet.target_weight_kg ?? null,
            age_months: getAgeMonths(activePet) ?? null,
            activity_level: activePet.activity_level,
            is_neutered: activePet.is_neutered,
            goal: previewGoal,
            confirmed_condition_keys: previewConditionKeys,
            breed: activePet.breed ?? null,
            age_years: activePet.age_years ?? null,
            body_condition_score: activePet.body_condition_score ?? null,
          },
          meal_grams: estimatedMealGrams,
        });
      } catch {
        // panel just won't render
      }

      // 4. Verdict — same gemini-verdict path as scan flow, with the same
      // deterministic generateVerdict fallback. Context assembly + LLM/fallback
      // order live in lib/verdictPipeline.ts (single source for all three flows).
      if (synthetic.food_analysis) {
        const today = getLocalYMD(new Date());
        const { data: todayLog } = await supabase
          .from('daily_logs')
          .select('calories_consumed')
          .eq('pet_id', activePet.id)
          .eq('log_date', today)
          .maybeSingle();
        const caloriesConsumedToday = (todayLog?.calories_consumed as number) || 0;

        const preComputedScore = synthetic.health_score ?? 5;
        synthetic.verdict_category = deriveVerdictCategory(
          synthetic.is_allergy_trigger === true,
          synthetic.is_treat === true,
          preComputedScore,
        );

        const bundle = buildVerdictBundle({
          pet: activePet,
          scan: {
            food_name: synthetic.food_name,
            food_type: synthetic.food_type ?? null,
            is_treat: synthetic.is_treat === true,
            is_allergy_trigger: synthetic.is_allergy_trigger === true,
            allergy_warnings: synthetic.allergy_warnings ?? [],
            ingredients_of_concern: synthetic.ingredients_of_concern ?? [],
            key_ingredients: synthetic.key_ingredients ?? null,
            calories_per_serving: synthetic.calories_per_serving,
            recommendation: synthetic.recommendation,
            confidence: synthetic.confidence,
          },
          macros: {
            total_kcal: synthetic.calories_per_serving,
            protein_g: synthetic.protein_g ?? 0,
            fat_g: synthetic.fat_g ?? 0,
            carbs_g: synthetic.carbs_g ?? 0,
            fibre_g: 0,
            kcal_per_100g: synthetic.kcal_per_100g_as_fed ?? null,
            moisture_pct: synthetic.moisture_pct ?? null,
            meal_grams: estimateMealGrams(synthetic.protein_pct, synthetic.protein_g ?? 0, synthetic.calories_per_serving),
          },
          foodAnalysis: synthetic.food_analysis,
          healthScore: preComputedScore,
          healthScoreReasons: healthReasons,
          caloriesConsumedToday,
          weightTrendDirection: usePetContextStore.getState().weightTrend?.direction ?? null,
        });

        const verdictResult = await fetchVerdictWithFallback(bundle);
        if (verdictResult) {
          synthetic.verdict = verdictResult.verdict;
          synthetic.verdict_category = verdictResult.verdict_category;
        }
        // else: verdict stays unset; result screen falls back to recommendation (empty)
      }

      setScanResult(synthetic);
    } catch (err: unknown) {
      presentFailure(err, 'log');
    } finally {
      setIsAnalyzing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePet?.id, hasFullAccess]);

  // The hero's Log button fires this with the chip's multiplier. Builds a
  // synthetic scan result from the pantry item and calls confirmLog directly —
  // no popup, no result-screen detour, just log the meal. Returns the
  // confirmLog promise so the hero can await it and show success state.
  const logHero = useCallback(async (item: PantryItem, multiplier: number) => {
    if (!checkAccess() || !activePet) return;
    const synthetic = pantryItemToScanResult(
      item,
      activePet.allergies ?? null,
      activePet.name,
    ) as ScanResult;
    await confirmLog({
      scanResult: synthetic,
      pantryId: item.id,
      servingCount: multiplier,
      capturedImage: null,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePet?.id, hasFullAccess]);

  // Android hardware back closes the source popup when it's open.
  useEffect(() => {
    if (!sourcePopupVisible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setSourcePopupVisible(false);
      return true;
    });
    return () => sub.remove();
  }, [sourcePopupVisible]);

  /**
   * The pantry row this scan belongs to, creating it if this product is new.
   *
   * Called from two places for the same reason: a scanned label describes a
   * food that outlives this meal. The log path uses it so the product shows up
   * on the Quick Log rail; the missing-calories path uses it because a figure
   * the owner types has to be stored *somewhere*, and the pantry row is the
   * thing that already carries label facts and their provenance.
   *
   * Deduped by (brand, product_name) against the in-memory rail, so a re-scan
   * in the same session reuses the row rather than stacking duplicates.
   */
  const ensurePantryRowForScan = useCallback(async (
    sr: ScanResult,
    imageUri: string | null,
  ): Promise<PantryItem | null> => {
    if (!activePet) return null;
    const isLabeledProduct = sr.is_labeled_product === true || (!!sr.brand && !!sr.product_name);
    if (!isLabeledProduct) return null;

    const targetBrand = (sr.brand || sr.food_name || '').trim().toLowerCase();
    const targetProduct = (sr.product_name || sr.food_name || '').trim().toLowerCase();
    const existing = foodPantry.find(p =>
      p.brand.trim().toLowerCase() === targetBrand &&
      (p.product_name || '').trim().toLowerCase() === targetProduct
    );
    if (existing) return existing;

    const foodType = sr.food_type || (sr.is_treat ? 'treat' : 'kibble');
    const sameTypeCount = foodPantry.filter(p => p.food_type === foodType).length;
    const petAllergiesLower = (activePet.allergies || []).map(a => a.toLowerCase());
    const ingredients = sr.key_ingredients || [];
    const allergyFlags = ingredients.filter(ing =>
      petAllergiesLower.some(a => ing.toLowerCase().includes(a))
    );
    try {
      return await addPantryItem({
        pet_id: activePet.id,
        brand: sr.brand || sr.food_name || 'Unknown',
        product_name: sr.product_name || sr.food_name || '',
        food_type: foodType,
        kcal_per_serving: sr.calories_per_serving || null,
        kcal_per_100g_as_fed: sr.kcal_per_100g_as_fed ?? null,
        // The label's own serving weight. Dropping it here was what forced
        // every downstream consumer to re-derive a weight it had been told.
        serving_grams: sr.serving_grams ?? null,
        serving_size_raw: sr.serving_size ?? null,
        moisture_pct: sr.moisture_pct ?? null,
        serving_unit: sr.serving_unit ?? null,
        protein_pct: sr.protein_pct ?? null,
        fat_pct: sr.fat_pct ?? null,
        fibre_pct: sr.fibre_pct ?? null,
        key_ingredients: sr.key_ingredients ?? null,
        allergy_flags: allergyFlags.length > 0 ? allergyFlags : null,
        is_primary: sameTypeCount === 0,
        image_url: imageUri || undefined,
        expiry_date: null,
        is_favorite: false,
      });
    } catch {
      // Silent failure — the scan still logs against food_scans even if the
      // pantry insert fails; the user just won't see it on the rail. The
      // missing-calories path checks for null and falls back to a failure sheet.
      return null;
    }
  }, [activePet, foodPantry, addPantryItem]);

  /**
   * Everything after "we have a figure we can stand behind": resolve the
   * source, derive the numbers from it, narrate a verdict, show the result.
   *
   * Split out of analyzeWithGemini so the owner-supplied-calories path can
   * re-enter it with the same scan once the missing number exists. Re-running
   * the whole analysis instead would spend a second Gemini call to re-read a
   * photo we already read correctly.
   */
  const finalizeScan = useCallback(async (
    scan: ScanResult,
    explicitPantryId: string | null,
  ) => {
    const normalized: ScanResult = { ...scan };

    // Decide whether to trust the pantry's label values over Gemini's read.
    //   • Explicit user selection → always trust (the user told us).
    //   • Server auto-match with high confidence AND no food_type mismatch →
    //     trust (the model says it's clearly this pantry item).
    //   • Otherwise → keep Gemini's macros; the Source row on the result
    //     screen will let the user accept the auto-match or pick another.
    // resolvePantrySourceId owns that decision for every consumer on this
    // screen (preview, chips, log) so they can't drift apart.
    const serverMatchId = normalized.matched_pantry_id ?? null;
    const matchConf = normalized.match_confidence ?? 0;
    const foodTypeMismatch = normalized.food_type_mismatch === true;
    const overrideFromPantryId = resolvePantrySourceId(
      { matched_pantry_id: serverMatchId, match_confidence: matchConf, food_type_mismatch: foodTypeMismatch },
      explicitPantryId,
    );

    // Carry the match metadata forward onto the scan result so the result
    // screen's Source row can show 'Auto-matched · tap to confirm' and the
    // "different food?" banner when food_type_mismatch was raised.
    normalized.matched_pantry_id = serverMatchId;
    normalized.match_confidence = matchConf;
    normalized.food_type_mismatch = foodTypeMismatch;

    // Nutrition, label percentages, health score and the verdict panel all
    // derive from the resolved source — through the SAME helper the source
    // picker uses, so a scan and a later source change can never produce
    // different answers for the same food.
    Object.assign(
      normalized,
      deriveScanFromSource(
        normalized,
        overrideFromPantryId
          ? foodPantry.find(p => p.id === overrideFromPantryId) ?? null
          : null,
      ),
    );

    // Build a plain-English verdict via Gemini using macro scan details + pet profile.
    // Architecture: compute ALL analysis BEFORE the LLM call, then pass the
    // completed decision as context. The LLM narrates — it doesn't judge.
    // Context assembly + LLM/fallback order live in lib/verdictPipeline.ts.
    if (normalized.food_analysis && activePet) {
      // Fetch today's running calorie total
      const today = getLocalYMD(new Date());
      const { data: todayLog } = await supabase
        .from('daily_logs')
        .select('calories_consumed')
        .eq('pet_id', activePet.id)
        .eq('log_date', today)
        .maybeSingle();
      const caloriesConsumedToday = (todayLog?.calories_consumed as number) || 0;

      const preComputedScore = normalized.health_score ?? 5;
      normalized.verdict_category = deriveVerdictCategory(
        normalized.is_allergy_trigger === true,
        normalized.is_treat === true,
        preComputedScore,
      );

      const bundle = buildVerdictBundle({
        pet: activePet,
        scan: {
          food_name: normalized.food_name,
          food_type: normalized.food_type ?? null,
          is_treat: normalized.is_treat === true,
          is_allergy_trigger: normalized.is_allergy_trigger === true,
          allergy_warnings: normalized.allergy_warnings ?? [],
          ingredients_of_concern: normalized.ingredients_of_concern ?? [],
          key_ingredients: normalized.key_ingredients ?? null,
          calories_per_serving: normalized.calories_per_serving,
          recommendation: normalized.recommendation,
          confidence: normalized.confidence,
        },
        macros: {
          total_kcal: normalized.calories_per_serving,
          protein_g: normalized.protein_g ?? 0,
          fat_g: normalized.fat_g ?? 0,
          carbs_g: normalized.carbs_g ?? 0,
          fibre_g: 0,
          kcal_per_100g: normalized.kcal_per_100g_as_fed ?? null,
          moisture_pct: normalized.moisture_pct ?? null,
          meal_grams: estimateMealGrams(normalized.protein_pct, normalized.protein_g ?? 0, normalized.calories_per_serving),
        },
        foodAnalysis: normalized.food_analysis,
        healthScore: preComputedScore,
        healthScoreReasons: (normalized as any)._healthScoreReasons ?? [],
        caloriesConsumedToday,
        weightTrendDirection: usePetContextStore.getState().weightTrend?.direction ?? null,
      });

      const verdictResult = await fetchVerdictWithFallback(bundle);
      if (verdictResult) {
        normalized.verdict = verdictResult.verdict;
        normalized.verdict_category = verdictResult.verdict_category;
      }
      // else: completely silent — verdict remains undefined
    }

    setScanResult(normalized);
  }, [activePet, foodPantry, deriveScanFromSource]);

  /**
   * The owner has filled in what the packet did not print. Store it, then let
   * the paused scan finish against the row they just corrected.
   */
  const saveLabelGap = useCallback(async (patch: PantryLabelPatch) => {
    const item = labelGapItem;
    const pending = pendingScanRef.current;
    if (!item || !activePet) return false;

    // `nutrition_revision` and `label_consistency` are deliberately absent: a
    // database trigger owns both, and the client is REVOKEd from writing them.
    const { error } = await supabase.from('food_pantry').update(patch).eq('id', item.id);
    if (error) {
      presentFailure(error, 'log');
      return false;
    }
    await fetchPantry(activePet.id);

    // Read the saved row back from the store rather than trusting the patch:
    // the trigger may have adjusted what actually landed, and the meal must be
    // priced off the stored row, not off the draft.
    const updated = useActivePetStore.getState().foodPantry.find(p => p.id === item.id) ?? null;
    setLabelGapItem(null);
    pendingScanRef.current = null;
    if (!pending) return true;

    const savedKcal = resolveScanKcal(updated ? {
      calories_per_serving: updated.kcal_per_serving ?? null,
      kcal_per_100g_as_fed: updated.kcal_per_100g_as_fed ?? null,
      serving_grams: updated.serving_grams ?? null,
    } : null);
    const stillUnpriced = savedKcal.kcalPerServing === null;
    if (stillUnpriced) {
      // They saved without a calorie figure. Nothing has changed about what we
      // can honestly say the meal costs, so the scan stops here rather than
      // logging a zero that would look exactly like a real meal.
      setCapturedImage(null);
      setFailure({
        title: 'Still nothing to count',
        message: `This meal still needs either calories per serving, or both calories per 100 g and a serving weight. Add those printed figures in the pantry whenever you have the packet to hand.`,
        actions: [{ label: 'OK', action: 'dismiss' }],
      });
      return true;
    }

    // The corrected row is now the source of truth for this meal, which is
    // exactly what an explicit pick means — so say so, and let the normal
    // pantry-sourced path do the arithmetic.
    setSelectedPantryId(updated!.id);
    setIsAnalyzing(true);
    try {
      await finalizeScan(pending, updated!.id);
    } finally {
      setIsAnalyzing(false);
    }
    return true;
  }, [labelGapItem, activePet, fetchPantry, finalizeScan, presentFailure]);

  /** Dismissed without filling anything in — abandon the scan, keep the row. */
  const cancelLabelGap = useCallback(() => {
    setLabelGapItem(null);
    pendingScanRef.current = null;
    setCapturedImage(null);
  }, []);

  const pickImage = async (useCamera: boolean) => {
    if (!checkAccess()) return;

    // Reset previous results
    setScanResult(null);

    let result;
    if (useCamera) {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission Required', 'Camera access is needed to scan food labels.');
        return;
      }
      result = await ImagePicker.launchCameraAsync({
        base64: true,
        quality: 0.7,
        allowsEditing: true,
      });
    } else {
      result = await ImagePicker.launchImageLibraryAsync({
        base64: true,
        quality: 0.7,
        allowsEditing: true,
        mediaTypes: ['images'],
      });
    }

    if (!result.canceled && result.assets[0]) {
      // Downscale before anything touches the network — camera frames are
      // 8–12 MP and Gemini needs ≤~1024 px. Falls back to the original asset
      // (with the picker's base64) if the manipulator can't process the image.
      const asset = await prepareImageForUpload(result.assets[0]);

      // Image size validation — backstop for the non-downscaled fallback path.
      const MAX_BASE64_LENGTH = 4 * 1024 * 1024; // ~4MB
      if (asset.base64 && asset.base64.length > MAX_BASE64_LENGTH) {
        setFailure({
          title: 'That photo is too large',
          message: 'Crop it or pick a lower-resolution photo and try again.',
          actions: [{ label: 'OK', action: 'dismiss' }],
        });
        return;
      }

      setCapturedImage(asset.uri);
      setServingCount(1); // Reset serving count for new scan
      analyzeWithGemini(asset.base64!, asset.mimeType, asset.uri);
    }
  };

  const analyzeWithGemini = async (base64: string, mimeType: string, imageUri?: string | null) => {
    retryRef.current = () => analyzeWithGemini(base64, mimeType, imageUri);
    setIsAnalyzing(true);

    try {
      // Pass pantry data alongside pet profile
      const profileWithPantry = {
        ...activePet,
        food_pantry: foodPantry,
      };

      // Snapshot today's live state so Gemini can judge this scan against
      // the *remaining* budget, not just the static daily ceiling.
      const ctx = usePetContextStore.getState();
      const todayState = {
        today_calories_consumed: ctx.todayCalories,
        today_calories_remaining: ctx.caloriesRemaining,
        today_treat_calories_consumed: ctx.treatCaloriesConsumed,
        treat_budget: ctx.treatBudget,
        weight_trend_direction: ctx.weightTrend?.direction ?? null,
      };

      const { data, error } = await supabase.functions.invoke('gemini-proxy', {
        body: {
          imageBase64: base64,
          mimeType,
          petProfile: profileWithPantry,
          selectedPantryItemId: selectedPantryId,
          todayState,
        },
      });

      if (error) {
        console.error('[Scanner] Supabase invoke error:', JSON.stringify(error));
        throw error;
      }

      if (data?.success && data.analysis) {
        if (data.analysis.parse_error) {
          // The model produced unparseable output — proceeding would log a
          // phantom placeholder meal. Treat it as a failed read instead.
          presentFailure(
            toAppError(new Error('scan analysis parse_error'), { errorCode: 'unreadable_image' }),
            'food_scan',
          );
          return;
        }
        const normalized: ScanResult = {
          ...data.analysis,
          fat_g: data.analysis.fats_g ?? data.analysis.fat_g ?? 0,
          protein_g: data.analysis.protein_g ?? 0,
          carbs_g: data.analysis.carbs_g ?? 0,
        };

        // The extractor returns null rather than inventing a calorie figure when
        // the label does not state one, so this branch is reachable where it
        // previously was not: a scan used to arrive carrying a confident 350.
        //
        // Two different situations arrive here and they must not share an
        // outcome:
        //
        //   • The packet prices by mass — "3650 kcal/kg", "Typical ME: 475
        //     kcal/100g" — and states a serving weight. Nothing is missing; the
        //     per-serving figure is the product of two printed numbers, and
        //     resolveScanKcal does that multiplication. This is the common case,
        //     because most pet food is labelled this way.
        //   • The figure genuinely is not on the packet (a bag whose back panel
        //     is a feeding table in cups per day). Then the owner is asked —
        //     they are holding the bag and we are not.
        //
        // What neither situation is, is an unreadable photo. Saying so sent
        // people back to retake a picture that was already perfectly legible,
        // and no number of retries could ever have fixed it.
        const resolvedKcal = resolveScanKcal({
          calories_per_serving: (data.analysis as any)?.calories_per_serving ?? null,
          kcal_per_100g_as_fed: (data.analysis as any)?.kcal_per_100g_as_fed ?? null,
          serving_grams: (data.analysis as any)?.serving_grams ?? null,
        });
        if (resolvedKcal.kcalPerServing !== null) {
          normalized.calories_per_serving = resolvedKcal.kcalPerServing;
        }
        const hasTrustedSource = !!resolvePantrySourceId(
          {
            matched_pantry_id: (data.analysis as any)?.matched_pantry_id ?? null,
            match_confidence: (data.analysis as any)?.match_confidence ?? 0,
            food_type_mismatch: (data.analysis as any)?.food_type_mismatch === true,
          },
          selectedPantryId,
        );
        const hasConflictingLabelFigures = normalized.extraction_flags?.includes('label_figures_conflict') === true;
        if (!hasTrustedSource && (resolvedKcal.kcalPerServing === null || hasConflictingLabelFigures)) {
          // Keep everything the scan DID read — brand, ingredients, guaranteed
          // analysis — as a pantry row, and ask for the one number that is
          // missing. Losing a good read because one field wasn't printed is how
          // an owner ends up entering the whole label by hand.
          const row = await ensurePantryRowForScan(normalized, imageUri ?? capturedImage);
          if (row) {
            pendingScanRef.current = normalized;
            setLabelGapItem(row);
            return;
          }
          const isIdentifiableLabel = normalized.is_labeled_product === true
            || (!!normalized.brand && !!normalized.product_name);
          if (isIdentifiableLabel) {
            // The image was readable, but persisting its editable pantry row
            // failed. Classify that as an app/server failure, not as a bad
            // photo; retaking the same photo cannot repair a database write.
            presentFailure(new Error('Could not create pantry row for label review'), 'food_scan');
          } else {
            // Nothing identifiable was read either — a bowl, a blurred packet.
            // Now "we couldn't make it out" is the honest answer.
            presentFailure(
              toAppError(new Error('scan calories unreadable'), { errorCode: 'unreadable_image' }),
              'food_scan',
            );
          }
          return;
        }

        await finalizeScan(normalized, selectedPantryId);
      } else {
        presentFailure(fromEdgeBody(data) ?? new Error('scan returned no analysis'), 'food_scan');
      }
    } catch (err: unknown) {
      presentFailure(toAppError(err, { errorCode: await extractInvokeErrorCode(err) }), 'food_scan');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // When called with `overrides` (Quick Log path), uses the provided scanResult /
  // pantryId / serving count / image instead of component state. This keeps the
  // chip-tap flow identical to the camera flow without state-timing races.
  type LogOverrides = {
    scanResult: ScanResult;
    pantryId: string | null;
    servingCount: number;
    capturedImage: string | null;
  };

  /**
   * The kcal/macros a log will write, for a given scan + portion.
   *
   * Every consumer — the overage guard, the result-screen receipt, the row we
   * insert — goes through here, so the number the owner is warned about is
   * always the number that lands in daily_logs.
   */
  const totalsFor = useCallback((
    sr: ScanResult,
    pantryId: string | null,
    sc: number,
  ) => {
    const sourceId = resolvePantrySourceId(sr, pantryId);
    const sourceItem = sourceId ? foodPantry.find(p => p.id === sourceId) ?? null : null;
    return resolveLoggedTotals(sr, sourceItem, sc, {
      species: activePet?.species as 'dog' | 'cat' | undefined,
      bowl: activePet?.bowl_size ? { size: activePet.bowl_size as any } : undefined,
    });
  }, [foodPantry, activePet?.species, activePet?.bowl_size]);

  const confirmLog = async (overrides?: LogOverrides, toxinAcknowledged = false) => {
    const sr = overrides?.scanResult ?? scanResult;
    const sc = overrides?.servingCount ?? servingCount;
    if (!sr || !activePet) return;
    retryRef.current = () => confirmLog(overrides, toxinAcknowledged);

    // Prevent double-taps during async checks
    setIsPendingConfirm(true);

    // ── Acute toxin warning ──
    //
    // findToxicIngredients is deterministic and runs against the food name and
    // ingredient list. A xylitol / chocolate / grape / allium match is the most
    // serious thing this screen can tell an owner, so it is said first and in
    // full, before any calorie arithmetic.
    //
    // It is a WARNING, not a gate, and the reason is what logging means: a log
    // records what was EATEN, not what someone plans to serve. Refusing the
    // write did not stop a poisoning — it stopped the record of one, on the
    // screen an owner is most likely to have open in the minutes afterwards.
    // The alert itself said "if they have already eaten any of this, call your
    // vet" while making that exact situation impossible to write down.
    //
    // So Pawtchi says everything it observed, plainly, and the decision stays
    // with the person who can see the bowl. Choosing to log re-enters this
    // function rather than jumping to executeLog, so the calorie checks below
    // still run: one disclosure does not buy silence on the others.
    if (!toxinAcknowledged) {
      const toxinHits = findToxicIngredients(activePet.species as 'dog' | 'cat', [
        sr.food_name,
        ...(sr.key_ingredients ?? []),
      ]);
      if (toxinHits.length > 0) {
        const toxinList = toxinHits.map((h) => `• ${h.toxin}: ${h.reason}`).join('\n');
        Alert.alert(
          `Unsafe for ${activePet.name}`,
          `This food contains ingredients that are toxic to ${activePet.species === 'cat' ? 'cats' : 'dogs'}:\n\n${toxinList}\n\nDo not feed this. If ${activePet.name} has already eaten some, contact your vet or an animal poison control hotline now.\n\nLogging keeps the record accurate. It does not make the food safe.`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => setIsPendingConfirm(false) },
            {
              text: 'Log anyway',
              style: 'destructive',
              onPress: () => {
                void confirmLog(overrides, true);
              },
            },
          ],
        );
        return;
      }
    }

    const today = getLocalYMD(new Date());
    const targetCal = activePet.target_daily_calories || 0;

    // The exact number executeLog will write — same resolver, same inputs, so
    // the owner is never warned about one figure and charged another.
    const totalCalories = totalsFor(sr, overrides?.pantryId ?? selectedPantryId, sc).totalCalories;

    // Pre-check: fetch current day's consumed calories
    const { data: existingLog } = await supabase
      .from('daily_logs')
      .select('*')
      .eq('pet_id', activePet.id)
      .eq('log_date', today)
      .single();

    const currentCal = (existingLog?.calories_consumed as number) || 0;
    const newTotal = currentCal + totalCalories;

    // Hard overage warning
    if (targetCal > 0 && newTotal > targetCal) {
      const overBy = newTotal - targetCal;
      Alert.alert(
        'Daily limit exceeded',
        `${activePet.name} has already consumed ${currentCal} kcal today.\n\nAdding ${totalCalories} kcal from "${sr.food_name}"${sc > 1 ? ` (${sc} servings)` : ''} would bring the total to ${newTotal} kcal — that's ${overBy} kcal over the daily limit of ${targetCal} kcal.\n\nOverfeeding can lead to weight gain and health issues.`,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => setIsPendingConfirm(false) },
          { text: 'Log Anyway', style: 'destructive', onPress: () => executeLog(existingLog, today, overrides) },
        ]
      );
      return;
    }

    // Approaching limit warning (90%+)
    if (targetCal > 0 && newTotal >= targetCal * 0.9 && currentCal < targetCal * 0.9) {
      Alert.alert(
        'Approaching limit',
        `This will bring ${activePet.name} to ${newTotal} of ${targetCal} kcal (${Math.round((newTotal / targetCal) * 100)}%). After this, only light treats are recommended.`,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => setIsPendingConfirm(false) },
          { text: 'Log It', onPress: () => executeLog(existingLog, today, overrides) },
        ]
      );
      return;
    }

    await executeLog(existingLog, today, overrides);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const executeLog = async (existingLog: any, today: string, overrides?: LogOverrides) => {
    const sr = overrides?.scanResult ?? scanResult;
    // Explicit owner pick, or a trusted server auto-match. This is the pantry
    // row the log counts against — for label math, scan counts and portion
    // learning alike. It used to be the explicit pick only, which meant an
    // auto-matched scan silently logged off unscaled Gemini numbers.
    const sPantryId = sr ? resolvePantrySourceId(sr, overrides?.pantryId ?? selectedPantryId) : null;
    const sourcePantryItem = sPantryId ? foodPantry.find(p => p.id === sPantryId) ?? null : null;
    const sCount = overrides?.servingCount ?? servingCount;
    const sImage = overrides?.capturedImage ?? capturedImage;
    if (!sr || !activePet) return;
    setIsLogging(true);
    setIsPendingConfirm(true);

    try {
      const shouldTrackFirstFood = await isFirstFoodLogForUser(user?.id);

      // THE canonical meal. One object, resolved once, driving the stored row,
      // the verdict, the daily aggregate and the receipt on screen. Nothing
      // below recomputes any part of it.
      //
      // What this replaces matters: meal weight used to be estimated back out
      // of protein grams (or kcal / 3.5) purely to feed the verdict layer. That
      // second, independent guess is why Jasper's row stored `meal_kcal: 240`
      // beside `ai_estimated_calories: 24000` — the app computed the right
      // answer and the wrong answer on the same row and shipped both.
      const canonical = resolveCanonicalMeal(sr, sourcePantryItem, sCount, {
        species: activePet.species as 'dog' | 'cat',
        bowl: activePet.bowl_size ? { size: activePet.bowl_size as BowlSize } : undefined,
      });
      const totalCalories = canonical.kcal;
      const totalProtein = canonical.protein_g;
      const totalCarbs = canonical.carbs_g;
      const totalFat = canonical.fat_g;

      // Label-accurate % values for the verdict layer (pantry wins when present).
      const pantry_kcal_per_100g = canonical.kcal_per_100g;
      const pantry_moisture_pct = canonical.moisture_pct;
      const pantry_protein_pct = canonical.protein_pct;
      const pantry_fat_pct = canonical.fat_pct;
      const pantry_fiber_pct = canonical.fibre_pct;

      // An unmatched scan has no pantry row and therefore no real meal weight.
      // The old estimate survives only for that case, and only to feed the
      // verdict's "% of daily" line — it is never persisted as meal_grams,
      // because a guess stored next to a measurement is indistinguishable from
      // one later on.
      const verdictMealGrams =
        canonical.mealGrams ??
        (pantry_protein_pct && pantry_protein_pct > 0 && totalProtein > 0
          ? Math.round((totalProtein / pantry_protein_pct) * 100)
          : Math.max(1, Math.round(totalCalories / 3.5)));

      // Build the FoodAnalysis verdict — stored on food_scans.food_analysis.
      const goal = deriveGoal(
        activePet.current_weight_kg ?? 0,
        activePet.target_weight_kg ?? null,
        activePet.body_condition_score,
      );
      const confirmedConditionKeys = mapMedicalConditionsToAdjustmentKeys(
        activePet.medical_conditions,
      );
      const foodAnalysis = analyzeFood({
        food: {
          product_name: sr.food_name,
          food_type: sr.food_type ?? 'kibble',
          kcal_per_100g_as_fed: pantry_kcal_per_100g,
          moisture_pct: pantry_moisture_pct,
          protein_pct: pantry_protein_pct,
          fat_pct: pantry_fat_pct,
          fiber_pct: pantry_fiber_pct,
          calcium_pct: null,
          phosphorus_pct: null,
        },
        pet: {
          name: activePet.name,
          species: activePet.species,
          weight_kg: activePet.current_weight_kg,
          target_weight_kg: activePet.target_weight_kg ?? null,
          age_months: getAgeMonths(activePet) ?? null,
          activity_level: activePet.activity_level,
          is_neutered: activePet.is_neutered,
          goal,
          confirmed_condition_keys: confirmedConditionKeys,
          breed: activePet.breed ?? null,
          age_years: activePet.age_years ?? null,
          body_condition_score: activePet.body_condition_score ?? null,
        },
        meal_grams: verdictMealGrams,
      });

      // Compute the health score deterministically from the extraction +
      // pet profile. Replaces the previous LLM-generated score.
      const { score: derivedHealthScore, reasons: derivedReasons } = computeHealthScore({
        food: {
          food_type: sr.food_type,
          is_treat: sr.is_treat === true,
          is_allergy_trigger: sr.is_allergy_trigger,
          allergy_warnings: sr.allergy_warnings,
          ingredients_of_concern: sr.ingredients_of_concern,
          calories_per_serving: sr.calories_per_serving,
          protein_pct: sr.protein_pct ?? null,
          fat_pct: sr.fat_pct ?? null,
          fibre_pct: sr.fibre_pct ?? null,
          moisture_pct: sr.moisture_pct ?? null,
          kcal_per_100g_as_fed: sr.kcal_per_100g_as_fed ?? null,
          confidence: sr.confidence,
          name_and_ingredients: [sr.food_name, ...(sr.key_ingredients ?? [])],
        },
        pet: {
          species: activePet.species,
          age_months: getAgeMonths(activePet) ?? null,
          daily_kcal_target: activePet.target_daily_calories ?? null,
          allergies: activePet.allergies ?? null,
          medical_conditions: activePet.medical_conditions ?? null,
          weight_kg: activePet.current_weight_kg ?? null,
          target_weight_kg: activePet.target_weight_kg ?? null,
        },
      });

      // The deterministic verdict category, applied to the stored analysis
      // unconditionally.
      //
      // It used to be written only inside the background LLM upgrade, so a scan
      // whose narration call failed kept whatever category `analyzeFood`
      // happened to produce — the category depended on whether a network
      // request succeeded. Now the LLM writes narration and nothing else, and
      // this is settled before the row is inserted.
      const storedCategory = deriveVerdictCategory(
        sr.is_allergy_trigger,
        sr.is_treat === true,
        derivedHealthScore,
      );
      const storedAnalysis = { ...foodAnalysis, verdict_category: storedCategory };
      const execConsumedToday = existingLog?.calories_consumed ?? 0;

      // Assemble the shared verdict contexts (lib/verdictPipeline.ts).
      const verdictBundle = buildVerdictBundle({
        pet: activePet,
        scan: {
          food_name: sr.food_name,
          food_type: sr.food_type ?? null,
          is_treat: sr.is_treat === true,
          is_allergy_trigger: sr.is_allergy_trigger,
          allergy_warnings: sr.allergy_warnings ?? [],
          ingredients_of_concern: sr.ingredients_of_concern ?? [],
          key_ingredients: sr.key_ingredients ?? null,
          calories_per_serving: sr.calories_per_serving,
          recommendation: sr.recommendation,
          confidence: sr.confidence,
        },
        macros: {
          total_kcal: totalCalories,
          protein_g: totalProtein,
          fat_g: totalFat,
          carbs_g: totalCarbs,
          fibre_g: 0,
          kcal_per_100g: pantry_kcal_per_100g,
          moisture_pct: pantry_moisture_pct,
          meal_grams: verdictMealGrams,
        },
        foodAnalysis,
        healthScore: derivedHealthScore,
        healthScoreReasons: derivedReasons,
        caloriesConsumedToday: execConsumedToday,
        weightTrendDirection: usePetContextStore.getState().weightTrend?.direction ?? null,
      });

      // Store the deterministic verdict NOW — the log must never wait on an
      // LLM round trip. The Gemini narration is fetched in the background
      // after the insert and upgrades the stored row when it lands (the same
      // text the old blocking path would have stored; the failure mode — the
      // deterministic verdict persists — is the old fallback path).
      const storedVerdict = deterministicVerdict(verdictBundle);

      // Attach verdict to foodAnalysis before storing — preserves the text even
      // if the pet profile changes later (historical scans stay accurate).
      if (storedVerdict) {
        (foodAnalysis as FoodAnalysis & { verdict: string }).verdict = storedVerdict.verdict;
        (foodAnalysis as FoodAnalysis & { verdict_category: string }).verdict_category = storedVerdict.verdict_category;
      }

      // 0. Silent pantry auto-save — when a fresh scan lands without a pantry
      // match, persist it as a pantry row so future scans of the same product
      // surface on the Quick Log rail. No UI feedback: pantry is plumbing.
      let effectivePantryId: string | null = sPantryId;
      if (!effectivePantryId) {
        const row = await ensurePantryRowForScan(sr, sImage);
        if (row) effectivePantryId = row.id;
      }

      // ── 1. Persist the meal ────────────────────────────────────────────────
      //
      // One transaction: the scan row, the daily aggregate, and the day's
      // quality rollup. This used to be two requests — INSERT food_scans, then
      // bump daily_logs — with a window between them where the process could
      // die and leave a scan with no aggregate. Production has days that look
      // exactly like that: 0 kcal recorded against three logged meals.
      //
      // The key is generated once per user action and reused across retries, so
      // a flaky network cannot produce two meals from one tap. `created` tells
      // us whether this call actually made the row: a retry returns the
      // existing one, and the side effects below must not run twice for it.
      const isTreat = sr.is_treat === true;
      const tzOffsetMinutes = -new Date().getTimezoneOffset();
      const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;

      if (!logKeyRef.current) logKeyRef.current = randomUUID();
      const idempotencyKey = logKeyRef.current;

      let insertedScanId: string | null = null;
      let didCreate = true;

      const { data: txResult, error: txError } = await supabase.rpc('log_meal', {
        p_idempotency_key: idempotencyKey,
        p_pet_id: activePet.id,
        p_log_date: today,
        p_payload: {
          pantry_item_id: effectivePantryId,
          servings: sCount,
          is_treat: isTreat,
          // The server recomputes and its number is what persists. Ours travels
          // only so a disagreement can be recorded — a rounding difference must
          // never stop someone logging what their animal ate.
          client_kcal: totalCalories,
          scan_kcal: sr.calories_per_serving,
          image_url: sImage || '',
          food_name: sr.food_name,
          confidence: Math.round(sr.confidence * 100),
          health_score: derivedHealthScore,
          ingredients: sr.key_ingredients || sr.ingredients || [],
          food_analysis: storedAnalysis,
          tz_offset_minutes: tzOffsetMinutes,
          tz_name: tzName,
        },
      });

      const txMissing = txError?.code === '42883'; // undefined_function
      if (txError && !txMissing) throw txError;

      if (!txMissing) {
        const env = txResult as { ok?: boolean; code?: string; scan_id?: string; created?: boolean } | null;
        if (!env?.ok) {
          // An expected integrity condition, returned as data rather than
          // raised — see the note in the migration about why RAISE would
          // destroy the record of what went wrong.
          throw new Error(env?.code ?? 'log_meal_failed');
        }
        insertedScanId = env.scan_id ?? null;
        didCreate = env.created !== false;
      } else {
        await legacyInsertMeal(activePet, sr);
      }

      /**
       * The pre-transaction write path.
       *
       * Retained ONLY for the window where the app has shipped but the
       * migration has not, and narrowed to `42883` on purpose: falling back on
       * a transient error would silently reintroduce the two-request defect for
       * anyone with a flaky connection, which is the precise failure mode this
       * whole change exists to remove.
       */
      async function legacyInsertMeal(pet: NonNullable<typeof activePet>, scan: NonNullable<typeof sr>) {
        const { data: insertedScan, error: scanInsertError } = await supabase.from('food_scans').insert({
        pet_id: pet.id,
        image_url: sImage || '',
        ai_identified_food: scan.food_name,
        ai_estimated_calories: totalCalories,
        ai_confidence_score: Math.round(scan.confidence * 100),
        is_user_confirmed: true,
        is_treat: scan.is_treat === true,
        protein_g: totalProtein,
        carbs_g: totalCarbs,
        fat_g: totalFat,
        health_score: derivedHealthScore,
        ingredients: scan.key_ingredients || scan.ingredients || [],
        food_analysis: storedAnalysis,

        // ── Provenance ──
        pantry_item_id: effectivePantryId,
        log_date: today,
        // Captured at log time, not reconstructed later. 73% of historical
        // scans belong to owners with no timezone on file, which is exactly
        // why "which day was this?" is unanswerable for them.
        tz_offset_minutes: -new Date().getTimezoneOffset(),
        tz_name: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
        portion_mode: canonical.portion.mode,
        portion_quantity: canonical.portion.quantity,
        unit_basis: canonical.portion.unitBasis,
        meal_grams: canonical.mealGrams,
        nutrition_snapshot: canonical.nutritionSnapshot,
        kcal_basis: canonical.kcalBasis,
        quality: canonical.quality,
        anomaly_flags: canonical.anomalies.length ? canonical.anomalies : null,
      }).select('id').single();
      if (scanInsertError) throw scanInsertError;
      insertedScanId = insertedScan?.id ?? null;

      const { error: intakeErr } = await supabase.rpc('log_intake', {
        p_pet_id: pet.id,
        p_log_date: today,
        p_kcal_delta: totalCalories,
        p_treat_delta: isTreat ? 1 : 0,
        p_water_delta: 0,
        p_walk_delta: 0,
      });
      if (intakeErr) {
        let fallbackError: unknown = null;
        if (existingLog) {
          const updateData: Record<string, unknown> = {
            calories_consumed: (existingLog.calories_consumed || 0) + totalCalories,
            updated_at: new Date().toISOString(),
          };
          if (isTreat) {
            updateData.treats_consumed = (existingLog.treats_consumed || 0) + 1;
          }
          const { error } = await supabase.from('daily_logs').update(updateData).eq('id', existingLog.id);
          fallbackError = error;
        } else {
          const { error } = await supabase.from('daily_logs').insert({
            pet_id: pet.id,
            log_date: today,
            calories_consumed: totalCalories,
            treats_consumed: isTreat ? 1 : 0,
          });
          fallbackError = error;
        }
        if (fallbackError) throw fallbackError;
      }
      } // end legacyInsertMeal

      // ── 1a. Background verdict narration ───────────────────────────────────
      //
      // Fire-and-forget, into its OWN column. It used to write the whole
      // `food_analysis` object rebuilt from a closure captured before the
      // insert, so an adjustment landing while the model was still thinking got
      // silently reverted by a write that had no idea it had happened. Keeping
      // the LLM out of canonical fields entirely is the stronger fix.
      if (insertedScanId && didCreate) {
        const narrateId = insertedScanId;
        fetchVerdictLLM(verdictBundle)
          .then(async (llmVerdict) => {
            if (!llmVerdict) return;
            await supabase
              .from('food_scans')
              .update({ verdict_narration: llmVerdict })
              .eq('id', narrateId);
          })
          .catch(() => {});
      }

      // ── 1b. Side effects, gated on actually having created the meal ────────
      //
      // A retry that returns the existing row must not award coins again, bump
      // the pantry count again, or re-close the scheduled feeding card. This
      // gate is the reason log_meal reports `created` at all.
      if (didCreate && effectivePantryId) {
        incrementPantryScan(effectivePantryId);
      }

      if (shouldTrackFirstFood && didCreate) trackFirebaseEvent('first_food_logged');

      // Update context store with new calorie total. updateCalories keeps the
      // headline number instant; invalidateContext forces the next Home focus to
      // refetch the scans list + macros (which aren't updated optimistically).
      const newCalTotal = (existingLog?.calories_consumed || 0) + totalCalories;
      usePetContextStore.getState().updateCalories(newCalTotal);
      usePetContextStore.getState().invalidateContext();

      // The tactile confirmation that the log committed (matches Activity's
      // success haptic). The CoinToast supplies the reward; this supplies the
      // "it's done" beat.
      haptic.success();

      // Award coins for the food log.
      //
      // Keyed on the scan id so a retry cannot pay twice: the award used to
      // pass no reference at all, which meant an uncertain response followed by
      // a retry was indistinguishable from two meals. Walks have been keyed on
      // their session id for exactly this reason.
      if (user?.id && didCreate) {
        awardCoins(user.id, 'food_log', insertedScanId ?? undefined);
      }

      // Auto-complete the matching feeding activity on the day's timeline so
      // logged meals visibly close their scheduled card. Fire-and-forget;
      // failures shouldn't disrupt the meal-log flow.
      // `sr`, not `scanResult` — on the hero/quick-log path the screen state is
      // null, so a logged treat used to close a scheduled feeding card.
      if (didCreate && activePet?.id && sr.is_treat !== true) {
        markNearestFeedingActivityComplete({
          petId: activePet.id,
          loggedAt: new Date(),
          slot: currentSlot(),
        }).catch(() => {});
      }

      // Record what was fed against the pantry source, WITH its unit. Storing a
      // bare multiplier is what let a 200× gram-unit bug survive its own fix —
      // see lib/portionLearning. The portion is typed from this item's current
      // presets and validated against the same bounds the stepper enforces, so
      // an out-of-range portion is dropped rather than stored for replay.
      if (effectivePantryId) {
        const sourceItem = foodPantry.find(p => p.id === effectivePantryId);
        if (sourceItem) {
          const presets = presetsForItem(sourceItem);
          recordServing(
            effectivePantryId,
            multiplierToLearnedPortion(sCount, presets),
            getPortionBounds(presets),
          );
        }
      }

      // The meal committed, so the next one starts a new idempotency scope.
      logKeyRef.current = null;

      // Immediately kill the scan result screen and return to scanner
      // User can scan next food or select from pantry
      setScanResult(null);
      setCapturedImage(null);
      setServingCount(1);
      setShowCustomPortion(false);
      setHasLogged(false);
      setIsPendingConfirm(false);
    } catch (err: unknown) {
      presentFailure(err, 'log');
    } finally {
      setIsLogging(false);
      setIsPendingConfirm(false);
    }
  };

  // ─── Weight context line for the canopy (calm phrasing, no red card) ───
  const weightContextLine = (() => {
    if (!activePet) return null;
    const plan = weightPlanViewModelFromRecord(activePet);
    const currentW = plan.currentWeightKg;
    const idealW = plan.idealWeightKg;
    if (!idealW) {
      return plan.showAssessmentPrompt
        ? `Complete a body check before Pawtchi adjusts ${activePet.name}'s plan.`
        : null;
    }
    const gap = currentW - idealW;
    if (plan.showVerifyPrompt) {
      return `Pawtchi noticed a weight change for ${activePet.name} — add another reading to confirm it.`;
    }
    if (plan.showAssessmentPrompt) {
      return `${activePet.name} is ${Math.abs(gap).toFixed(1)} kg ${gap >= 0 ? 'above' : 'below'} their confirmed ${idealW.toFixed(1)} kg ideal — a body check is due.`;
    }
    if (plan.status === 'active' && gap > 0.5) {
      return `${activePet.name} is ${gap.toFixed(1)} kg above their confirmed ${idealW.toFixed(1)} kg ideal — keep portions steady.`;
    }
    if (plan.status === 'active' && gap < -0.5) {
      return `${activePet.name} is ${Math.abs(gap).toFixed(1)} kg below their confirmed ${idealW.toFixed(1)} kg ideal.`;
    }
    return null;

  })();

  // ── Publish this screen's two prompts to the notification center ──────────
  const publishNotification = useNotificationCenterStore(s => s.publish);
  const retractNotification = useNotificationCenterStore(s => s.retract);

  React.useEffect(() => {
    const id = stableId('runtime', `weight_context_${activePet?.id ?? 'none'}`, dayScope());
    if (!weightContextLine) { retractNotification(id); return; }
    publishNotification({
      id,
      source: 'runtime',
      tone: 'info',
      title: 'About the plan',
      body: weightContextLine,
      icon: 'info-outline',
      createdAt: new Date().toISOString(),
      route: '/(tabs)/health',
      petId: activePet?.id ?? null,
    });
  }, [weightContextLine, activePet?.id, publishNotification, retractNotification]);

  /**
   * The learned-portion prompt has been withdrawn.
   *
   * It offered "make this the usual", and accepting it wrote
   * `kcal_per_serving = kcal_per_serving × multiplier` onto the pantry row —
   * storing a PORTION inside a LABEL FACT. A pantry item's calories are what
   * the manufacturer printed; how much of it this owner serves is a different
   * fact and belongs in its own field.
   *
   * Any lingering notification is retracted here so the tray doesn't keep
   * offering an action that no longer exists. The suggestion itself still
   * works — it pre-fills the portion picker, which was always the useful half.
   *
   * Reinstated in stage 5 against `food_pantry.usual_portion`.
   */
  React.useEffect(() => {
    retractNotification(
      stableId('runtime', `usual_portion_${activePet?.id ?? 'none'}`, dayScope()),
    );
  }, [activePet?.id, retractNotification]);

  // When scan result is ready, show the full Stitch-designed result view
  if (scanResult && !isAnalyzing) {
    const healthScore = scanResult.health_score ?? 5; // deterministically set above; 5 is a safe fallback
    // Preview totals come from the same resolver the log uses, so the receipt
    // line, the budget bar and the stored row can never disagree.
    const previewTotals = totalsFor(scanResult, selectedPantryId, servingCount);
    // The "N × 1.25 = M kcal" receipt reads off the same resolver at 1×, so the
    // arithmetic on screen is always true of the number being written.
    const perServingCalories = totalsFor(scanResult, selectedPantryId, 1).totalCalories;
    const proteinG = Math.round(previewTotals.protein_g);
    const carbsG = Math.round(previewTotals.carbs_g);
    const fatG = Math.round(previewTotals.fat_g);
    const displayCalories = previewTotals.totalCalories;
    const ingredientsList = scanResult.ingredients ?? scanResult.ingredients_of_concern ?? [];

    // Pre-compute budget values so the JSX stays clean
    const ctxStore = usePetContextStore.getState();
    const budgetTarget = activePet?.target_daily_calories ?? 0;
    const consumed = ctxStore.todayCalories ?? 0;
    const afterMeal = budgetTarget - consumed - displayCalories;
    const pctUsed = budgetTarget > 0 ? Math.round((consumed / budgetTarget) * 100) : 0;
    const mealPct = budgetTarget > 0 ? Math.round((displayCalories / budgetTarget) * 100) : 0;

    // Resolve the pantry item this result is logging against (explicit pick or
    // trusted server match) so the portion chips can speak in "bowls" when
    // that reads more naturally than abstract multipliers. Same resolver the
    // log uses — the chips must not describe a source the kcal didn't come from.
    const resolvedSourceId = resolvePantrySourceId(scanResult, selectedPantryId);
    const resolvedSourceItem = resolvedSourceId ? foodPantry.find(p => p.id === resolvedSourceId) ?? null : null;
    const bowlMode =
      !!activePet?.bowl_size &&
      !!resolvedSourceItem &&
      (resolvedSourceItem.serving_unit === 'cup' || !resolvedSourceItem.serving_unit);
    // The range this screen's +/- stepper may move through, as a multiplier.
    //
    // It used to have a floor of 0.25 and NO ceiling — `servingCount + 0.25`
    // forever. Combined with a learned portion that could arrive at any
    // magnitude, there was nothing between the owner and a 200× meal. When the
    // log is backed by a pantry item the bounds come from that item's own
    // presets; otherwise a conservative fixed range applies, because an
    // unmatched scan has no serving weight to reason about.
    // `servingCount` is a multiplier (gramsFed / gramsPerUnit), so the gram
    // ceiling converts to a multiplier ceiling the same way for every mode.
    const servingCountMax = (() => {
      if (!resolvedSourceItem) return 20;
      const bounds = getPortionBounds(presetsForItem(resolvedSourceItem));
      if (!(bounds.gramsPerUnit > 0)) return 20;
      const maxMultiplier = boundsInGrams(bounds).max / bounds.gramsPerUnit;
      return Number.isFinite(maxMultiplier) && maxMultiplier >= 1 ? maxMultiplier : 20;
    })();
    const servingCountMin = 0.25;

    // Adaptive chip set: bowl fractions read better than 0.75/1/1.25 for kibble.
    const portionOptions = bowlMode
      ? [
          { label: '¼ bowl', value: 0.25 },
          { label: '½ bowl', value: 0.5 },
          { label: 'Full bowl', value: 1 },
        ]
      : [
          { label: 'Less', value: 0.75 },
          { label: 'Usual', value: 1 },
          { label: 'More', value: 1.25 },
        ];

    return (
      <View style={styles.srRoot}>
        {/* ─── Top bar — quiet back ─── */}
        <View style={[styles.srTopBar, { paddingTop: insets.top + space.md }]}>
          <TouchableOpacity onPress={() => setScanResult(null)} activeOpacity={0.7} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <MaterialIcons name="arrow-back" size={22} color={color.ink} />
          </TouchableOpacity>
          <Text style={styles.srEyebrow}>SCAN RESULT</Text>
          <View style={{ width: 22 }} />
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.srScroll, { paddingBottom: 120 + TAB_BAR_CLEARANCE }]}
          showsVerticalScrollIndicator={false}
        >
          {/* ─── Hero — full-bleed image, no decorative chrome ─── */}
          <View style={styles.srHero}>
            {capturedImage ? (
              <Image source={{ uri: capturedImage }} style={styles.srHeroImg} />
            ) : (
              <View style={[styles.srHeroImg, styles.srHeroFallback]}>
                <MaterialIcons name="restaurant" size={56} color={color.slateFaint} />
              </View>
            )}
          </View>

          <Animated.View entering={FadeInDown.duration(420)} style={{ paddingHorizontal: space.xxl }}>
            {/* Food name — display weight */}
            <Text style={styles.srFoodName} numberOfLines={3}>{scanResult.food_name}</Text>

            {/* Allergy strip — only when triggered */}
            {scanResult.is_allergy_trigger && scanResult.allergy_warnings?.length > 0 && (
              <View style={styles.srAllergyStrip}>
                <MaterialIcons name="warning" size={18} color={color.error} />
                <Text style={styles.srAllergyText}>{scanResult.allergy_warnings.join('. ')}</Text>
              </View>
            )}

            {/* ─── Source — which pantry item this log will count against ─── */}
            {(() => {
              const typeMismatch = scanResult.food_type_mismatch === true;
              // Resolution order: explicit user pick → trusted server auto-match
              // → none. One threshold (AUTO_MATCH_TRUST_THRESHOLD) decides this
              // row, the portion chips and the kcal, so the row can't claim a
              // match the calories were never taken from.
              const kind: 'explicit' | 'auto' | 'new' | 'unmatched' =
                selectedPantryId ? 'explicit'
                : resolvedSourceId ? 'auto'
                : scanResult.is_labeled_product ? 'new'
                : 'unmatched';
              return (
                <ScanSourceRow
                  matchedItem={resolvedSourceItem}
                  kind={kind}
                  showTypeMismatchHint={typeMismatch}
                  onChange={() => setSourcePickerVisible(true)}
                  onUseAsNew={() => setSelectedPantryId(null)}
                />
              );
            })()}

            {/* ─── Portion ─── */}
            <View style={styles.sectionHead}>
              <Text style={styles.sectionLabel}>PORTION</Text>
              <View style={styles.sectionRule} />
            </View>
            {/* The learned-portion prompt ("you've been feeding less, make it
                usual?") used to sit here, directly above the picker it applied
                to. It is a notification-center item now — see the publish
                effect above, and the note there about what that costs. */}

            {/* Three-chip portion picker — the 95% case is one tap. Speaks in
                bowls for cup-based foods, multipliers otherwise. */}
            <View style={styles.portionChipsRow}>
              {portionOptions.map((opt) => {
                const isSelected = !showCustomPortion && Math.abs(servingCount - opt.value) < 0.01;
                return (
                  <TouchableOpacity
                    key={opt.label}
                    style={[styles.portionChip, isSelected && styles.portionChipSelected]}
                    activeOpacity={0.85}
                    onPress={() => {
                      setShowCustomPortion(false);
                      setServingCount(opt.value);
                    }}
                  >
                    <Text style={[styles.portionChipText, isSelected && styles.portionChipTextSelected]} numberOfLines={1}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                style={[styles.portionChip, showCustomPortion && styles.portionChipSelected]}
                activeOpacity={0.85}
                onPress={() => setShowCustomPortion((v) => !v)}
              >
                <Text style={[styles.portionChipText, showCustomPortion && styles.portionChipTextSelected]} numberOfLines={1}>
                  Custom
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.portionRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.portionValue}>
                  {servingCount % 1 === 0 ? servingCount : servingCount.toFixed(2)}
                  <Text style={styles.portionUnit}>{bowlMode ? ` × ${activePet?.bowl_size} bowl` : ` × serving${servingCount !== 1 ? 's' : ''}`}</Text>
                </Text>
                {bowlMode ? (
                  <Text style={styles.portionHint} numberOfLines={1}>
                    1 full bowl = ~{BOWL_SIZE_GRAMS[(activePet!.bowl_size as keyof typeof BOWL_SIZE_GRAMS)]} g
                  </Text>
                ) : scanResult.serving_size ? (
                  <Text style={styles.portionHint} numberOfLines={1}>
                    1 serving = {scanResult.serving_size}
                  </Text>
                ) : null}
                <Text style={styles.portionHint} numberOfLines={1}>
                  {perServingCalories} × {servingCount % 1 === 0 ? servingCount : servingCount.toFixed(2)} = {displayCalories} kcal
                </Text>
              </View>
              {showCustomPortion && (
                <View style={styles.stepper}>
                  <TouchableOpacity
                    style={[styles.stepperBtn, servingCount <= servingCountMin && { opacity: 0.3 }]}
                    onPress={() => setServingCount(Math.max(servingCountMin, +(servingCount - 0.25).toFixed(2)))}
                    disabled={servingCount <= servingCountMin}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons name="remove" size={18} color={color.navy} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.stepperBtn, servingCount >= servingCountMax && { opacity: 0.3 }]}
                    onPress={() => setServingCount(Math.min(servingCountMax, +(servingCount + 0.25).toFixed(2)))}
                    disabled={servingCount >= servingCountMax}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons name="add" size={18} color={color.navy} />
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {/* ─── Verdict — the deliberate dark moment ─── */}
            <View style={styles.verdict}>
              <View style={styles.verdictHead}>
                <Text style={styles.verdictEyebrow}>PAWTCHI&apos;S VERDICT</Text>
                <View style={styles.verdictScoreChip}>
                  <Text style={styles.verdictScoreNum}>{healthScore}</Text>
                  <Text style={styles.verdictScoreOf}>/10</Text>
                </View>
              </View>
              <View style={styles.verdictBarTrack}>
                <View style={[styles.verdictBarFill, { width: `${healthScore * 10}%` }]} />
              </View>
              {(scanResult.verdict || scanResult.recommendation) && (
                <View style={styles.verdictBodyRow}>
                  <View style={styles.verdictQuoteBar} />
                  <Text style={styles.verdictBody}>
                    {scanResult.verdict ?? scanResult.recommendation}
                  </Text>
                </View>
              )}
            </View>

            {/* ─── Nutrition — typography stat strip, no boxes ─── */}
            <View style={styles.sectionHead}>
              <Text style={styles.sectionLabel}>NUTRITION</Text>
              <View style={styles.sectionRule} />
            </View>
            <View style={styles.nutrRow}>
              <View style={styles.nutrCell}>
                <Text style={styles.nutrValue}>{displayCalories}</Text>
                <Text style={styles.nutrLabel}>kcal</Text>
              </View>
              <View style={styles.nutrDivider} />
              <View style={styles.nutrCell}>
                <Text style={styles.nutrValue}>{proteinG}<Text style={styles.nutrUnit}>g</Text></Text>
                <Text style={styles.nutrLabel}>protein</Text>
              </View>
              <View style={styles.nutrDivider} />
              <View style={styles.nutrCell}>
                <Text style={styles.nutrValue}>{carbsG}<Text style={styles.nutrUnit}>g</Text></Text>
                <Text style={styles.nutrLabel}>carbs</Text>
              </View>
              <View style={styles.nutrDivider} />
              <View style={styles.nutrCell}>
                <Text style={styles.nutrValue}>{fatG}<Text style={styles.nutrUnit}>g</Text></Text>
                <Text style={styles.nutrLabel}>fats</Text>
              </View>
            </View>

            {/* ─── Daily budget — editorial bar + ledger lines ─── */}
            {budgetTarget > 0 && (
              <>
                <View style={styles.sectionHead}>
                  <Text style={styles.sectionLabel}>DAILY BUDGET</Text>
                  <View style={styles.sectionRule} />
                  <Text style={[styles.sectionMeta, { color: pctUsed >= 100 ? color.error : pctUsed >= 80 ? color.alert : color.success }]}>
                    {pctUsed}% used
                  </Text>
                </View>
                <View style={styles.budgetTrack}>
                  <View
                    style={[
                      styles.budgetFill,
                      {
                        width: `${Math.min(pctUsed, 100)}%`,
                        backgroundColor: pctUsed >= 100 ? color.error : pctUsed >= 80 ? color.alert : color.success,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.budgetMeta}>{consumed} / {budgetTarget} kcal consumed today</Text>
                <View style={styles.budgetLedger}>
                  <View style={styles.budgetLedgerRow}>
                    <Text style={styles.budgetLedgerLabel}>This meal</Text>
                    <Text style={styles.budgetLedgerValue}>+{displayCalories} kcal · {mealPct}%</Text>
                  </View>
                  <View style={styles.budgetLedgerRow}>
                    <Text style={styles.budgetLedgerLabel}>After logging</Text>
                    <Text style={[styles.budgetLedgerValue, afterMeal < 0 && { color: color.error }]}>
                      {afterMeal >= 0 ? `${afterMeal} kcal left` : `${Math.abs(afterMeal)} kcal over`}
                    </Text>
                  </View>
                </View>
              </>
            )}

            {/* The AAFCO nutritional-reference panel (Fat/Fiber/Calcium/
                Phosphorus vs. AAFCO minimums) used to render here. Hidden per
                product decision — the comparison read as more clinical
                authority than a label-derived estimate warrants for a food the
                owner is about to log in one tap. */}

            {/* ─── Ingredients — quiet chip row ─── */}
            {ingredientsList.length > 0 && (
              <>
                <View style={styles.sectionHead}>
                  <Text style={styles.sectionLabel}>INGREDIENTS</Text>
                  <View style={styles.sectionRule} />
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.ingChipRow}
                >
                  {ingredientsList.map((item, idx) => (
                    <View key={idx} style={styles.ingChip}>
                      <Text style={styles.ingChipText}>{item}</Text>
                    </View>
                  ))}
                </ScrollView>
              </>
            )}

            {/* Confidence — quiet end-of-content note */}
            <View style={styles.confidenceRow}>
              <Text style={styles.confidenceLabel}>Scan confidence</Text>
              <Text style={[styles.confidenceValue, { color: scanResult.confidence > 0.7 ? color.success : color.alert }]}>
                {Math.round(scanResult.confidence * 100)}%
              </Text>
            </View>
          </Animated.View>
        </ScrollView>

        {/* ─── Sticky Add to Bowl — plinth lifts off the sheet ───
            The floating tab bar (SplitTabBar) is rendered as an absolute
            overlay on top of every tab screen, not in normal flow — so a
            sticky bar pinned to this screen's own bottom:0 sits directly
            behind it rather than above it. `TAB_BAR_CLEARANCE + insets.bottom`
            is the same offset every other screen uses to clear that overlay
            (see index.tsx's `chrome` padding). */}
        <View style={[styles.srSticky, { bottom: insets.bottom + TAB_BAR_CLEARANCE }]}>
          <PawtchiButton
            title={hasLogged ? 'Added to bowl' : 'Add to bowl'}
            variant="primary"
            size="large"
            iconName={hasLogged ? 'check' : 'add'}
            loading={isLogging}
            disabled={hasLogged || isLogging || isPendingConfirm}
            onPress={() => {
              if (!hasLogged && !isLogging && !isPendingConfirm) {
                confirmLog();
              }
            }}
          />
        </View>

        {/* "Change source" picker — pantry pills inside a bottom sheet. */}
        <Modal visible={sourcePickerVisible} animationType="slide" transparent onRequestClose={() => setSourcePickerVisible(false)}>
          <TouchableOpacity
            activeOpacity={1}
            style={styles.sourcePickerBackdrop}
            onPress={() => setSourcePickerVisible(false)}
          >
            <View style={styles.sourcePickerSheet}>
              <View style={styles.sourcePickerHeader}>
                <Text style={styles.sourcePickerTitle}>Change source</Text>
                <TouchableOpacity onPress={() => setSourcePickerVisible(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <MaterialIcons name="close" size={20} color={color.slateMuted} />
                </TouchableOpacity>
              </View>
              <Text style={styles.sourcePickerHint}>
                Tap a pantry item to log against it, or use New food.
              </Text>
              <PantryPillSelector
                pantryItems={foodPantry}
                selectedId={selectedPantryId}
                onSelect={(id) => {
                  setSelectedPantryId(id);
                  setSourcePickerVisible(false);
                }}
                onAddNew={() => {
                  setSelectedPantryId(null);
                  setSourcePickerVisible(false);
                }}
                onArchive={promptArchivePantry}
              />
            </View>
          </TouchableOpacity>
        </Modal>
      </View>
    );
  }

  // Today's consumed / target for the canopy hero number
  // (consumedToday subscribed at the top — keeps hooks order stable across renders)
  const dailyTarget = activePet?.target_daily_calories ?? 0;
  const pctToday = dailyTarget > 0 ? Math.min(100, Math.round((consumedToday / dailyTarget) * 100)) : 0;

  // Calorie context for the status strip
  const remaining = dailyTarget - consumedToday;
  const overBudget = remaining < 0;

  return (
    <View style={styles.scRoot}>
      {/* ════ STATUS STRIP — slim yellow band, no longer the hero ════ */}
      <View style={[styles.statusStrip, { paddingTop: insets.top + 10 }]}>
        <View style={styles.statusRow}>
          <View style={styles.statusLeft}>
            <Text style={styles.statusEyebrow}>MEAL</Text>
            {recalibrating ? (
              <View style={styles.recalChip}>
                <BreathingPaw size={14} />
                <Text style={styles.recalChipText}>Recalibrating target…</Text>
              </View>
            ) : (
              <Text style={styles.statusValue} numberOfLines={1}>
                {dailyTarget > 0
                  ? overBudget
                    ? `${Math.abs(remaining)} kcal over today`
                    : `${remaining} kcal left today`
                  : 'Scan a food label'}
              </Text>
            )}
          </View>
          <View style={styles.coinChip}>
            <View style={styles.coinDot} />
            <Text style={styles.coinChipText}>{pawCoins.toLocaleString()}</Text>
          </View>
        </View>
        {dailyTarget > 0 && (
          <View style={styles.statusTrack}>
            <View style={[styles.statusFill, { width: `${pctToday}%` }]} />
          </View>
        )}
      </View>

      <ScrollView
        contentContainerStyle={styles.scScrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* The weight-context line lived here. It is a notification-center item
            now, which is also where it belongs: it was never about the meal
            being logged, only about the plan around it. */}

        {(() => {
          const prediction = predictMeal(foodPantry, activePet?.name);
          // The user can override the prediction by tapping an alternative —
          // that item swaps into the hero spot, the previous hero falls into
          // the alternatives list.
          const overridden = heroOverrideId
            ? foodPantry.find(p => p.id === heroOverrideId) ?? null
            : null;
          const hero = overridden ?? prediction.hero;
          const alternatives = (() => {
            if (!hero) return [];
            return foodPantry.filter(p => p.id !== hero.id).slice(0, 3);
          })();

          if (!hero) {
            // No pantry yet — only show the scan-new-food row.
            return (
              <AddNewFoodRow
                petName={activePet?.name}
                isEmpty
                disabled={isAnalyzing || isLogging}
                onPress={() => {
                  if (!checkAccess()) return;
                  setSourcePopupVisible(true);
                }}
              />
            );
          }

          return (
            <>
              <MealHero
                key={hero.id}
                eyebrow={prediction.eyebrow}
                item={hero}
                bowlSize={activePet?.bowl_size as any}
                species={(activePet?.species as any) ?? 'dog'}
                dailyKcalTarget={activePet?.target_daily_calories ?? 0}
                isBusy={isAnalyzing || isLogging || isPendingConfirm}
                onLog={(mult) => logHero(hero, mult)}
              />

              {alternatives.length > 0 && (
                <Animated.View
                  entering={FadeInDown.duration(420).delay(120)}
                  style={styles.altsWrap}
                >
                  <Text style={styles.altsLabel}>OR PICK ANOTHER</Text>
                  {alternatives.map((alt) => (
                    <AlternativeRow
                      key={alt.id}
                      item={alt}
                      onSelect={() => {
                        setHeroOverrideId(alt.id);
                      }}
                    />
                  ))}
                </Animated.View>
              )}

              <AddNewFoodRow
                petName={activePet?.name}
                isEmpty={false}
                disabled={isAnalyzing || isLogging}
                onPress={() => {
                  if (!checkAccess()) return;
                  setSourcePopupVisible(true);
                }}
              />
            </>
          );
        })()}
      </ScrollView>

      {/* ─── Source popup — inline absolute overlay (NOT a Modal) ─── */}
      {sourcePopupVisible && (
        <View style={styles.popupRoot} pointerEvents="auto">
          <Pressable
            style={styles.popupBackdrop}
            onPress={() => setSourcePopupVisible(false)}
          />
          <View style={styles.popupCard}>
            <Text style={styles.popupTitle}>Add a food</Text>
            <Text style={styles.popupHint}>Pawtchi will read the label.</Text>
            <Pressable
              style={({ pressed }) => [styles.popupRow, pressed && styles.popupRowPressed]}
              onPress={() => {
                setSourcePopupVisible(false);
                InteractionManager.runAfterInteractions(() => pickImage(true));
              }}
            >
              <View style={styles.popupRowIcon}>
                <MaterialIcons name="photo-camera" size={22} color={color.navy} />
              </View>
              <View style={styles.popupRowText}>
                <Text style={styles.popupRowTitle}>Take photo</Text>
                <Text style={styles.popupRowSub}>Snap the back of the bag or pouch</Text>
              </View>
              <MaterialIcons name="chevron-right" size={20} color={color.slateFaint} />
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.popupRow, pressed && styles.popupRowPressed]}
              onPress={() => {
                setSourcePopupVisible(false);
                InteractionManager.runAfterInteractions(() => pickImage(false));
              }}
            >
              <View style={styles.popupRowIcon}>
                <MaterialIcons name="photo-library" size={22} color={color.navy} />
              </View>
              <View style={styles.popupRowText}>
                <Text style={styles.popupRowTitle}>Choose from library</Text>
                <Text style={styles.popupRowSub}>Pick a saved label image</Text>
              </View>
              <MaterialIcons name="chevron-right" size={20} color={color.slateFaint} />
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.popupCancel, pressed && { opacity: 0.5 }]}
              onPress={() => setSourcePopupVisible(false)}
            >
              <Text style={styles.popupCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}

      <PantryLabelEditor
        visible={!!labelGapItem}
        item={labelGapItem}
        onClose={cancelLabelGap}
        onSave={saveLabelGap}
        closeOnSave={false}
        title="Add calorie details"
        intro="The label was readable, but it did not give Pawtchi one dependable calorie total. Enter the printed kcal figure below; if it lists kcal/kg, divide by 10 and use Calories per 100 g."
      />

      {/* Branded failure sheet — every failure path on this screen. FailureModal
          owns support / settings / back; handleRecovery owns the flow. */}
      <FailureModal
        copy={failure}
        onClose={() => setFailure(null)}
        onAction={handleRecovery}
        meta={{ ...failureMeta, screen: '/(tabs)/meal' }}
      />

      <PawLoader visible={isAnalyzing} />
      {/* CoinToast appears automatically via useStreakStore when coins are awarded */}
    </View>
  );
}

// ─── Inline sub-components for the new pre-scan layout ───

const ALT_FOOD_TYPE_ICONS: Record<string, keyof typeof MaterialIcons.glyphMap> = {
  kibble: 'pets',
  wet_food: 'soup-kitchen',
  treat: 'cookie',
  raw: 'egg-alt',
  supplement: 'medication',
  human_food: 'restaurant',
};

function AlternativeRow({ item, onSelect }: { item: PantryItem; onSelect: () => void }) {
  const icon = ALT_FOOD_TYPE_ICONS[item.food_type] || 'pets';
  const sub = item.kcal_per_serving
    ? `${Math.round(item.kcal_per_serving)} kcal · ${item.serving_unit || 'serving'}`
    : (item.serving_unit || 'serving');
  return (
    <Pressable
      style={({ pressed }) => [styles.altRow, pressed && styles.altRowPressed]}
      onPress={onSelect}
    >
      {item.image_url ? (
        <ExpoImage
          source={{ uri: item.image_url }}
          style={styles.altThumb}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={160}
        />
      ) : (
        <View style={[styles.altThumb, styles.altThumbFallback]}>
          <MaterialIcons name={icon} size={18} color={color.navy} />
        </View>
      )}
      <View style={styles.altText}>
        <Text style={styles.altBrand} numberOfLines={1}>{item.brand}</Text>
        <Text style={styles.altSub} numberOfLines={1}>{sub}</Text>
      </View>
      {item.is_favorite && (
        <MaterialIcons name="star" size={14} color={color.alert} style={{ marginRight: 4 }} />
      )}
      <MaterialIcons name="chevron-right" size={20} color={color.slateFaint} />
    </Pressable>
  );
}

function AddNewFoodRow({
  petName,
  isEmpty,
  disabled,
  onPress,
}: {
  petName: string | undefined | null;
  isEmpty: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.addNewRow,
        isEmpty && styles.addNewRowEmpty,
        pressed && !disabled && styles.addNewRowPressed,
        disabled && { opacity: 0.5 },
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <View style={styles.addNewIcon}>
        <MaterialIcons name="add" size={28} color={color.navy} />
      </View>
      <Text style={styles.addNewText}>
        {isEmpty
          ? `Scan ${petName || 'your pet'}'s first food`
          : 'Scan a new food'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // ════ Default scanner screen ════
  scRoot: { flex: 1, backgroundColor: color.surfaceSubtle },
  scScrollContent: { flexGrow: 1, paddingBottom: 120 + TAB_BAR_CLEARANCE },

  // ─── Status strip: slim yellow band, no longer the hero ───
  statusStrip: {
    backgroundColor: color.yellow,
    paddingHorizontal: space.xxl,
    paddingBottom: 0,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: space.md,
  },
  statusLeft: { flex: 1, minWidth: 0 },
  statusEyebrow: {
    fontFamily: font.semibold,
    fontSize: 10,
    letterSpacing: 2.4,
    color: 'rgba(7, 32, 42, 0.62)',
    marginBottom: 2,
  },
  statusValue: {
    fontFamily: font.bold,
    fontSize: 16,
    color: color.navy,
    letterSpacing: -0.2,
  },
  recalChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  recalChipText: {
    fontFamily: font.bold,
    fontSize: 14,
    color: color.navy,
    letterSpacing: -0.2,
  },
  coinChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(7, 32, 42, 0.18)',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginLeft: space.md,
  },
  coinDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: color.navy,
  },
  coinChipText: {
    fontFamily: font.bold,
    fontSize: 11.5,
    color: color.navy,
  },
  // Thin progress sits flush at the strip's bottom edge — reads as a system bar
  statusTrack: {
    height: 3,
    backgroundColor: 'rgba(7, 32, 42, 0.14)',
    overflow: 'hidden',
  },
  statusFill: {
    height: 3,
    backgroundColor: color.navy,
  },

  // ─── Alternatives stack (sits below the MealHero) ───
  altsWrap: {
    paddingHorizontal: space.xxl,
    paddingTop: space.xl,
    gap: space.sm,
  },
  altsLabel: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: 2.4,
    color: color.slateFaint,
    marginBottom: space.sm,
  },
  altRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.hairline,
  },
  altRowPressed: {
    backgroundColor: color.surfaceSubtle,
  },
  altThumb: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: color.yellowSoft,
  },
  altThumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  altText: { flex: 1, minWidth: 0 },
  altBrand: {
    fontFamily: font.bold,
    fontSize: 14,
    color: color.ink,
  },
  altSub: {
    fontFamily: font.medium,
    fontSize: 11.5,
    color: color.slateMuted,
    marginTop: 2,
  },

  // ─── Add-new-food row (centered vertical CTA) ───
  addNewRow: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    marginHorizontal: space.xxl,
    marginTop: space.xl,
    paddingHorizontal: space.md,
    paddingVertical: space.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.hairline,
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
  },
  addNewRowEmpty: {
    backgroundColor: color.surface,
    borderStyle: 'solid',
    borderColor: color.yellow,
    ...shadow.card,
  },
  addNewRowPressed: {
    backgroundColor: color.surfaceSubtle,
  },
  addNewIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addNewText: {
    fontFamily: font.semibold,
    fontSize: 14,
    color: color.ink,
    textAlign: 'center',
  },

  // ─── Centered popup modals (source + portion) ───
  // Backdrop and card are siblings, card is centered. No flex-end edge zone,
  // no overlap geometry. Backdrop owns "tap-outside-to-close"; card owns
  // every interactive Pressable inside it. RN responder routing just works.
  popupRoot: {
    // Anchors above all screen content. zIndex ensures it sits over the
    // status strip and ScrollView contents.
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xxl,
    zIndex: 100,
    elevation: 100,
  },
  popupBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(7, 32, 42, 0.5)',
  },
  popupCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: color.surface,
    borderRadius: radius.xxl,
    paddingHorizontal: space.xxl,
    paddingVertical: space.xl,
    ...shadow.raised,
  },
  popupTitle: {
    fontFamily: font.extrabold,
    fontSize: 20,
    color: color.ink,
    letterSpacing: -0.3,
  },
  popupHint: {
    fontFamily: font.medium,
    fontSize: 13,
    color: color.slateMuted,
    marginTop: 2,
    marginBottom: space.lg,
  },

  // Source popup rows
  popupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderTopWidth: 1,
    borderTopColor: color.hairline,
  },
  popupRowPressed: {
    backgroundColor: color.surfaceSubtle,
  },
  popupRowIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: color.yellowSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  popupRowText: { flex: 1 },
  popupRowTitle: {
    fontFamily: font.bold,
    fontSize: 15,
    color: color.ink,
  },
  popupRowSub: {
    fontFamily: font.medium,
    fontSize: 12,
    color: color.slateMuted,
    marginTop: 2,
  },
  popupCancel: {
    marginTop: space.md,
    paddingVertical: space.sm,
    alignItems: 'center',
  },
  popupCancelText: {
    fontFamily: font.semibold,
    fontSize: 14,
    color: color.slateMuted,
  },


  // Full-screen analyzing overlay — replaces the in-hero overlay since the
  // scanner hero no longer exists.
  analyzingFull: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: color.navy,
    justifyContent: 'center',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.xxl,
    zIndex: 999,
  },
  analyzingText: {
    fontFamily: font.bold,
    fontSize: 14,
    letterSpacing: 1.4,
    color: color.yellow,
  },
  analyzingSub: {
    fontFamily: font.medium,
    fontSize: 12,
    color: color.creamDim,
    textAlign: 'center',
  },

  // ─── Editorial section heads ───
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.xxl,
    marginBottom: space.md,
  },
  sectionLabel: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: 2.4,
    color: color.slateFaint,
  },
  sectionRule: {
    flex: 1,
    height: 1,
    backgroundColor: '#ece9e2',
  },
  sectionMeta: {
    fontFamily: font.bold,
    fontSize: 11,
  },

  // ════ Scan result screen ════
  srRoot: { flex: 1, backgroundColor: color.surfaceSubtle },
  srTopBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.xxl,
    paddingBottom: space.md,
    backgroundColor: color.surfaceSubtle,
    zIndex: 50,
  },
  srEyebrow: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: 2.4,
    color: color.slateFaint,
  },
  srScroll: {
    flexGrow: 1,
    paddingTop: space.md,
  },
  srHero: {
    width: '100%',
    aspectRatio: 4 / 3,
    backgroundColor: color.track,
    marginBottom: space.xl,
  },
  srHeroImg: {
    width: '100%',
    height: '100%',
  },
  srHeroFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.track,
  },
  srFoodName: {
    fontFamily: font.display,
    fontSize: 42,
    lineHeight: 42,
    letterSpacing: 1,
    color: color.ink,
    marginBottom: space.md,
  },
  srAllergyStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: color.errorSoft,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    marginTop: space.md,
  },
  srAllergyText: {
    flex: 1,
    fontFamily: font.semibold,
    fontSize: 12.5,
    color: '#991b1b',
    lineHeight: 17,
  },


  // ─── Portion ───
  portionChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    marginBottom: space.md,
  },
  portionChip: {
    flexGrow: 1,
    flexBasis: '22%',
    paddingHorizontal: 6,
    paddingVertical: 10,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.hairline,
    backgroundColor: color.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  portionChipSelected: {
    borderColor: color.navy,
    backgroundColor: color.navy,
  },
  portionChipText: {
    fontFamily: font.semibold,
    fontSize: 12.5,
    color: color.ink,
  },
  portionChipTextSelected: {
    color: color.cream,
  },
  portionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  portionValue: {
    fontFamily: font.display,
    fontSize: 38,
    lineHeight: 38,
    letterSpacing: 0.5,
    color: color.ink,
  },
  portionUnit: {
    fontSize: 15,
    color: color.slateFaint,
  },
  portionHint: {
    fontFamily: font.medium,
    fontSize: 12,
    color: color.slateMuted,
    marginTop: 4,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepperBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.hairline,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.card,
  },

  // ─── Verdict (the dark moment) ───
  verdict: {
    backgroundColor: color.navy,
    borderRadius: 28,
    padding: space.xxl,
    marginTop: space.xxl,
    ...shadow.raised,
  },
  verdictHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
  verdictEyebrow: {
    fontFamily: font.semibold,
    fontSize: 10.5,
    letterSpacing: 2.4,
    color: color.yellow,
  },
  verdictScoreChip: {
    flexDirection: 'row',
    alignItems: 'baseline',
    backgroundColor: color.navyRaised,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: color.hairlineOnNavy,
  },
  verdictScoreNum: {
    fontFamily: font.extrabold,
    fontSize: 18,
    color: color.yellow,
  },
  verdictScoreOf: {
    fontFamily: font.semibold,
    fontSize: 11,
    color: color.creamDim,
    marginLeft: 2,
  },
  verdictBarTrack: {
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(244, 241, 236, 0.12)',
    overflow: 'hidden',
    marginBottom: space.lg,
  },
  verdictBarFill: {
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: color.yellow,
  },
  verdictBodyRow: {
    flexDirection: 'row',
    gap: space.md,
  },
  verdictQuoteBar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: color.yellow,
  },
  verdictBody: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: 13.5,
    lineHeight: 20,
    color: color.creamDim,
  },

  // ─── Nutrition (typography strip) ───
  nutrRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  nutrCell: {
    flex: 1,
    alignItems: 'flex-start',
  },
  nutrDivider: {
    width: 1,
    height: 36,
    backgroundColor: '#ece9e2',
    marginHorizontal: space.sm,
  },
  nutrValue: {
    fontFamily: font.display,
    fontSize: 28,
    lineHeight: 28,
    letterSpacing: 0.5,
    color: color.ink,
  },
  nutrUnit: {
    fontSize: 14,
    color: color.slateFaint,
  },
  nutrLabel: {
    fontFamily: font.medium,
    fontSize: 11,
    color: color.slateMuted,
    marginTop: 4,
  },

  // ─── Daily budget ───
  budgetTrack: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: color.track,
    overflow: 'hidden',
  },
  budgetFill: {
    height: 6,
    borderRadius: radius.pill,
  },
  budgetMeta: {
    fontFamily: font.medium,
    fontSize: 12,
    color: color.slateMuted,
    marginTop: space.sm,
  },
  budgetLedger: {
    marginTop: space.md,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: '#ece9e2',
    gap: 6,
  },
  budgetLedgerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  budgetLedgerLabel: {
    fontFamily: font.medium,
    fontSize: 12.5,
    color: color.slateMuted,
  },
  budgetLedgerValue: {
    fontFamily: font.bold,
    fontSize: 13,
    color: color.ink,
  },

  // ─── Ingredients ───
  ingChipRow: {
    gap: 8,
    paddingRight: space.xxl,
  },
  ingChip: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.hairline,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  ingChipText: {
    fontFamily: font.semibold,
    fontSize: 12.5,
    color: color.slate,
  },

  // ─── Confidence + sticky Add to Bowl ───
  confidenceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: space.xxl,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: '#ece9e2',
  },
  confidenceLabel: {
    fontFamily: font.medium,
    fontSize: 12,
    color: color.slateMuted,
  },
  confidenceValue: {
    fontFamily: font.bold,
    fontSize: 13,
  },
  // "Change source" picker (bottom sheet on the result screen)
  sourcePickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(7, 32, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  sourcePickerSheet: {
    backgroundColor: color.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: space.xxl,
    paddingTop: space.lg,
    paddingBottom: space.xxxl,
  },
  sourcePickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.xs,
  },
  sourcePickerTitle: {
    fontFamily: font.bold,
    fontSize: 17,
    color: color.ink,
    letterSpacing: -0.2,
  },
  sourcePickerHint: {
    fontFamily: font.medium,
    fontSize: 12.5,
    color: color.slateMuted,
    marginBottom: space.sm,
  },

  srSticky: {
    position: 'absolute',
    left: 0,
    right: 0,
    // `bottom` is set at the call site (insets.bottom + TAB_BAR_CLEARANCE) so
    // the bar clears the floating tab bar rather than sitting behind it.
    backgroundColor: color.surface,
    paddingHorizontal: space.xxl,
    paddingTop: space.lg,
    paddingBottom: space.lg,
    // Real elevation so the bar lifts off the warm sheet beneath it.
    // Negative y so the shadow falls UP onto the content above.
    ...makeShadow(-6, 14, 0.06),
  },
});
