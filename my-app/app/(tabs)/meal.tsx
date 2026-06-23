import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, Pressable, ActivityIndicator, Alert, Modal, BackHandler, InteractionManager } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { color, font, motion, radius, shadow, space } from '../../constants/design';
import { useActivePetStore } from '../../store/useActivePetStore';
import { useStreakStore } from '../../store/useStreakStore';
import { usePetContextStore } from '../../store/usePetContextStore';
import { useAuth } from '../../providers/AuthProvider';
import { supabase } from '../../lib/supabase';
import { computeHealthScore } from '../../lib/healthScore';
import { analyzeFood, type FoodAnalysis } from '../../lib/foodVerdict';
import { generateVerdict } from '../../lib/generateVerdict';
import { computePantryMacros } from '../../lib/pantryMath';
import { mapMedicalConditionsToAdjustmentKeys } from '../../lib/clinicalMapping';
import { deriveGoal } from '../../lib/healthMath';
import { useSubscription } from '../../hooks/useSubscription';
import PantryPillSelector from '../../components/PantryPillSelector';
import NutritionReferencePanel from '../../components/NutritionReferencePanel';
import { PawtchiButton } from '../../components/PawtchiButton';
import { AnimatedPressable } from '../../components/AnimatedPressable';
import { ScanSourceRow } from '../../components/ScanSourceRow';
import { MealHero } from '../../components/MealHero';
import { Image as ExpoImage } from 'expo-image';
import { BOWL_SIZE_GRAMS } from '../../lib/pantryMath';
import { predictMeal } from '../../lib/mealPrediction';
import { recordServing, getSuggestion, clearHistory } from '../../lib/portionLearning';
import { haptic } from '../../lib/haptics';
import { pantryItemToScanResult } from '../../lib/pantryToScanResult';
import type { PantryItem } from '../../store/useActivePetStore';

interface ScanResult {
  food_name: string;
  brand?: string | null;
  product_name?: string | null;
  food_type?: 'kibble' | 'wet_food' | 'treat' | 'raw' | 'supplement' | 'human_food';
  calories_per_serving: number;
  serving_size: string;
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
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  health_score?: number;
  ingredients?: string[];
  verdict?: string;
  verdict_category?: 'unsafe' | 'poor' | 'fair' | 'good' | 'excellent';
  food_analysis?: FoodAnalysis | null;
}

