import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, TextInput, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
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
  const [loadingMessage, setLoadingMessage] = useState("AI ANALYZING...");

  // Serving count multiplier — lets users adjust portions
  const [servingCount, setServingCount] = useState(1);

  // Rotate cool spinner words during analysis
  useEffect(() => {
    if (!isAnalyzing) {
      setLoadingMessage("AI ANALYZING...");
      return;
    }
    
    const messages = [
      "SNIFFING OUT CALORIES...",
      "CONSULTING THE MEAL ORACLE...",
      "TASTING VIRTUAL KIBBLE...",
      "CALCULATING PAW-TIONS...",
      "DECODING PET TREATS...",
      "SCANNING FOR GOODNESS...",
      "PET-PROVING THE DATA..."
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

  // Quick Log: tap a pantry chip → land on the same result screen as a scan,
  // pre-populated from pantry data. Skips the camera + Gemini food-ID call,
  // but still computes health score, food_analysis, and verdict so the result
  // screen has the full review UX. The user adjusts servings and taps
  // "Add to Bowl" → confirmLog runs through the regular logging pipeline.
  const handleQuickLog = useCallback(async (item: PantryItem) => {
    if (!checkAccess() || !activePet) return;

    setIsAnalyzing(true);
    setLoadingMessage('PREPARING MEAL...');
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

    // ⛔ Hard overage warning
    if (targetCal > 0 && newTotal > targetCal) {
      const overBy = newTotal - targetCal;
      Alert.alert(
        '⚠️ Daily Limit Exceeded',
        `${activePet.name} has already consumed ${currentCal} kcal today.\n\nAdding ${totalCalories} kcal from "${sr.food_name}"${sc > 1 ? ` (${sc} servings)` : ''} would bring the total to ${newTotal} kcal — that's ${overBy} kcal over the daily limit of ${targetCal} kcal.\n\nOverfeeding can lead to weight gain and health issues.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Log Anyway', style: 'destructive', onPress: () => executeLog(existingLog, today, overrides) },
        ]
      );
      return;
    }

    // 🟡 Approaching limit warning (90%+)
    if (targetCal > 0 && newTotal >= targetCal * 0.9 && currentCal < targetCal * 0.9) {
      Alert.alert(
        '🟡 Approaching Limit',
        `This will bring ${activePet.name} to ${newTotal} of ${targetCal} kcal (${Math.round((newTotal / targetCal) * 100)}%). After this, only light treats are recommended.`,
        [
          { text: 'Cancel', style: 'cancel' },
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

      // Update context store with new calorie total
      const newCalTotal = (existingLog?.calories_consumed || 0) + totalCalories;
      usePetContextStore.getState().updateCalories(newCalTotal);

      // Build success message — with dinner reduction guidance for treats
      const targetCal = activePet.target_daily_calories || 0;
      const treatKcal = totalCalories;
      const dinnerReduction = isTreat && targetCal > 0
        ? `\n\n🍽 Vet tip: Reduce tonight's dinner by ~${treatKcal} kcal (about ${Math.max(1, Math.round(treatKcal / 30))} tablespoon${treatKcal >= 60 ? 's' : ''} less kibble) to keep ${activePet.name} on target.`
        : '';

      Alert.alert(
        isTreat ? 'Treat Logged 🦴' : 'Logged Successfully! 🎉',
        `${treatKcal} kcal from ${sr.food_name}${sCount > 1 ? ` (${sCount} servings)` : ''} has been added to ${activePet.name}'s daily tracker.${dinnerReduction}`,
        [{ text: 'OK', onPress: () => { setCapturedImage(null); setScanResult(null); setServingCount(1); } }]
      );

      // Award coins for food log
      if (user?.id) {
        awardCoins(user.id, 'food_log');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      Alert.alert('Log Error', message);
    } finally {
      setIsLogging(false);
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

    return (
      <View style={[styles.container, { backgroundColor: '#FFFFFF' }]}>
        {/* Scan Result Top Bar */}
        <View style={[styles.srHeader, { paddingTop: insets.top + 12 }]}>
          <View style={styles.srHeaderLeft}>
            <TouchableOpacity style={styles.srBackBtn} onPress={() => { setScanResult(null); }} activeOpacity={0.7}>
              <MaterialIcons name="arrow-back" size={24} color="#041015" />
            </TouchableOpacity>
            <Text style={styles.srHeaderTitle}>Scan Result</Text>
          </View>
          <TouchableOpacity activeOpacity={0.7}>
            <MaterialIcons name="more-horiz" size={24} color="#041015" />
          </TouchableOpacity>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.srScrollContent} showsVerticalScrollIndicator={false}>
          {/* Hero Image */}
          <View style={styles.srHeroContainer}>
            {capturedImage ? (
              <Image source={{ uri: capturedImage }} style={styles.srHeroImage} />
            ) : (
              <View style={[styles.srHeroImage, { backgroundColor: '#e5e7eb', justifyContent: 'center', alignItems: 'center' }]}>
                <MaterialIcons name="restaurant" size={64} color="#94a3b8" />
              </View>
            )}
            <LinearGradient colors={['transparent', 'rgba(0,0,0,0.4)']} style={styles.srHeroGradient} />
            <View style={styles.srNutritionBadge}>
              <MaterialIcons name="eco" size={14} color="#FFFFFF" />
              <Text style={styles.srNutritionBadgeText}>Nutrition</Text>
            </View>
          </View>

          {/* Result Card */}
          <View style={styles.srResultCard}>
            <View style={styles.srAccentLine} />
            <View style={styles.srFoodHeader}>
              <Text style={styles.srFoodName}>{scanResult.food_name}</Text>
            </View>

            {/* Serving Count Adjuster */}
            <View style={styles.srServingRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.srServingLabel}>Portion</Text>
                {scanResult.serving_size && (
                  <Text style={[styles.srServingHint, { marginTop: 2 }]} numberOfLines={1}>
                    1 serving = {scanResult.serving_size}
                  </Text>
                )}
              </View>
              <View style={styles.srServingStepper}>
                <TouchableOpacity
                  style={[styles.srServingBtn, servingCount <= 0.5 && { opacity: 0.3 }]}
                  onPress={() => setServingCount(Math.max(0.5, servingCount - 0.5))}
                  disabled={servingCount <= 0.5}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="remove" size={18} color="#041015" />
                </TouchableOpacity>
                <Text style={styles.srServingValue}>{servingCount % 1 === 0 ? servingCount : servingCount.toFixed(1)}</Text>
                <TouchableOpacity
                  style={styles.srServingBtn}
                  onPress={() => setServingCount(servingCount + 0.5)}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="add" size={18} color="#041015" />
                </TouchableOpacity>
              </View>
            </View>
            {servingCount !== 1 && (
              <Text style={styles.srServingHint}>
                {scanResult.calories_per_serving} kcal/serving × {servingCount % 1 === 0 ? servingCount : servingCount.toFixed(1)} = {displayCalories} kcal total
              </Text>
            )}

            {/* Health Score */}
            <View style={styles.srHealthScoreCard}>
              <View style={styles.srHealthScoreHeader}>
                <Text style={styles.srHealthScoreLabel}>Health Score</Text>
                <Text style={styles.srHealthScoreValue}>{healthScore}/10</Text>
              </View>
              <View style={styles.srProgressBarBg}>
                <View style={[styles.srProgressBarFill, { width: `${healthScore * 10}%` }]} />
              </View>
              <Text style={styles.srHealthScoreDesc}>
                {scanResult.verdict ?? scanResult.recommendation}
              </Text>
            </View>

            {/* Daily Budget Card — connects this meal to the pet's weight journey */}
            {(() => {
              const ctxStore = usePetContextStore.getState();
              const budgetTarget = activePet?.target_daily_calories ?? 0;
              const consumed = ctxStore.todayCalories ?? 0;
              const remaining = budgetTarget - consumed;
              const afterMeal = remaining - displayCalories;
              const pctUsed = budgetTarget > 0 ? Math.round((consumed / budgetTarget) * 100) : 0;
              const mealPct = budgetTarget > 0 ? Math.round((displayCalories / budgetTarget) * 100) : 0;
              const currentW = activePet?.current_weight_kg ?? 0;
              const targetW = activePet?.target_weight_kg ?? null;
              const wGap = targetW ? Math.abs(currentW - targetW) : 0;
              const wGoal = targetW && targetW < currentW - 0.5 ? 'lose' : targetW && targetW > currentW + 0.5 ? 'gain' : 'maintain';
              const trendDir = ctxStore.weightTrend?.direction ?? null;
              const trendArrow = trendDir === 'down' ? '↘' : trendDir === 'up' ? '↗' : '→';

              if (budgetTarget <= 0) return null;

              return (
                <View style={styles.srBudgetCard}>
                  <View style={styles.srBudgetHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <MaterialIcons name="pie-chart" size={16} color="rgba(255,255,255,0.7)" />
                      <Text style={styles.srBudgetTitle}>Daily Budget</Text>
                    </View>
                    <Text style={styles.srBudgetPct}>{pctUsed}%</Text>
                  </View>

                  {/* Progress bar */}
                  <View style={styles.srBudgetBarBg}>
                    <View style={[styles.srBudgetBarFill, {
                      width: `${Math.min(pctUsed, 100)}%`,
                      backgroundColor: pctUsed >= 100 ? '#ef4444' : pctUsed >= 80 ? '#f59e0b' : '#22c55e',
                    }]} />
                  </View>
                  <Text style={styles.srBudgetConsumed}>
                    {consumed} / {budgetTarget} kcal consumed today
                  </Text>

                  {/* This meal's impact */}
                  <View style={styles.srBudgetDivider} />
                  <View style={styles.srBudgetRow}>
                    <Text style={styles.srBudgetRowLabel}>This meal</Text>
                    <Text style={styles.srBudgetRowValue}>+{displayCalories} kcal ({mealPct}%)</Text>
                  </View>
                  <View style={styles.srBudgetRow}>
                    <Text style={styles.srBudgetRowLabel}>After logging</Text>
                    <Text style={[styles.srBudgetRowValue, afterMeal < 0 && { color: '#ef4444' }]}>
                      {afterMeal >= 0 ? `${afterMeal} kcal remaining` : `${Math.abs(afterMeal)} kcal over`}
                    </Text>
                  </View>

                  {/* Weight goal context */}
                  {wGoal !== 'maintain' && wGap > 0 && (
                    <View style={styles.srBudgetWeightRow}>
                      <MaterialIcons name="fitness-center" size={14} color="rgba(255,255,255,0.5)" />
                      <Text style={styles.srBudgetWeightText}>
                        {activePet?.name} needs to {wGoal} {wGap.toFixed(1)} kg {trendDir ? `${trendArrow} ${trendDir === 'down' && wGoal === 'lose' ? 'on track' : trendDir === 'up' && wGoal === 'lose' ? 'needs attention' : ''}` : ''}
                      </Text>
                    </View>
                  )}
                </View>
              );
            })()}

            {/* Allergy Warnings */}
            {scanResult.is_allergy_trigger && scanResult.allergy_warnings?.length > 0 && (
              <View style={styles.warningCard}>
                <MaterialIcons name="error" size={20} color="#dc2626" />
                <Text style={styles.warningText}>{scanResult.allergy_warnings.join('. ')}</Text>
              </View>
            )}

            {/* Nutrition Grid */}
            <View style={styles.srNutritionGrid}>
              <View style={styles.srNutritionItem}>
                <MaterialIcons name="local-fire-department" size={28} color="#FFFC00" />
                <Text style={styles.srNutritionValue}>{displayCalories}</Text>
                <Text style={styles.srNutritionLabel}>CALORIES</Text>
              </View>
              <View style={styles.srNutritionItem}>
                <MaterialIcons name="egg-alt" size={28} color="#FFFC00" />
                <Text style={styles.srNutritionValue}>{proteinG}g</Text>
                <Text style={styles.srNutritionLabel}>PROTEIN</Text>
              </View>
              <View style={styles.srNutritionItem}>
                <MaterialIcons name="grass" size={28} color="#FFFC00" />
                <Text style={styles.srNutritionValue}>{carbsG}g</Text>
                <Text style={styles.srNutritionLabel}>CARBS</Text>
              </View>
              <View style={styles.srNutritionItem}>
                <MaterialIcons name="opacity" size={28} color="#FFFC00" />
                <Text style={styles.srNutritionValue}>{fatG}g</Text>
                <Text style={styles.srNutritionLabel}>FATS</Text>
              </View>
            </View>

            {/* Nutrition Reference (AAFCO + clinical adjustments) — same panel
                as Scan Details, computed at scan time so preview and history match */}
            {scanResult.food_analysis && (
              <NutritionReferencePanel
                foodAnalysis={scanResult.food_analysis}
                mealKcalOverride={displayCalories}
              />
            )}

            {/* Ingredients */}
            {ingredientsList.length > 0 && (
              <View style={styles.srIngredientsSection}>
                <Text style={styles.srIngredientsTitle}>Ingredients</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.srIngredientsScroll}>
                  {ingredientsList.map((item, idx) => (
                    <View key={idx} style={styles.srIngredientChip}>
                      <Text style={styles.srIngredientText}>{item}</Text>
                    </View>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Confidence */}
            <View style={styles.srConfidenceRow}>
              <Text style={styles.srConfidenceLabel}>AI Confidence:</Text>
              <Text style={[styles.srConfidenceValue, { color: scanResult.confidence > 0.7 ? '#4ade80' : '#fbbf24' }]}>
                {Math.round(scanResult.confidence * 100)}%
              </Text>
            </View>
          </View>

          {/* Add to Bowl — at end of scrollable content */}
          <View style={styles.srBottomBar}>
            <TouchableOpacity
              style={[styles.srAddBtn, { opacity: isLogging ? 0.7 : 1 }]}
              activeOpacity={0.9}
              onPress={() => confirmLog()}
              disabled={isLogging}
            >
              {isLogging ? (
                <ActivityIndicator color="#041015" />
              ) : (
                <Text style={styles.srAddBtnText}>Add to Bowl</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: '#FFFFFF' }]}>

      {/* Top Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>Food Scanner</Text>
        </View>
        <View style={[styles.coinPill, { backgroundColor: '#f9fafb', borderColor: '#e5e7eb' }]}>
          <MaterialIcons name="generating-tokens" size={18} color="#755700" />
          <Text style={styles.coinText}>{pawCoins.toLocaleString()}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* Psychological Weight Goal Nudge */}
        {(() => {
          if (!activePet) return null;
          const targetW = activePet.target_weight_kg || activePet.current_weight_kg || 10;
          const currentW = activePet.current_weight_kg || 10;
          const gap = currentW - targetW;

          if (gap > 0.5) {
            return (
              <View style={[styles.warningCard, { marginHorizontal: 24, marginBottom: 16, marginTop: 8 }]}>
                <MaterialIcons name="monitor-weight" size={20} color="#dc2626" />
                <Text style={styles.warningText}>
                  {activePet.name} is {gap.toFixed(1)}kg above their {targetW}kg goal. Keep portions strict!
                </Text>
              </View>
            );
          } else if (gap < -0.5) {
            return (
              <View style={[styles.warningCard, { marginHorizontal: 24, marginBottom: 16, marginTop: 8, backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' }]}>
                <MaterialIcons name="monitor-weight" size={20} color="#16a34a" />
                <Text style={[styles.warningText, { color: '#14532d' }]}>
                  {activePet.name} is {Math.abs(gap).toFixed(1)}kg below their {targetW}kg goal.
                </Text>
              </View>
            );
          }
          return null;
        })()}


        {/* AI Scanner Viewport */}
        <View style={[styles.scannerContainer, { backgroundColor: '#0f172a' }]}>
          {capturedImage ? (
            <Image source={{ uri: capturedImage }} style={styles.scannerImg} />
          ) : (
            <View style={styles.scannerPlaceholder}>
              <MaterialIcons name="photo-camera" size={64} color="rgba(255,255,255,0.3)" />
              <Text style={styles.scannerPlaceholderText}>Tap below to scan a food label</Text>
            </View>
          )}

          {/* Scanner Action Buttons */}
          <View style={styles.scannerActions}>
            <TouchableOpacity
              style={[styles.scanActionBtn, { backgroundColor: 'rgba(255,255,255,0.15)' }]}
              onPress={() => pickImage(false)}
              disabled={isAnalyzing}
            >
              <MaterialIcons name="photo-library" size={24} color="#FFFFFF" />
              <Text style={styles.scanActionText}>Gallery</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.scanActionBtnMain, { backgroundColor: '#FFFC00' }]}
              onPress={() => pickImage(true)}
              disabled={isAnalyzing}
            >
              <MaterialIcons name="photo-camera" size={32} color="#000000" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.scanActionBtn, { backgroundColor: 'rgba(255,255,255,0.15)' }]}
              onPress={() => { setCapturedImage(null); setScanResult(null); }}
              disabled={isAnalyzing}
            >
              <MaterialIcons name="refresh" size={24} color="#FFFFFF" />
              <Text style={styles.scanActionText}>Reset</Text>
            </TouchableOpacity>
          </View>

          {/* Analyzing Full Overlay — blocks all interaction during AI processing */}
          {isAnalyzing && (
            <View style={styles.analyzingOverlay} pointerEvents="box-only">
              <View style={styles.analyzingSpinnerRing}>
                <ActivityIndicator size="large" color="#041015" />
              </View>
              <View style={styles.analyzingLabelBox}>
                <MaterialIcons name="auto-awesome" size={16} color="#041015" />
                <Text style={styles.analyzingText}>{loadingMessage}</Text>
              </View>
              <Text style={styles.analyzingSubText}>Please wait while we analyse your pet&apos;s food</Text>
            </View>
          )}
        </View>

        {/* Context Zone: Pantry Nudge OR Pills */}
        <View style={styles.contextZone}>
          {foodPantry.length === 0 && showPantryNudge && activePet ? (
            <EmptyPantryNudge
              petId={activePet.id}
              petName={activePet.name}
              petAvatarUrl={(activePet as any).current_avatar_url}
              onUpdatePantry={() => router.push('/(tabs)/profile')}
              onDismiss={() => setShowPantryNudge(false)}
            />
          ) : (
            foodPantry.length > 0 && (
              <PantryPillSelector
                pantryItems={foodPantry}
                selectedId={selectedPantryId}
                onSelect={setSelectedPantryId}
                onAddNew={() => router.push('/(tabs)/profile')}
              />
            )
          )}
        </View>

        {/* Quick Log — replaces "Recent Scans". Tap a chip to land on the same
            result screen as a scan, pre-populated from pantry data. */}
        <QuickLogRail
          pantryItems={foodPantry}
          onLog={handleQuickLog}
          isBusy={isAnalyzing || isLogging}
        />

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
    zIndex: 50,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontSize: 28,
    letterSpacing: -0.5,
    color: '#2e2f2d',
  },
  coinPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  coinText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 14,
    color: '#2e2f2d',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 100,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  searchIcon: {
    position: 'absolute',
    left: 20,
    zIndex: 10,
  },
  searchInput: {
    flex: 1,
    height: 56,
    borderRadius: 16,
    borderWidth: 1,
    paddingLeft: 56,
    paddingRight: 24,
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 16,
  },
  scannerContainer: {
    width: '100%',
    minHeight: 280,
    borderRadius: 24,
    overflow: 'hidden',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  scannerImg: {
    width: '100%',
    height: 280,
  },
  scannerPlaceholder: {
    width: '100%',
    height: 280,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  contextZone: {
    marginBottom: 24,
    marginTop: 8,
  },
  scannerPlaceholderText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '600',
    fontSize: 16,
    color: 'rgba(255,255,255,0.4)',
  },
  analyzingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FFFC00',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
    zIndex: 100,
    borderRadius: 24,
  },
  analyzingSpinnerRing: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(4,16,21,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  analyzingLabelBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  analyzingText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontSize: 14,
    letterSpacing: 1.5,
    color: '#041015',
  },
  analyzingSubText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '500',
    fontSize: 13,
    color: '#041015',
    opacity: 0.65,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  scannerActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 24,
    paddingVertical: 20,
    paddingHorizontal: 24,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  scanActionBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 16,
    gap: 4,
  },
  scanActionText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 11,
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  scanActionBtnMain: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#FFFC00',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  resultCard: {
    margin: 16,
    padding: 24,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 8,
  },
  estHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  estLabel: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 2,
    color: '#94a3b8',
  },
  estValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  estValue: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontSize: 36,
    color: '#0f172a',
  },
  estUnit: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 18,
    marginLeft: 4,
    color: '#64748b',
  },
  estIconBg: {
    padding: 10,
    borderRadius: 20,
  },
  estDesc: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 16,
    color: '#334155',
    marginBottom: 12,
  },
  warningCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#fef2f2',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  warningText: {
    flex: 1,
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '600',
    fontSize: 13,
    color: '#991b1b',
    lineHeight: 18,
  },
  recommendationText: {
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 14,
    color: '#64748b',
    marginBottom: 12,
    lineHeight: 20,
  },
  confidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  confidenceLabel: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '600',
    fontSize: 12,
    color: '#94a3b8',
  },
  confidenceValue: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 14,
  },
  confirmBtn: {
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  confirmBtnGradient: {
    width: '100%',
    paddingVertical: 18,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontSize: 14,
    letterSpacing: 2,
    color: '#000000',
  },
  bentoGrid: {
    gap: 16,
    marginBottom: 32,
  },
  bentoFull: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
  },
  bentoLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  bentoIconBg: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bentoTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 18,
  },
  bentoSub: {
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 14,
  },
  bentoRow: {
    flexDirection: 'row',
    gap: 16,
  },
  bentoHalf: {
    flex: 1,
    aspectRatio: 1,
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: 'space-between',
  },
  bentoSubSmall: {
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 12,
    marginTop: 4,
  },
  // ── Scan Result (sr*) styles ──
  srHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 24,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
    zIndex: 50,
  },
  srHeaderLeft: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 16,
  },
  srBackBtn: {
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  srHeaderTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700' as const,
    fontSize: 28,
    letterSpacing: -0.5,
    color: '#041015',
  },
  srScrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 32,
  },
  srHeroContainer: {
    width: '100%' as const,
    aspectRatio: 1,
    borderRadius: 40,
    overflow: 'hidden' as const,
    marginBottom: 24,
    position: 'relative' as const,
  },
  srHeroImage: {
    width: '100%' as const,
    height: '100%' as const,
  },
  srHeroGradient: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    bottom: 0,
    height: '50%' as const,
  },
  srNutritionBadge: {
    position: 'absolute' as const,
    top: 20,
    right: 20,
    backgroundColor: '#041015',
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 40,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  srNutritionBadgeText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700' as const,
    fontSize: 14,
    color: '#FFFFFF',
  },
  srResultCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 40,
    padding: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.04,
    shadowRadius: 40,
    elevation: 4,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.04)',
    overflow: 'hidden' as const,
    position: 'relative' as const,
  },
  srAccentLine: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    height: 6,
    backgroundColor: '#FFFC00',
  },
  srFoodHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'flex-start' as const,
    marginBottom: 20,
    marginTop: 8,
  },
  srFoodName: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800' as const,
    fontSize: 28,
    letterSpacing: -0.5,
    lineHeight: 34,
    color: '#041015',
    flex: 1,
    marginRight: 16,
  },
  srServingRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    backgroundColor: '#f8fafc',
    borderRadius: 20,
    padding: 14,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  srServingLabel: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700' as const,
    fontSize: 15,
    color: '#64748b',
  },
  srServingStepper: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 4,
  },
  srServingBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#FFFC00',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  srServingValue: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900' as const,
    fontSize: 20,
    color: '#041015',
    minWidth: 40,
    textAlign: 'center' as const,
  },
  srServingHint: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '600' as const,
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'center' as const,
    marginBottom: 16,
  },
  srHealthScoreCard: {
    backgroundColor: '#041015',
    borderRadius: 32,
    padding: 24,
    marginBottom: 20,
  },
  srHealthScoreHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'flex-end' as const,
    marginBottom: 12,
  },
  srHealthScoreLabel: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700' as const,
    fontSize: 16,
    color: 'rgba(255,255,255,0.6)',
  },
  srHealthScoreValue: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800' as const,
    fontSize: 28,
    color: '#FFFC00',
  },
  srProgressBarBg: {
    width: '100%' as const,
    height: 12,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 8,
    overflow: 'hidden' as const,
  },
  srProgressBarFill: {
    height: '100%' as const,
    borderRadius: 8,
    backgroundColor: '#FFFC00',
  },
  srHealthScoreDesc: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '500' as const,
    fontSize: 14,
    color: 'rgba(255,255,255,0.6)',
    lineHeight: 20,
    marginTop: 14,
  },
  srBudgetCard: {
    backgroundColor: '#041015',
    borderRadius: 32,
    padding: 24,
    marginBottom: 20,
  },
  srBudgetHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: 12,
  },
  srBudgetTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700' as const,
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
  },
  srBudgetPct: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800' as const,
    fontSize: 20,
    color: '#FFFC00',
  },
  srBudgetBarBg: {
    width: '100%' as const,
    height: 10,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 6,
    overflow: 'hidden' as const,
    marginBottom: 8,
  },
  srBudgetBarFill: {
    height: '100%' as const,
    borderRadius: 6,
  },
  srBudgetConsumed: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '500' as const,
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    marginBottom: 4,
  },
  srBudgetDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginVertical: 12,
  },
  srBudgetRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: 6,
  },
  srBudgetRowLabel: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '600' as const,
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
  },
  srBudgetRowValue: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700' as const,
    fontSize: 13,
    color: '#FFFFFF',
  },
  srBudgetWeightRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  srBudgetWeightText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '600' as const,
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    flex: 1,
  },
  srNutritionGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 12,
    marginBottom: 24,
  },
  srNutritionItem: {
    width: '47%' as const,
    backgroundColor: '#041015',
    borderRadius: 32,
    padding: 22,
    gap: 6,
  },
  srNutritionValue: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800' as const,
    fontSize: 24,
    color: '#FFFFFF',
  },
  srNutritionLabel: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700' as const,
    fontSize: 10,
    letterSpacing: 2,
    color: 'rgba(255,255,255,0.5)',
  },
  srIngredientsSection: {
    marginBottom: 20,
  },
  srIngredientsTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800' as const,
    fontSize: 18,
    color: '#041015',
    marginBottom: 14,
    paddingHorizontal: 4,
  },
  srIngredientsScroll: {
    gap: 10,
    paddingBottom: 8,
  },
  srIngredientChip: {
    backgroundColor: '#041015',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 40,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  srIngredientText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700' as const,
    fontSize: 14,
    color: '#FFFFFF',
  },
  srConfidenceRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginTop: 4,
  },
  srConfidenceLabel: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '600' as const,
    fontSize: 13,
    color: 'rgba(4,16,21,0.5)',
  },
  srConfidenceValue: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800' as const,
    fontSize: 15,
  },
  srBottomBar: {
    marginTop: 24,
    paddingHorizontal: 24,
    paddingTop: 4,
    paddingBottom: 32,
  },
  srAddBtn: {
    width: '100%' as const,
    backgroundColor: '#FFFC00',
    paddingVertical: 20,
    borderRadius: 40,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    shadowColor: '#FFFC00',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 8,
  },
  srAddBtnText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700' as const,
    fontSize: 17,
    color: '#041015',
  },

});
