import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Image, TouchableOpacity,
  Modal, TextInput, ActivityIndicator,
  KeyboardAvoidingView, Platform, TouchableWithoutFeedback, Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Defs, LinearGradient as SvgLinearGradient, Stop, Circle } from 'react-native-svg';
import { PawtchiModal, PawtchiSuccessModal } from '../../components/PawtchiModal';
import { PawtchiButton } from '../../components/PawtchiButton';
import * as ImagePicker from 'expo-image-picker';

import { useActivePetStore } from '../../store/useActivePetStore';
import { useStreakStore } from '../../store/useStreakStore';
import { usePetContextStore, computeDerived } from '../../store/usePetContextStore';
import { useAuth } from '../../providers/AuthProvider';
import { supabase } from '../../lib/supabase';
import { calculateDailyKcal, deriveGoal } from '../../lib/healthMath';
import { regenerateSchedule } from '../../lib/scheduleAdjuster';
import { getReportFreshness } from '../../lib/vetReportFreshness';

function getLocalYMD(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
import WeeklyNutritionChart, { DayMacro } from '../../components/WeeklyNutritionChart';

// Screen 10: Health Hub — Data-Driven
export default function HealthScreen() {
  const insets = useSafeAreaInsets();
  const { activePet } = useActivePetStore();
  const { awardCoins, pawCoins } = useStreakStore();
  const { user } = useAuth();

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
  // Loading state for health data fetch

  // Weight log modal
  const [showWeightModal, setShowWeightModal] = useState(false);
  const [weightInput, setWeightInput] = useState('');
  const [weightNotes, setWeightNotes] = useState('');
  const [isSavingWeight, setIsSavingWeight] = useState(false);

  // AI insight
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

  const fetchHealthData = useCallback(async () => {
    if (!activePet) return;

    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const fourteenDaysAgo = new Date(today);
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const todayStr = today.toISOString().split('T')[0];
    const sevenStr = sevenDaysAgo.toISOString().split('T')[0];
    const fourteenStr = fourteenDaysAgo.toISOString().split('T')[0];

    try {
      // 1. Weight logs (last 6)
      const { data: wLogs } = await supabase
        .from('weight_logs')
        .select('*')
        .eq('pet_id', activePet.id)
        .order('logged_at', { ascending: false })
        .limit(6);
      setWeightLogs(wLogs || []);

      // 2. Weekly Macros (Last 7 days of food_scans)
      const { data: scans7 } = await supabase
        .from('food_scans')
        .select('created_at, ai_estimated_calories, protein_g, carbs_g, fat_g')
        .eq('pet_id', activePet.id)
        .gte('created_at', `${sevenStr}T00:00:00`);

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
      setWeeklyMacros(daysArr);

      // 3. Activity Score: last 7 vs previous 7 days
      const { data: actsThisWeek } = await supabase
        .from('activities')
        .select('duration_minutes')
        .eq('pet_id', activePet.id)
        .eq('status', 'completed')
        .in('activity_type', ['walk', 'play', 'training'])
        .gte('scheduled_date', sevenStr)
        .lte('scheduled_date', todayStr);

      const { data: actsLastWeek } = await supabase
        .from('activities')
        .select('duration_minutes')
        .eq('pet_id', activePet.id)
        .eq('status', 'completed')
        .in('activity_type', ['walk', 'play', 'training'])
        .gte('scheduled_date', fourteenStr)
        .lt('scheduled_date', sevenStr);

      const thisWeekMins = (actsThisWeek || []).reduce((s, a) => s + (a.duration_minutes || 0), 0);
      const lastWeekMins = (actsLastWeek || []).reduce((s, a) => s + (a.duration_minutes || 0), 0);
      setActivityScore({ thisWeek: thisWeekMins, lastWeek: lastWeekMins });

      // Build per-day activity for last 7 days
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
      setWeeklyActivity(actDaysArr);

      // 4. Hydration: last 7 days average vs target (~50ml/kg)
      const { data: waterLogs } = await supabase
        .from('daily_logs')
        .select('water_ml, log_date')
        .eq('pet_id', activePet.id)
        .gte('log_date', sevenStr)
        .lte('log_date', todayStr);

      const totalWater = (waterLogs || []).reduce((s, l) => s + (l.water_ml || 0), 0);
      const daysWithData = (waterLogs || []).filter(l => l.water_ml > 0).length || 1;
      const avgMl = Math.round(totalWater / daysWithData);
      const targetMl = Math.round((activePet.current_weight_kg || 10) * 50);
      setHydrationScore({ avgMl, targetMl });

      // Build per-day hydration for last 7 days
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
      setWeeklyHydration(hydDaysArr);

      // 5. Latest AI insight
      const { data: insight } = await supabase
        .from('health_insights')
        .select('*')
        .eq('pet_id', activePet.id)
        .order('generated_at', { ascending: false })
        .limit(1)
        .single();
      setHealthInsight(insight || null);

      // 6. Allergy flagged scans (from food_scans — we check if the food contains known allergens)
      if (activePet.allergies && activePet.allergies.length > 0) {
        const { data: allScans } = await supabase
          .from('food_scans')
          .select('*')
          .eq('pet_id', activePet.id)
          .order('created_at', { ascending: false })
          .limit(20);

        const flagged = (allScans || []).filter(scan => {
          const food = (scan.ai_identified_food || '').toLowerCase();
          return activePet.allergies!.some(a => food.includes(a.toLowerCase()));
        }).slice(0, 3);
        setRecentAllergyScans(flagged);
      }

      // 7. Vet reports (last 5)
      const { data: vReports } = await supabase
        .from('vet_reports')
        .select('*')
        .eq('pet_id', activePet.id)
        .order('report_date', { ascending: false })
        .limit(5);
      setVetReports(vReports || []);
    } catch (e) {
      console.error('Health data error:', e);
    }
  }, [activePet]);

  useFocusEffect(
    useCallback(() => {
      fetchHealthData();
    }, [fetchHealthData])
  );

  // Scan Vet Report
  const scanVetReport = async () => {
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
      let summary = 'Report processed successfully!\n';
      if (ext.weight_kg) summary += `\nWeight: ${ext.weight_kg} kg`;
      if (ext.body_condition_score) summary += `\nBCS: ${ext.body_condition_score}/9`;
      if (ext.diagnoses?.length) summary += `\nDiagnoses: ${ext.diagnoses.join(', ')}`;
      if (ext.allergies?.length) summary += `\nAllergies: ${ext.allergies.join(', ')}`;
      if (ext.medications?.length) summary += `\nMedications: ${ext.medications.map((m: any) => m.name).join(', ')}`;
      if (ext.next_appointment) summary += `\nNext visit: ${ext.next_appointment}`;

      // Force a global refresh of the pet profile so new conditions/allergies sync to the Clinical Profile and Intelligent Layer instantly
      if (user?.id) {
        await useActivePetStore.getState().fetchPet(user.id);
      }
      if (activePet.id) {
        usePetContextStore.getState().refreshTrends(activePet.id);
        usePetContextStore.getState().refreshToday(activePet.id);
      }

      setVetScanSummary(summary);
      setShowVetScanSuccess(true);
    } catch (e: any) {
      setVetScanErrorMsg(e?.message || 'Scan failed.');
      setShowVetScanError(true);
    } finally {
      setIsScanning(false);
    }
  };

  // Generate AI Health Insight
  const generateHealthInsight = async () => {
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
        await useActivePetStore.getState().fetchPet(user.id);
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

  const activityHrs = activityScore ? (activityScore.thisWeek / 60).toFixed(1) : '0';
  const activityTrend = activityScore
    ? activityScore.thisWeek > activityScore.lastWeek ? 'up'
      : activityScore.thisWeek < activityScore.lastWeek ? 'down' : 'same'
    : 'same';

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

  return (
    <View style={[styles.container, { backgroundColor: '#FFFFFF' }]}>

      {/* Top Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={styles.headerLeft}>
          <View style={[styles.avatarMini, { backgroundColor: '#ebebeb' }]}>
            <Image
              source={{ uri: activePet?.current_avatar_url || activePet?.image_url || 'https://images.unsplash.com/photo-1543466835-00a7907e9de1?q=80&w=200' }}
              style={styles.avatarMiniImg}
            />
          </View>
          <Text style={[styles.headerTitle, { color: '#000000' }]}>PAWTCHI</Text>
        </View>
        <View style={[styles.coinPill, { backgroundColor: '#f5f5f5' }]}>
          <MaterialIcons name="workspace-premium" size={16} color="#755700" />
          <Text style={[styles.coinText, { color: '#2e2f2d' }]}>{pawCoins.toLocaleString()} PawCoins</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* Hero Section */}
        <View style={styles.heroSection}>
          <Text style={[styles.heroTitle, { color: '#000407' }]}>Health Overview</Text>
          <Text style={[styles.heroSub, { color: '#42474b' }]}>
            Tracking {activePet?.name || 'your pet'}&apos;s vitals and nutrition.
          </Text>
        </View>

        {/* Target Weight Goal (Moved up) */}
        {hasWeightGoal && (
          <View style={[styles.card, { marginBottom: 24 }]}>
            <Text style={styles.cardEyebrow}>TARGET WEIGHT GOAL</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text style={[styles.bodyText, { color: '#000407' }]}>
                Current: {Number(activePet?.current_weight_kg || 0).toFixed(1)} kg
              </Text>
              <Text style={[styles.bodyText, { color: '#000407', fontWeight: '700' }]}>
                Goal: {Number(activePet?.target_weight_kg || 0).toFixed(1)} kg
              </Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.max(weightGoalPct, 5)}%`, backgroundColor: '#000407' }]}>
                <View style={styles.progressIndicator} />
              </View>
            </View>
            <Text style={[styles.smallText, { textAlign: 'right', marginTop: 4, color: '#42474b' }]}>
              {Math.abs((activePet?.current_weight_kg || 0) - (activePet?.target_weight_kg || 0)).toFixed(1)} kg remaining
            </Text>
          </View>
        )}

        {/* Weekly Nutrition Chart */}
        {weeklyMacros.length > 0 && (
          <View style={{ marginBottom: 24, position: 'relative' }}>
            {weeklyDelta !== null && weeklyTarget !== null && (
              <View style={{
                position: 'absolute', top: 20, right: 20, zIndex: 10,
                flexDirection: 'row', alignItems: 'center', gap: 4,
                paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12,
                backgroundColor: Math.abs(weeklyDelta) < weeklyTarget * 0.05 ? '#dcfce7'
                  : weeklyDelta > 0 ? '#fee2e2' : '#fef3c7',
              }}>
                <MaterialIcons
                  name={Math.abs(weeklyDelta) < weeklyTarget * 0.05 ? 'check-circle'
                    : weeklyDelta > 0 ? 'trending-up' : 'trending-down'}
                  size={12}
                  color={Math.abs(weeklyDelta) < weeklyTarget * 0.05 ? '#15803d'
                    : weeklyDelta > 0 ? '#b91c1c' : '#a16207'}
                />
                <Text style={{
                  fontFamily: 'Plus Jakarta Sans', fontSize: 10, fontWeight: '700',
                  color: Math.abs(weeklyDelta) < weeklyTarget * 0.05 ? '#15803d'
                    : weeklyDelta > 0 ? '#b91c1c' : '#a16207',
                }}>
                  {Math.abs(weeklyDelta) < weeklyTarget * 0.05 ? 'On track' : `${weeklyDelta > 0 ? '+' : ''}${Math.round(weeklyDelta)} kcal`}
                </Text>
              </View>
            )}
            <WeeklyNutritionChart data={weeklyMacros} />
          </View>
        )}

        {/* Bento Grid */}
        <View style={styles.bentoGrid}>
          {/* Weight Trend */}
          <View style={[styles.card, styles.bentoCard]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <Text style={styles.cardEyebrow}>WEIGHT</Text>
                  {weightDelta !== null && (
                    <View style={[styles.weightBadge, {
                      backgroundColor: parseFloat(weightDelta) <= 0 ? '#e5eeff' : '#fee2e2'
                    }]}>
                      <Text style={[styles.weightBadgeText, {
                        color: parseFloat(weightDelta) <= 0 ? '#000407' : '#b91c1c'
                      }]}>
                        {parseFloat(weightDelta) > 0 ? '+' : ''}{weightDelta}kg
                      </Text>
                    </View>
                  )}
                </View>
                {hasWeightData ? (
                  <Text style={[styles.metricValue, { color: '#000407' }]}>
                    {Number(currentWeight).toFixed(1)} <Text style={styles.metricUnit}>kg</Text>
                  </Text>
                ) : (
                  <Text style={[styles.metricValue, { color: '#94a3b8', fontSize: 16 }]}>No data</Text>
                )}
              </View>
              <TouchableOpacity
                style={styles.logBtnBlack}
                onPress={() => {
                  const defaultWeight = activePet?.current_weight_kg || undefined;
                  setWeightInput(defaultWeight ? String(defaultWeight) : '');
                  setShowWeightModal(true);
                }}
              >
                <Text style={styles.logBtnTextYellow}>+ Log Weight</Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.chartContainer, { width: '100%', marginTop: 24, paddingHorizontal: 0, height: 80, position: 'relative' }]}>
              {hasWeightData ? (
                <>{(() => {
                const logs = [...weightLogs].reverse();
                if (logs.length === 1) logs.push({...logs[0]}); // Need at least 2 points
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
                        <SvgLinearGradient id="riverGrad" x1="0" y1="0" x2="0" y2="1">
                          <Stop offset="0" stopColor="#000407" stopOpacity="0.15" />
                          <Stop offset="1" stopColor="#000407" stopOpacity="0" />
                        </SvgLinearGradient>
                      </Defs>
                      <Path d={dFill} fill="url(#riverGrad)" />
                      <Path d={dLine} stroke="#000407" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      {pts.map((p, i) => (
                        <Circle
                          key={i}
                          cx={p.x}
                          cy={p.y}
                          r={i === pts.length - 1 ? 4 : 2}
                          fill={i === pts.length - 1 ? '#FFFC00' : '#000407'}
                          stroke="#000407"
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
                        <Text style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 10, color: '#000407', position: 'absolute', top: p.y - 18 }}>
                          {p.weight}
                        </Text>
                        <Text style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: '600', fontSize: 9, color: '#42474b', position: 'absolute', bottom: 4 }}>
                          {p.dateStr}
                        </Text>
                      </View>
                    ))}
                  </>
                );
              })()}</>
              ) : (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>
                    Log your first weight to see trends
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Activity Progress */}
          <View style={[styles.card, styles.bentoCard]}>
            <Text style={styles.cardEyebrow}>ACTIVITY</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 }}>
              <View>
                <Text style={[styles.metricValue, { color: '#000407' }]}>
                  {Math.round(activityScore ? activityScore.thisWeek / 7 : 0)} <Text style={styles.metricUnit}>min</Text>
                </Text>
                <Text style={styles.activitySub}>avg / day this week</Text>
              </View>
              <View style={styles.circularIndicator}>
                <MaterialIcons name="pets" size={24} color="#000407" />
              </View>
            </View>
            {/* 7-day bar chart */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', height: 48, marginTop: 8 }}>
              {weeklyActivity.map((d, i) => {
                const maxMins = Math.max(...weeklyActivity.map(x => x.minutes), 60);
                const heightPct = maxMins > 0 ? (d.minutes / maxMins) * 40 : 0;
                return (
                  <View key={i} style={{ alignItems: 'center', flex: 1 }}>
                    <View style={{
                      width: 20,
                      height: Math.max(heightPct, 2),
                      backgroundColor: d.isToday ? '#FFFC00' : '#e5e7eb',
                      borderRadius: 4,
                      marginBottom: 4,
                    }} />
                    <Text style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 9, fontWeight: d.isToday ? '800' : '500', color: d.isToday ? '#000407' : '#94a3b8' }}>
                      {d.day}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        </View>

        {/* Weekly Reflection */}
        <TouchableOpacity
          style={[styles.card, { backgroundColor: '#eff4ff', marginBottom: 24 }]}
          onPress={!healthInsight ? generateHealthInsight : undefined}
          activeOpacity={healthInsight ? 1 : 0.9}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <MaterialIcons name="auto-awesome" size={20} color="#000407" />
            <Text style={[styles.cardTitle, { color: '#000407', flex: 1 }]}>Weekly Reflection</Text>
            {healthInsight && (
              <TouchableOpacity onPress={generateHealthInsight} disabled={isGeneratingInsight}>
                <MaterialIcons name="refresh" size={20} color={isGeneratingInsight ? '#94a3b8' : '#000407'} />
              </TouchableOpacity>
            )}
          </View>
          
          {isGeneratingInsight ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
              <ActivityIndicator color="#000407" />
              <Text style={[styles.bodyText, { color: '#42474b' }]}>Analyzing {activePet?.name || 'your pet'}&apos;s data...</Text>
            </View>
          ) : healthInsight?.insight_data ? (
            <>
              <Text style={[styles.bodyText, { color: '#42474b', marginBottom: 16, lineHeight: 22 }]}>
                {healthInsight.insight_data.headline}
              </Text>
              <View style={{ borderTopWidth: 1, borderTopColor: 'rgba(0,4,7,0.1)', paddingTop: 12, marginTop: 4 }}>
                <Text style={[styles.cardEyebrow, { color: '#000407' }]}>RECOMMENDATION</Text>
                <Text style={[styles.smallText, { color: '#42474b', marginTop: 4, lineHeight: 18 }]}>
                   {healthInsight.insight_data.tip || "Maintain current routine based on this week's data."}
                </Text>
              </View>
            </>
          ) : (
            <View style={{ alignItems: 'center', paddingVertical: 12 }}>
              <Text style={[styles.bodyText, { textAlign: 'center', color: '#42474b' }]}>Tap to generate reflection</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Hydration */}
        <View style={[styles.card, { marginBottom: 24 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <Text style={styles.cardEyebrow}>HYDRATION</Text>
            <MaterialIcons name="water-drop" size={20} color="#b2cad7" />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
            <Text style={[styles.metricValue, { color: '#000407' }]}>{((hydrationScore?.avgMl || 0) / 1000).toFixed(1)}</Text>
            <Text style={[styles.bodyText, { color: '#42474b' }]}>/ {((hydrationScore?.targetMl || 0) / 1000).toFixed(1)} Litres</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${hydrationPct}%`, backgroundColor: '#b2cad7' }]} />
          </View>
          {/* 7-day bar chart */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', height: 48, marginTop: 16 }}>
            {weeklyHydration.map((d, i) => {
              const maxMl = d.targetMl > 0 ? d.targetMl : 1000;
              const heightPct = maxMl > 0 ? (d.ml / maxMl) * 40 : 0;
              const metTarget = d.ml >= d.targetMl * 0.9;
              return (
                <View key={i} style={{ alignItems: 'center', flex: 1 }}>
                  <View style={{
                    width: 20,
                    height: Math.max(heightPct, 2),
                    backgroundColor: d.isToday ? '#FFFC00' : metTarget ? '#b2cad7' : '#e5e7eb',
                    borderRadius: 4,
                    marginBottom: 4,
                  }} />
                  <Text style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 9, fontWeight: d.isToday ? '800' : '500', color: d.isToday ? '#000407' : '#94a3b8' }}>
                    {d.day}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* Allergy Watchdog */}
        {recentAllergyScans.length > 0 && (
          <View style={[styles.card, { backgroundColor: '#fee2e2', borderColor: '#fca5a5', marginBottom: 24 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
              <MaterialIcons name="warning" size={24} color="#b91c1c" style={{ marginTop: 2 }} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, { color: '#7f1d1d', marginBottom: 4 }]}>Allergy Watchdog</Text>
                <Text style={[styles.bodyText, { color: '#991b1b', lineHeight: 20 }]}>
                  Allergen detected in recent foods: {recentAllergyScans.map(s => s.ai_identified_food).join(', ')}.
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Vet Records */}
        {vetReports.length > 0 && (
          <View style={{ marginBottom: 24 }}>
            <Text style={[styles.sectionTitle, { color: '#000407', marginBottom: 12 }]}>Vet Records</Text>
            <View style={{ gap: 12 }}>
              {vetReports.map(report => {
                const d = report.ai_extracted_data || {};
                const freshness = getReportFreshness(report.report_date);
                return (
                  <View key={report.id} style={styles.card}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                        <View style={{ backgroundColor: '#eff4ff', padding: 8, borderRadius: 12 }}>
                          <MaterialIcons name="description" size={20} color="#000407" />
                        </View>
                        <View>
                          <Text style={[styles.bodyText, { color: '#000407', fontWeight: '700' }]}>
                            {new Date(report.report_date).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}
                          </Text>
                          <Text style={[styles.smallText, { color: '#42474b' }]}>
                            {report.image_url === 'uploaded_scan' ? 'AI Scanned' : 'Manual'}
                          </Text>
                        </View>
                      </View>
                      {d.weight_kg && (
                        <View style={[styles.weightBadge, { backgroundColor: '#e5eeff' }]}>
                          <Text style={[styles.weightBadgeText, { color: '#000407' }]}>{d.weight_kg} kg</Text>
                        </View>
                      )}
                    </View>
                    {freshness.message && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: freshness.requiresReconfirm ? '#FEE2E2' : '#fef3c7', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginTop: 8 }}>
                        <MaterialIcons name={freshness.requiresReconfirm ? 'warning' : 'schedule'} size={14} color={freshness.requiresReconfirm ? '#991b1b' : '#92400e'} />
                        <Text style={{ flex: 1, fontSize: 11, fontFamily: 'Plus Jakarta Sans', color: freshness.requiresReconfirm ? '#991b1b' : '#92400e', fontWeight: '600' }}>{freshness.message}</Text>
                      </View>
                    )}
                    {d.diagnoses?.length > 0 && (
                      <Text style={[styles.smallText, { color: '#42474b', marginTop: 8 }]}>
                        <Text style={{ fontWeight: '700', color: '#000407' }}>Diagnoses: </Text>{d.diagnoses.join(', ')}
                      </Text>
                    )}
                    {d.medications?.length > 0 && (
                      <Text style={[styles.smallText, { color: '#42474b', marginTop: 4 }]}>
                        <Text style={{ fontWeight: '700', color: '#000407' }}>Meds: </Text>{d.medications.map((m: any) => `${m.name} (${m.dosage})`).join(', ')}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Vet Report CTA */}
        <View style={[styles.card, { backgroundColor: '#000407', borderColor: 'transparent', marginBottom: 24 }]}>
          <Text style={[styles.cardTitle, { color: '#ffffff', marginBottom: 8 }]}>Scan Vet Report</Text>
          <Text style={[styles.bodyText, { color: '#b2cad7', marginBottom: 20, lineHeight: 20 }]}>
            Upload your vet&apos;s report and let AI extract vitals, diagnoses, and medication schedules instantly.
          </Text>
          <PawtchiButton
            title="Scan report"
            variant="primary"
            onPress={scanVetReport}
            disabled={isScanning}
            loading={isScanning}
          />
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
              <Text style={styles.modalTitle}>Log Weight</Text>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Weight (kg)</Text>
                <TextInput
                  style={styles.input}
                  value={weightInput}
                  onChangeText={setWeightInput}
                  keyboardType="decimal-pad"
                  placeholder="e.g. 24.5"
                  placeholderTextColor="#94a3b8"
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
                  placeholder="Any observations..."
                  placeholderTextColor="#94a3b8"
                  blurOnSubmit
                />
              </View>

              <TouchableOpacity
                style={[styles.saveBtn, isSavingWeight && { opacity: 0.7 }]}
                onPress={() => { Keyboard.dismiss(); saveWeightLog(); }}
                disabled={isSavingWeight}
                activeOpacity={0.9}
              >
                {isSavingWeight
                  ? <ActivityIndicator color="#000407" />
                  : <Text style={styles.saveBtnText}>Save weight</Text>
                }
              </TouchableOpacity>

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
          icon={{ name: 'monitor-weight', color: '#FFFC00' }}
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
        icon={{ name: 'description', color: '#FFFC00' }}
        lines={[
          { text: vetScanSummary.replace(/\n+/g, ' '), type: 'normal' },
        ]}
        primaryAction={{
          label: 'Great!',
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
        icon={{ name: 'error-outline', color: '#ef4444' }}
        message={vetScanErrorMsg}
        showCloseButton
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 24, paddingBottom: 16, backgroundColor: '#ffffff', zIndex: 50, borderBottomWidth: 1, borderBottomColor: 'rgba(0,4,7,0.05)'
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatarMini: { width: 32, height: 32, borderRadius: 16, overflow: 'hidden', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(0,4,7,0.1)' },
  avatarMiniImg: { width: '100%', height: '100%' },
  headerTitle: { fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 18, color: '#000407' },
  coinPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: '#000407', backgroundColor: 'transparent' },
  coinText: { fontFamily: 'Plus Jakarta Sans', fontWeight: '600', fontSize: 10, color: '#000407' },
  
  scrollContent: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 120 },
  heroSection: { marginBottom: 24 },
  heroTitle: { fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 28, letterSpacing: -0.5, marginBottom: 4 },
  heroSub: { fontFamily: 'Plus Jakarta Sans', fontWeight: '400', fontSize: 14 },
  sectionTitle: { fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 20 },

  // Base theme
  card: { backgroundColor: '#ffffff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(0,4,7,0.1)' },
  cardEyebrow: { fontFamily: 'Plus Jakarta Sans', fontWeight: '600', fontSize: 10, color: '#42474b', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 },
  cardTitle: { fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 18 },
  bodyText: { fontFamily: 'Plus Jakarta Sans', fontWeight: '500', fontSize: 14 },
  smallText: { fontFamily: 'Plus Jakarta Sans', fontWeight: '500', fontSize: 12 },
  
  progressTrack: { height: 8, width: '100%', backgroundColor: '#e5eeff', borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4 },
  progressIndicator: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 4, backgroundColor: '#ebea00' },
  
  bentoGrid: { flexDirection: 'column', gap: 16, marginBottom: 24 },
  bentoCard: { width: '100%' },
  metricValue: { fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 24 },
  metricUnit: { fontSize: 12, fontWeight: '500', color: '#42474b' },
  
  weightBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  weightBadgeText: { fontFamily: 'Plus Jakarta Sans', fontWeight: '600', fontSize: 10 },
  bentoBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 16 },
  logBtn: { backgroundColor: '#FFFC00', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: '#000407' },
  logBtnBlack: { backgroundColor: '#000407', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16 },
  logBtnWhite: { backgroundColor: '#FFFC00', paddingHorizontal: 10, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: '#000407' },
  logBtnText: { fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 11, color: '#000407' },
  logBtnTextYellow: { fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 11, color: '#FFFC00' },

  activitySub: { fontFamily: 'Plus Jakarta Sans', fontWeight: '500', fontSize: 10, color: '#a1a1aa', marginTop: 2 },
  circularIndicator: { width: 56, height: 56, borderRadius: 28, borderWidth: 4, borderColor: '#FFFC00', borderLeftColor: '#eff4ff', borderBottomColor: '#eff4ff', alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-45deg' }] },
  
  chartContainer: { height: 40, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },

  // Modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContent: { backgroundColor: '#ffffff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40 },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#e2e8f0', alignSelf: 'center', marginBottom: 24 },
  modalTitle: { fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 20, color: '#000407', marginBottom: 24 },
  inputGroup: { marginBottom: 20 },
  inputLabel: { fontFamily: 'Plus Jakarta Sans', fontWeight: '600', fontSize: 12, color: '#42474b', marginBottom: 8 },
  input: { backgroundColor: '#ffffff', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(0,4,7,0.1)', paddingHorizontal: 16, paddingVertical: 14, fontFamily: 'Plus Jakarta Sans', fontSize: 14, color: '#000407' },
  saveBtn: { borderRadius: 12, backgroundColor: '#FFFC00', paddingVertical: 16, alignItems: 'center', marginTop: 8, borderWidth: 1, borderColor: '#000407' },
  saveBtnGradient: { alignItems: 'center' },
  saveBtnText: { fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 14, color: '#000407' },
  cancelBtn: { paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  cancelBtnText: { fontFamily: 'Plus Jakarta Sans', fontWeight: '600', fontSize: 14, color: '#42474b' },
});
