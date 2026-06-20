import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, TextInput, ActivityIndicator,
  KeyboardAvoidingView, Platform, TouchableWithoutFeedback, Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import Svg, { Path, Defs, LinearGradient as SvgLinearGradient, Stop, Circle } from 'react-native-svg';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { PawtchiModal, PawtchiSuccessModal } from '../../components/PawtchiModal';
import { PawtchiButton } from '../../components/PawtchiButton';
import * as ImagePicker from 'expo-image-picker';

import { color, font, radius, shadow, space } from '../../constants/design';
import { useActivePetStore } from '../../store/useActivePetStore';
import { useStreakStore } from '../../store/useStreakStore';
import { usePetContextStore, computeDerived } from '../../store/usePetContextStore';
import { useAuth } from '../../providers/AuthProvider';
import { useSubscription } from '../../hooks/useSubscription';
import { supabase } from '../../lib/supabase';
import { calculateDailyKcal, deriveGoal } from '../../lib/healthMath';
import { regenerateSchedule } from '../../lib/scheduleAdjuster';
import { getReportFreshness } from '../../lib/vetReportFreshness';
import WeeklyNutritionChart, { DayMacro } from '../../components/WeeklyNutritionChart';

function getLocalYMD(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Health — one continuous canvas, not a stack of boxes.
// A full-bleed navy canopy carries the weight story; a light sheet rises over
// it (the seam holds the floating yellow action). Below, metrics live as
// typography directly on the ground, history reads as a timeline, and the
// one dark "insight" card mid-scroll is the deliberate rhythm break.

// Minimal 7-day spark bars — no chrome, used inside stat moments.
function SparkBars({
  days,
  accent,
}: {
  days: { value: number; max: number; isToday: boolean; met?: boolean }[];
  accent: string;
}) {
  return (
    <View style={sparkStyles.row}>
      {days.map((d, i) => {
        const h = d.max > 0 ? (d.value / d.max) * 26 : 0;
        return (
          <View
            key={i}
            style={[
              sparkStyles.bar,
              {
                height: Math.max(h, 3),
                backgroundColor: d.isToday ? color.yellow : d.met ? accent : color.track,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const sparkStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 5,
    height: 26,
  },
  bar: { flex: 1, borderRadius: 3 },
});

export default function HealthScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const activePet = useActivePetStore(s => s.activePet);
  const awardCoins = useStreakStore(s => s.awardCoins);
  const { user } = useAuth();
  const { hasFullAccess } = useSubscription();

  // Standard premium-feature gate — mirrors activity.tsx / meal.tsx / profile.tsx.
  // Returns true when the action may proceed, otherwise opens the paywall.
  const checkAccess = () => {
    if (!hasFullAccess) {
      router.push('/paywall' as any);
      return false;
    }
    return true;
  };

  // Pull rolling weekly balance from central store (computed in refreshTrends)
  const weeklyDelta = usePetContextStore((s) => s.weeklyDelta);
  const weeklyTarget = usePetContextStore((s) => s.weeklyTarget);

  // Live data states
  const [weightLogs, setWeightLogs] = useState<any[]>([]);
  const [activityScore, setActivityScore] = useState<{ thisWeek: number; lastWeek: number } | null>(null);
  const [hydrationScore, setHydrationScore] = useState<{ avgMl: number; targetMl: number } | null>(null);
  const [recentAllergyScans, setRecentAllergyScans] = useState<any[]>([]);
  const [healthInsight, setHealthInsight] = useState<any>(null);
  const [weeklyMacros, setWeeklyMacros] = useState<DayMacro[]>([]);
  const [weeklyActivity, setWeeklyActivity] = useState<{ day: string; minutes: number; isToday: boolean }[]>([]);
  const [weeklyHydration, setWeeklyHydration] = useState<{ day: string; ml: number; targetMl: number; isToday: boolean }[]>([]);

  // Weight log modal
  const [showWeightModal, setShowWeightModal] = useState(false);
  const [weightInput, setWeightInput] = useState('');
  const [weightNotes, setWeightNotes] = useState('');
  const [isSavingWeight, setIsSavingWeight] = useState(false);

  // Insight generation
  const [isGeneratingInsight, setIsGeneratingInsight] = useState(false);

  // Branded weight log success modal
  const [showWeightSuccess, setShowWeightSuccess] = useState(false);
  const [weightSuccessData, setWeightSuccessData] = useState<{
    weight: number;
    prevCalories: number;
    newCalories: number;
    calorieDiff: number | null;
    weightDiff: number | null;
    scheduleRegenerated: boolean;
    goal: string;
  } | null>(null);

  // Branded vet scan success/error modals
  const [showVetScanSuccess, setShowVetScanSuccess] = useState(false);
  const [vetScanSummary, setVetScanSummary] = useState('');
  const [showVetScanError, setShowVetScanError] = useState(false);
  const [vetScanErrorMsg, setVetScanErrorMsg] = useState('');

  // Vet scan states
  const [isScanning, setIsScanning] = useState(false);
  const [vetReports, setVetReports] = useState<any[]>([]);

  // Freshness guard so refocusing Health doesn't re-run the whole batch every time.
  const healthFetchedAtRef = useRef(0);
  const healthFetchedPetRef = useRef<string | null>(null);
  const HEALTH_STALE_MS = 30_000;

  const fetchHealthData = useCallback(async (opts?: { force?: boolean }) => {
    if (!activePet) return;
    if (
      !opts?.force &&
      healthFetchedPetRef.current === activePet.id &&
      (Date.now() - healthFetchedAtRef.current) < HEALTH_STALE_MS
    ) {
      return;
    }

    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const fourteenDaysAgo = new Date(today);
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const todayStr = today.toISOString().split('T')[0];
    const sevenStr = sevenDaysAgo.toISOString().split('T')[0];
    const fourteenStr = fourteenDaysAgo.toISOString().split('T')[0];
    const hasAllergies = !!(activePet.allergies && activePet.allergies.length > 0);

    try {
      // All reads are independent → fire them in parallel instead of a serial
      // waterfall, then process + batch the setState calls so the screen paints once.
      const [wLogsRes, scans7Res, actsThisRes, actsLastRes, waterRes, insightRes, allergyRes, vReportsRes] = await Promise.all([
        supabase
          .from('weight_logs')
          .select('*')
          .eq('pet_id', activePet.id)
          .order('logged_at', { ascending: false })
          .limit(6),
        supabase
          .from('food_scans')
          .select('created_at, ai_estimated_calories, protein_g, carbs_g, fat_g')
          .eq('pet_id', activePet.id)
          .gte('created_at', `${sevenStr}T00:00:00`),
        supabase
          .from('activities')
          .select('duration_minutes, scheduled_date')
          .eq('pet_id', activePet.id)
          .eq('status', 'completed')
          .in('activity_type', ['walk', 'play', 'training'])
          .gte('scheduled_date', sevenStr)
          .lte('scheduled_date', todayStr),
        supabase
          .from('activities')
          .select('duration_minutes')
          .eq('pet_id', activePet.id)
          .eq('status', 'completed')
          .in('activity_type', ['walk', 'play', 'training'])
          .gte('scheduled_date', fourteenStr)
          .lt('scheduled_date', sevenStr),
        supabase
          .from('daily_logs')
          .select('water_ml, log_date')
          .eq('pet_id', activePet.id)
          .gte('log_date', sevenStr)
          .lte('log_date', todayStr),
        supabase
          .from('health_insights')
          .select('*')
          .eq('pet_id', activePet.id)
          .order('generated_at', { ascending: false })
          .limit(1)
          .single(),
        hasAllergies
          ? supabase
              .from('food_scans')
              .select('*')
              .eq('pet_id', activePet.id)
              .order('created_at', { ascending: false })
              .limit(20)
          : Promise.resolve({ data: null as any }),
        supabase
          .from('vet_reports')
          .select('*')
          .eq('pet_id', activePet.id)
          .order('report_date', { ascending: false })
          .limit(5),
      ]);

      // 2. Weekly Macros (Last 7 days of food_scans)
      const scans7 = scans7Res.data;
      const daysArr: DayMacro[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        daysArr.push({
          date: dateStr,
          dayLabel: d.toLocaleDateString('en-US', { weekday: 'narrow' }),
          calories: 0,
          protein: 0,
          carbs: 0,
          fat: 0,
          isToday: i === 0
        });
      }

      (scans7 || []).forEach(scan => {
        const scanDate = new Date(scan.created_at).toISOString().split('T')[0];
        const dayIdx = daysArr.findIndex(d => d.date === scanDate);
        if (dayIdx >= 0) {
          daysArr[dayIdx].calories += (scan.ai_estimated_calories || 0);
          daysArr[dayIdx].protein += (scan.protein_g || 0);
          daysArr[dayIdx].carbs += (scan.carbs_g || 0);
          daysArr[dayIdx].fat += (scan.fat_g || 0);
        }
      });

      // 3. Activity Score: last 7 vs previous 7 days
      const actsThisWeek = actsThisRes.data;
      const actsLastWeek = actsLastRes.data;
      const thisWeekMins = (actsThisWeek || []).reduce((s, a) => s + (a.duration_minutes || 0), 0);
      const lastWeekMins = (actsLastWeek || []).reduce((s, a) => s + (a.duration_minutes || 0), 0);

      const actDaysArr: { day: string; minutes: number; isToday: boolean }[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        const dayActs = (actsThisWeek || []).filter((a: any) => a.scheduled_date === dateStr);
        const dayMins = dayActs.reduce((s: number, a: any) => s + (a.duration_minutes || 0), 0);
        actDaysArr.push({
          day: d.toLocaleDateString('en-US', { weekday: 'narrow' }),
          minutes: dayMins,
          isToday: i === 0,
        });
      }

      // 4. Hydration: last 7 days average vs target (~50ml/kg)
      const waterLogs = waterRes.data;
      const totalWater = (waterLogs || []).reduce((s, l) => s + (l.water_ml || 0), 0);
      const daysWithData = (waterLogs || []).filter(l => l.water_ml > 0).length || 1;
      const avgMl = Math.round(totalWater / daysWithData);
      const targetMl = Math.round((activePet.current_weight_kg || 10) * 50);

      const hydDaysArr: { day: string; ml: number; targetMl: number; isToday: boolean }[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        const dayLog = (waterLogs || []).find((l: any) => l.log_date === dateStr);
        hydDaysArr.push({
          day: d.toLocaleDateString('en-US', { weekday: 'narrow' }),
          ml: dayLog?.water_ml || 0,
          targetMl,
          isToday: i === 0,
        });
      }

      // 6. Allergy flagged scans — only when the pet has known allergies.
      let flagged: any[] | null = null;
      if (hasAllergies) {
        flagged = (allergyRes.data || []).filter((scan: any) => {
          const food = (scan.ai_identified_food || '').toLowerCase();
          return activePet.allergies!.some(a => food.includes(a.toLowerCase()));
        }).slice(0, 3);
      }

      // Batch all state updates together so the screen paints in one pass.
      setWeightLogs(wLogsRes.data || []);
      setWeeklyMacros(daysArr);
      setActivityScore({ thisWeek: thisWeekMins, lastWeek: lastWeekMins });
      setWeeklyActivity(actDaysArr);
      setHydrationScore({ avgMl, targetMl });
      setWeeklyHydration(hydDaysArr);
      setHealthInsight(insightRes.data || null);
      if (flagged) setRecentAllergyScans(flagged);
      setVetReports(vReportsRes.data || []);

      healthFetchedAtRef.current = Date.now();
      healthFetchedPetRef.current = activePet.id;
    } catch (e) {
      console.error('Health data error:', e);
    }
  }, [activePet]);

  // The canopy is navy and sits behind the status bar — flip its icons to
  // light while this tab is focused, and back when leaving.
  useFocusEffect(
    useCallback(() => {
      fetchHealthData();
      // Canopy is yellow now — dark status bar icons read against it.
      setStatusBarStyle('dark');
    }, [fetchHealthData])
  );

  // Scan Vet Report
  const scanVetReport = async () => {
    if (!checkAccess()) return;
    if (!activePet) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      base64: true,
    });

    if (result.canceled || !result.assets?.[0]?.base64) return;

    setIsScanning(true);
    try {
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch(`${supabaseUrl}/functions/v1/scan-vet-report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          imageBase64: result.assets[0].base64,
          mimeType: 'image/jpeg',
          petId: activePet.id,
          petProfile: activePet,
        }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Scan failed.');

      const ext = data.extracted_data;
      let summary = 'Report processed.\n';
      if (ext.weight_kg) summary += `\nWeight: ${ext.weight_kg} kg`;
      if (ext.body_condition_score) summary += `\nBCS: ${ext.body_condition_score}/9`;
      if (ext.diagnoses?.length) summary += `\nDiagnoses: ${ext.diagnoses.join(', ')}`;
      if (ext.allergies?.length) summary += `\nAllergies: ${ext.allergies.join(', ')}`;
      if (ext.medications?.length) summary += `\nMedications: ${ext.medications.map((m: any) => m.name).join(', ')}`;
      if (ext.next_appointment) summary += `\nNext visit: ${ext.next_appointment}`;

      // Force a global refresh of the pet profile so new conditions/allergies sync to the Clinical Profile and Intelligent Layer instantly
      if (user?.id) {
        await useActivePetStore.getState().fetchPet(user.id, { silent: true });
      }
      if (activePet.id) {
        // Explicit post-write refresh — bypass the staleness guard.
        usePetContextStore.getState().refreshTrends(activePet.id, { force: true });
        usePetContextStore.getState().refreshToday(activePet.id, { force: true });
      }
      // Refresh this screen's own lists (vet reports, weight) past the guard.
      fetchHealthData({ force: true });

      setVetScanSummary(summary);
      setShowVetScanSuccess(true);
    } catch (e: any) {
      setVetScanErrorMsg(e?.message || 'Scan failed.');
      setShowVetScanError(true);
    } finally {
      setIsScanning(false);
    }
  };

  // Generate health insight
  const generateHealthInsight = async () => {
    if (!checkAccess()) return;
    if (!activePet) return;
    setIsGeneratingInsight(true);

    try {
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch(`${supabaseUrl}/functions/v1/generate-health-insight`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ petId: activePet.id }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Generation failed.');

      setHealthInsight(data.insight);
    } catch (e: any) {
      setHealthInsight(null);
    } finally {
      setIsGeneratingInsight(false);
    }
  };

  // Save weight log
  const saveWeightLog = async () => {
    const weight = parseFloat(weightInput);
    if (isNaN(weight) || weight <= 0) {
      return;
    }
    if (!activePet) return;
    setIsSavingWeight(true);

    try {
      // Snapshot prior state so we can detect a meaningful change after the log.
      const prevWeight = activePet.current_weight_kg ?? null;
      const prevGoal = deriveGoal(prevWeight ?? weight, activePet.target_weight_kg);
      const prevCalories = activePet.target_daily_calories ?? 0;

      // Recalculate daily calorie target based on new weight
      const goal = deriveGoal(weight, activePet.target_weight_kg);
      const newCalories = calculateDailyKcal(
        weight,
        activePet.species,
        activePet.is_neutered,
        activePet.activity_level,
        goal,
        undefined,
        1.0,
        activePet.target_weight_kg,
      );

      // ---- HOT RELOAD: Optimistic UI update (instant, no flicker) ----
      // Update pet store immediately so home tab and all listeners see new weight + calories
      useActivePetStore.getState().updatePetWeight(weight, newCalories);

      // Persist weight log to DB
      await supabase.from('weight_logs').insert({
        pet_id: activePet.id,
        weight_kg: weight,
        notes: weightNotes || null,
        source: 'manual',
      });

      // Persist pet profile update to DB
      await supabase.from('pets').update({
        current_weight_kg: weight,
        target_daily_calories: newCalories,
      }).eq('id', activePet.id);

      setShowWeightModal(false);
      setWeightInput('');
      setWeightNotes('');

      // Build branded success data
      const weightDiff = prevWeight !== null ? (weight - prevWeight) : null;
      const calorieDiff = prevCalories > 0 && prevCalories !== newCalories
        ? newCalories - prevCalories
        : null;

      // Show branded success modal
      setWeightSuccessData({
        weight,
        prevCalories,
        newCalories,
        calorieDiff,
        weightDiff,
        scheduleRegenerated: false,
        goal,
      });
      setShowWeightSuccess(true);

      // Award coins for weight log
      if (user?.id) {
        awardCoins(user.id, 'weight_log');
      }

      // ---- BACKGROUND SYNC: Update weight logs UI without full refresh ----
      const newLog = {
        id: `temp-${Date.now()}`,
        pet_id: activePet.id,
        weight_kg: weight,
        notes: weightNotes || null,
        logged_at: new Date().toISOString(),
        source: 'manual',
      };
      setWeightLogs(prev => [newLog, ...prev]);

      // Recalculate derived data in context store without triggering loading states
      const ctx = usePetContextStore.getState();
      const todayDataNow = {
        todayCalories: ctx.todayCalories,
        todayWater: ctx.todayWater,
        todayWalks: ctx.todayWalks,
        treatsConsumed: ctx.treatsConsumed,
        treatCaloriesConsumed: ctx.treatCaloriesConsumed,
        todayScans: ctx.todayScans,
        nextActivity: ctx.nextActivity,
        todayActivityMinutes: ctx.todayActivityMinutes,
        activityCompletionRate: ctx.activityCompletionRate,
        todayProtein: ctx.todayProtein,
        todayCarbs: ctx.todayCarbs,
        todayFats: ctx.todayFats,
      };
      const petWithNewWeight = { ...activePet, current_weight_kg: weight, target_daily_calories: newCalories };
      const derived = computeDerived(
        todayDataNow,
        petWithNewWeight,
        ctx.weightTrend,
        ctx.weeklyDelta,
      );
      usePetContextStore.setState({ ...derived });
      // A new weigh-in changes the weight trend / derived target → force the
      // context store to refetch today + trends on the next screen focus.
      usePetContextStore.getState().invalidateContext();

      // ---- SCHEDULE REGENERATION: When weight change is meaningful ----
      // Either ≥0.3kg movement OR the goal direction has flipped (e.g. lose → maintain).
      const weightDeltaKg = prevWeight !== null ? Math.abs(weight - prevWeight) : 0;
      const goalFlipped = prevGoal !== goal;
      let scheduleRegenerated = false;
      if (activePet.id && (weightDeltaKg >= 0.3 || goalFlipped)) {
        const refreshed = useActivePetStore.getState().activePet ?? activePet;
        const result = await regenerateSchedule({
          pet: refreshed,
          weeklyStats: null,
          todayCalPercent: derived.calPercent,
          weightTrendDirection: ctx.weightTrend?.direction ?? null,
        });
        scheduleRegenerated = result.success;

        if (scheduleRegenerated) {
          const newWaterPerSession = Math.round(weight * 50 / 3);
          const todayStr = getLocalYMD(new Date());
          await supabase
            .from('activities')
            .update({ water_ml: newWaterPerSession })
            .eq('pet_id', activePet.id)
            .eq('activity_type', 'water')
            .eq('scheduled_date', todayStr)
            .eq('status', 'pending');

          // Update success data to reflect schedule regeneration
          setWeightSuccessData(prev => prev ? { ...prev, scheduleRegenerated: true } : null);
        }
      }
    } catch (e: any) {
      // Revert optimistic update on failure
      if (user?.id) {
        await useActivePetStore.getState().fetchPet(user.id, { silent: true });
      }
    } finally {
      setIsSavingWeight(false);
    }
  };

  // Computed values
  const currentWeight = weightLogs.length > 0 ? weightLogs[0].weight_kg : null;
  const hasWeightData = currentWeight !== null;
  const weightDelta = weightLogs.length >= 2
    ? (weightLogs[0].weight_kg - weightLogs[weightLogs.length - 1].weight_kg).toFixed(1)
    : null;

  const hydrationPct = hydrationScore
    ? Math.min(Math.round((hydrationScore.avgMl / Math.max(hydrationScore.targetMl, 1)) * 100), 100)
    : 0;

  // Weight goal progress
  const hasWeightGoal = activePet?.target_weight_kg && activePet.target_weight_kg !== activePet.current_weight_kg;
  const weightGoalPct = hasWeightGoal && hasWeightData
    ? Math.min(Math.round(
      Math.abs(1 - (Math.abs((currentWeight ?? activePet!.current_weight_kg!) - activePet!.target_weight_kg!) /
        Math.abs((weightLogs[weightLogs.length - 1]?.weight_kg || activePet!.current_weight_kg) - activePet!.target_weight_kg!))) * 100
    ), 100)
    : 0;

  const petName = activePet?.name || 'your pet';
  const onTrack = weeklyDelta !== null && weeklyTarget !== null && Math.abs(weeklyDelta) < weeklyTarget * 0.05;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* ════ NAVY CANOPY — full bleed, behind the status bar ════ */}
        <View style={[styles.canopy, { paddingTop: insets.top + space.lg }]}>
          <Animated.View entering={FadeInDown.duration(420)}>
            <View style={styles.canopyTopRow}>
              <Text style={styles.canopyEyebrow}>HEALTH</Text>
              {weightDelta !== null && (
                <View style={styles.deltaChip}>
                  <MaterialIcons
                    name={parseFloat(weightDelta) <= 0 ? 'south-east' : 'north-east'}
                    size={11}
                    color={color.cream}
                  />
                  <Text style={styles.deltaChipText}>
                    {parseFloat(weightDelta) > 0 ? '+' : ''}{weightDelta} kg
                  </Text>
                </View>
              )}
            </View>

            {hasWeightData ? (
              <Text style={styles.canopyWeight}>
                {Number(currentWeight).toFixed(1)}
                <Text style={styles.canopyUnit}> KG</Text>
              </Text>
            ) : (
              <Text style={styles.canopyNoData}>NO WEIGHT YET</Text>
            )}
            <Text style={styles.canopySub}>
              {hasWeightGoal
                ? `goal ${Number(activePet?.target_weight_kg || 0).toFixed(1)} kg · ${Math.abs((activePet?.current_weight_kg || 0) - (activePet?.target_weight_kg || 0)).toFixed(1)} kg to go`
                : `${petName}’s weight over time`}
            </Text>

            {hasWeightGoal && (
              <View style={styles.goalTrack}>
                <View style={[styles.goalFill, { width: `${Math.max(weightGoalPct, 4)}%` }]} />
              </View>
            )}
          </Animated.View>

          {/* Trend line bleeds across the canopy */}
          <View style={styles.canopyChart}>
            {hasWeightData ? (
              <>{(() => {
                const logs = [...weightLogs].reverse();
                if (logs.length === 1) logs.push({ ...logs[0] }); // Need at least 2 points
                const maxW = Math.max(...logs.map(l => l.weight_kg));
                const minW = Math.min(...logs.map(l => l.weight_kg));
                const range = maxW - minW || 1;
                const pts = logs.map((log, i) => {
                  const pctX = i / (logs.length - 1);
                  const x = 20 + pctX * 260;
                  const y = 55 - (((log.weight_kg - minW) / range) * 25);
                  const dateObj = new Date(log.logged_at || new Date());
                  const dateStr = `${dateObj.getDate()} ${dateObj.toLocaleString('en-US', { month: 'short' })}`;
                  return { x, y, pctX, weight: log.weight_kg, dateStr };
                });
                const dLine = `M ${pts.map(p => `${p.x},${p.y}`).join(' L ')}`;
                const dFill = `${dLine} L 280,60 L 20,60 Z`;
                return (
                  <>
                    <Svg width="100%" height="80" viewBox="0 0 300 80" preserveAspectRatio="none" style={{ position: 'absolute', top: 0, left: 0 }}>
                      <Defs>
                        <SvgLinearGradient id="weightGrad" x1="0" y1="0" x2="0" y2="1">
                          <Stop offset="0" stopColor={color.navy} stopOpacity="0.18" />
                          <Stop offset="1" stopColor={color.navy} stopOpacity="0" />
                        </SvgLinearGradient>
                      </Defs>
                      <Path d={dFill} fill="url(#weightGrad)" />
                      <Path d={dLine} stroke={color.navy} strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      {pts.map((p, i) => (
                        <Circle
                          key={i}
                          cx={p.x}
                          cy={p.y}
                          r={i === pts.length - 1 ? 5 : 2}
                          fill={color.navy}
                          stroke={i === pts.length - 1 ? color.yellow : 'none'}
                          strokeWidth={i === pts.length - 1 ? 2 : 0}
                        />
                      ))}
                    </Svg>
                    {pts.map((p, i) => (
                      <View
                        key={`label-${i}`}
                        style={{
                          position: 'absolute',
                          left: `${(20 / 300) * 100 + p.pctX * ((260 / 300) * 100)}%`,
                          top: 0,
                          bottom: 0,
                          width: 40,
                          marginLeft: -20,
                          alignItems: 'center'
                        }}
                      >
                        <Text style={[styles.chartWeightLabel, { top: p.y - 18 }]}>
                          {p.weight}
                        </Text>
                        <Text style={styles.chartDateLabel}>
                          {p.dateStr}
                        </Text>
                      </View>
                    ))}
                  </>
                );
              })()}</>
            ) : (
              <View style={styles.canopyChartEmpty}>
                <Text style={styles.canopyChartEmptyText}>
                  Log {petName}&apos;s first weight to start the trend line
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* ════ THE SHEET — rises over the canopy; the seam holds the action ════ */}
        <View style={styles.sheet}>
          <TouchableOpacity
            style={styles.seamAction}
            activeOpacity={0.9}
            onPress={() => {
              const defaultWeight = activePet?.current_weight_kg || undefined;
              setWeightInput(defaultWeight ? String(defaultWeight) : '');
              setShowWeightModal(true);
            }}
          >
            <MaterialIcons name="add" size={16} color={color.navy} />
            <Text style={styles.seamActionText}>Log weight</Text>
          </TouchableOpacity>

          {/* ─── This week — two stat moments, typography on the ground ─── */}
          <Animated.View entering={FadeInDown.duration(420).delay(60)}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionLabel}>THIS WEEK</Text>
              <View style={styles.sectionRule} />
            </View>
            <View style={styles.statRow}>
              <View style={styles.stat}>
                <Text style={styles.statValue}>
                  {Math.round(activityScore ? activityScore.thisWeek / 7 : 0)}
                  <Text style={styles.statUnit}> min</Text>
                </Text>
                <Text style={styles.statLabel}>activity / day</Text>
                <SparkBars
                  days={weeklyActivity.map(d => ({
                    value: d.minutes,
                    max: Math.max(...weeklyActivity.map(x => x.minutes), 60),
                    isToday: d.isToday,
                    met: d.minutes > 0,
                  }))}
                  accent={color.slateFaint}
                />
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statValue}>
                  {((hydrationScore?.avgMl || 0) / 1000).toFixed(1)}
                  <Text style={styles.statUnit}> / {((hydrationScore?.targetMl || 0) / 1000).toFixed(1)} L</Text>
                </Text>
                <Text style={styles.statLabel}>water · {hydrationPct}% of target</Text>
                <SparkBars
                  days={weeklyHydration.map(d => ({
                    value: d.ml,
                    max: d.targetMl > 0 ? d.targetMl : 1000,
                    isToday: d.isToday,
                    met: d.ml >= d.targetMl * 0.9,
                  }))}
                  accent={color.viz.hydrate}
                />
              </View>
            </View>
          </Animated.View>

          {/* ─── Nutrition ─── */}
          {weeklyMacros.length > 0 && (
            <Animated.View entering={FadeInDown.duration(420).delay(120)}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionLabel}>NUTRITION</Text>
                <View style={styles.sectionRule} />
                {weeklyDelta !== null && weeklyTarget !== null && (
                  <Text style={[styles.sectionMeta, { color: onTrack ? '#15803d' : weeklyDelta > 0 ? '#b91c1c' : '#a16207' }]}>
                    {onTrack ? 'on track' : `${weeklyDelta > 0 ? '+' : ''}${Math.round(weeklyDelta)} kcal`}
                  </Text>
                )}
              </View>
              <WeeklyNutritionChart data={weeklyMacros} />
            </Animated.View>
          )}

          {/* ─── The insight — the deliberate dark moment mid-scroll ─── */}
          <Animated.View entering={FadeInDown.duration(420).delay(180)}>
            <TouchableOpacity
              style={styles.insight}
              onPress={!healthInsight ? generateHealthInsight : undefined}
              activeOpacity={healthInsight ? 1 : 0.92}
            >
              <View style={styles.insightHead}>
                <Text style={styles.insightEyebrow}>WHAT PAWTCHI NOTICED</Text>
                {healthInsight && (
                  <TouchableOpacity onPress={generateHealthInsight} disabled={isGeneratingInsight} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <MaterialIcons name="refresh" size={18} color={isGeneratingInsight ? color.creamFaint : color.cream} />
                  </TouchableOpacity>
                )}
              </View>

              {isGeneratingInsight ? (
                <View style={styles.insightLoading}>
                  <ActivityIndicator color={color.yellow} />
                  <Text style={styles.insightBody}>Reading {petName}&apos;s week…</Text>
                </View>
              ) : healthInsight?.insight_data ? (
                <>
                  <Text style={styles.insightHeadline}>
                    {healthInsight.insight_data.headline}
                  </Text>
                  <View style={styles.insightTipRow}>
                    <View style={styles.insightTipMark} />
                    <Text style={styles.insightTip}>
                      {healthInsight.insight_data.tip || "Maintain the current routine based on this week's data."}
                    </Text>
                  </View>
                </>
              ) : (
                <Text style={styles.insightBody}>
                  Tap to see what this week&apos;s logs say about {petName}.
                </Text>
              )}
            </TouchableOpacity>
          </Animated.View>

          {/* ─── Allergy watchdog (data alert — red is earned) ─── */}
          {recentAllergyScans.length > 0 && (
            <Animated.View entering={FadeInDown.duration(420).delay(220)} style={styles.allergyStrip}>
              <MaterialIcons name="warning" size={20} color={color.error} />
              <Text style={styles.allergyText}>
                Allergen detected in recent foods: {recentAllergyScans.map(s => s.ai_identified_food).join(', ')}.
              </Text>
            </Animated.View>
          )}

          {/* ─── Vet history — a timeline, not boxes ─── */}
          {vetReports.length > 0 && (
            <Animated.View entering={FadeInDown.duration(420).delay(260)}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionLabel}>VET HISTORY</Text>
                <View style={styles.sectionRule} />
              </View>
              <View style={styles.timeline}>
                {vetReports.map((report, idx) => {
                  const d = report.ai_extracted_data || {};
                  const freshness = getReportFreshness(report.report_date);
                  const isLast = idx === vetReports.length - 1;
                  return (
                    <View key={report.id} style={styles.timelineItem}>
                      <View style={styles.timelineRail}>
                        <View style={styles.timelineDot} />
                        {!isLast && <View style={styles.timelineLine} />}
                      </View>
                      <View style={[styles.timelineBody, isLast && { paddingBottom: 0 }]}>
                        <View style={styles.timelineHeadRow}>
                          <Text style={styles.timelineDate}>
                            {new Date(report.report_date).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}
                          </Text>
                          {d.weight_kg && <Text style={styles.timelineWeight}>{d.weight_kg} kg</Text>}
                        </View>
                        <Text style={styles.timelineSource}>
                          {report.image_url === 'uploaded_scan' ? 'Scanned report' : 'Manual entry'}
                        </Text>
                        {freshness.message && (
                          <View style={styles.freshnessRow}>
                            <MaterialIcons
                              name={freshness.requiresReconfirm ? 'warning' : 'schedule'}
                              size={12}
                              color={freshness.requiresReconfirm ? '#991b1b' : '#92400e'}
                            />
                            <Text style={[styles.freshnessText, freshness.requiresReconfirm && { color: '#991b1b' }]}>
                              {freshness.message}
                            </Text>
                          </View>
                        )}
                        {d.diagnoses?.length > 0 && (
                          <Text style={styles.timelineDetail}>
                            <Text style={styles.timelineDetailLabel}>Diagnoses · </Text>{d.diagnoses.join(', ')}
                          </Text>
                        )}
                        {d.medications?.length > 0 && (
                          <Text style={styles.timelineDetail}>
                            <Text style={styles.timelineDetailLabel}>Meds · </Text>{d.medications.map((m: any) => `${m.name} (${m.dosage})`).join(', ')}
                          </Text>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            </Animated.View>
          )}

          {/* ─── Scan a report — quiet full-width action, no card ─── */}
          <Animated.View entering={FadeInDown.duration(420).delay(300)} style={styles.scanBlock}>
            <PawtchiButton
              title="Scan a vet report"
              variant="black"
              size="large"
              iconName="document-scanner"
              onPress={scanVetReport}
              disabled={isScanning}
              loading={isScanning}
            />
            <Text style={styles.scanHint}>
              Pawtchi files the vitals, diagnoses and medications into {petName}&apos;s picture.
            </Text>

            <View style={styles.exportRow}>
              <PawtchiButton
                title="Export for vet"
                variant="outline"
                size="large"
                iconName="ios-share"
                onPress={() => { if (checkAccess()) router.push('/vet-report'); }}
              />
              <Text style={styles.scanHint}>
                Hand {petName}&apos;s vet a clean PDF summary — weight, diet, allergies and history.
              </Text>
            </View>
          </Animated.View>
        </View>
      </ScrollView>

      {/* Weight Log Modal */}
      <Modal visible={showWeightModal} transparent animationType="slide">
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <KeyboardAvoidingView
            style={styles.modalOverlay}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <View style={styles.modalContent}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>Log weight</Text>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Weight (kg)</Text>
                <TextInput
                  style={styles.input}
                  value={weightInput}
                  onChangeText={setWeightInput}
                  keyboardType="decimal-pad"
                  placeholder="e.g. 24.5"
                  placeholderTextColor={color.slateFaint}
                  returnKeyType="done"
                  onSubmitEditing={Keyboard.dismiss}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Notes (optional)</Text>
                <TextInput
                  style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
                  value={weightNotes}
                  onChangeText={setWeightNotes}
                  multiline
                  placeholder="Any observations…"
                  placeholderTextColor={color.slateFaint}
                  blurOnSubmit
                />
              </View>

              <PawtchiButton
                title="Save weight"
                variant="primary"
                loading={isSavingWeight}
                onPress={() => { Keyboard.dismiss(); saveWeightLog(); }}
              />

              <TouchableOpacity onPress={() => { Keyboard.dismiss(); setShowWeightModal(false); }} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Branded Weight Log Success Modal */}
      {weightSuccessData && (
        <PawtchiSuccessModal
          visible={showWeightSuccess}
          onClose={() => {
            setShowWeightSuccess(false);
          }}
          title={`${weightSuccessData.weight} kg logged`}
          icon={{ name: 'monitor-weight', color: color.yellow }}
          lines={[
            {
              text: `${weightSuccessData.weight} kg recorded for ${activePet?.name}.`,
              type: 'normal',
            },
            ...(weightSuccessData.calorieDiff !== null && weightSuccessData.calorieDiff !== 0
              ? [{
                  text: `Daily target: ${weightSuccessData.prevCalories} → ${weightSuccessData.newCalories} kcal ${weightSuccessData.calorieDiff > 0 ? '↑' : '↓'}`,
                  type: 'highlight' as const,
                }]
              : []),
            ...(weightSuccessData.weightDiff !== null && Math.abs(weightSuccessData.weightDiff) >= 0.1
              ? [{
                  text: weightSuccessData.weightDiff > 0
                    ? `Weight is up — schedule adjusted to burn more calories.`
                    : `Weight is down — schedule supports healthy maintenance.`,
                  type: 'sub' as const,
                }]
              : []),
            ...(weightSuccessData.scheduleRegenerated
              ? [{
                  text: 'Activity schedule has been refreshed for the new weight.',
                  type: 'sub' as const,
                }]
              : []),
          ]}
          primaryAction={{
            label: 'Done',
            onPress: () => setShowWeightSuccess(false),
          }}
        />
      )}

      {/* Branded Vet Scan Success Modal */}
      <PawtchiSuccessModal
        visible={showVetScanSuccess}
        onClose={() => {
          setShowVetScanSuccess(false);
          fetchHealthData();
        }}
        title="Vet report scanned"
        icon={{ name: 'description', color: color.yellow }}
        lines={[
          { text: vetScanSummary.replace(/\n+/g, ' '), type: 'normal' },
        ]}
        primaryAction={{
          label: 'Got it',
          onPress: () => {
            setShowVetScanSuccess(false);
            fetchHealthData();
          },
        }}
      />

      {/* Branded Vet Scan Error Modal */}
      <PawtchiModal
        visible={showVetScanError}
        onClose={() => setShowVetScanError(false)}
        title="Scan Failed"
        icon={{ name: 'error-outline', color: color.error }}
        message={vetScanErrorMsg}
        showCloseButton
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.yellow },
  scrollContent: { flexGrow: 1 },

  // ════ Canopy — yellow ground, navy ink ════
  canopy: {
    backgroundColor: color.yellow,
    paddingHorizontal: space.xxl,
    paddingBottom: 56, // breathing room before the sheet rises over it
  },
  canopyTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.xl,
  },
  canopyEyebrow: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: 3,
    color: 'rgba(7, 32, 42, 0.62)', // navy at 62%
  },
  deltaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: 'rgba(7, 32, 42, 0.18)',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  deltaChipText: {
    fontFamily: font.semibold,
    fontSize: 11,
    color: color.navy,
  },
  canopyWeight: {
    fontFamily: font.display,
    fontSize: 76,
    lineHeight: 72,
    letterSpacing: 1,
    color: color.navy,
  },
  canopyUnit: {
    fontSize: 28,
    color: 'rgba(7, 32, 42, 0.55)',
  },
  canopyNoData: {
    fontFamily: font.display,
    fontSize: 34,
    color: 'rgba(7, 32, 42, 0.72)',
    letterSpacing: 1,
  },
  canopySub: {
    fontFamily: font.medium,
    fontSize: 13,
    color: 'rgba(7, 32, 42, 0.72)',
    marginTop: space.sm,
  },
  goalTrack: {
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(7, 32, 42, 0.14)',
    overflow: 'hidden',
    marginTop: space.lg,
  },
  goalFill: {
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: color.navy,
  },
  canopyChart: {
    height: 80,
    position: 'relative',
    marginTop: space.xl,
  },
  canopyChartEmpty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  canopyChartEmptyText: {
    fontFamily: font.regular,
    fontSize: 12,
    color: 'rgba(7, 32, 42, 0.62)',
    textAlign: 'center',
  },
  chartWeightLabel: {
    position: 'absolute',
    fontFamily: font.bold,
    fontSize: 10,
    color: color.navy,
  },
  chartDateLabel: {
    position: 'absolute',
    bottom: 4,
    fontFamily: font.semibold,
    fontSize: 9,
    color: 'rgba(7, 32, 42, 0.62)',
  },

  // ════ Sheet ════
  sheet: {
    backgroundColor: color.surfaceSubtle,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    marginTop: -32, // rises over the canopy
    paddingHorizontal: space.xxl,
    paddingTop: 44, // clears the seam action
    paddingBottom: 130, // tab bar
  },
  // The one navy action — floats on the seam between yellow canopy and light sheet
  seamAction: {
    position: 'absolute',
    top: -22,
    right: space.xxl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: color.navy,
    borderRadius: radius.pill,
    paddingHorizontal: 18,
    height: 44,
    ...shadow.raised,
  },
  seamActionText: {
    fontFamily: font.bold,
    fontSize: 13.5,
    color: color.cream,
  },

  // Editorial section heads: caption + hairline rule
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginBottom: space.lg,
    marginTop: space.xxl,
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
    backgroundColor: '#e7e3dc',
  },
  sectionMeta: {
    fontFamily: font.bold,
    fontSize: 11,
  },

  // Stat moments — typography on the ground, divided by a hairline
  statRow: {
    flexDirection: 'row',
    gap: space.xl,
  },
  stat: { flex: 1 },
  statDivider: {
    width: 1,
    backgroundColor: '#e7e3dc',
  },
  statValue: {
    fontFamily: font.display,
    fontSize: 34,
    lineHeight: 34,
    color: color.ink,
    letterSpacing: 0.5,
  },
  statUnit: {
    fontSize: 15,
    color: color.slateFaint,
  },
  statLabel: {
    fontFamily: font.medium,
    fontSize: 12,
    color: color.slateMuted,
    marginTop: 4,
    marginBottom: space.md,
  },

  // The dark insight moment
  insight: {
    backgroundColor: color.navy,
    borderRadius: 28,
    padding: space.xxl,
    marginTop: space.xxl,
    ...shadow.raised,
  },
  insightHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.lg,
  },
  insightEyebrow: {
    fontFamily: font.semibold,
    fontSize: 10.5,
    letterSpacing: 2.4,
    color: color.yellow,
  },
  insightLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  insightHeadline: {
    fontFamily: font.medium,
    fontSize: 16.5,
    lineHeight: 25,
    color: color.cream,
  },
  insightBody: {
    fontFamily: font.regular,
    fontSize: 13.5,
    lineHeight: 20,
    color: color.creamDim,
  },
  insightTipRow: {
    flexDirection: 'row',
    gap: space.md,
    marginTop: space.lg,
  },
  insightTipMark: {
    width: 3,
    borderRadius: 2,
    backgroundColor: color.yellow,
  },
  insightTip: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 19,
    color: color.creamDim,
  },

  // Allergy strip — soft, factual
  allergyStrip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    backgroundColor: color.errorSoft,
    borderRadius: radius.lg,
    padding: space.lg,
    marginTop: space.xxl,
  },
  allergyText: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 12.5,
    lineHeight: 18,
    color: '#991b1b',
  },

  // Vet timeline
  timeline: {},
  timelineItem: { flexDirection: 'row' },
  timelineRail: {
    width: 20,
    alignItems: 'center',
  },
  timelineDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: color.navy,
    marginTop: 5,
  },
  timelineLine: {
    flex: 1,
    width: 1.5,
    backgroundColor: '#e7e3dc',
    marginTop: 4,
    marginBottom: -4,
  },
  timelineBody: {
    flex: 1,
    paddingLeft: space.md,
    paddingBottom: space.xxl,
  },
  timelineHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timelineDate: {
    fontFamily: font.bold,
    fontSize: 14.5,
    color: color.ink,
    letterSpacing: -0.2,
  },
  timelineWeight: {
    fontFamily: font.semibold,
    fontSize: 12,
    color: color.slate,
  },
  timelineSource: {
    fontFamily: font.regular,
    fontSize: 11.5,
    color: color.slateFaint,
    marginTop: 1,
  },
  freshnessRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 6,
  },
  freshnessText: {
    flex: 1,
    fontSize: 11,
    fontFamily: font.semibold,
    color: '#92400e',
  },
  timelineDetail: {
    fontFamily: font.regular,
    fontSize: 12.5,
    lineHeight: 18,
    color: color.slate,
    marginTop: 5,
  },
  timelineDetailLabel: {
    fontFamily: font.bold,
    color: color.ink,
  },

  // Scan block — action without a container
  scanBlock: {
    marginTop: space.xxl,
  },
  exportRow: {
    marginTop: space.xxl,
  },
  scanHint: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 17,
    color: color.slateFaint,
    textAlign: 'center',
    marginTop: space.md,
    paddingHorizontal: space.xl,
  },

  // ════ Modal ════
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(7, 32, 42, 0.55)',
  },
  modalContent: {
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingHorizontal: space.xxl,
    paddingTop: space.lg,
    paddingBottom: 40,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: color.track,
    alignSelf: 'center',
    marginBottom: space.xxl,
  },
  modalTitle: {
    fontFamily: font.bold,
    fontSize: 19,
    color: color.ink,
    marginBottom: space.xxl,
    letterSpacing: -0.2,
  },
  inputGroup: { marginBottom: space.xl },
  inputLabel: {
    fontFamily: font.semibold,
    fontSize: 12.5,
    color: color.slate,
    marginBottom: space.sm,
  },
  input: {
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.hairline,
    paddingHorizontal: space.lg,
    paddingVertical: 14,
    fontFamily: font.medium,
    fontSize: 15,
    color: color.ink,
  },
  cancelBtn: { paddingVertical: space.lg, alignItems: 'center', marginTop: space.sm },
  cancelBtnText: {
    fontFamily: font.semibold,
    fontSize: 14,
    color: color.slateMuted,
  },
});