export default function MealScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activePet, foodPantry, incrementPantryScan, archivePantryItem, addPantryItem } = useActivePetStore();
  const { pawCoins, awardCoins } = useStreakStore();
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

  // Serving count multiplier — lets users adjust portions
  const [servingCount, setServingCount] = useState(1);
  // Show the precise +/- stepper only when the user taps Custom. The three
  // Less/Usual/More chips cover ~95% of real intent.
  const [showCustomPortion, setShowCustomPortion] = useState(false);
  // Learned-portion suggestion for the current pantry source: when the user has
  // repeatedly fed off-1×, offer "make this the new usual?". `{ id, multiplier }`.
  const [usualSuggestion, setUsualSuggestion] = useState<{ id: string; multiplier: number } | null>(null);
  const [applyingUsual, setApplyingUsual] = useState(false);

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
    } else {
      setUsualSuggestion(null);
    }
  }, [scanResult]);

  // When a result opens for a pantry-sourced food, load any learned-portion
  // suggestion and pre-default the portion to what the owner's been feeding.
  useEffect(() => {
    if (!scanResult) return;
    const serverMatchId = (scanResult as any).matched_pantry_id as string | null | undefined;
    const matchConf = ((scanResult as any).match_confidence as number | undefined) ?? 0;
    const sourceId = selectedPantryId ?? (serverMatchId && matchConf >= 0.5 ? serverMatchId : null);
    if (!sourceId) {
      setUsualSuggestion(null);
      return;
    }
    let cancelled = false;
    getSuggestion(sourceId).then((mult) => {
      if (cancelled || mult == null) return;
      setUsualSuggestion({ id: sourceId, multiplier: mult });
      // Pre-default the chip to the learned portion (user just confirms).
      setShowCustomPortion(false);
      setServingCount(mult);
    });
    return () => { cancelled = true; };
  }, [scanResult, selectedPantryId]);

  // Accept the learned portion → bump the pantry item's per-serving kcal to
  // match what's actually being fed, then clear the history.
  const applyNewUsual = async () => {
    if (!usualSuggestion || applyingUsual) return;
    const item = foodPantry.find(p => p.id === usualSuggestion.id);
    if (!item) { setUsualSuggestion(null); return; }
    setApplyingUsual(true);
    try {
      const base = item.kcal_per_serving ?? 350;
      const newKcal = Math.max(1, Math.round(base * usualSuggestion.multiplier));
      await supabase.from('food_pantry').update({ kcal_per_serving: newKcal }).eq('id', item.id);
      // Reflect in the store so subsequent logs use the new value immediately.
      useActivePetStore.setState((s) => ({
        foodPantry: s.foodPantry.map(p => p.id === item.id ? { ...p, kcal_per_serving: newKcal } : p),
      }));
      await clearHistory(item.id);
      haptic.success();
      // Reset to 1× now that "usual" means the new value.
      setServingCount(1);
      setUsualSuggestion(null);
    } catch {
      // Non-critical; leave the suggestion in place to retry.
    } finally {
      setApplyingUsual(false);
    }
  };

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
          },
          pet: {
            species: activePet.species as 'dog' | 'cat',
            age_months: activePet.age_years ? Math.round(activePet.age_years * 12) : null,
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
            age_months: activePet.age_years ? Math.round(activePet.age_years * 12) : null,
            activity_level: activePet.activity_level,
            is_neutered: activePet.is_neutered,
            goal: previewGoal,
            confirmed_condition_keys: previewConditionKeys,
          },
          meal_grams: estimatedMealGrams,
        });
      } catch {
        // panel just won't render
      }

      // 4. Verdict — same gemini-verdict path as scan flow, with the same
      // deterministic generateVerdict fallback.
      if (synthetic.food_analysis) {
        const today = new Date().toISOString().split('T')[0];
        const { data: todayLog } = await supabase
          .from('daily_logs')
          .select('calories_consumed')
          .eq('pet_id', activePet.id)
          .eq('log_date', today)
          .maybeSingle();
        const caloriesConsumedToday = (todayLog?.calories_consumed as number) || 0;

        const preComputedScore = synthetic.health_score ?? 5;
        let preComputedCategory: 'unsafe' | 'poor' | 'fair' | 'good' | 'excellent' = 'fair';
        if (synthetic.is_allergy_trigger) preComputedCategory = 'unsafe';
        else if (synthetic.is_treat) preComputedCategory = preComputedScore >= 8 ? 'excellent' : preComputedScore >= 5 ? 'fair' : 'poor';
        else preComputedCategory = preComputedScore >= 7 ? 'good' : preComputedScore >= 4 ? 'fair' : 'poor';
        synthetic.verdict_category = preComputedCategory;

        const petCtxStore = usePetContextStore.getState();
        const dailyTarget = activePet.target_daily_calories ?? 0;
        const currentWeightKg = activePet.current_weight_kg ?? 0;
        const targetWeightKg = activePet.target_weight_kg ?? null;
        const weightGapKg = targetWeightKg ? Math.abs(currentWeightKg - targetWeightKg) : 0;

        const petContext = {
          name: activePet.name,
          species: activePet.species,
          age_years: activePet.age_years ?? null,
          current_weight_kg: currentWeightKg,
          target_weight_kg: targetWeightKg,
          activity_level: activePet.activity_level,
          goal: previewGoal,
          confirmed_condition_keys: previewConditionKeys,
          daily_kcal_target: dailyTarget,
        };
        const scanContext = {
          food_name: synthetic.food_name,
          food_type: synthetic.food_type ?? null,
          is_treat: synthetic.is_treat === true,
          is_allergy_trigger: synthetic.is_allergy_trigger === true,
          allergy_warnings: synthetic.allergy_warnings ?? [],
          key_ingredients: synthetic.key_ingredients ?? null,
          calories_per_serving: synthetic.calories_per_serving,
        };
        const macrosContext = {
          total_kcal: synthetic.calories_per_serving,
          protein_g: synthetic.protein_g ?? 0,
          fat_g: synthetic.fat_g ?? 0,
          carbs_g: synthetic.carbs_g ?? 0,
          fibre_g: 0,
          kcal_per_100g: synthetic.kcal_per_100g_as_fed ?? null,
          moisture_pct: synthetic.moisture_pct ?? null,
          meal_grams: synthetic.protein_pct && synthetic.protein_pct > 0 && (synthetic.protein_g ?? 0) > 0
            ? Math.round(((synthetic.protein_g ?? 0) / synthetic.protein_pct) * 100)
            : Math.max(1, Math.round(synthetic.calories_per_serving / 3.5)),
        };
        const analysisContext = {
          health_score: preComputedScore,
          health_score_reasons: healthReasons,
          verdict_category: preComputedCategory,
          nutrient_statuses: synthetic.food_analysis.nutrients.map(n => ({
            nutrient: n.nutrient,
            status: n.status,
          })),
          active_clinical_adjustments: synthetic.food_analysis.active_clinical_adjustments,
        };
        const weightContext = {
          current_weight_kg: currentWeightKg,
          target_weight_kg: targetWeightKg,
          goal: previewGoal,
          weight_trend_direction: petCtxStore.weightTrend?.direction ?? null,
          weight_gap_kg: weightGapKg,
          calories_consumed_today: caloriesConsumedToday,
          daily_kcal_target: dailyTarget,
          calories_remaining: dailyTarget - caloriesConsumedToday,
          cal_percent: dailyTarget > 0 ? Math.round((caloriesConsumedToday / dailyTarget) * 100) : 0,
          meal_pct_of_daily: dailyTarget > 0 ? Math.round((synthetic.calories_per_serving / dailyTarget) * 100) : 0,
        };

        try {
          const { data: vData, error: vErr } = await supabase.functions.invoke('gemini-verdict', {
            body: {
              pet: petContext,
              scan: scanContext,
              macros: macrosContext,
              analysis: analysisContext,
              weight_context: weightContext,
            },
          });
          if (vData?.success && vData.verdict) {
            synthetic.verdict = vData.verdict;
          } else {
            throw new Error(vErr ?? 'no verdict');
          }
        } catch {
          try {
            const fallback = generateVerdict({
              scanResult: {
                food_name: synthetic.food_name,
                food_type: synthetic.food_type ?? null,
                is_treat: synthetic.is_treat === true,
                is_allergy_trigger: synthetic.is_allergy_trigger === true,
                allergy_warnings: synthetic.allergy_warnings ?? [],
                ingredients_of_concern: synthetic.ingredients_of_concern ?? [],
                key_ingredients: synthetic.key_ingredients ?? null,
                calories_per_serving: synthetic.calories_per_serving,
                health_score: preComputedScore,
                recommendation: synthetic.recommendation,
                confidence: synthetic.confidence,
              },
              foodAnalysis: synthetic.food_analysis,
              pet: petContext,
              weight_context: {
                calories_consumed_today: caloriesConsumedToday,
                calories_remaining: dailyTarget - caloriesConsumedToday,
                cal_percent: dailyTarget > 0 ? Math.round((caloriesConsumedToday / dailyTarget) * 100) : 0,
                weight_trend_direction: petCtxStore.weightTrend?.direction ?? null,
                weight_gap_kg: weightGapKg,
              },
            });
            synthetic.verdict = fallback.verdict;
            synthetic.verdict_category = fallback.verdict_category;
          } catch {
            // verdict stays unset; result screen falls back to recommendation (empty)
          }
        }
      }

      setScanResult(synthetic);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      Alert.alert('Quick Log Failed', message);
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
      const asset = result.assets[0];

      // Image size validation — prevent oversized payloads from crashing the edge function
      const MAX_BASE64_LENGTH = 4 * 1024 * 1024; // ~4MB
      if (asset.base64 && asset.base64.length > MAX_BASE64_LENGTH) {
        Alert.alert(
          'Image Too Large',
          'The selected image is too large. Please crop it or use a lower resolution photo.',
          [{ text: 'OK' }]
        );
        return;
      }

      setCapturedImage(asset.uri);
      setServingCount(1); // Reset serving count for new scan
      analyzeWithGemini(asset.base64!, asset.mimeType || 'image/jpeg');
    }
  };

  const analyzeWithGemini = async (base64: string, mimeType: string) => {
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
          Alert.alert(
            'Partial Analysis',
            `AI could not return structured data.\n\nRaw: ${data.analysis.raw_response?.substring(0, 200) || 'Empty response'}`
          );
        }
        const normalized: ScanResult = {
          ...data.analysis,
          fat_g: data.analysis.fats_g ?? data.analysis.fat_g ?? 0,
          protein_g: data.analysis.protein_g ?? 0,
          carbs_g: data.analysis.carbs_g ?? 0,
        };

        // Decide whether to trust the pantry's label values over Gemini's read.
        //   • Explicit user selection → always trust (the user told us).
        //   • Server auto-match with high confidence AND no food_type mismatch →
        //     trust (the model says it's clearly this pantry item).
        //   • Otherwise → keep Gemini's macros; the Source row on the result
        //     screen will let the user accept the auto-match or pick another.
        const serverMatchId = (data.analysis as { matched_pantry_id?: string | null })?.matched_pantry_id ?? null;
        const matchConf = (data.analysis as { match_confidence?: number })?.match_confidence ?? 0;
        const foodTypeMismatch = (data.analysis as { food_type_mismatch?: boolean })?.food_type_mismatch === true;
        const useExplicit = !!selectedPantryId;
        const useAutoMatch = !useExplicit && !!serverMatchId && matchConf >= 0.7 && !foodTypeMismatch;
        const overrideFromPantryId = useExplicit ? selectedPantryId : (useAutoMatch ? serverMatchId : null);

        if (overrideFromPantryId) {
          const pantryItem = foodPantry.find(p => p.id === overrideFromPantryId);
          if (pantryItem) {
            const macros = computePantryMacros(pantryItem, servingCount, {
              species: activePet?.species,
              bowl: activePet?.bowl_size ? { size: activePet.bowl_size as any } : undefined,
            });
            normalized.calories_per_serving = macros.total_kcal;
            normalized.protein_g = macros.protein_g;
            normalized.fat_g = macros.fat_g;
            normalized.carbs_g = macros.carbs_g;
            normalized.kcal_per_100g_as_fed = macros.kcal_per_100g;
            normalized.moisture_pct = macros.moisture_pct;
            // Also carry label percentages so the preview verdict uses the same
            // data as executeLog — prevents preview vs. stored verdict mismatch.
            normalized.protein_pct = pantryItem.protein_pct ?? null;
            normalized.fat_pct = pantryItem.fat_pct ?? null;
            normalized.fibre_pct = pantryItem.fibre_pct ?? null;
          }
        }

        // Carry the match metadata forward onto the scan result so the result
        // screen's Source row can show "Auto-matched · tap to confirm" and the
        // "different food?" banner when food_type_mismatch was raised.
        (normalized as any).matched_pantry_id = serverMatchId;
        (normalized as any).match_confidence = matchConf;
        (normalized as any).food_type_mismatch = foodTypeMismatch;

        // Compute health score deterministically right now so the preview
        // shows the same score that will be stored when the user logs.
        if (activePet) {
          try {
            const { score, reasons: healthReasons } = computeHealthScore({
              food: {
                food_type: normalized.food_type,
                is_treat: normalized.is_treat === true,
                is_allergy_trigger: normalized.is_allergy_trigger === true,
                allergy_warnings: normalized.allergy_warnings ?? [],
                ingredients_of_concern: normalized.ingredients_of_concern ?? [],
                calories_per_serving: normalized.calories_per_serving,
                protein_pct: normalized.protein_pct ?? null,
                fat_pct: normalized.fat_pct ?? null,
                fibre_pct: normalized.fibre_pct ?? null,
                moisture_pct: normalized.moisture_pct ?? null,
                kcal_per_100g_as_fed: normalized.kcal_per_100g_as_fed ?? null,
                confidence: normalized.confidence,
              },
              pet: {
                species: activePet.species as 'dog' | 'cat',
                age_months: activePet.age_years ? Math.round(activePet.age_years * 12) : null,
                daily_kcal_target: activePet.target_daily_calories ?? null,
                allergies: activePet.allergies ?? null,
                medical_conditions: activePet.medical_conditions ?? null,
                weight_kg: activePet.current_weight_kg ?? null,
                target_weight_kg: activePet.target_weight_kg ?? null,
              },
            });
            normalized.health_score = score;
            // Store reasons for the verdict context builder (passed to LLM prompt)
            (normalized as any)._healthScoreReasons = healthReasons;
          } catch {
            // keep Gemini fallback if scoring fails
          }

          // Compute the same FoodAnalysis verdict that confirmLog will store,
          // so the preview's Nutrition Reference panel matches the historical
          // Scan Details view exactly. meal_grams is best-effort estimated
          // for the verdict's per-nutrient g/1000 kcal calculations.
          try {
            const proteinPct = normalized.protein_pct ?? null;
            const proteinG = normalized.protein_g ?? 0;
            const previewKcal = normalized.calories_per_serving;
            const estimatedMealGrams =
              proteinPct && proteinPct > 0 && proteinG > 0
                ? Math.round((proteinG / proteinPct) * 100)
                : Math.max(1, Math.round(previewKcal / 3.5));
            const previewGoal = deriveGoal(
              activePet.current_weight_kg ?? 0,
              activePet.target_weight_kg ?? null,
            );
            const previewConditionKeys = mapMedicalConditionsToAdjustmentKeys(
              activePet.medical_conditions,
            );
            normalized.food_analysis = analyzeFood({
              food: {
                product_name: normalized.food_name,
                food_type: normalized.food_type ?? 'kibble',
                kcal_per_100g_as_fed: normalized.kcal_per_100g_as_fed ?? null,
                moisture_pct: normalized.moisture_pct ?? null,
                protein_pct: normalized.protein_pct ?? null,
                fat_pct: normalized.fat_pct ?? null,
                fiber_pct: normalized.fibre_pct ?? null,
                calcium_pct: null,
                phosphorus_pct: null,
              },
              pet: {
                name: activePet.name,
                species: activePet.species,
                weight_kg: activePet.current_weight_kg,
                target_weight_kg: activePet.target_weight_kg ?? null,
                age_months: activePet.age_years ? Math.round(activePet.age_years * 12) : null,
                activity_level: activePet.activity_level,
                is_neutered: activePet.is_neutered,
                goal: previewGoal,
                confirmed_condition_keys: previewConditionKeys,
              },
              meal_grams: estimatedMealGrams,
            });
          } catch {
            // panel will simply not render if verdict computation fails
          }
        }

        // Build a plain-English verdict via Gemini using macro scan details + pet profile.
        // Architecture: compute ALL analysis BEFORE the LLM call, then pass the
        // completed decision as context. The LLM narrates — it doesn't judge.
        if (normalized.food_analysis && activePet) {
          const previewGoal = deriveGoal(
            activePet.current_weight_kg ?? 0,
            activePet.target_weight_kg ?? null,
          );
          const previewConditionKeys = mapMedicalConditionsToAdjustmentKeys(
            activePet.medical_conditions,
          );

          // Fetch today's running calorie total
          const today = new Date().toISOString().split('T')[0];
          const { data: todayLog } = await supabase
            .from('daily_logs')
            .select('calories_consumed')
            .eq('pet_id', activePet.id)
            .eq('log_date', today)
            .maybeSingle();
          const caloriesConsumedToday = (todayLog?.calories_consumed as number) || 0;

          // --- STEP 1: Compute verdict_category BEFORE the LLM call ---
          const preComputedScore = normalized.health_score ?? 5;
          let preComputedCategory: 'unsafe' | 'poor' | 'fair' | 'good' | 'excellent' = 'fair';
          if (normalized.is_allergy_trigger) {
            preComputedCategory = 'unsafe';
          } else if (normalized.is_treat) {
            preComputedCategory = preComputedScore >= 8 ? 'excellent' : preComputedScore >= 5 ? 'fair' : 'poor';
          } else {
            preComputedCategory = preComputedScore >= 7 ? 'good' : preComputedScore >= 4 ? 'fair' : 'poor';
          }
          normalized.verdict_category = preComputedCategory;

          // --- STEP 2: Read weight context from central store ---
          const petCtxStore = usePetContextStore.getState();
          const dailyTarget = activePet.target_daily_calories ?? 0;
          const currentWeightKg = activePet.current_weight_kg ?? 0;
          const targetWeightKg = activePet.target_weight_kg ?? null;
          const weightGapKg = targetWeightKg
            ? Math.abs(currentWeightKg - targetWeightKg)
            : 0;

          // --- STEP 3: Build complete context payloads ---
          const petContext = {
            name: activePet.name,
            species: activePet.species,
            age_years: activePet.age_years ?? null,
            current_weight_kg: currentWeightKg,
            target_weight_kg: targetWeightKg,
            activity_level: activePet.activity_level,
            goal: previewGoal,
            confirmed_condition_keys: previewConditionKeys,
            daily_kcal_target: dailyTarget,
          };

          const scanContext = {
            food_name: normalized.food_name,
            food_type: normalized.food_type ?? null,
            is_treat: normalized.is_treat === true,
            is_allergy_trigger: normalized.is_allergy_trigger === true,
            allergy_warnings: normalized.allergy_warnings ?? [],
            key_ingredients: normalized.key_ingredients ?? null,
            calories_per_serving: normalized.calories_per_serving,
          };

          const macrosContext = {
            total_kcal: normalized.calories_per_serving,
            protein_g: normalized.protein_g ?? 0,
            fat_g: normalized.fat_g ?? 0,
            carbs_g: normalized.carbs_g ?? 0,
            fibre_g: 0,
            kcal_per_100g: normalized.kcal_per_100g_as_fed ?? null,
            moisture_pct: normalized.moisture_pct ?? null,
            meal_grams: normalized.protein_pct && normalized.protein_pct > 0 && (normalized.protein_g ?? 0) > 0
              ? Math.round(((normalized.protein_g ?? 0) / normalized.protein_pct) * 100)
              : Math.max(1, Math.round(normalized.calories_per_serving / 3.5)),
          };

          // Pre-computed analysis — sent to LLM so it narrates, not judges
          const analysisContext = {
            health_score: preComputedScore,
            health_score_reasons: (normalized as any)._healthScoreReasons ?? [],
            verdict_category: preComputedCategory,
            nutrient_statuses: normalized.food_analysis.nutrients.map(n => ({
              nutrient: n.nutrient,
              status: n.status,
            })),
            active_clinical_adjustments: normalized.food_analysis.active_clinical_adjustments,
          };

          // Weight & calorie context — holistic view
          const weightContext = {
            current_weight_kg: currentWeightKg,
            target_weight_kg: targetWeightKg,
            goal: previewGoal,
            weight_trend_direction: petCtxStore.weightTrend?.direction ?? null,
            weight_gap_kg: weightGapKg,
            calories_consumed_today: caloriesConsumedToday,
            daily_kcal_target: dailyTarget,
            calories_remaining: dailyTarget - caloriesConsumedToday,
            cal_percent: dailyTarget > 0 ? Math.round((caloriesConsumedToday / dailyTarget) * 100) : 0,
            meal_pct_of_daily: dailyTarget > 0 ? Math.round((normalized.calories_per_serving / dailyTarget) * 100) : 0,
          };

          // --- STEP 4: Call LLM with COMPLETE context ---
          try {
            const { data: verdictData, error: verdictErr } = await supabase.functions.invoke('gemini-verdict', {
              body: {
                pet: petContext,
                scan: scanContext,
                macros: macrosContext,
                analysis: analysisContext,
                weight_context: weightContext,
              },
            });

            if (verdictData?.success && verdictData.verdict) {
              normalized.verdict = verdictData.verdict;
              // Category already set in Step 1 — no post-processing needed
            } else {
              throw new Error(verdictErr ?? 'Verdict call returned no content');
            }
          } catch {
            // Network fallback: deterministic generateVerdict (also weight-aware)
            try {
              const { verdict: fallbackVerdict, verdict_category: fallbackCategory } = generateVerdict({
                scanResult: {
                  food_name: normalized.food_name,
                  food_type: normalized.food_type ?? null,
                  is_treat: normalized.is_treat === true,
                  is_allergy_trigger: normalized.is_allergy_trigger === true,
                  allergy_warnings: normalized.allergy_warnings ?? [],
                  ingredients_of_concern: normalized.ingredients_of_concern ?? [],
                  key_ingredients: normalized.key_ingredients ?? null,
                  calories_per_serving: normalized.calories_per_serving,
                  health_score: preComputedScore,
                  recommendation: normalized.recommendation,
                  confidence: normalized.confidence,
                },
                foodAnalysis: normalized.food_analysis,
                pet: petContext,
                weight_context: {
                  calories_consumed_today: caloriesConsumedToday,
                  calories_remaining: dailyTarget - caloriesConsumedToday,
                  cal_percent: dailyTarget > 0 ? Math.round((caloriesConsumedToday / dailyTarget) * 100) : 0,
                  weight_trend_direction: petCtxStore.weightTrend?.direction ?? null,
                  weight_gap_kg: weightGapKg,
                },
              });
              normalized.verdict = fallbackVerdict;
              normalized.verdict_category = fallbackCategory;
            } catch {
              // completely silent — verdict remains undefined
            }
          }
        }

        setScanResult(normalized);
      } else {
        Alert.alert('Analysis Failed', data?.error || JSON.stringify(data) || 'Could not analyze image.');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : JSON.stringify(err);
      Alert.alert('Connection Error', message);
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

  const confirmLog = async (overrides?: LogOverrides) => {
    const sr = overrides?.scanResult ?? scanResult;
    const sc = overrides?.servingCount ?? servingCount;
    if (!sr || !activePet) return;

    // Prevent double-taps during async checks
    setIsPendingConfirm(true);

    const today = new Date().toISOString().split('T')[0];
    const targetCal = activePet.target_daily_calories || 0;

    // Apply serving multiplier to get the actual calories being logged
    const totalCalories = Math.round(sr.calories_per_serving * sc);

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
    const sPantryId = overrides?.pantryId ?? selectedPantryId;
    const sCount = overrides?.servingCount ?? servingCount;
    const sImage = overrides?.capturedImage ?? capturedImage;
    if (!sr || !activePet) return;
    setIsLogging(true);
    setIsPendingConfirm(true);

    try {
      // When a pantry item is selected, compute macros deterministically from
      // its label data — same math as analyzeWithGemini used for the preview,
      // so food_scans stores values identical to what the user confirmed.
      // Note: when no pantry item is selected, scanResult values already
      // include the servingCount multiplier applied in analyzeWithGemini.
      let totalCalories = sr.calories_per_serving;
      let totalProtein = sr.protein_g ?? 0;
      let totalCarbs = sr.carbs_g ?? 0;
      let totalFat = sr.fat_g ?? 0;

      // Also capture label-accurate % values from the pantry for the verdict layer.
      let pantry_kcal_per_100g: number | null = sr.kcal_per_100g_as_fed ?? null;
      let pantry_moisture_pct: number | null = sr.moisture_pct ?? null;
      let pantry_protein_pct: number | null = sr.protein_pct ?? null;
      let pantry_fat_pct: number | null = sr.fat_pct ?? null;
      let pantry_fiber_pct: number | null = sr.fibre_pct ?? null;

      if (sPantryId) {
        const pantryItem = foodPantry.find(p => p.id === sPantryId);
        if (pantryItem) {
          const macros = computePantryMacros(pantryItem, sCount, {
            species: activePet?.species,
            bowl: activePet?.bowl_size ? { size: activePet.bowl_size as any } : undefined,
          });
          totalCalories = macros.total_kcal;
          totalProtein = macros.protein_g;
          totalCarbs = macros.carbs_g;
          totalFat = macros.fat_g;
          pantry_kcal_per_100g = macros.kcal_per_100g;
          pantry_moisture_pct = macros.moisture_pct;
          pantry_protein_pct = pantryItem.protein_pct ?? null;
          pantry_fat_pct = pantryItem.fat_pct ?? null;
          pantry_fiber_pct = pantryItem.fibre_pct ?? null;
        }
      }

      // Best-effort meal_grams estimate for the verdict layer.
      // Per-nutrient verdicts are intrinsic to the food (g/1000 kcal) and
      // don't depend on this; meal_grams only feeds the meal_kcal /
      // % of daily calculation, which we override with totalCalories below.
      const proteinPct = sr.protein_pct ?? null;
      const estimatedMealGrams =
        proteinPct && proteinPct > 0 && totalProtein > 0
          ? Math.round((totalProtein / proteinPct) * 100)
          : Math.max(1, Math.round(totalCalories / 3.5));

      // Build the FoodAnalysis verdict — stored on food_scans.food_analysis.
      const goal = deriveGoal(
        activePet.current_weight_kg ?? 0,
        activePet.target_weight_kg ?? null,
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
          age_months: activePet.age_years ? Math.round(activePet.age_years * 12) : null,
          activity_level: activePet.activity_level,
          is_neutered: activePet.is_neutered,
          goal,
          confirmed_condition_keys: confirmedConditionKeys,
        },
        meal_grams: estimatedMealGrams,
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
        },
        pet: {
          species: activePet.species,
          age_months: activePet.age_years ? Math.round(activePet.age_years * 12) : null,
          daily_kcal_target: activePet.target_daily_calories ?? null,
          allergies: activePet.allergies ?? null,
          medical_conditions: activePet.medical_conditions ?? null,
          weight_kg: activePet.current_weight_kg ?? null,
          target_weight_kg: activePet.target_weight_kg ?? null,
        },
      });

      // --- Compute verdict_category BEFORE LLM call ---
      let storedCategory: 'unsafe' | 'poor' | 'fair' | 'good' | 'excellent' = 'fair';
      if (sr.is_allergy_trigger) storedCategory = 'unsafe';
      else if (sr.is_treat) storedCategory = derivedHealthScore >= 8 ? 'excellent' : derivedHealthScore >= 5 ? 'fair' : 'poor';
      else storedCategory = derivedHealthScore >= 7 ? 'good' : derivedHealthScore >= 4 ? 'fair' : 'poor';

      // Read weight context from central store
      const execPetCtxStore = usePetContextStore.getState();
      const execDailyTarget = activePet.target_daily_calories ?? 0;
      const execCurrentWeight = activePet.current_weight_kg ?? 0;
      const execTargetWeight = activePet.target_weight_kg ?? null;
      const execWeightGap = execTargetWeight ? Math.abs(execCurrentWeight - execTargetWeight) : 0;
      const execConsumedToday = existingLog?.calories_consumed ?? 0;

      // Generate plain-English verdict via Gemini (with deterministic fallback).
      let storedVerdict = null as { verdict: string; verdict_category: string } | null;
      try {
        const petCtx = {
          name: activePet.name,
          species: activePet.species,
          age_years: activePet.age_years ?? null,
          current_weight_kg: execCurrentWeight,
          target_weight_kg: execTargetWeight,
          activity_level: activePet.activity_level,
          goal,
          confirmed_condition_keys: confirmedConditionKeys,
          daily_kcal_target: execDailyTarget,
        };
        const scanCtx = {
          food_name: sr.food_name,
          food_type: sr.food_type ?? null,
          is_treat: sr.is_treat === true,
          is_allergy_trigger: sr.is_allergy_trigger,
          allergy_warnings: sr.allergy_warnings ?? [],
          key_ingredients: sr.key_ingredients ?? null,
          calories_per_serving: sr.calories_per_serving,
        };
        const macrosCtx = {
          total_kcal: totalCalories,
          protein_g: totalProtein,
          fat_g: totalFat,
          carbs_g: totalCarbs,
          fibre_g: 0,
          kcal_per_100g: sr.kcal_per_100g_as_fed ?? null,
          moisture_pct: sr.moisture_pct ?? null,
          meal_grams: estimatedMealGrams,
        };

        // Pre-computed analysis — LLM narrates, doesn't judge
        const analysisCtx = {
          health_score: derivedHealthScore,
          health_score_reasons: derivedReasons,
          verdict_category: storedCategory,
          nutrient_statuses: foodAnalysis.nutrients.map(n => ({
            nutrient: n.nutrient,
            status: n.status,
          })),
          active_clinical_adjustments: foodAnalysis.active_clinical_adjustments,
        };

        // Weight & calorie context
        const weightCtx = {
          current_weight_kg: execCurrentWeight,
          target_weight_kg: execTargetWeight,
          goal,
          weight_trend_direction: execPetCtxStore.weightTrend?.direction ?? null,
          weight_gap_kg: execWeightGap,
          calories_consumed_today: execConsumedToday,
          daily_kcal_target: execDailyTarget,
          calories_remaining: execDailyTarget - execConsumedToday,
          cal_percent: execDailyTarget > 0 ? Math.round((execConsumedToday / execDailyTarget) * 100) : 0,
          meal_pct_of_daily: execDailyTarget > 0 ? Math.round((totalCalories / execDailyTarget) * 100) : 0,
        };

        const { data: vData, error: vErr } = await supabase.functions.invoke('gemini-verdict', {
          body: {
            pet: petCtx,
            scan: scanCtx,
            macros: macrosCtx,
            analysis: analysisCtx,
            weight_context: weightCtx,
          },
        });
        if (vData?.success && vData.verdict) {
          storedVerdict = { verdict: vData.verdict, verdict_category: storedCategory };
        } else {
          throw new Error(vErr ?? 'no verdict');
        }
      } catch {
        // Network fallback: deterministic generateVerdict (also weight-aware)
        try {
          const fallback = generateVerdict({
            scanResult: {
              food_name: sr.food_name,
              food_type: sr.food_type ?? null,
              is_treat: sr.is_treat === true,
              is_allergy_trigger: sr.is_allergy_trigger,
              allergy_warnings: sr.allergy_warnings ?? [],
              ingredients_of_concern: sr.ingredients_of_concern ?? [],
              calories_per_serving: sr.calories_per_serving,
              health_score: derivedHealthScore,
              recommendation: sr.recommendation,
              confidence: sr.confidence,
            },
            foodAnalysis,
            pet: {
              name: activePet.name,
              species: activePet.species,
              goal,
              activity_level: activePet.activity_level,
              confirmed_condition_keys: confirmedConditionKeys,
              age_years: activePet.age_years ?? null,
              current_weight_kg: activePet.current_weight_kg,
              target_weight_kg: activePet.target_weight_kg ?? null,
              daily_kcal_target: activePet.target_daily_calories ?? null,
            },
            weight_context: {
              calories_consumed_today: execConsumedToday,
              calories_remaining: execDailyTarget - execConsumedToday,
              cal_percent: execDailyTarget > 0 ? Math.round((execConsumedToday / execDailyTarget) * 100) : 0,
              weight_trend_direction: execPetCtxStore.weightTrend?.direction ?? null,
              weight_gap_kg: execWeightGap,
            },
          });
          storedVerdict = { verdict: fallback.verdict, verdict_category: fallback.verdict_category };
        } catch {
          // silent — verdict left undefined
        }
      }

      // Attach verdict to foodAnalysis before storing — preserves the text even
      // if the pet profile changes later (historical scans stay accurate).
      if (storedVerdict) {
        (foodAnalysis as FoodAnalysis & { verdict: string }).verdict = storedVerdict.verdict;
        (foodAnalysis as FoodAnalysis & { verdict_category: string }).verdict_category = storedVerdict.verdict_category;
      }

      // 0. Silent pantry auto-save — when a fresh scan lands without a pantry
      // match, persist it as a pantry row so future scans of the same product
      // surface on the Quick Log rail. No UI feedback: pantry is plumbing.
      // Dedupe against the in-memory rail by (brand, product_name) so a re-scan
      // within the same session reuses the existing row.
      let effectivePantryId: string | null = sPantryId;
      const isLabeledProduct = sr.is_labeled_product === true || (!!sr.brand && !!sr.product_name);
      if (!effectivePantryId && isLabeledProduct) {
        const targetBrand = (sr.brand || sr.food_name || '').trim().toLowerCase();
        const targetProduct = (sr.product_name || sr.food_name || '').trim().toLowerCase();
        const existing = foodPantry.find(p =>
          p.brand.trim().toLowerCase() === targetBrand &&
          (p.product_name || '').trim().toLowerCase() === targetProduct
        );
        if (existing) {
          effectivePantryId = existing.id;
        } else {
          const foodType = sr.food_type || (sr.is_treat ? 'treat' : 'kibble');
          const sameTypeCount = foodPantry.filter(p => p.food_type === foodType).length;
          const petAllergiesLower = (activePet.allergies || []).map(a => a.toLowerCase());
          const ingredients = sr.key_ingredients || [];
          const allergyFlags = ingredients.filter(ing =>
            petAllergiesLower.some(a => ing.toLowerCase().includes(a))
          );
          try {
            const created = await addPantryItem({
              pet_id: activePet.id,
              brand: sr.brand || sr.food_name || 'Unknown',
              product_name: sr.product_name || sr.food_name || '',
              food_type: foodType,
              kcal_per_serving: sr.calories_per_serving || null,
              kcal_per_100g_as_fed: sr.kcal_per_100g_as_fed ?? null,
              moisture_pct: sr.moisture_pct ?? null,
              serving_unit: sr.serving_unit ?? null,
              protein_pct: sr.protein_pct ?? null,
              fat_pct: sr.fat_pct ?? null,
              fibre_pct: sr.fibre_pct ?? null,
              key_ingredients: sr.key_ingredients ?? null,
              allergy_flags: allergyFlags.length > 0 ? allergyFlags : null,
              is_primary: sameTypeCount === 0,
              image_url: sImage || undefined,
              expiry_date: null,
              is_favorite: false,
            });
            if (created?.id) {
              effectivePantryId = created.id;
            }
          } catch {
            // Silent failure — the scan still logs against food_scans even if
            // the pantry insert fails; the user just won't see it on the rail.
          }
        }
      }

      // 1. Insert into food_scans
      await supabase.from('food_scans').insert({
        pet_id: activePet.id,
        image_url: sImage || '',
        ai_identified_food: sr.food_name,
        ai_estimated_calories: totalCalories,
        ai_confidence_score: Math.round(sr.confidence * 100),
        is_user_confirmed: true,
        is_treat: sr.is_treat === true,
        protein_g: totalProtein,
        carbs_g: totalCarbs,
        fat_g: totalFat,
        health_score: derivedHealthScore,
        ingredients: sr.key_ingredients || sr.ingredients || [],
        food_analysis: foodAnalysis,
      });

      // 1b. Bump scan count for the pantry source (explicit pick or silent save).
      if (effectivePantryId) {
        incrementPantryScan(effectivePantryId);
      }

      // 2. Upsert today's daily_log (with treat tracking)
      const isTreat = sr.is_treat === true;
      if (existingLog) {
        const updateData: Record<string, unknown> = {
          calories_consumed: (existingLog.calories_consumed || 0) + totalCalories,
          updated_at: new Date().toISOString(),
        };
        if (isTreat) {
          updateData.treats_consumed = (existingLog.treats_consumed || 0) + 1;
        }
        await supabase.from('daily_logs').update(updateData).eq('id', existingLog.id);
      } else {
        await supabase.from('daily_logs').insert({
          pet_id: activePet.id,
          log_date: today,
          calories_consumed: totalCalories,
          treats_consumed: isTreat ? 1 : 0,
        });
      }

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

      // Award coins for food log (before clearing state)
      if (user?.id) {
        awardCoins(user.id, 'food_log');
      }

      // Record the serving multiplier against the pantry source for the
      // learning loop (so repeated off-1× feeding can become the new usual).
      if (effectivePantryId) {
        recordServing(effectivePantryId, sCount);
      }

      setUsualSuggestion(null);

      // Immediately kill the scan result screen and return to scanner
      // User can scan next food or select from pantry
      setScanResult(null);
      setCapturedImage(null);
      setServingCount(1);
      setShowCustomPortion(false);
      setHasLogged(false);
      setIsPendingConfirm(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      Alert.alert('Log Error', message);
    } finally {
      setIsLogging(false);
      setIsPendingConfirm(false);
    }
  };

  // When scan result is ready, show the full Stitch-designed result view
  if (scanResult && !isAnalyzing) {
    const healthScore = scanResult.health_score ?? 5; // deterministically set above; 5 is a safe fallback
    const proteinG = Math.round((scanResult.protein_g ?? 0) * servingCount);
    const carbsG = Math.round((scanResult.carbs_g ?? 0) * servingCount);
    const fatG = Math.round((scanResult.fat_g ?? 0) * servingCount);
    const displayCalories = Math.round(scanResult.calories_per_serving * servingCount);
    const ingredientsList = scanResult.ingredients ?? scanResult.ingredients_of_concern ?? [];

    // Pre-compute budget values so the JSX stays clean
    const ctxStore = usePetContextStore.getState();
    const budgetTarget = activePet?.target_daily_calories ?? 0;
    const consumed = ctxStore.todayCalories ?? 0;
    const afterMeal = budgetTarget - consumed - displayCalories;
    const pctUsed = budgetTarget > 0 ? Math.round((consumed / budgetTarget) * 100) : 0;
    const mealPct = budgetTarget > 0 ? Math.round((displayCalories / budgetTarget) * 100) : 0;

    // Resolve the pantry item this result is logging against (explicit pick or
    // confident server match) so the portion chips can speak in "bowls" when
    // that reads more naturally than abstract multipliers.
    const resolvedSourceId =
      selectedPantryId ??
      (((scanResult as any).matched_pantry_id as string | null) &&
      (((scanResult as any).match_confidence as number | undefined) ?? 0) >= 0.5
        ? ((scanResult as any).matched_pantry_id as string)
        : null);
    const resolvedSourceItem = resolvedSourceId ? foodPantry.find(p => p.id === resolvedSourceId) ?? null : null;
    const bowlMode =
      !!activePet?.bowl_size &&
      !!resolvedSourceItem &&
      (resolvedSourceItem.serving_unit === 'cup' || !resolvedSourceItem.serving_unit);
    // Adaptive chip set: bowl fractions read better than 0.75/1/1.25 for kibble.
    const portionOptions = bowlMode
      ? [
          { label: 'Quarter bowl', value: 0.25 },
          { label: 'Half bowl', value: 0.5 },
          { label: 'Full bowl', value: 1 },
        ]
      : [
          { label: 'A little less', value: 0.75 },
          { label: 'Usual', value: 1 },
          { label: 'A little more', value: 1.25 },
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
          contentContainerStyle={[styles.srScroll, { paddingBottom: 120 }]}
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
              const serverMatchId = (scanResult as any).matched_pantry_id as string | null | undefined;
              const matchConf = ((scanResult as any).match_confidence as number | undefined) ?? 0;
              const typeMismatch = ((scanResult as any).food_type_mismatch as boolean | undefined) === true;
              // Resolution order: explicit user pick → server auto-match → none.
              const resolvedId = selectedPantryId ?? (serverMatchId && matchConf >= 0.5 ? serverMatchId : null);
              const matchedItem = resolvedId ? foodPantry.find(p => p.id === resolvedId) ?? null : null;
              const kind: 'explicit' | 'auto' | 'new' | 'unmatched' =
                selectedPantryId ? 'explicit'
                : (serverMatchId && matchConf >= 0.5) ? 'auto'
                : scanResult.is_labeled_product ? 'new'
                : 'unmatched';
              return (
                <ScanSourceRow
                  matchedItem={matchedItem}
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
            {/* Learned-portion nudge — "you've been feeding less, make it usual?" */}
            {usualSuggestion && (
              <View style={styles.usualBanner}>
                <MaterialIcons name="auto-awesome" size={16} color={color.navy} />
                <Text style={styles.usualBannerText} numberOfLines={2}>
                  Lately you&apos;ve fed {usualSuggestion.multiplier < 1 ? 'a little less' : 'a little more'} — make this {activePet?.name || 'your pet'}&apos;s usual?
                </Text>
                <TouchableOpacity
                  style={styles.usualBannerCta}
                  onPress={applyNewUsual}
                  disabled={applyingUsual}
                  activeOpacity={0.85}
                >
                  <Text style={styles.usualBannerCtaText}>{applyingUsual ? '…' : 'Update'}</Text>
                </TouchableOpacity>
              </View>
            )}

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
                    <Text style={[styles.portionChipText, isSelected && styles.portionChipTextSelected]}>
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
                <Text style={[styles.portionChipText, showCustomPortion && styles.portionChipTextSelected]}>
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
                  {scanResult.calories_per_serving} × {servingCount % 1 === 0 ? servingCount : servingCount.toFixed(2)} = {displayCalories} kcal
                </Text>
              </View>
              {showCustomPortion && (
                <View style={styles.stepper}>
                  <TouchableOpacity
                    style={[styles.stepperBtn, servingCount <= 0.25 && { opacity: 0.3 }]}
                    onPress={() => setServingCount(Math.max(0.25, +(servingCount - 0.25).toFixed(2)))}
                    disabled={servingCount <= 0.25}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons name="remove" size={18} color={color.navy} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.stepperBtn}
                    onPress={() => setServingCount(+(servingCount + 0.25).toFixed(2))}
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

            {/* ─── Nutrition reference (external panel) ─── */}
            {scanResult.food_analysis && (
              <View style={{ marginTop: space.xxl }}>
                <NutritionReferencePanel
                  foodAnalysis={scanResult.food_analysis}
                  mealKcalOverride={displayCalories}
                />
              </View>
            )}

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

        {/* ─── Sticky Add to Bowl — plinth lifts off the sheet ─── */}
        <View style={styles.srSticky}>
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

  // ─── Weight context line for the canopy (calm phrasing, no red card) ───
  const weightContextLine = (() => {
    if (!activePet) return null;
    const targetW = activePet.target_weight_kg || activePet.current_weight_kg || 0;
    const currentW = activePet.current_weight_kg || 0;
    const gap = currentW - targetW;
    if (gap > 0.5) return `${activePet.name} is ${gap.toFixed(1)} kg above their ${targetW} kg target — keep portions steady.`;
    if (gap < -0.5) return `${activePet.name} is ${Math.abs(gap).toFixed(1)} kg below their ${targetW} kg goal.`;
    return null;
  })();

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
            <Text style={styles.statusValue} numberOfLines={1}>
              {dailyTarget > 0
                ? overBudget
                  ? `${Math.abs(remaining)} kcal over today`
                  : `${remaining} kcal left today`
                : 'Scan a food label'}
            </Text>
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
        {/* Weight context — calm inline row, only when off-target */}
        {weightContextLine && (
          <Animated.View entering={FadeInDown.duration(420)} style={styles.weightNote}>
            <MaterialIcons name="info-outline" size={14} color={color.slateMuted} />
            <Text style={styles.weightNoteText} numberOfLines={2}>{weightContextLine}</Text>
          </Animated.View>
        )}

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

      {/* ─── Analysing overlay — full screen since the scanner hero is gone ─── */}
      {isAnalyzing && (
        <View style={styles.analyzingFull} pointerEvents="auto">
          <View style={styles.analyzingSpinnerRing}>
            <ActivityIndicator size="large" color={color.yellow} />
          </View>
          <Text style={styles.analyzingText}>{loadingMessage}</Text>
          <Text style={styles.analyzingSub}>Reading the label for {activePet?.name || 'your pet'}</Text>
        </View>
      )}
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
        <MaterialIcons name="add" size={20} color={color.navy} />
      </View>
      <Text style={styles.addNewText}>
        {isEmpty
          ? `Scan ${petName || 'your pet'}'s first food`
          : 'Scan a new food'}
      </Text>
      <MaterialIcons name="photo-camera" size={18} color={color.slateFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // ════ Default scanner screen ════
  scRoot: { flex: 1, backgroundColor: color.surfaceSubtle },
  scScrollContent: { flexGrow: 1, paddingBottom: 120 },

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

  // ─── Weight nudge — calm inline row above the scanner ───
  weightNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.hairline,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginHorizontal: space.xxl,
    marginTop: space.lg,
  },
  weightNoteText: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 12,
    color: color.slate,
    lineHeight: 17,
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

  // ─── Add-new-food row (tertiary CTA at the bottom of the list) ───
  addNewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginHorizontal: space.xxl,
    marginTop: space.xl,
    paddingHorizontal: space.md,
    paddingVertical: 14,
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
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addNewText: {
    flex: 1,
    fontFamily: font.semibold,
    fontSize: 14,
    color: color.ink,
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
  analyzingSpinnerRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: color.navyRaised,
    borderWidth: 1,
    borderColor: color.hairlineOnNavy,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
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

  // ─── Learned-portion nudge ───
  usualBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: color.yellowSoft,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.yellow,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    marginTop: space.lg,
    marginBottom: space.sm,
  },
  usualBannerText: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 12.5,
    color: color.ink,
    lineHeight: 17,
  },
  usualBannerCta: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: color.navy,
  },
  usualBannerCtaText: {
    fontFamily: font.bold,
    fontSize: 12,
    color: color.cream,
    letterSpacing: 0.3,
  },

  // ─── Portion ───
  portionChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    marginBottom: space.md,
  },
  portionChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.hairline,
    backgroundColor: color.surface,
  },
  portionChipSelected: {
    backgroundColor: color.yellowSoft,
    borderColor: color.yellow,
  },
  portionChipText: {
    fontFamily: font.semibold,
    fontSize: 13,
    color: color.slate,
  },
  portionChipTextSelected: {
    color: color.navy,
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
    bottom: 0,
    backgroundColor: color.surface,
    paddingHorizontal: space.xxl,
    paddingTop: space.lg,
    paddingBottom: space.lg,
    // Real elevation so the bar lifts off the warm sheet beneath it.
    // Negative y so the shadow falls UP onto the content above.
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 12,
  },
});

