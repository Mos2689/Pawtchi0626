import React, { useState, useCallback, useRef } from 'react';
import { withTimeout } from '../../lib/withTimeout';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, TextInput, Alert,
  KeyboardAvoidingView, Platform, TouchableWithoutFeedback, Keyboard,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import Svg, { Path, Defs, LinearGradient as SvgLinearGradient, Stop, Circle } from 'react-native-svg';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { PawtchiModal } from '../../components/PawtchiModal';
import { HealthTodayFeed } from '../../components/health/HealthTodayFeed';
import { HealthProfileGate } from '../../components/health/HealthProfileGate';
import { WeightSaveProgress } from '../../components/health/WeightSaveProgress';
import type { WeightSaveStage } from '../../lib/weightSaveStages';
import { WeightLoggedModal } from '../../components/WeightLoggedModal';
import { PawtchiButton } from '../../components/PawtchiButton';
import { PawLoader } from '../../components/loader/PawLoader';
import * as ImagePicker from 'expo-image-picker';

import { color, displayLine, font, radius, shadow, space } from '../../constants/design';
import { useActivePetStore } from '../../store/useActivePetStore';
import { useStreakStore } from '../../store/useStreakStore';
import { usePetContextStore } from '../../store/usePetContextStore';
import { useAuth } from '../../providers/AuthProvider';
import { useSubscription } from '../../hooks/useSubscription';
import { supabase } from '../../lib/supabase';
import { deriveGoal } from '../../lib/healthMath';
import { getLocalYMD, localDayStartUtcISO } from '../../lib/dateUtils';
import { waterPerSessionMl, computeWaterTargetMl } from '../../lib/hydration';
import { prepareImageForUpload } from '../../lib/imagePrep';
import { getAgeMonths } from '../../lib/lifeStage';
import { getReportFreshness } from '../../lib/vetReportFreshness';
import { evaluateMilestone, type MilestoneResult } from '../../lib/milestoneEngine';
import { track } from '../../lib/analytics';
import {
  appError, errorCopy, fromEdgeBody, isAppError, reportError, toAppError,
  type AppError, type ErrorContext, type ErrorCopy, type RecoveryActionId,
} from '../../lib/appError';
import { FailureModal } from '../../components/FailureModal';
import type { FailureMeta } from '../../lib/support/handoff';
import { haptic } from '../../lib/haptics';
import { VetScanResultModal, type VetScanResult } from '../../components/VetScanResultModal';
import { BcsRescoreSheet, type RescoreTrigger } from '../../components/BcsRescoreSheet';
import WeeklyNutritionChart, { DayMacro } from '../../components/WeeklyNutritionChart';
import {
  recordWeightAssessment,
  recordWeightMeasurement,
} from '../../lib/weightPlanService';
import { weightPlanViewModelFromRecord } from '../../lib/weightPlanRecord';
import { TAB_BAR_CLEARANCE } from '../../components/navigation/SplitTabBar';

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

/**
 * Every ring, target and trend on this screen is computed from weight, age and
 * body score. Without them the whole tab renders confident zeroes, so the gate
 * stands in front of it until the profile can support the maths.
 */
export default function HealthScreen() {
  const gatePet = useActivePetStore(s => s.activePet);
  return (
    <HealthProfileGate feature="health_insights" pet={gatePet} petName={gatePet?.name}>
      <HealthScreenContent />
    </HealthProfileGate>
  );
}

