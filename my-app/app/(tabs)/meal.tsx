import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { color, font, radius, shadow, space } from '../../constants/design';
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
import EmptyPantryNudge from '../../components/EmptyPantryNudge';
import PantryPillSelector from '../../components/PantryPillSelector';
import NutritionReferencePanel from '../../components/NutritionReferencePanel';
import QuickLogRail from '../../components/QuickLogRail';
import { PawtchiButton } from '../../components/PawtchiButton';
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
  const { activePet, foodPantry, incrementPantryScan } = useActivePetStore();
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
  const [showPantryNudge, setShowPantryNudge] = useState(true);

  // Reset pantry selection when pet changes
  useEffect(() => {
    setSelectedPantryId(null);
    setShowPantryNudge(true);
  }, [activePet?.id]);

  // Scanner state
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("Ai analysing...");

  // Serving count multiplier — lets users adjust portions
  const [servingCount, setServingCount] = useState(1);

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

  // Branded log success modal state — no longer used (replaced by CoinToast)

  // Quick Log: tap a pantry chip → land on the same result screen as a scan,
  // pre-populated from pantry data. Skips the camera + Gemini food-ID call,
  // but still computes health score, food_analysis, and verdict so the result
  // screen has the full review UX. The user adjusts servings and taps
  // "Add to Bowl" → confirmLog runs through the regular logging pipeline.
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
      const macros = computePantryMacros(item, 1);
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

        // When a pantry item is selected, use its label-accurate values throughout:
        // macro grams (for display), % values (for the verdict), and kcal/100g /
        // moisture (for nutrient math). This ensures the preview verdict and the
        // stored food_scans verdict are computed from identical data.
        if (selectedPantryId) {
          const pantryItem = foodPantry.find(p => p.id === selectedPantryId);
          if (pantryItem) {
            const macros = computePantryMacros(pantryItem, servingCount);
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
          const macros = computePantryMacros(pantryItem, sCount);
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

      // 1b. Bump scan count for selected pantry item
      if (sPantryId) {
        incrementPantryScan(sPantryId);
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

      // Award coins for food log (before clearing state)
      if (user?.id) {
        awardCoins(user.id, 'food_log');
      }

      // Immediately kill the scan result screen and return to scanner
      // User can scan next food or select from pantry
      setScanResult(null);
      setCapturedImage(null);
      setServingCount(1);
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

            {/* ─── Portion ─── */}
            <View style={styles.sectionHead}>
              <Text style={styles.sectionLabel}>PORTION</Text>
              <View style={styles.sectionRule} />
            </View>
            <View style={styles.portionRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.portionValue}>
                  {servingCount % 1 === 0 ? servingCount : servingCount.toFixed(1)}
                  <Text style={styles.portionUnit}> serving{servingCount !== 1 ? 's' : ''}</Text>
                </Text>
                {scanResult.serving_size && (
                  <Text style={styles.portionHint} numberOfLines={1}>
                    1 serving = {scanResult.serving_size}
                  </Text>
                )}
                {servingCount !== 1 && (
                  <Text style={styles.portionHint} numberOfLines={1}>
                    {scanResult.calories_per_serving} × {servingCount % 1 === 0 ? servingCount : servingCount.toFixed(1)} = {displayCalories} kcal
                  </Text>
                )}
              </View>
              <View style={styles.stepper}>
                <TouchableOpacity
                  style={[styles.stepperBtn, servingCount <= 0.5 && { opacity: 0.3 }]}
                  onPress={() => setServingCount(Math.max(0.5, servingCount - 0.5))}
                  disabled={servingCount <= 0.5}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="remove" size={18} color={color.navy} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.stepperBtn}
                  onPress={() => setServingCount(servingCount + 0.5)}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="add" size={18} color={color.navy} />
                </TouchableOpacity>
              </View>
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

        {/* ════ SCANNER HERO — the page's anchor ════ */}
        <Animated.View entering={FadeInDown.duration(440).delay(40)} style={styles.scannerHero}>
          {capturedImage ? (
            <Image source={{ uri: capturedImage }} style={styles.scannerImg} />
          ) : (
            <View style={styles.scannerPlaceholder}>
              {/* Faint frame ticks evoke a viewfinder */}
              <View style={[styles.frameTick, styles.frameTickTL]} />
              <View style={[styles.frameTick, styles.frameTickTR]} />
              <View style={[styles.frameTick, styles.frameTickBL]} />
              <View style={[styles.frameTick, styles.frameTickBR]} />
              <View style={styles.scannerPhotoIcon}>
                <MaterialIcons name="photo-camera" size={32} color={color.creamFaint} />
              </View>
              <Text style={styles.scannerPlaceholderTitle}>
                Scan {activePet?.name || 'your pet'}&apos;s next meal
              </Text>
              <Text style={styles.scannerPlaceholderText}>
                Pawtchi reads the label in seconds
              </Text>
            </View>
          )}

          {/* Action dock — Gallery (ghost) + Camera (big yellow round) + Reset (ghost) */}
          <View style={styles.scannerDock}>
            <TouchableOpacity
              style={styles.dockGhostBtn}
              onPress={() => pickImage(false)}
              disabled={isAnalyzing}
              activeOpacity={0.85}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialIcons name="photo-library" size={20} color={color.cream} />
              <Text style={styles.dockGhostText}>Gallery</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.dockShutter}
              onPress={() => pickImage(true)}
              disabled={isAnalyzing}
              activeOpacity={0.9}
            >
              <View style={styles.dockShutterInner}>
                <MaterialIcons name="photo-camera" size={28} color={color.navy} />
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.dockGhostBtn}
              onPress={() => { setCapturedImage(null); setScanResult(null); }}
              disabled={isAnalyzing}
              activeOpacity={0.85}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialIcons name="refresh" size={20} color={color.cream} />
              <Text style={styles.dockGhostText}>Reset</Text>
            </TouchableOpacity>
          </View>

          {/* Analysing overlay — navy "AI is working" state, yellow accent */}
          {isAnalyzing && (
            <View style={styles.analyzingOverlay} pointerEvents="box-only">
              <View style={styles.analyzingSpinnerRing}>
                <ActivityIndicator size="large" color={color.yellow} />
              </View>
              <Text style={styles.analyzingText}>{loadingMessage}</Text>
              <Text style={styles.analyzingSub}>Reading the label for {activePet?.name || 'your pet'}</Text>
            </View>
          )}
        </Animated.View>

        {/* Below: editorial sections continue on the warm sheet */}
        <View style={styles.sheet}>

          {/* ─── Pantry context ─── */}
          <Animated.View entering={FadeInDown.duration(420).delay(100)}>
            {foodPantry.length === 0 && showPantryNudge && activePet ? (
              <View style={{ marginTop: space.xl }}>
                <EmptyPantryNudge
                  petId={activePet.id}
                  petName={activePet.name}
                  petAvatarUrl={(activePet as any).current_avatar_url}
                  onUpdatePantry={() => router.push('/(tabs)/profile')}
                  onDismiss={() => setShowPantryNudge(false)}
                />
              </View>
            ) : (
              foodPantry.length > 0 && (
                <>
                  <View style={styles.sectionHead}>
                    <Text style={styles.sectionLabel}>PANTRY</Text>
                    <View style={styles.sectionRule} />
                  </View>
                  <PantryPillSelector
                    pantryItems={foodPantry}
                    selectedId={selectedPantryId}
                    onSelect={setSelectedPantryId}
                    onAddNew={() => router.push('/(tabs)/profile')}
                  />
                </>
              )
            )}
          </Animated.View>

          {/* ─── Quick log ─── */}
          {foodPantry.length > 0 && (
            <Animated.View entering={FadeInDown.duration(420).delay(160)}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionLabel}>QUICK LOG</Text>
                <View style={styles.sectionRule} />
              </View>
              <QuickLogRail
                pantryItems={foodPantry}
                onLog={handleQuickLog}
                isBusy={isAnalyzing || isLogging}
              />
            </Animated.View>
          )}
        </View>
      </ScrollView>
      {/* CoinToast appears automatically via useStreakStore when coins are awarded */}
    </View>
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

  // ─── Scanner hero — the page's anchor ───
  scannerHero: {
    backgroundColor: color.navy,
    borderRadius: 32,
    overflow: 'hidden',
    marginHorizontal: space.xxl,
    marginTop: space.lg,
    ...shadow.raised,
  },
  scannerImg: {
    width: '100%',
    aspectRatio: 1,
  },
  scannerPlaceholder: {
    width: '100%',
    aspectRatio: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: space.xxl,
    position: 'relative',
  },
  // Four corner ticks evoke a viewfinder frame
  frameTick: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderColor: 'rgba(244, 241, 236, 0.32)',
  },
  frameTickTL: { top: 18, left: 18, borderTopWidth: 1.5, borderLeftWidth: 1.5, borderTopLeftRadius: 4 },
  frameTickTR: { top: 18, right: 18, borderTopWidth: 1.5, borderRightWidth: 1.5, borderTopRightRadius: 4 },
  frameTickBL: { bottom: 18, left: 18, borderBottomWidth: 1.5, borderLeftWidth: 1.5, borderBottomLeftRadius: 4 },
  frameTickBR: { bottom: 18, right: 18, borderBottomWidth: 1.5, borderRightWidth: 1.5, borderBottomRightRadius: 4 },
  scannerPhotoIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: color.navyRaised,
    borderWidth: 1,
    borderColor: color.hairlineOnNavy,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.lg,
  },
  scannerPlaceholderTitle: {
    fontFamily: font.bold,
    fontSize: 17,
    color: color.cream,
    letterSpacing: -0.2,
    textAlign: 'center',
    marginBottom: 4,
  },
  scannerPlaceholderText: {
    fontFamily: font.regular,
    fontSize: 13,
    color: color.creamDim,
    textAlign: 'center',
  },

  // Camera-app style action dock — gallery + big shutter + reset
  scannerDock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: color.navyRaised,
    borderTopWidth: 1,
    borderTopColor: color.hairlineOnNavy,
    paddingVertical: space.lg,
    paddingHorizontal: space.xxl,
  },
  dockGhostBtn: {
    alignItems: 'center',
    gap: 4,
    width: 64,
  },
  dockGhostText: {
    fontFamily: font.semibold,
    fontSize: 10.5,
    letterSpacing: 0.8,
    color: color.creamDim,
  },
  dockShutter: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: color.navy,
    // Camera-shutter halo
    shadowColor: color.yellow,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  dockShutterInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ─── Sheet wrapper for PANTRY / QUICK LOG below the scanner ───
  sheet: {
    paddingHorizontal: space.xxl,
    paddingTop: space.sm,
    minHeight: 200,
  },

  analyzingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: color.navy,
    justifyContent: 'center',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.xxl,
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

  // ─── Portion ───
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

