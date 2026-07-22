import React, { useState, useCallback, useRef } from 'react';
import { withTimeout } from '../../lib/withTimeout';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, TextInput, Alert, Linking,
  KeyboardAvoidingView, Platform, TouchableWithoutFeedback, Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import Svg, { Path, Defs, LinearGradient as SvgLinearGradient, Stop, Circle } from 'react-native-svg';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { PawtchiModal } from '../../components/PawtchiModal';
import { WeightLoggedModal } from '../../components/WeightLoggedModal';
import { PawtchiButton } from '../../components/PawtchiButton';
import { PawLoader } from '../../components/loader/PawLoader';
import * as ImagePicker from 'expo-image-picker';

import { color, font, radius, shadow, space } from '../../constants/design';
import { useActivePetStore } from '../../store/useActivePetStore';
import { useStreakStore } from '../../store/useStreakStore';
import { usePetContextStore, computeDerived } from '../../store/usePetContextStore';
import { useAuth } from '../../providers/AuthProvider';
import { useSubscription } from '../../hooks/useSubscription';
import { supabase } from '../../lib/supabase';
import { calculateDailyKcal, deriveGoal } from '../../lib/healthMath';
import { validateWeeklyLossRate } from '../../lib/weightLossRate';
import { getLocalYMD, localDayStartUtcISO } from '../../lib/dateUtils';
import { waterPerSessionMl, computeWaterTargetMl } from '../../lib/hydration';
import { prepareImageForUpload } from '../../lib/imagePrep';
import { deriveLifeStage, getLifeStageCalorieMultiplier, getAgeMonths } from '../../lib/lifeStage';
import { getBreedDefaults, sizeCategoryFromWeight } from '../../lib/breedData';
import { regenerateSchedule } from '../../lib/scheduleAdjuster';
import { getReportFreshness } from '../../lib/vetReportFreshness';
import { estimateIdealWeight } from '../../lib/idealWeight';
import { evaluateMilestone, type MilestoneResult } from '../../lib/milestoneEngine';
import { track } from '../../lib/analytics';
import { appError, errorCopy, fromEdgeBody, isAppError, reportError, toAppError, type ErrorCopy, type RecoveryActionId } from '../../lib/appError';
import { haptic } from '../../lib/haptics';
import { VetScanResultModal, type VetScanResult } from '../../components/VetScanResultModal';
import { BcsRescoreSheet, type RescoreTrigger } from '../../components/BcsRescoreSheet';
import WeeklyNutritionChart, { DayMacro } from '../../components/WeeklyNutritionChart';

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

  // ── Milestone loop state ──
  // Earliest weight log = plan-start anchor for milestone progress.
  const [firstWeightLog, setFirstWeightLog] = useState<{ weight_kg: number; logged_at: string } | null>(null);
  // Open re-score sheet: why it opened + the engine result behind it.
  const [milestonePrompt, setMilestonePrompt] = useState<{ trigger: RescoreTrigger; result: MilestoneResult } | null>(null);
  // Milestone detected during a vet scan — promoted to the sheet after the
  // scan-result modal closes so the two don't stack.
  const [pendingMilestone, setPendingMilestone] = useState<{ trigger: RescoreTrigger; result: MilestoneResult } | null>(null);
  // Transparency note after a recalc: "Daily target adjusted −40 kcal".
  const [kcalDeltaNote, setKcalDeltaNote] = useState<number | null>(null);

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
    willRecalibrate: boolean;
  } | null>(null);

  // Branded vet scan success/error modals
  const [showVetScanSuccess, setShowVetScanSuccess] = useState(false);
  const [vetScanResult, setVetScanResult] = useState<VetScanResult | null>(null);
  // Branded failure sheet for the scan / report paths. retryRef replays the
  // operation that failed; pick-again reopens the source chooser.
  const [failure, setFailure] = useState<ErrorCopy | null>(null);
  const retryRef = useRef<null | (() => void)>(null);
  const handleRecovery = useCallback((action: RecoveryActionId) => {
    setFailure(null);
    if (action === 'retry') retryRef.current?.();
    else if (action === 'pick_again') scanVetReport();
    else if (action === 'open_settings') Linking.openSettings().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Delete-report confirm flow
  const [reportToDelete, setReportToDelete] = useState<{ id: string; date: string } | null>(null);

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

    // Local-day strings — log_date / scheduled_date are DATE columns; using
    // UTC dates here would mis-bucket boundary days for owners east of UTC.
    const todayStr = getLocalYMD(today);
    const sevenStr = getLocalYMD(sevenDaysAgo);
    const fourteenStr = getLocalYMD(fourteenDaysAgo);
    const hasAllergies = !!(activePet.allergies && activePet.allergies.length > 0);

    try {
      // All reads are independent → fire them in parallel instead of a serial
      // waterfall, then process + batch the setState calls so the screen paints once.
      const [wLogsRes, scans7Res, actsThisRes, actsLastRes, waterRes, insightRes, allergyRes, vReportsRes, firstLogRes] = await Promise.all([
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
          .gte('created_at', localDayStartUtcISO(sevenDaysAgo)),
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
        // Earliest weight log — plan-start anchor for milestone progress.
        supabase
          .from('weight_logs')
          .select('weight_kg, logged_at')
          .eq('pet_id', activePet.id)
          .order('logged_at', { ascending: true })
          .limit(1),
      ]);

      // 2. Weekly Macros (Last 7 days of food_scans).
      // Bucket by LOCAL day, not UTC — owners east of UTC otherwise see scans
      // shifted to the wrong day (e.g. a 02:00 IST scan would land in
      // "yesterday's" bucket).
      const scans7 = scans7Res.data;
      const daysArr: DayMacro[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dateStr = getLocalYMD(d);
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
        const scanDate = getLocalYMD(new Date(scan.created_at));
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
        const dateStr = getLocalYMD(d);
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
      // Single source for the drinking target — diet-aware (wet-fed pets get most
      // water from food), same function Home uses. Never inline weight × 50.
      const targetMl = computeWaterTargetMl(activePet.current_weight_kg || 10, activePet.diet_type);

      const hydDaysArr: { day: string; ml: number; targetMl: number; isToday: boolean }[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dateStr = getLocalYMD(d);
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

      // Onboarding weight is written to `pets.current_weight_kg` but NOT to
      // `weight_logs` — so a brand-new pet has an empty logs table and this
      // screen would say "NO WEIGHT YET" even though the value the owner just
      // entered is right there on the pet row. Synthesize a virtual first
      // entry from the pet's onboarding weight + created_at so it anchors the
      // trend, the list, and the milestone loop like any other log.
      const realLogs = wLogsRes.data || [];
      const realFirst = firstLogRes.data?.[0] ?? null;
      const onboardingLog =
        realLogs.length === 0 && activePet.current_weight_kg > 0
          ? {
              id: `onboarding-${activePet.id}`,
              pet_id: activePet.id,
              weight_kg: activePet.current_weight_kg,
              logged_at: activePet.created_at || new Date().toISOString(),
              notes: null,
              source: 'onboarding',
            }
          : null;
      setWeightLogs(onboardingLog ? [onboardingLog] : realLogs);
      setFirstWeightLog(realFirst ?? (onboardingLog ? {
        weight_kg: onboardingLog.weight_kg,
        logged_at: onboardingLog.logged_at,
      } : null));
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

  // Scan Vet Report — show Take a photo / Choose from library first.
  const scanVetReport = () => {
    if (!checkAccess()) return;
    if (!activePet) return;
    if (isScanning) return; // prevent re-launching while a scan is in flight
    Alert.alert(
      'Scan a vet report',
      'Use your camera or pick a saved image.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Choose from library', onPress: () => pickAndUploadVetReport('library') },
        { text: 'Take a photo', onPress: () => pickAndUploadVetReport('camera') },
      ],
      { cancelable: true },
    );
  };

  const pickAndUploadVetReport = async (source: 'camera' | 'library') => {
    if (!activePet) return;
    if (isScanning) return;
    retryRef.current = () => pickAndUploadVetReport(source);

    // Lock the button before the picker so a rapid double-tap can't insert two rows.
    setIsScanning(true);
    try {
      let result: ImagePicker.ImagePickerResult;
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          setFailure(errorCopy(appError('permission', 'camera permission denied'), { context: 'vet_scan' }));
          setIsScanning(false);
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 0.8,
          base64: true,
        });
      } else {
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.8,
          base64: true,
        });
      }

      if (result.canceled || !result.assets?.[0]) {
        setIsScanning(false);
        return;
      }
      // Downscale before the network round trip; falls back to the picker's
      // original base64 when the manipulator can't process the image.
      const prepared = await prepareImageForUpload(result.assets[0]);
      const base64 = prepared.base64;
      if (!base64) {
        setIsScanning(false);
        return;
      }
      // Pre-check size before round-tripping to the function (5MB raw cap).
      if (base64.length * 0.75 > 5_000_000) {
        setFailure({
          title: 'That photo is too large',
          message: 'Crop it or pick a lower-resolution photo, then scan again.',
          actions: [{ label: 'Try another photo', action: 'pick_again' }, { label: 'Not now', action: 'dismiss' }],
        });
        setIsScanning(false);
        return;
      }
      const mimeType = prepared.mimeType;
      console.log(`[VetScan] picked image source=${source} sizeKB=${Math.round(base64.length * 0.75 / 1024)} mime=${mimeType} downscaled=${prepared.downscaled}`);

      await runVetScan(base64, mimeType);
    } catch (e: unknown) {
      const appErr = isAppError(e) ? e : toAppError(e);
      reportError(appErr, 'vet_scan');
      console.warn('[VetScan] failed: picker stage', appErr.technical);
      setFailure(errorCopy(appErr, { context: 'vet_scan', petName: activePet?.name }));
    } finally {
      setIsScanning(false);
    }
  };

  const runVetScan = async (imageBase64: string, mimeType: string) => {
    if (!activePet) return;
    retryRef.current = () => runVetScan(imageBase64, mimeType);
    const startedAt = Date.now();
    try {
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      // 60s client-side timeout — twice the edge function's internal Gemini cap.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60_000);

      console.log('[VetScan] calling edge function');
      let res: Response;
      try {
        res = await fetch(`${supabaseUrl}/functions/v1/scan-vet-report`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            imageBase64,
            mimeType,
            petId: activePet.id,
            petProfile: activePet,
          }),
          signal: controller.signal,
        });
      } catch (fetchErr: any) {
        if (fetchErr?.name === 'AbortError') {
          throw appError('timeout', 'vet scan aborted after 60s client cap');
        }
        throw fetchErr;
      } finally {
        clearTimeout(timeoutId);
      }

      // Text-first read so we can distinguish empty / non-JSON / error-JSON
      // bodies and produce a useful message for each.
      const bodyText = await res.text();
      const contentType = res.headers.get('content-type') || 'unknown';
      console.log(`[VetScan] response status=${res.status} contentType=${contentType} bytes=${bodyText.length}`);

      if (!res.ok) {
        // A coded body (rate_limited, ai_unavailable, ...) beats the bare
        // status; either way the status lands in the technical log.
        let errBody: any = null;
        try { errBody = JSON.parse(bodyText); } catch { /* not json */ }
        throw fromEdgeBody(errBody) ?? appError('server', `vet scan HTTP ${res.status}`);
      }
      if (bodyText.length === 0) {
        // Almost always a dropped tunnel POST in dev (expo --tunnel drops
        // large uploads) — the detail lives in the technical log.
        throw appError('offline', 'empty response body — dropped tunnel POST? use LAN (npx expo start)');
      }
      let data: any;
      try {
        data = JSON.parse(bodyText);
      } catch {
        throw appError('server', `non-JSON scan response, first 200 chars: ${bodyText.slice(0, 200)}`);
      }
      if (!data.success) {
        throw fromEdgeBody(data) ?? appError('server', 'scan success=false with no error_code');
      }
      console.log(`[VetScan] parsed success=true hasExtracted=${!!data.extracted_data}`);

      const ext = data.extracted_data || {};

      // ── Snapshot prior state for the success summary + recalibration. ──
      const prevWeight = activePet.current_weight_kg ?? null;
      const prevCalories = activePet.target_daily_calories ?? 0;
      const prevGoal = deriveGoal(prevWeight ?? 0, activePet.target_weight_kg, activePet.body_condition_score);
      const prevDiagnoses = new Set(activePet.medical_conditions || []);
      const prevAllergies = new Set(activePet.allergies || []);

      // ── Recalibrate calorie target + schedule when a fresh weight came in. ──
      const newWeight: number | null = typeof ext.weight_kg === 'number' && ext.weight_kg > 0
        ? ext.weight_kg
        : null;
      let newCalories: number | null = null;
      let scheduleRegenerated = false;
      let newGoal = prevGoal;
      if (newWeight && activePet.species) {
        newGoal = deriveGoal(newWeight, activePet.target_weight_kg, activePet.body_condition_score);
        const ageYears = activePet.age_years ?? 0;
        const ageMonths = getAgeMonths(activePet);

        const breedDefs = getBreedDefaults(activePet.species, activePet.breed ?? null, newWeight);
        const sizeCat = breedDefs?.sizeCategory ?? sizeCategoryFromWeight(activePet.species, newWeight);
        const lifeStage = deriveLifeStage(activePet.species, Math.floor(ageYears), Math.round((ageYears % 1) * 12), sizeCat);
        const lsMultiplier = getLifeStageCalorieMultiplier(lifeStage, activePet.species);
        const metabMod = breedDefs?.metabolicModifier ?? 1.0;
        newCalories = calculateDailyKcal(
          newWeight,
          activePet.species,
          activePet.is_neutered,
          activePet.activity_level,
          newGoal,
          ageMonths,
          lsMultiplier,
          activePet.target_weight_kg,
          metabMod,
          activePet.body_condition_score,
        );
        console.log(`[VetScan] recalibrate weight=${newWeight} prev=${prevWeight ?? 'null'} newKcal=${newCalories}`);
        // Optimistic store update so Home + Health derive off new target instantly.
        useActivePetStore.getState().updatePetWeight(newWeight, newCalories);
        try {
          // The edge function wrote current_weight_kg but not the recomputed target.
          const { error: updErr } = await supabase.from('pets').update({
            target_daily_calories: newCalories,
          }).eq('id', activePet.id);
          if (updErr) throw updErr;
          console.log(`[VetScan] persisted target_daily_calories=${newCalories}`);

          const weightDeltaKg = prevWeight !== null ? Math.abs(newWeight - prevWeight) : 0;
          const goalFlipped = prevGoal !== newGoal;
          if (activePet.id && (weightDeltaKg >= 0.3 || goalFlipped)) {
            console.log(`[VetScan] schedule regenerate trigger=${goalFlipped ? 'goal' : 'delta'} weightDelta=${weightDeltaKg.toFixed(2)}`);
            useActivePetStore.getState().setRecalibrating(true);
            const refreshed = useActivePetStore.getState().activePet ?? activePet;
            const ctx = usePetContextStore.getState();
            const sched = await regenerateSchedule({
              pet: refreshed,
              weeklyStats: null,
              todayCalPercent: ctx.calPercent ?? 0,
              weightTrendDirection: ctx.weightTrend?.direction ?? null,
            });
            scheduleRegenerated = sched.success;
            if (scheduleRegenerated) {
              const newWaterPerSession = waterPerSessionMl(newWeight, activePet.diet_type);
              const todayStr = getLocalYMD(new Date());
              await supabase
                .from('activities')
                .update({ water_ml: newWaterPerSession })
                .eq('pet_id', activePet.id)
                .eq('activity_type', 'water')
                .eq('scheduled_date', todayStr)
                .eq('status', 'pending');
            }
          }
        } catch (recalErr) {
          // Revert the optimistic write so the UI doesn't display a target
          // the DB never accepted.
          if (user?.id) {
            await useActivePetStore.getState().fetchPet(user.id, { silent: true });
          }
          throw recalErr;
        }

        // Milestone check on the scanned weight — promoted to the re-score
        // sheet after the scan-result modal closes.
        const milestone = evaluateMilestoneForWeights(newWeight, prevWeight);
        if (milestone) setPendingMilestone(milestone);
      }

      // Pull post-write pet so we can diff diagnoses/allergies the edge function merged.
      if (user?.id) {
        await useActivePetStore.getState().fetchPet(user.id, { silent: true });
      }
      const postPet = useActivePetStore.getState().activePet ?? activePet;
      const newDiagnoses = (postPet.medical_conditions || []).filter((d) => !prevDiagnoses.has(d));
      const newAllergies = (postPet.allergies || []).filter((a) => !prevAllergies.has(a));

      if (activePet.id) {
        // Explicit post-write refresh — bypass the staleness guard.
        usePetContextStore.getState().refreshTrends(activePet.id, { force: true });
        usePetContextStore.getState().refreshToday(activePet.id, { force: true });
      }
      // Refresh this screen's own lists (vet reports, weight) past the guard.
      fetchHealthData({ force: true });

      const weightDiff = newWeight !== null && prevWeight !== null ? newWeight - prevWeight : null;
      const calorieDiff = newCalories !== null && prevCalories > 0 && prevCalories !== newCalories
        ? newCalories - prevCalories
        : null;
      const medicationsCount = Array.isArray(ext.medications) ? ext.medications.length : 0;
      const vaccinationsCount = Array.isArray(ext.vaccinations) ? ext.vaccinations.length : 0;
      const bcs = typeof ext.body_condition_score === 'number' ? ext.body_condition_score : null;
      const waterMlPerSession = scheduleRegenerated && newWeight ? waterPerSessionMl(newWeight, activePet.diet_type) : null;

      // "Useful data" gates the celebration tone + coin reward. An unreadable
      // photo where Gemini only filled vet_notes shouldn't pay out.
      const hasUsefulData =
        newWeight !== null ||
        bcs !== null ||
        newDiagnoses.length > 0 ||
        newAllergies.length > 0 ||
        medicationsCount > 0 ||
        vaccinationsCount > 0 ||
        !!ext.next_appointment;

      // Coins are awarded server-side; show the chip locally for instant feedback.
      const coinsAwarded = hasUsefulData ? 25 : 0;

      // Defensive: even when hasUsefulData is false, never surface JSON-shaped
      // notes as the "couldn't read" hint.
      const cantReadHint = (() => {
        if (hasUsefulData || typeof ext.vet_notes !== 'string') return null;
        const trimmed = ext.vet_notes.trim();
        if (trimmed.startsWith('{') || /"[a-z_]+"\s*:/i.test(trimmed)) return null;
        return trimmed.slice(0, 160);
      })();

      haptic.success();
      setVetScanResult({
        weight: newWeight,
        bcs,
        newDiagnoses,
        newAllergies,
        medicationsCount,
        vaccinationsCount,
        nextAppointment: ext.next_appointment || null,
        prevWeight,
        weightDiff,
        prevCalories,
        newCalories,
        calorieDiff,
        scheduleRegenerated,
        waterMlPerSession,
        coinsAwarded,
        hasUsefulData,
        cantReadHint,
      });
      setShowVetScanSuccess(true);

      track('vet_report_scanned', {
        has_weight: newWeight !== null,
        has_bcs: bcs !== null,
        diagnoses_added: newDiagnoses.length,
        allergies_added: newAllergies.length,
        calorie_delta: calorieDiff ?? 0,
        schedule_regenerated: scheduleRegenerated,
        useful: hasUsefulData,
      });

      if (hasUsefulData && user?.id) {
        awardCoins(user.id, 'vet_report_log', data.report_id);
      }
      console.log(`[VetScan] done in ${Date.now() - startedAt}ms`);
    } catch (e: unknown) {
      const appErr = isAppError(e) ? e : toAppError(e);
      reportError(appErr, 'vet_scan');
      console.warn(`[VetScan] failed after ${Date.now() - startedAt}ms:`, appErr.technical);
      setFailure(errorCopy(appErr, { context: 'vet_scan', petName: activePet.name }));
    } finally {
      setIsScanning(false);
      useActivePetStore.getState().setRecalibrating(false);
    }
  };

  // Delete a vet report row (used for clearing failed/duplicate scans).
  const deleteReportById = async (id: string) => {
    retryRef.current = () => deleteReportById(id);
    // Optimistic removal so the timeline updates instantly.
    setVetReports((prev) => prev.filter((r) => r.id !== id));
    setReportToDelete(null);
    try {
      const { error } = await supabase.from('vet_reports').delete().eq('id', id);
      if (error) throw error;
    } catch (e: unknown) {
      // Restore on failure.
      fetchHealthData({ force: true });
      const appErr = toAppError(e);
      reportError(appErr, 'report');
      setFailure(errorCopy(appErr, { context: 'report' }));
    }
  };

  const confirmDeleteReport = () => {
    if (!reportToDelete) return;
    deleteReportById(reportToDelete.id);
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

      const res = await withTimeout(
        fetch(`${supabaseUrl}/functions/v1/generate-health-insight`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ petId: activePet.id }),
        }),
        45_000,
        'generate-health-insight',
      );

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
      const prevGoal = deriveGoal(prevWeight ?? weight, activePet.target_weight_kg, activePet.body_condition_score);
      const prevCalories = activePet.target_daily_calories ?? 0;

      // Recalculate daily calorie target based on new weight
      const goal = deriveGoal(weight, activePet.target_weight_kg, activePet.body_condition_score);

      // A meaningful weight move (≥0.3 kg) or a flipped goal rebuilds the
      // activity schedule. Decide this up front so the success modal and every
      // tab can show a "recalibrating" state from the moment the log lands.
      const weightDeltaKg = prevWeight !== null ? Math.abs(weight - prevWeight) : 0;
      const goalFlipped = prevGoal !== goal;
      const willRecalibrate = !!activePet.id && (weightDeltaKg >= 0.3 || goalFlipped);

      const ageYears = activePet.age_years ?? 0;
      const ageMonths = getAgeMonths(activePet);
      const breedDefs = getBreedDefaults(activePet.species, activePet.breed ?? null, weight);
      const sizeCat = breedDefs?.sizeCategory ?? sizeCategoryFromWeight(activePet.species, weight);
      const lifeStage = deriveLifeStage(activePet.species, Math.floor(ageYears), Math.round((ageYears % 1) * 12), sizeCat);
      const lsMultiplier = getLifeStageCalorieMultiplier(lifeStage, activePet.species);
      const metabMod = breedDefs?.metabolicModifier ?? 1.0;
      // Cat ramp: compute days since pet creation so the first 14 days of a
      // lose plan get the gentler ramp floor (hepatic lipidosis prevention).
      const createdAt = (activePet as { created_at?: string | null }).created_at;
      const daysSincePlanStart = createdAt
        ? Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24)))
        : undefined;
      let newCalories = calculateDailyKcal(
        weight,
        activePet.species,
        activePet.is_neutered,
        activePet.activity_level,
        goal,
        ageMonths,
        lsMultiplier,
        activePet.target_weight_kg,
        metabMod,
        activePet.body_condition_score,
        daysSincePlanStart,
      );

      // ── Weight-loss rate safety check ──
      // Fetch the most recent prior weight log to compute the actual rate of
      // loss. A dangerous rate (dog ≥3%/wk, cat ≥2%/wk) means we ease the
      // plan upward by 10% and warn the owner. Especially important for cats
      // where fast loss → hepatic lipidosis risk.
      let lossRateWarning: { species: 'dog' | 'cat'; pctPerWeek: number } | null = null;
      try {
        const { data: priorLogs } = await supabase
          .from('weight_logs')
          .select('weight_kg, created_at')
          .eq('pet_id', activePet.id)
          .order('created_at', { ascending: false })
          .limit(1);
        const prior = priorLogs?.[0];
        if (prior && typeof prior.weight_kg === 'number' && prior.created_at) {
          const daysBetween = (Date.now() - new Date(prior.created_at).getTime()) / (1000 * 60 * 60 * 24);
          const rate = validateWeeklyLossRate(weight, prior.weight_kg, daysBetween, activePet.species as 'dog' | 'cat');
          if (rate.status === 'dangerous') {
            newCalories = Math.round(newCalories * 1.10);
            lossRateWarning = { species: activePet.species as 'dog' | 'cat', pctPerWeek: rate.pctPerWeek };
            try { track('weight_loss_rate_dangerous', { pct_per_week: Math.round(rate.pctPerWeek * 10) / 10, species: activePet.species }); } catch { /* analytics best-effort */ }
          }
        }
      } catch {
        // Safety net is best-effort. If the query fails, fall through to the
        // normal flow rather than blocking the weight log itself.
      }

      // ---- HOT RELOAD: Optimistic UI update (instant, no flicker) ----
      // Update pet store immediately so home tab and all listeners see new weight + calories
      useActivePetStore.getState().updatePetWeight(weight, newCalories);

      // Flip the shared recalibrating signal on the moment kcal is correct, so
      // Activity/Meal show "recalibrating" instead of a wrong empty state while
      // the schedule rebuilds below. Cleared in the finally block.
      if (willRecalibrate) useActivePetStore.getState().setRecalibrating(true);

      // Persist weight log to DB
      await supabase.from('weight_logs').insert({
        pet_id: activePet.id,
        weight_kg: weight,
        notes: weightNotes || null,
        source: 'manual',
      });

      if (lossRateWarning) {
        Alert.alert(
          'Losing weight too fast',
          `${activePet.name} has lost about ${lossRateWarning.pctPerWeek.toFixed(1)}% of body weight per week — faster than vets recommend (≤${lossRateWarning.species === 'cat' ? '1' : '1.5'}% for ${lossRateWarning.species}s).\n\nWe've eased today's calorie target up by 10%. Please check in with your vet — fast weight loss can be especially risky for ${lossRateWarning.species === 'cat' ? 'cats (hepatic lipidosis)' : 'muscle health'}.`,
          [{ text: 'OK' }],
        );
      }

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
      haptic.success();
      setWeightSuccessData({
        weight,
        prevCalories,
        newCalories,
        calorieDiff,
        weightDiff,
        scheduleRegenerated: false,
        goal,
        willRecalibrate,
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
        todayActivityTargetMinutes: ctx.todayActivityTargetMinutes,
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
      // `willRecalibrate` was decided up front (see above) so the UI could react instantly.
      let scheduleRegenerated = false;
      if (willRecalibrate) {
        const refreshed = useActivePetStore.getState().activePet ?? activePet;
        const result = await regenerateSchedule({
          pet: refreshed,
          weeklyStats: null,
          todayCalPercent: derived.calPercent,
          weightTrendDirection: ctx.weightTrend?.direction ?? null,
        });
        scheduleRegenerated = result.success;

        if (scheduleRegenerated) {
          const newWaterPerSession = waterPerSessionMl(weight, activePet.diet_type);
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
      // ---- MILESTONE LOOP: did this log cross a stage target? ----
      // Evaluated after everything persisted; the sheet opens once the
      // weight-success modal closes so the two never stack.
      const milestone = evaluateMilestoneForWeights(weight, prevWeight);
      if (milestone) setPendingMilestone(milestone);
    } catch (e: any) {
      // Revert optimistic update on failure
      if (user?.id) {
        await useActivePetStore.getState().fetchPet(user.id, { silent: true });
      }
    } finally {
      setIsSavingWeight(false);
      // Rebuild finished (or failed) — clear the shared signal so tabs settle.
      useActivePetStore.getState().setRecalibrating(false);
    }
  };

  // ── Milestone loop helpers ──

  // Weight log nearest to the BCS recording time — the anchor for predicting
  // how the score has drifted. Best-effort from the logs already loaded.
  const bcsAnchorWeight = (bcsUpdatedAt: string | null): number | null => {
    if (!bcsUpdatedAt) return null;
    const at = Date.parse(bcsUpdatedAt);
    if (!Number.isFinite(at)) return null;
    const candidates = [...weightLogs, ...(firstWeightLog ? [firstWeightLog] : [])]
      .filter((l) => typeof l.weight_kg === 'number' && l.logged_at);
    let best: { weight_kg: number } | null = null;
    let bestDist = Infinity;
    for (const l of candidates) {
      const d = Math.abs(Date.parse(l.logged_at) - at);
      if (Number.isFinite(d) && d < bestDist) { bestDist = d; best = l; }
    }
    return best?.weight_kg ?? null;
  };

  const evaluateMilestoneForWeights = (
    newWeight: number,
    prevWeight: number | null,
  ): { trigger: RescoreTrigger; result: MilestoneResult } | null => {
    if (!activePet) return null;
    const bcsUpdatedAt = activePet.bcs_updated_at ?? activePet.created_at ?? null;
    const result = evaluateMilestone({
      species: activePet.species,
      breed: activePet.breed ?? null,
      sex: activePet.gender ?? null,
      ageMonths: getAgeMonths(activePet),
      startWeightKg: firstWeightLog?.weight_kg ?? prevWeight ?? null,
      previousWeightKg: prevWeight,
      currentWeightKg: newWeight,
      stageTargetKg: activePet.target_weight_kg ?? null,
      bcs: activePet.body_condition_score ?? null,
      bcsUpdatedAt,
      bcsAnchorWeightKg: bcsAnchorWeight(bcsUpdatedAt),
    });
    if (result.event === 'stage_reached' || result.event === 'final_reached') {
      track('milestone_reached', {
        event: result.event,
        progress_pct: result.progressPct,
        next_target_kg: result.nextStage?.targetKg ?? null,
        final_ideal_kg: result.finalIdealKg,
      });
      return { trigger: result.event, result };
    }
    return null;
  };

  // Apply a BCS re-score (owner-picked, or drift-predicted on dismissal):
  // fresh ideal-weight estimate at today's weight → next stage target →
  // recalculated calories → persisted + schedule regenerated. The same loop
  // a vet runs at a recheck appointment.
  const applyBcsRescore = async (pickedBcs: number | null) => {
    const prompt = milestonePrompt;
    setMilestonePrompt(null);
    if (!activePet || !prompt) return;

    const predictedUsed = pickedBcs == null;
    const newBcs = pickedBcs ?? prompt.result.predictedBcs ?? activePet.body_condition_score ?? null;
    if (newBcs == null) return;

    const weight = activePet.current_weight_kg;
    const prevCalories = activePet.target_daily_calories ?? 0;

    try {
      const estimate = estimateIdealWeight({
        species: activePet.species,
        breed: activePet.breed ?? null,
        sex: activePet.gender ?? null,
        ageMonths: getAgeMonths(activePet),
        currentWeightKg: weight,
        bcs: newBcs,
      });
      const newTarget = estimate.mode === 'ok' && estimate.targetKg != null
        ? estimate.targetKg
        : activePet.target_weight_kg ?? null;

      const goal = deriveGoal(weight, newTarget, newBcs);
      const ageMonths = getAgeMonths(activePet);
      const breedDefs = getBreedDefaults(activePet.species, activePet.breed ?? null, weight);
      const sizeCat = breedDefs?.sizeCategory ?? sizeCategoryFromWeight(activePet.species, weight);
      const ageYears = activePet.age_years ?? 0;
      const lifeStage = deriveLifeStage(activePet.species, Math.floor(ageYears), Math.round((ageYears % 1) * 12), sizeCat);
      const lsMultiplier = getLifeStageCalorieMultiplier(lifeStage, activePet.species);
      const newCalories = calculateDailyKcal(
        weight,
        activePet.species,
        activePet.is_neutered,
        activePet.activity_level,
        goal,
        ageMonths,
        lsMultiplier,
        newTarget,
        breedDefs?.metabolicModifier ?? 1.0,
        newBcs,
      );

      const { error } = await supabase.from('pets').update({
        body_condition_score: newBcs,
        bcs_updated_at: new Date().toISOString(),
        target_weight_kg: newTarget,
        target_daily_calories: newCalories,
      }).eq('id', activePet.id);
      if (error) throw error;

      // Optimistic calories + full silent refresh for the rest of the row.
      useActivePetStore.getState().updatePetWeight(weight, newCalories);
      if (user?.id) await useActivePetStore.getState().fetchPet(user.id, { silent: true });
      usePetContextStore.getState().invalidateContext();

      if (newCalories !== prevCalories) setKcalDeltaNote(newCalories - prevCalories);

      // Stage advance usually flips or re-aims the plan — regenerate.
      useActivePetStore.getState().setRecalibrating(true);
      const refreshed = useActivePetStore.getState().activePet ?? activePet;
      const ctx = usePetContextStore.getState();
      await regenerateSchedule({
        pet: refreshed,
        weeklyStats: null,
        todayCalPercent: ctx.calPercent ?? 0,
        weightTrendDirection: ctx.weightTrend?.direction ?? null,
      });

      track('bcs_rescored', {
        source: prompt.trigger,
        old_bcs: activePet.body_condition_score ?? null,
        new_bcs: newBcs,
        predicted_used: predictedUsed,
        new_target_kg: newTarget,
        calorie_delta: newCalories - prevCalories,
      });
      haptic.success();
    } catch (e) {
      console.warn('[Milestone] re-score apply failed:', e);
      if (user?.id) await useActivePetStore.getState().fetchPet(user.id, { silent: true });
    } finally {
      useActivePetStore.getState().setRecalibrating(false);
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

  // Milestone view for display: progress toward the FINAL ideal (not the
  // stage target) + BCS staleness. previousWeightKg = current suppresses
  // stage events — those only fire from actual weight logs.
  const milestoneView = activePet && activePet.current_weight_kg > 0
    ? evaluateMilestone({
        species: activePet.species,
        breed: activePet.breed ?? null,
        sex: activePet.gender ?? null,
        ageMonths: getAgeMonths(activePet),
        startWeightKg: firstWeightLog?.weight_kg ?? activePet.current_weight_kg,
        previousWeightKg: activePet.current_weight_kg,
        currentWeightKg: activePet.current_weight_kg,
        stageTargetKg: activePet.target_weight_kg ?? null,
        bcs: activePet.body_condition_score ?? null,
        bcsUpdatedAt: activePet.bcs_updated_at ?? activePet.created_at ?? null,
        bcsAnchorWeightKg: null,
      })
    : null;

  // Stage-relative fallback when the milestone view can't compute (no logs yet).
  const stageRelativePct = hasWeightGoal && hasWeightData
    ? Math.min(Math.round(
      Math.abs(1 - (Math.abs((currentWeight ?? activePet!.current_weight_kg!) - activePet!.target_weight_kg!) /
        Math.abs((weightLogs[weightLogs.length - 1]?.weight_kg || activePet!.current_weight_kg) - activePet!.target_weight_kg!))) * 100
    ), 100)
    : 0;
  const weightGoalPct = milestoneView?.progressPct ?? stageRelativePct;
  // The final ideal, when it differs meaningfully from the stored stage —
  // lets the goal line read "stage 42 kg · ideal 37 kg".
  const finalIdealForDisplay = milestoneView?.finalIdealKg != null
    && activePet?.target_weight_kg != null
    && Math.abs(milestoneView.finalIdealKg - activePet.target_weight_kg) > 0.5
    ? milestoneView.finalIdealKg
    : null;

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
                ? finalIdealForDisplay != null
                  ? `stage ${Number(activePet?.target_weight_kg || 0).toFixed(1)} kg · ideal ${finalIdealForDisplay.toFixed(1)} kg · ${weightGoalPct}% there`
                  : `goal ${Number(activePet?.target_weight_kg || 0).toFixed(1)} kg · ${Math.abs((activePet?.current_weight_kg || 0) - (activePet?.target_weight_kg || 0)).toFixed(1)} kg to go`
                : `${petName}’s weight over time`}
            </Text>

            {hasWeightGoal && (
              <View style={styles.goalTrack}>
                <View style={[styles.goalFill, { width: `${Math.max(weightGoalPct, 4)}%` }]} />
              </View>
            )}

            {kcalDeltaNote != null && kcalDeltaNote !== 0 && (
              <Text style={styles.kcalDeltaNote}>
                Daily target adjusted {kcalDeltaNote > 0 ? '+' : ''}{kcalDeltaNote} kcal
              </Text>
            )}

            {/* Stale-BCS prompt — the plan is running on an old body-shape
                assessment. Tapping opens the same re-score sheet. */}
            {milestoneView?.event === 'bcs_stale' && !milestonePrompt && (
              <TouchableOpacity
                activeOpacity={0.8}
                style={styles.staleBcsCard}
                onPress={() => setMilestonePrompt({ trigger: 'bcs_stale', result: milestoneView })}
              >
                <MaterialIcons name="pets" size={16} color={color.navy} />
                <Text style={styles.staleBcsText}>
                  Quick body check — {petName}&apos;s shape hasn&apos;t been updated in a while. Tap to re-check.
                </Text>
              </TouchableOpacity>
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

              {isGeneratingInsight ? null : healthInsight?.insight_data ? (
                <>
                  <Text style={styles.insightHeadline}>
                    {healthInsight.insight_data.headline}
                  </Text>

                  {Array.isArray(healthInsight.insight_data.wins) && healthInsight.insight_data.wins.length > 0 && (
                    <View style={styles.insightList}>
                      {healthInsight.insight_data.wins.slice(0, 3).map((w: string, i: number) => (
                        <View key={`win-${i}`} style={styles.insightListRow}>
                          <MaterialIcons name="check" size={14} color={color.yellow} style={styles.insightListIcon} />
                          <Text style={styles.insightListText}>{w}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {Array.isArray(healthInsight.insight_data.concerns) && healthInsight.insight_data.concerns.length > 0 && (
                    <View style={styles.insightList}>
                      {healthInsight.insight_data.concerns.slice(0, 2).map((c: string, i: number) => (
                        <View key={`concern-${i}`} style={styles.insightListRow}>
                          <MaterialIcons name="priority-high" size={14} color="#fca5a5" style={styles.insightListIcon} />
                          <Text style={[styles.insightListText, styles.insightConcernText]}>{c}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  <View style={styles.insightTipRow}>
                    <View style={styles.insightTipMark} />
                    <Text style={styles.insightTip}>
                      {healthInsight.insight_data.tip || "Maintain the current routine based on this week's data."}
                    </Text>
                  </View>

                  {healthInsight.insight_data.comparison && (() => {
                    const c = healthInsight.insight_data.comparison;
                    const chips: { label: string; value: string }[] = [];
                    if (c.caloriesVsLastWeek && c.caloriesVsLastWeek !== 'N/A') chips.push({ label: 'kcal', value: c.caloriesVsLastWeek });
                    if (c.activityVsLastWeek && c.activityVsLastWeek !== 'N/A') chips.push({ label: 'activity', value: c.activityVsLastWeek });
                    if (c.waterVsLastWeek && c.waterVsLastWeek !== 'N/A') chips.push({ label: 'water', value: c.waterVsLastWeek });
                    if (chips.length === 0) return null;
                    return (
                      <View style={styles.insightDeltaRow}>
                        <Text style={styles.insightDeltaCaption}>vs last week</Text>
                        <View style={styles.insightDeltaChips}>
                          {chips.map((chip, i) => {
                            const positive = chip.value.trim().startsWith('+');
                            const negative = chip.value.trim().startsWith('-');
                            return (
                              <View key={i} style={styles.insightDeltaChip}>
                                <Text style={styles.insightDeltaLabel}>{chip.label}</Text>
                                <Text style={[
                                  styles.insightDeltaValue,
                                  positive && styles.insightDeltaPositive,
                                  negative && styles.insightDeltaNegative,
                                ]}>{chip.value}</Text>
                              </View>
                            );
                          })}
                        </View>
                      </View>
                    );
                  })()}
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
                          <TouchableOpacity
                            onPress={() => setReportToDelete({ id: report.id, date: report.report_date })}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            style={styles.timelineDeleteBtn}
                            accessibilityLabel="Delete this report"
                          >
                            <MaterialIcons name="delete-outline" size={16} color={color.slateFaint} />
                          </TouchableOpacity>
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
                            <Text style={styles.timelineDetailLabel}>Meds · </Text>{d.medications
                              .map((m: any) => {
                                const name = (m?.name || '').toString().trim();
                                const dose = (m?.dosage || '').toString().trim();
                                if (!name) return null;
                                return dose ? `${name} · ${dose}` : name;
                              })
                              .filter(Boolean)
                              .join(', ')}
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
        <WeightLoggedModal
          visible={showWeightSuccess}
          onClose={() => {
            setShowWeightSuccess(false);
            // A milestone detected during this weigh-in opens its sheet now,
            // after the success beat — never stacked on top of it.
            if (pendingMilestone) {
              setMilestonePrompt(pendingMilestone);
              setPendingMilestone(null);
            }
          }}
          petName={activePet?.name || 'your pet'}
          weight={weightSuccessData.weight}
          weightDiff={weightSuccessData.weightDiff}
          prevCalories={weightSuccessData.prevCalories}
          newCalories={weightSuccessData.newCalories}
          calorieDiff={weightSuccessData.calorieDiff}
          goal={weightSuccessData.goal}
          willRecalibrate={weightSuccessData.willRecalibrate}
          progressPct={milestoneView?.progressPct ?? null}
        />
      )}

      {/* Vet scan result sheet — premium calibration card */}
      <VetScanResultModal
        visible={showVetScanSuccess}
        result={vetScanResult}
        pet={{
          name: activePet?.name || 'your pet',
          imageUrl: activePet?.image_url,
          species: activePet?.species,
          gender: activePet?.gender,
          currentWeightKg: activePet?.current_weight_kg ?? null,
          targetWeightKg: activePet?.target_weight_kg ?? null,
          targetDailyCalories: activePet?.target_daily_calories ?? null,
          bcs: activePet?.body_condition_score ?? null,
          activityLevel: activePet?.activity_level ?? null,
          totalAllergies: activePet?.allergies?.length,
          totalConditions: activePet?.medical_conditions?.length,
        }}
        onClose={() => {
          setShowVetScanSuccess(false);
          fetchHealthData();
          if (pendingMilestone) {
            setMilestonePrompt(pendingMilestone);
            setPendingMilestone(null);
          }
        }}
        onOpenHistory={() => {
          setShowVetScanSuccess(false);
          // Vet history lives inline on this screen; close + refresh scrolls it
          // back into view at the top of the list.
          fetchHealthData();
          if (pendingMilestone) {
            setMilestonePrompt(pendingMilestone);
            setPendingMilestone(null);
          }
        }}
      />

      {/* Milestone / stale-BCS re-score sheet — the recheck moment. Selecting
          a silhouette advances the plan; skipping advances on the predicted
          score so the program never stalls at a stage target. */}
      <BcsRescoreSheet
        visible={milestonePrompt !== null}
        petName={petName}
        species={activePet?.species ?? 'dog'}
        trigger={milestonePrompt?.trigger ?? 'bcs_stale'}
        progressPct={milestonePrompt?.result.progressPct ?? null}
        onSelect={(bcs) => { applyBcsRescore(bcs); }}
        onDismiss={() => {
          if (milestonePrompt?.trigger === 'bcs_stale') {
            // Stale prompt is purely optional — dismissing changes nothing.
            setMilestonePrompt(null);
          } else {
            // Milestone dismissal still advances the stage (predicted BCS).
            applyBcsRescore(null);
          }
        }}
      />

      {/* Branded Vet Scan Error Modal */}
      <PawtchiModal
        visible={failure != null}
        onClose={() => setFailure(null)}
        title={failure?.title ?? ''}
        icon={{ name: 'error-outline', color: color.error }}
        message={failure?.message}
        actions={(failure?.actions ?? []).map(a => ({
          label: a.label,
          onPress: () => handleRecovery(a.action),
        }))}
      />

      {/* Delete-report confirm */}
      <PawtchiModal
        visible={!!reportToDelete}
        onClose={() => setReportToDelete(null)}
        title="Delete this report?"
        icon={{ name: 'delete-outline', color: color.error }}
        message="This removes the report from the timeline. It won't affect logged weights or pet profile changes already applied."
        actions={[
          { label: 'Cancel', onPress: () => setReportToDelete(null), variant: 'secondary' },
          { label: 'Delete', onPress: confirmDeleteReport, variant: 'primary' },
        ]}
      />
      <PawLoader visible={isGeneratingInsight} message="Generating health insight…" />
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
  kcalDeltaNote: {
    fontFamily: font.semibold,
    fontSize: 12,
    color: color.navy,
    marginTop: space.md,
  },
  staleBcsCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: space.lg,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: color.yellowSoft,
  },
  staleBcsText: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 12.5,
    lineHeight: 17,
    color: color.navy,
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
  insightList: {
    marginTop: space.lg,
    gap: 8,
  },
  insightListRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  insightListIcon: {
    marginTop: 2,
  },
  insightListText: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 19,
    color: color.cream,
  },
  insightConcernText: {
    color: '#fecaca',
  },
  insightDeltaRow: {
    marginTop: space.lg,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(244, 241, 236, 0.10)',
  },
  insightDeltaCaption: {
    fontFamily: font.semibold,
    fontSize: 9.5,
    letterSpacing: 1.8,
    color: color.creamFaint,
    marginBottom: space.sm,
  },
  insightDeltaChips: {
    flexDirection: 'row',
    gap: space.sm,
    flexWrap: 'wrap',
  },
  insightDeltaChip: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(244, 241, 236, 0.06)',
  },
  insightDeltaLabel: {
    fontFamily: font.regular,
    fontSize: 11,
    color: color.creamDim,
  },
  insightDeltaValue: {
    fontFamily: font.semibold,
    fontSize: 12,
    color: color.cream,
  },
  insightDeltaPositive: {
    color: '#86efac',
  },
  insightDeltaNegative: {
    color: '#fca5a5',
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
    gap: space.sm,
  },
  timelineDeleteBtn: {
    padding: 4,
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