function HealthScreenContent() {
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
  /** Which part of the weigh-in pipeline is running — drives WeightSaveProgress. */
  const [saveStage, setSaveStage] = useState<WeightSaveStage | null>(null);
  const weightSubmissionRef = useRef<{
    id: string;
    weightKg: number;
    measuredAt: string;
  } | null>(null);

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
  // What the failure was, for the support composer: the area chip arrives
  // preselected and the kind rides along into diagnostics. This tab raises
  // failures in three contexts (vet_scan / report / log), so it is tracked
  // per failure rather than fixed on the sheet.
  const [failureMeta, setFailureMeta] = useState<FailureMeta | null>(null);
  const presentFailure = useCallback((
    appErr: AppError,
    context: ErrorContext,
    petName?: string | null,
  ) => {
    setFailureMeta({ kind: appErr.kind, context });
    setFailure(errorCopy(appErr, { context, petName }));
  }, []);
  const retryRef = useRef<null | (() => void)>(null);
  // Only the actions this screen owns — FailureModal handles contact support,
  // settings and back, so none of them can go dead here.
  const handleRecovery = useCallback((action: RecoveryActionId) => {
    if (action === 'retry') retryRef.current?.();
    else if (action === 'pick_again') scanVetReport();
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
          presentFailure(appError('permission', 'camera permission denied'), 'vet_scan');
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
        setFailureMeta({ kind: 'validation', context: 'vet_scan' });
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
      presentFailure(appErr, 'vet_scan', activePet?.name);
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
      const prevDiagnoses = new Set(activePet.medical_conditions || []);
      const prevAllergies = new Set(activePet.allergies || []);

      // ── Recalibrate calorie target + schedule when a fresh weight came in. ──
      const newWeight: number | null = typeof ext.weight_kg === 'number' && ext.weight_kg > 0
        ? ext.weight_kg
        : null;
      let newCalories: number | null = null;
      let scheduleRegenerated = false;
      let acceptedReportWeight: number | null = null;
      let reportWeightIsCurrent = false;
      const reportMeasuredAt =
        typeof ext.report_date === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(ext.report_date)
          ? ext.report_date === getLocalYMD(new Date())
            ? new Date().toISOString()
            : `${ext.report_date}T12:00:00.000Z`
          : new Date().toISOString();
      const extractedBcs =
        typeof ext.body_condition_score === 'number'
          ? ext.body_condition_score
          : null;

      if (newWeight && activePet.species) {
        const measurement = await recordWeightMeasurement({
          pet: activePet,
          weightKg: newWeight,
          source: 'vet_report',
          notes: 'Extracted from vet report',
          measuredAt: reportMeasuredAt,
          sourceEventId: `vet_report:${data.report_id}:weight`,
        });
        if (measurement.status === 'confirmation_required') {
          Alert.alert(
            'Review extracted weight',
            `${measurement.message} It remains in the report, but it has not changed the active plan.`,
          );
        } else {
          acceptedReportWeight = newWeight;
          reportWeightIsCurrent = !measurement.isBackdated;
          newCalories = measurement.targetCalories;
          scheduleRegenerated = measurement.scheduleRegenerated;
          const milestone = evaluateMilestoneForWeights(
            measurement.currentWeightKg,
            prevWeight,
          );
          if (milestone) setPendingMilestone(milestone);
        }
      }

      if (extractedBcs != null) {
        const currentPet =
          useActivePetStore.getState().activePet ?? activePet;
        const reportDay = reportMeasuredAt.slice(0, 10);
        const currentWeightMatchesReportDay =
          !newWeight &&
          currentPet.current_weight_logged_at?.slice(0, 10) ===
            reportDay;
        const assessmentWeight =
          acceptedReportWeight ??
          (currentWeightMatchesReportDay
            ? currentPet.current_weight_kg
            : null);

        if (assessmentWeight == null) {
          Alert.alert(
            'Body score saved as evidence',
            `The report's body score did not include a matching dated weight, so it has not changed ${activePet.name}'s confirmed ideal.`,
          );
        } else {
          const assessment = await recordWeightAssessment({
            pet: currentPet,
            bcs: extractedBcs,
            source: 'vet_report',
            assessedAt: reportMeasuredAt,
            assessmentWeightKg: assessmentWeight,
          });
          if (assessment.applied) {
            newCalories = assessment.targetCalories;
            scheduleRegenerated =
              scheduleRegenerated ||
              assessment.scheduleRegenerated;
            if (
              assessment.discloseIdealChange &&
              assessment.idealWeightKg != null
            ) {
              Alert.alert(
                'Plan updated',
                `The vet evidence updated ${activePet.name}'s confirmed ideal from ${assessment.previousIdealWeightKg?.toFixed(1)} kg to ${assessment.idealWeightKg.toFixed(1)} kg.`,
              );
            }
          }
        }
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

      const weightDiff =
        reportWeightIsCurrent &&
        newWeight !== null &&
        prevWeight !== null
          ? newWeight - prevWeight
          : null;
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
      presentFailure(appErr, 'vet_scan', activePet.name);
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
      presentFailure(appErr, 'report');
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

  // Canonical measurement path. A scale entry can move or reopen the plan,
  // but it can never recalculate the confirmed ideal.
  const saveWeightLog = async (confirmUnusual = false) => {
    const weight = Number.parseFloat(weightInput);
    if (!Number.isFinite(weight) || weight <= 0 || !activePet) return;
    if (isSavingWeight) return;

    const previousWeight = activePet.current_weight_kg ?? null;
    const previousCalories = activePet.target_daily_calories ?? 0;
    const notes = weightNotes.trim() || null;
    if (
      !weightSubmissionRef.current ||
      weightSubmissionRef.current.weightKg !== weight
    ) {
      const measuredAt = new Date().toISOString();
      weightSubmissionRef.current = {
        id: `manual:${activePet.id}:${measuredAt}:${weight.toFixed(3)}`,
        weightKg: weight,
        measuredAt,
      };
    }
    const submission = weightSubmissionRef.current;
    setIsSavingWeight(true);
    setSaveStage(null);

    try {
      const result = await recordWeightMeasurement({
        pet: activePet,
        weightKg: weight,
        source: 'manual',
        notes,
        measuredAt: submission.measuredAt,
        sourceEventId: submission.id,
        confirmUnusual,
        onStage: setSaveStage,
      });

      if (result.status === 'confirmation_required') {
        setIsSavingWeight(false);
        setSaveStage(null);
        Alert.alert('Confirm weight', result.message, [
          { text: 'Check again', style: 'cancel' },
          {
            text: 'Save weight',
            onPress: () => void saveWeightLog(true),
          },
        ]);
        return;
      }

      weightSubmissionRef.current = null;
      const goal = deriveGoal(
        result.currentWeightKg,
        activePet.target_weight_kg,
        activePet.body_condition_score,
      );
      const calorieDiff =
        previousCalories > 0 && previousCalories !== result.targetCalories
          ? result.targetCalories - previousCalories
          : null;
      const weightDiff =
        previousWeight != null
          ? result.currentWeightKg - previousWeight
          : null;

      setShowWeightModal(false);
      setWeightInput('');
      setWeightNotes('');
      haptic.success();
      setWeightSuccessData({
        weight: result.currentWeightKg,
        prevCalories: previousCalories,
        newCalories: result.targetCalories,
        calorieDiff,
        weightDiff,
        scheduleRegenerated: result.scheduleRegenerated,
        goal,
        willRecalibrate: result.scheduleRegenerated,
      });
      setShowWeightSuccess(true);

      const newLog = {
        id: `temp-${Date.now()}`,
        pet_id: activePet.id,
        weight_kg: result.currentWeightKg,
        notes,
        logged_at: submission.measuredAt,
        source: 'manual',
      };
      setWeightLogs((previous) => [newLog, ...previous]);

      if (result.lossRateWarning) {
        Alert.alert(
          'Losing weight too fast',
          `${activePet.name} has lost about ${result.lossRateWarning.pctPerWeek.toFixed(1)}% of body weight per week. We eased the calorie target by 10%; please check in with your vet.`,
        );
      }

      const milestone = evaluateMilestoneForWeights(
        result.currentWeightKg,
        previousWeight,
      );
      if (milestone) setPendingMilestone(milestone);

      if (user?.id) {
        awardCoins(user.id, 'weight_log');
        await useActivePetStore
          .getState()
          .fetchPet(user.id, { silent: true });
      }
      usePetContextStore.getState().invalidateContext();
      void fetchHealthData({ force: true });
    } catch (error) {
      const appErr = toAppError(error);
      reportError(appErr, 'log');
      presentFailure(appErr, 'log', activePet.name);
      if (user?.id) {
        await useActivePetStore
          .getState()
          .fetchPet(user.id, { silent: true });
      }
    } finally {
      setIsSavingWeight(false);
      // Cleared here rather than on success, so a thrown error also takes the
      // progress list down instead of freezing it on whichever step failed.
      setSaveStage(null);
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

  // Accepted assessment path. Dismissal and predicted scores deliberately do
  // nothing: only an explicit body check may create a new ideal revision.
  const applyBcsRescore = async (pickedBcs: number | null) => {
    const prompt = milestonePrompt;
    setMilestonePrompt(null);
    if (!activePet || !prompt || pickedBcs == null) return;
    const previousCalories = activePet.target_daily_calories ?? 0;

    try {
      const assessment = await recordWeightAssessment({
        pet: activePet,
        bcs: pickedBcs,
        source:
          prompt.trigger === 'bcs_stale'
            ? 'owner_bcs'
            : 'milestone',
      });
      const calorieDelta =
        assessment.targetCalories - previousCalories;
      if (calorieDelta !== 0) setKcalDeltaNote(calorieDelta);

      track('bcs_rescored', {
        source: prompt.trigger,
        old_bcs: activePet.body_condition_score ?? null,
        new_bcs: pickedBcs,
        predicted_used: false,
        new_target_kg: assessment.targetWeightKg,
        calorie_delta: calorieDelta,
      });
      haptic.success();
      if (
        assessment.discloseIdealChange &&
        assessment.idealWeightKg != null
      ) {
        Alert.alert(
          'Plan updated',
          `The confirmed ideal changed from ${assessment.previousIdealWeightKg?.toFixed(1)} kg to ${assessment.idealWeightKg.toFixed(1)} kg after this body check.`,
        );
      }
    } catch (error) {
      const appErr = toAppError(error);
      reportError(appErr, 'log');
      presentFailure(appErr, 'log', activePet.name);
    } finally {
      if (user?.id) {
        await useActivePetStore
          .getState()
          .fetchPet(user.id, { silent: true });
      }
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

  // Every Health label is derived from the same persisted plan used by Home,
  // Meal and Profile. Recent readings are supplied only as status evidence.
  const weightPlanView = activePet
    ? weightPlanViewModelFromRecord(
        activePet,
        weightLogs.slice(0, 3).map((log) => ({
          weightKg: Number(log.weight_kg),
          loggedAt: log.logged_at,
        })),
      )
    : null;
  const hasWeightGoal = Boolean(
    weightPlanView?.showJourney &&
      weightPlanView.targetWeightKg != null &&
      weightPlanView.idealWeightKg != null,
  );

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

  // Progress comes exclusively from the persisted journey anchor and final
  // assessed ideal. This prevents Health from disagreeing with Home/Profile
  // when the next staged milestone differs from the final destination.
  const weightGoalPct = weightPlanView?.progressPct ?? 0;
  const petName = activePet?.name || 'your pet';
  const onTrack = weeklyDelta !== null && weeklyTarget !== null && Math.abs(weeklyDelta) < weeklyTarget * 0.05;
  const weightPlanLabel = hasWeightGoal
    ? `next ${Number(weightPlanView?.targetWeightKg).toFixed(1)} kg · ideal ${Number(weightPlanView?.idealWeightKg).toFixed(1)} kg · ${weightGoalPct}% there`
    : weightPlanView?.showHealthyBanner &&
        weightPlanView.idealWeightKg != null
      ? `confirmed ideal ${weightPlanView.idealWeightKg.toFixed(1)} kg${
          weightPlanView.healthyBand
            ? ` · healthy ${weightPlanView.healthyBand.low.toFixed(1)}–${weightPlanView.healthyBand.high.toFixed(1)} kg`
            : ''
        }`
      : `${petName}’s weight over time`;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* ════ TODAY — the daily health experience, relocated from Home ════ */}
        <HealthTodayFeed onLogWeight={() => {
          const defaultWeight = activePet?.current_weight_kg || undefined;
          setWeightInput(defaultWeight ? String(defaultWeight) : '');
          weightSubmissionRef.current = null;
          setShowWeightModal(true);
        }} />

        {/* ════ THE SHEET ════ */}
        <View style={styles.sheet}>
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

              {/* Named work instead of an opaque spinner. Most of the wait is
                  the schedule rebuild, and saying so is what stops a slow save
                  reading as a hung one. */}
              <WeightSaveProgress stage={saveStage} />

              <PawtchiButton
                title="Save weight"
                variant="primary"
                loading={isSavingWeight}
                onPress={() => { Keyboard.dismiss(); saveWeightLog(); }}
              />

              {/* Cancel dismisses the sheet but cannot stop the save — the
                  writes are already in flight. Hidden while saving rather than
                  offering an abort this screen cannot honour. */}
              {!isSavingWeight && (
                <TouchableOpacity onPress={() => {
                  Keyboard.dismiss();
                  weightSubmissionRef.current = null;
                  setShowWeightModal(false);
                }} style={styles.cancelBtn}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
              )}
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
          progressPct={weightPlanView?.progressPct ?? null}
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

      {/* Milestone / stale-BCS re-score sheet. Only an explicit selection
          creates a new assessment revision; dismissal changes nothing. */}
      <BcsRescoreSheet
        visible={milestonePrompt !== null}
        petName={petName}
        species={activePet?.species ?? 'dog'}
        trigger={milestonePrompt?.trigger ?? 'bcs_stale'}
        progressPct={milestonePrompt?.result.progressPct ?? null}
        onSelect={(bcs) => { applyBcsRescore(bcs); }}
        onDismiss={() => setMilestonePrompt(null)}
      />

      {/* Branded failure sheet — scan / report / log paths. FailureModal owns
          contact support, settings and back; handleRecovery owns the flow. */}
      <FailureModal
        copy={failure}
        onClose={() => setFailure(null)}
        onAction={handleRecovery}
        icon={{ name: 'error-outline', color: color.error }}
        meta={{ ...failureMeta, screen: '/(tabs)/health' }}
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
  // White, matching the daily feed that now opens the scroll — the canopy
  // keeps its own yellow ground below it.
  container: { flex: 1, backgroundColor: '#FFFFFF' },
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
    ...displayLine(76),
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
    paddingHorizontal: space.xxl,
    paddingTop: space.xl,
    paddingBottom: 130 + TAB_BAR_CLEARANCE, // floating tab bar overlaps content
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
