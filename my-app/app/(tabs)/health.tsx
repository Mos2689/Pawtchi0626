import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Image, TouchableOpacity,
  Modal, TextInput, Alert, ActivityIndicator,
  KeyboardAvoidingView, TouchableWithoutFeedback, Keyboard, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';

import { useActivePetStore } from '../../store/useActivePetStore';
import { useStreakStore } from '../../store/useStreakStore';
import { usePetContextStore } from '../../store/usePetContextStore';
import { useAuth } from '../../providers/AuthProvider';
import { supabase } from '../../lib/supabase';
import { calculateDailyKcal, deriveGoal } from '../../lib/healthMath';
import { regenerateSchedule } from '../../lib/scheduleAdjuster';
import { getReportFreshness } from '../../lib/vetReportFreshness';
import WeeklyNutritionChart, { DayMacro } from '../../components/WeeklyNutritionChart';

// Screen 10: Health Hub — Data-Driven
export default function HealthScreen() {
  const insets = useSafeAreaInsets();
  const { activePet } = useActivePetStore();
  const { awardCoins, pawCoins } = useStreakStore();
  const { user } = useAuth();
  const router = useRouter();

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
  // Loading state for health data fetch

  // Weight log modal
  const [showWeightModal, setShowWeightModal] = useState(false);
  const [weightInput, setWeightInput] = useState('');
  const [weightNotes, setWeightNotes] = useState('');
  const [isSavingWeight, setIsSavingWeight] = useState(false);

  // AI insight
  const [isGeneratingInsight, setIsGeneratingInsight] = useState(false);

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

      // 4. Hydration: last 7 days average vs target (~50ml/kg)
      const { data: waterLogs } = await supabase
        .from('daily_logs')
        .select('water_ml')
        .eq('pet_id', activePet.id)
        .gte('log_date', sevenStr)
        .lte('log_date', todayStr);

      const totalWater = (waterLogs || []).reduce((s, l) => s + (l.water_ml || 0), 0);
      const daysWithData = (waterLogs || []).filter(l => l.water_ml > 0).length || 1;
      const avgMl = Math.round(totalWater / daysWithData);
      const targetMl = Math.round((activePet.current_weight_kg || 10) * 50);
      setHydrationScore({ avgMl, targetMl });

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
      const res = await fetch(`${supabaseUrl}/functions/v1/scan-vet-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

      Alert.alert('Vet Report Scanned ✅', summary, [
        { text: 'Great!', onPress: () => fetchHealthData() }
      ]);
    } catch (e: any) {
      Alert.alert('Scan Failed', e.message);
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
      const res = await fetch(`${supabaseUrl}/functions/v1/generate-health-insight`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ petId: activePet.id }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Generation failed.');

      setHealthInsight(data.insight);
    } catch (e: any) {
      Alert.alert('Insight Failed', e.message);
    } finally {
      setIsGeneratingInsight(false);
    }
  };

  // Save weight log
  const saveWeightLog = async () => {
    const weight = parseFloat(weightInput);
    if (isNaN(weight) || weight <= 0) {
      Alert.alert('Invalid Weight', 'Please enter a valid weight in kg.');
      return;
    }
    if (!activePet) return;
    setIsSavingWeight(true);

    try {
      // Snapshot prior state so we can detect a meaningful change after the log.
      const prevWeight = activePet.current_weight_kg ?? null;
      const prevGoal = deriveGoal(prevWeight ?? weight, activePet.target_weight_kg);

      await supabase.from('weight_logs').insert({
        pet_id: activePet.id,
        weight_kg: weight,
        notes: weightNotes || null,
        source: 'manual',
      });

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

      // Update pet's current weight and recalculated calorie target
      await supabase.from('pets').update({
        current_weight_kg: weight,
        target_daily_calories: newCalories,
      }).eq('id', activePet.id);

      // Refresh pet store so home screen sees updated target
      if (user?.id) {
        await useActivePetStore.getState().fetchPet(user.id);
      }

      // Refresh context store so dynamic budget recalculates with new weight trend
      if (activePet.id) {
        usePetContextStore.getState().refreshTrends(activePet.id);
        usePetContextStore.getState().refreshToday(activePet.id);
      }

      // Auto-regenerate activity schedule when the weight change is meaningful:
      // either ≥0.3kg movement OR the goal direction has flipped (e.g. lose → maintain).
      // Otherwise the user is stuck with a schedule designed for last week's pet.
      const weightDeltaKg = prevWeight !== null ? Math.abs(weight - prevWeight) : 0;
      const goalFlipped = prevGoal !== goal;
      let scheduleRegenerated = false;
      if (activePet.id && (weightDeltaKg >= 0.3 || goalFlipped)) {
        const ctx = usePetContextStore.getState();
        const refreshed = useActivePetStore.getState().activePet ?? activePet;
        const result = await regenerateSchedule({
          pet: refreshed,
          weeklyStats: null, // no per-week stats accessible here; lib handles defaults
          todayCalPercent: ctx.calPercent,
          weightTrendDirection: ctx.weightTrend?.direction ?? null,
        });
        scheduleRegenerated = result.success;
      }

      setShowWeightModal(false);
      setWeightInput('');
      setWeightNotes('');
      fetchHealthData();
      const successSuffix = scheduleRegenerated
        ? `\n\nActivity schedule has been refreshed for the new weight.`
        : '';
      Alert.alert('Weight Logged! ✅', `Recorded ${weight} kg for ${activePet.name}.${successSuffix}`);

      // Award coins for weight log
      if (user?.id) {
        awardCoins(user.id, 'weight_log');
      }
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setIsSavingWeight(false);
    }
  };

  // Computed values
  const currentWeight = weightLogs.length > 0 ? weightLogs[0].weight_kg : activePet?.current_weight_kg || 0;
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
  const weightGoalPct = hasWeightGoal
    ? Math.min(Math.round(
      Math.abs(1 - (Math.abs(currentWeight - activePet!.target_weight_kg!) /
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
          <MaterialIcons name="stars" size={16} color="#755700" />
          <Text style={[styles.coinText, { color: '#2e2f2d' }]}>{pawCoins.toLocaleString()} PawCoins</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* Hero Section */}
        <View style={styles.heroSection}>
          <Text style={[styles.heroTitle, { color: '#2e2f2d' }]}>Health Hub</Text>
          <Text style={[styles.heroSub, { color: '#5b5c5a' }]}>
            Monitoring {activePet?.name || 'your pet'}&apos;s vitals.
          </Text>
        </View>

        {/* AI Health Insight Card */}
        <TouchableOpacity
          style={styles.insightCard}
          onPress={!healthInsight ? generateHealthInsight : undefined}
          activeOpacity={healthInsight ? 1 : 0.9}
        >
          <LinearGradient colors={['#0f172a', '#1e293b']} style={styles.insightGradient}>
            <View style={styles.insightTop}>
              <View style={styles.insightBadge}>
                <MaterialIcons name="auto-awesome" size={14} color="#fac129" />
                <Text style={styles.insightBadgeText}>WEEKLY REFLECTION</Text>
              </View>
              {healthInsight ? (
                <TouchableOpacity onPress={generateHealthInsight} disabled={isGeneratingInsight}>
                  <MaterialIcons name="refresh" size={20} color={isGeneratingInsight ? '#475569' : '#94a3b8'} />
                </TouchableOpacity>
              ) : null}
            </View>
            {isGeneratingInsight ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
                <ActivityIndicator color="#fac129" />
                <Text style={styles.insightText}>Analyzing {activePet?.name || 'your pet'}&apos;s health data...</Text>
              </View>
            ) : healthInsight?.insight_data ? (
              <>
                {/* Structured Insight */}
                <Text style={[styles.insightText, { fontSize: 17, fontWeight: '800', marginBottom: 16 }]}>
                  {healthInsight.insight_data.headline}
                </Text>

                {/* Wins */}
                {healthInsight.insight_data.wins?.length > 0 && (
                  <View style={{ marginBottom: 12 }}>
                    {healthInsight.insight_data.wins.map((win: string, i: number) => (
                      <View key={`win-${i}`} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                        <Text style={{ fontSize: 14, marginTop: 1 }}>✅</Text>
                        <Text style={[styles.insightText, { flex: 1, fontSize: 14 }]}>{win}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Concerns */}
                {healthInsight.insight_data.concerns?.length > 0 && (
                  <View style={{ marginBottom: 12 }}>
                    {healthInsight.insight_data.concerns.map((concern: string, i: number) => (
                      <View key={`concern-${i}`} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                        <Text style={{ fontSize: 14, marginTop: 1 }}>⚠️</Text>
                        <Text style={[styles.insightText, { flex: 1, fontSize: 14, color: '#fbbf24' }]}>{concern}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Actionable Tip */}
                {healthInsight.insight_data.tip && (
                  <View style={{
                    backgroundColor: 'rgba(250,193,41,0.1)',
                    borderRadius: 14,
                    padding: 14,
                    marginBottom: 12,
                    borderLeftWidth: 3,
                    borderLeftColor: '#fac129',
                  }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <MaterialIcons name="lightbulb" size={16} color="#fac129" />
                      <Text style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: '800', fontSize: 12, color: '#fac129', letterSpacing: 0.5 }}>
                        THIS WEEK&apos;S TIP
                      </Text>
                    </View>
                    <Text style={[styles.insightText, { fontSize: 14 }]}>{healthInsight.insight_data.tip}</Text>
                  </View>
                )}

                {/* Comparison Chips */}
                {healthInsight.insight_data.comparison && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                    {[
                      { label: 'Calories', value: healthInsight.insight_data.comparison.caloriesVsLastWeek, icon: 'restaurant' },
                      { label: 'Activity', value: healthInsight.insight_data.comparison.activityVsLastWeek, icon: 'directions-run' },
                      { label: 'Water', value: healthInsight.insight_data.comparison.waterVsLastWeek, icon: 'water-drop' },
                    ].filter(c => c.value && c.value !== 'N/A').map((chip) => {
                      const isPositive = chip.label === 'Calories'
                        ? chip.value.startsWith('-') // less calories = good (if trying to lose)
                        : chip.value.startsWith('+') || !chip.value.startsWith('-'); // more activity/water = good
                      return (
                        <View key={chip.label} style={{
                          flexDirection: 'row', alignItems: 'center', gap: 6,
                          backgroundColor: 'rgba(255,255,255,0.08)',
                          paddingHorizontal: 12, paddingVertical: 6,
                          borderRadius: 12,
                        }}>
                          <MaterialIcons name={chip.icon as any} size={14} color="#94a3b8" />
                          <Text style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 12, color: '#94a3b8' }}>
                            {chip.label}
                          </Text>
                          <Text style={{
                            fontFamily: 'Plus Jakarta Sans', fontWeight: '800', fontSize: 12,
                            color: chip.value === '0%' || chip.value === '+0%' ? '#94a3b8' : isPositive ? '#4ade80' : '#fb923c',
                          }}>
                            {chip.value}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                )}

                <Text style={[styles.insightTime, { marginTop: 4 }]}>
                  Generated {new Date(healthInsight.generated_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                </Text>
              </>
            ) : healthInsight ? (
              <>
                {/* Fallback: plain text insight (backward compatible) */}
                <Text style={styles.insightText}>{healthInsight.insight_text}</Text>
                <Text style={[styles.insightTime, { marginTop: 12 }]}>
                  Generated {new Date(healthInsight.generated_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                </Text>
              </>
            ) : (
              <View style={{ alignItems: 'center', paddingVertical: 12 }}>
                <MaterialIcons name="psychology" size={32} color="#475569" />
                <Text style={[styles.insightText, { textAlign: 'center', marginTop: 8 }]}>Tap to generate your first weekly reflection</Text>
              </View>
            )}
          </LinearGradient>
        </TouchableOpacity>

        {/* Weekly Nutrition Chart */}
        {weeklyMacros.length > 0 && (
          <>
            {weeklyDelta !== null && weeklyTarget !== null && (
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8, marginBottom: 4, paddingHorizontal: 4 }}>
                <View style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 999,
                  backgroundColor: Math.abs(weeklyDelta) < weeklyTarget * 0.05 ? '#dcfce7'
                    : weeklyDelta > 0 ? '#fee2e2' : '#fef3c7',
                }}>
                  <MaterialIcons
                    name={Math.abs(weeklyDelta) < weeklyTarget * 0.05 ? 'check-circle'
                      : weeklyDelta > 0 ? 'trending-up' : 'trending-down'}
                    size={13}
                    color={Math.abs(weeklyDelta) < weeklyTarget * 0.05 ? '#15803d'
                      : weeklyDelta > 0 ? '#b91c1c' : '#a16207'}
                  />
                  <Text style={{
                    fontFamily: 'Plus Jakarta Sans',
                    fontSize: 11,
                    fontWeight: '700',
                    color: Math.abs(weeklyDelta) < weeklyTarget * 0.05 ? '#15803d'
                      : weeklyDelta > 0 ? '#b91c1c' : '#a16207',
                  }}>
                    {Math.abs(weeklyDelta) < weeklyTarget * 0.05
                      ? 'Week on track'
                      : `Week ${weeklyDelta > 0 ? '+' : ''}${Math.round(weeklyDelta)} kcal`}
                  </Text>
                </View>
              </View>
            )}
            <WeeklyNutritionChart data={weeklyMacros} />
          </>
        )}

        {/* Bento Grid — Live Vitals */}
        <View style={styles.bentoGrid}>
          <View style={styles.bentoRow}>

            {/* Weight Card — LIVE */}
            <View style={[styles.weightCard, { backgroundColor: '#f5f5f5', borderColor: 'rgba(0,0,0,0.05)' }]}>
              <View>
                <View style={styles.weightHeader}>
                  <Text style={[styles.weightLabel, { color: '#5b5c5a' }]}>WEIGHT</Text>
                  {weightDelta !== null && (
                    <View style={[styles.weightBadge, {
                      backgroundColor: parseFloat(weightDelta) <= 0 ? '#FFFC00' : '#fee2e2'
                    }]}>
                      <Text style={[styles.weightBadgeText, {
                        color: parseFloat(weightDelta) <= 0 ? '#5b5a00' : '#b91c1c'
                      }]}>
                        {parseFloat(weightDelta) > 0 ? '+' : ''}{weightDelta}kg
                      </Text>
                    </View>
                  )}
                </View>
                <View style={styles.weightValueRow}>
                  <Text style={[styles.weightValue, { color: '#2e2f2d' }]}>{Number(currentWeight).toFixed(1)}</Text>
                  <Text style={[styles.weightUnit, { color: '#5b5c5a' }]}>kg</Text>
                </View>
              </View>

              {/* Sparkline from weight logs */}
              <View style={styles.chartContainer}>
                {weightLogs.length > 0 ? (
                  [...weightLogs].reverse().map((log, i) => {
                    const maxW = Math.max(...weightLogs.map(l => l.weight_kg));
                    const minW = Math.min(...weightLogs.map(l => l.weight_kg));
                    const range = maxW - minW || 1;
                    const pct = ((log.weight_kg - minW) / range) * 70 + 30;
                    const isLast = i === weightLogs.length - 1;
                    return isLast ? (
                      <LinearGradient key={i} colors={['#FFFC00', '#fac129']} style={[styles.barGradient, { height: `${pct}%` }]} />
                    ) : (
                      <View key={i} style={[styles.bar, { height: `${pct}%`, backgroundColor: '#ddddd9' }]} />
                    );
                  })
                ) : (
                  <>
                    <View style={[styles.bar, { height: '50%', backgroundColor: '#ddddd9' }]} />
                    <LinearGradient colors={['#FFFC00', '#fac129']} style={[styles.barGradient, { height: '100%' }]} />
                  </>
                )}
              </View>

              {/* Log Weight Button */}
              <TouchableOpacity
                style={styles.logWeightBtn}
                onPress={() => { setWeightInput(String(currentWeight)); setShowWeightModal(true); }}
                activeOpacity={0.8}
              >
                <MaterialIcons name="add" size={16} color="#1A1A1A" />
                <Text style={styles.logWeightText}>LOG WEIGHT</Text>
              </TouchableOpacity>
            </View>

            {/* Right Column: Active Navigation Card */}
            <View style={styles.metricsColumn}>
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => router.push('/routine' as any)}
                style={[styles.squareCard, { backgroundColor: '#f1f5f9', borderColor: 'rgba(0,0,0,0.05)', flex: 1, justifyContent: 'space-between', minHeight: 260 }]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <View style={{ backgroundColor: '#e2e8f0', padding: 8, borderRadius: 12 }}>
                    <MaterialIcons name="directions-run" size={24} color="#0f172a" />
                  </View>
                  <MaterialIcons
                    name={activityTrend === 'up' ? 'trending-up' : activityTrend === 'down' ? 'trending-down' : 'trending-flat'}
                    size={22}
                    color={activityTrend === 'up' ? '#16a34a' : activityTrend === 'down' ? '#dc2626' : '#94a3b8'}
                  />
                </View>

                <View>
                  <Text style={[styles.metricValue, { color: '#0f172a', fontSize: 32 }]}>{activityHrs}h</Text>
                  <Text style={[styles.metricLabel, { color: '#64748b', fontSize: 13 }]}>ACTIVE THIS WEEK</Text>
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#ffffff', alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16 }}>
                  <Text style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 12, fontWeight: '700', color: '#0f172a' }}>View Routines</Text>
                  <MaterialIcons name="arrow-forward" size={14} color="#0f172a" />
                </View>
              </TouchableOpacity>
            </View>
          </View>

          {/* Hydration Card */}
          <View style={[styles.hydrationCard, { backgroundColor: '#f5f5f5', borderColor: 'rgba(0,0,0,0.05)' }]}>
            <View style={styles.hydrationLeft}>
              <LinearGradient colors={['#3b82f6', '#60a5fa']} style={styles.hydrationIconBg}>
                <MaterialIcons name="water-drop" size={24} color="#FFFFFF" />
              </LinearGradient>
              <View>
                <Text style={[styles.hydrationTitle, { color: '#2e2f2d' }]}>Hydration</Text>
                <Text style={[styles.hydrationSub, { color: '#5b5c5a' }]}>
                  Avg {hydrationScore?.avgMl || 0}ml / {hydrationScore?.targetMl || 0}ml target
                </Text>
              </View>
            </View>
            <View style={styles.hydrationRight}>
              <Text style={[styles.hydrationPct, { color: hydrationPct >= 80 ? '#16a34a' : hydrationPct >= 50 ? '#ca8a04' : '#dc2626' }]}>
                {hydrationPct}%
              </Text>
            </View>
          </View>
        </View>

        {/* Weight Goal Progress */}
        {hasWeightGoal && (
          <View style={styles.goalSection}>
            <Text style={[styles.sectionTitle, { color: '#2e2f2d' }]}>Weight Goal</Text>
            <View style={[styles.goalCard, { backgroundColor: '#f5f5f5', borderColor: 'rgba(0,0,0,0.05)' }]}>
              <View style={styles.goalRow}>
                <View style={{ alignItems: 'center' }}>
                  <Text style={[styles.goalWeight, { color: '#5b5c5a' }]}>{Number(activePet?.current_weight_kg || 0).toFixed(1)}</Text>
                  <Text style={[styles.goalLabel, { color: '#94a3b8' }]}>Current</Text>
                </View>
                <View style={styles.goalBarContainer}>
                  <View style={styles.goalBarBg}>
                    <LinearGradient
                      colors={['#FFFC00', '#fac129']}
                      style={[styles.goalBarFill, { width: `${Math.max(weightGoalPct, 5)}%` }]}
                    />
                  </View>
                  <Text style={[styles.goalPctText, { color: '#5b5c5a' }]}>{weightGoalPct}%</Text>
                </View>
                <View style={{ alignItems: 'center' }}>
                  <Text style={[styles.goalWeight, { color: '#2e2f2d' }]}>{Number(activePet?.target_weight_kg || 0).toFixed(1)}</Text>
                  <Text style={[styles.goalLabel, { color: '#94a3b8' }]}>Target</Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* Allergy Watchdog */}
        {recentAllergyScans.length > 0 && (
          <View style={styles.allergySection}>
            <View style={styles.allergyHeader}>
              <MaterialIcons name="warning" size={20} color="#dc2626" />
              <Text style={[styles.sectionTitle, { color: '#2e2f2d', marginBottom: 0 }]}>Allergy Watchdog</Text>
            </View>
            <View style={styles.allergyList}>
              {recentAllergyScans.map(scan => (
                <View key={scan.id} style={[styles.allergyItem, { backgroundColor: '#fef2f2', borderColor: '#fecaca' }]}>
                  <View style={styles.allergyItemLeft}>
                    <MaterialIcons name="no-food" size={20} color="#dc2626" />
                    <View>
                      <Text style={[styles.allergyFood, { color: '#991b1b' }]}>{scan.ai_identified_food}</Text>
                      <Text style={[styles.allergyDate, { color: '#b91c1c' }]}>
                        {new Date(scan.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.allergyCal, { color: '#991b1b' }]}>{scan.ai_estimated_calories} kcal</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Vet Records */}
        {vetReports.length > 0 && (
          <View style={styles.vetRecordsSection}>
            <Text style={[styles.sectionTitle, { color: '#2e2f2d' }]}>Vet Records</Text>
            <View style={{ gap: 12 }}>
              {vetReports.map(report => {
                const d = report.ai_extracted_data || {};
                const freshness = getReportFreshness(report.report_date);
                return (
                  <View key={report.id} style={[styles.vetRecordCard, { backgroundColor: '#f5f5f5', borderColor: 'rgba(0,0,0,0.05)' }]}>
                    <View style={styles.vetRecordTop}>
                      <View style={styles.vetRecordTopLeft}>
                        <MaterialIcons name="description" size={24} color="#fac129" />
                        <View>
                          <Text style={[styles.vetRecordDate, { color: '#2e2f2d' }]}>
                            {new Date(report.report_date).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}
                          </Text>
                          <Text style={[styles.vetRecordSource, { color: '#94a3b8' }]}>
                            {report.image_url === 'uploaded_scan' ? 'AI Scanned' : 'Manual'}
                          </Text>
                        </View>
                      </View>
                      {d.weight_kg && (
                        <View style={[styles.vetWeightChip, { backgroundColor: '#FFFC00' }]}>
                          <Text style={styles.vetWeightText}>{d.weight_kg} kg</Text>
                        </View>
                      )}
                    </View>
                    {freshness.message && (
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 8,
                          backgroundColor: freshness.requiresReconfirm ? '#FEE2E2' : '#FEF3C7',
                          borderRadius: 8,
                          paddingHorizontal: 10,
                          paddingVertical: 8,
                          marginTop: 8,
                        }}
                      >
                        <MaterialIcons
                          name={freshness.requiresReconfirm ? 'warning' : 'schedule'}
                          size={16}
                          color={freshness.requiresReconfirm ? '#991b1b' : '#92400e'}
                        />
                        <Text
                          style={{
                            flex: 1,
                            fontSize: 12,
                            color: freshness.requiresReconfirm ? '#991b1b' : '#92400e',
                            fontWeight: '600',
                          }}
                        >
                          {freshness.message}
                        </Text>
                      </View>
                    )}
                    {d.diagnoses?.length > 0 && (
                      <Text style={[styles.vetRecordDetail, { color: '#5b5c5a' }]}>
                        <Text style={{ fontWeight: '800' }}>Diagnoses: </Text>{d.diagnoses.join(', ')}
                      </Text>
                    )}
                    {d.medications?.length > 0 && (
                      <Text style={[styles.vetRecordDetail, { color: '#5b5c5a' }]}>
                        <Text style={{ fontWeight: '800' }}>Meds: </Text>{d.medications.map((m: any) => `${m.name} (${m.dosage})`).join(', ')}
                      </Text>
                    )}
                    {d.vet_notes && (
                      <Text style={[styles.vetRecordDetail, { color: '#5b5c5a' }]} numberOfLines={2}>
                        <Text style={{ fontWeight: '800' }}>Notes: </Text>{d.vet_notes}
                      </Text>
                    )}
                    {d.next_appointment && (
                      <View style={[styles.vetNextAppt, { backgroundColor: '#FEF3C7' }]}>
                        <MaterialIcons name="event" size={16} color="#92400e" />
                        <Text style={styles.vetNextApptText}>Next visit: {d.next_appointment}</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Vet Report CTA */}
        <LinearGradient colors={['#FFFC00', '#fac129']} style={styles.ctaCard}>
          <Text style={[styles.ctaTitle, { color: '#3d2b00' }]}>Scan Vet Report</Text>
          <Text style={[styles.ctaDesc, { color: '#3d2b00' }]}>
            Upload your vet&apos;s report and let AI extract vitals, diagnoses, and medication schedules instantly.
          </Text>
          <TouchableOpacity
            style={[styles.ctaBtn, { backgroundColor: '#3d2b00' }, isScanning && { opacity: 0.7 }]}
            activeOpacity={0.9}
            onPress={scanVetReport}
            disabled={isScanning}
          >
            {isScanning
              ? <ActivityIndicator color="#FFFC00" />
              : <Text style={[styles.ctaBtnText, { color: '#FFFC00' }]}>SCAN REPORT</Text>
            }
          </TouchableOpacity>
        </LinearGradient>

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
                <LinearGradient colors={['#FFFC00', '#fac129']} style={styles.saveBtnGradient}>
                  {isSavingWeight
                    ? <ActivityIndicator color="#1A1A1A" />
                    : <Text style={styles.saveBtnText}>SAVE WEIGHT</Text>
                  }
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity onPress={() => { Keyboard.dismiss(); setShowWeightModal(false); }} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 24, paddingBottom: 16, backgroundColor: 'rgba(255,255,255,0.95)', zIndex: 50,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatarMini: { width: 40, height: 40, borderRadius: 20, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  avatarMiniImg: { width: '100%', height: '100%' },
  headerTitle: { fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 20, letterSpacing: -0.5 },
  coinPill: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  coinText: { fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 12 },
  scrollContent: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 120 },
  heroSection: { marginBottom: 32 },
  heroTitle: { fontFamily: 'Plus Jakarta Sans', fontWeight: '900', fontSize: 36, letterSpacing: -1, marginBottom: 8 },
  heroSub: { fontFamily: 'Plus Jakarta Sans', fontWeight: '600', fontSize: 16 },

  // AI Insight Card
  insightCard: { marginBottom: 32, borderRadius: 24, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 24, elevation: 8 },
  insightGradient: { padding: 24, borderRadius: 24 },
  insightTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  insightBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(250,193,41,0.12)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  insightBadgeText: { fontFamily: 'Plus Jakarta Sans', fontWeight: '800', fontSize: 11, letterSpacing: 1.5, color: '#fac129' },
  insightTime: { fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 13, color: '#94a3b8' },
  insightText: { fontFamily: 'Plus Jakarta Sans', fontWeight: '600', fontSize: 15, lineHeight: 24, color: '#e2e8f0' },

  // Bento Grid
  bentoGrid: { marginBottom: 32 },
  bentoRow: { flexDirection: 'row', gap: 16, marginBottom: 16 },

  // Weight Card
  weightCard: { flex: 3, borderRadius: 24, padding: 20, borderWidth: 1, justifyContent: 'space-between', minHeight: 260 },
  weightHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  weightLabel: { fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 12, letterSpacing: 1 },
  weightBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  weightBadgeText: { fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 10 },
  weightValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  weightValue: { fontFamily: 'Plus Jakarta Sans', fontWeight: '900', fontSize: 44, fontStyle: 'italic' },
  weightUnit: { fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 18 },
  chartContainer: { height: 80, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 6, marginTop: 12 },
  bar: { flex: 1, borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  barGradient: { flex: 1, borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  logWeightBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12,
    backgroundColor: '#FFFC00', paddingVertical: 10, borderRadius: 14,
  },
  logWeightText: { fontFamily: 'Plus Jakarta Sans', fontWeight: '900', fontSize: 11, letterSpacing: 1, color: '#1A1A1A' },

  // Metric Cards
  metricsColumn: { flex: 2, gap: 16 },
  squareCard: { flex: 1, borderRadius: 24, padding: 16, borderWidth: 1, justifyContent: 'space-between' },
  metricValue: { fontFamily: 'Plus Jakarta Sans', fontWeight: '900', fontSize: 24, marginBottom: 2 },
  metricLabel: { fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 10, letterSpacing: 1 },

  // Hydration Card
  hydrationCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: 24, padding: 20, borderWidth: 1,
  },
  hydrationLeft: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  hydrationIconBg: { width: 48, height: 48, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  hydrationTitle: { fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 16 },
  hydrationSub: { fontFamily: 'Plus Jakarta Sans', fontWeight: '500', fontSize: 12, marginTop: 2 },
  hydrationRight: {},
  hydrationPct: { fontFamily: 'Plus Jakarta Sans', fontWeight: '900', fontSize: 28, fontStyle: 'italic' },

  // Weight Goal
  goalSection: { marginBottom: 32 },
  sectionTitle: { fontFamily: 'Plus Jakarta Sans', fontWeight: '900', fontSize: 24, marginBottom: 16, letterSpacing: -0.5 },
  goalCard: { borderRadius: 24, padding: 24, borderWidth: 1 },
  goalRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  goalWeight: { fontFamily: 'Plus Jakarta Sans', fontWeight: '900', fontSize: 18 },
  goalLabel: { fontFamily: 'Plus Jakarta Sans', fontWeight: '600', fontSize: 11, letterSpacing: 0.5 },
  goalBarContainer: { flex: 1, alignItems: 'center' },
  goalBarBg: { width: '100%', height: 8, backgroundColor: '#e5e7eb', borderRadius: 4, overflow: 'hidden' },
  goalBarFill: { height: '100%', borderRadius: 4 },
  goalPctText: { fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 12, marginTop: 6 },

  // Allergy Watchdog
  allergySection: { marginBottom: 32 },
  allergyHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  allergyList: { gap: 12 },
  allergyItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderRadius: 16, borderWidth: 1 },
  allergyItemLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  allergyFood: { fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 15 },
  allergyDate: { fontFamily: 'Plus Jakarta Sans', fontWeight: '600', fontSize: 12, marginTop: 2 },
  allergyCal: { fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 14 },

  // CTA
  ctaCard: { padding: 32, borderRadius: 24, marginBottom: 16 },
  ctaTitle: { fontFamily: 'Plus Jakarta Sans', fontWeight: '900', fontSize: 24, fontStyle: 'italic', marginBottom: 8 },
  ctaDesc: { fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 14, marginBottom: 24, lineHeight: 20, opacity: 0.8 },
  ctaBtn: { paddingVertical: 16, paddingHorizontal: 32, borderRadius: 32, alignSelf: 'flex-start', shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 20, elevation: 8 },
  ctaBtnText: { fontFamily: 'Plus Jakarta Sans', fontWeight: '900', fontSize: 12, letterSpacing: 2 },

  // Modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContent: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 32, borderTopRightRadius: 32, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40 },
  modalHandle: { width: 40, height: 5, borderRadius: 3, backgroundColor: '#d1d5db', alignSelf: 'center', marginBottom: 24 },
  modalTitle: { fontFamily: 'Plus Jakarta Sans', fontWeight: '900', fontSize: 24, color: '#1A1A1A', marginBottom: 24 },
  inputGroup: { marginBottom: 20 },
  inputLabel: { fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 14, color: '#515d64', marginBottom: 8 },
  input: { backgroundColor: '#F3F4F6', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, fontFamily: 'Plus Jakarta Sans', fontSize: 16, color: '#1A1A1A' },
  saveBtn: { borderRadius: 32, overflow: 'hidden', marginTop: 8 },
  saveBtnGradient: { paddingVertical: 16, alignItems: 'center' },
  saveBtnText: { fontFamily: 'Plus Jakarta Sans', fontWeight: '900', fontSize: 16, color: '#1A1A1A' },
  cancelBtn: { paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  cancelBtnText: { fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 16, color: '#6b7280' },

  // Vet Records
  vetRecordsSection: { marginBottom: 32 },
  vetRecordCard: { borderRadius: 20, padding: 20, borderWidth: 1 },
  vetRecordTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  vetRecordTopLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  vetRecordDate: { fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 15 },
  vetRecordSource: { fontFamily: 'Plus Jakarta Sans', fontWeight: '600', fontSize: 12, marginTop: 2 },
  vetWeightChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  vetWeightText: { fontFamily: 'Plus Jakarta Sans', fontWeight: '800', fontSize: 13, color: '#3d2b00' },
  vetRecordDetail: { fontFamily: 'Plus Jakarta Sans', fontWeight: '600', fontSize: 13, lineHeight: 20, marginBottom: 6 },
  vetNextAppt: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, marginTop: 8 },
  vetNextApptText: { fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 13, color: '#92400e' },
});
