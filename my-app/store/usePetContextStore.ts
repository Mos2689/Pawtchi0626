import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { useActivePetStore, Pet } from './useActivePetStore';
import { computeNudge, Nudge } from '../lib/nudgeEngine';
import { adjustDailyTarget, deriveGoal } from '../lib/healthMath';

// ---- Supporting types ----

interface FoodScanSummary {
  id: string;
  ai_identified_food: string;
  ai_estimated_calories: number;
  created_at: string;
  is_treat?: boolean;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  image_url?: string;
  is_user_confirmed?: boolean;
}

interface ActivitySummary {
  id: string;
  activity_type: string;
  title: string;
  scheduled_time: string | null;
  status: string;
  duration_minutes: number | null;
  intensity: string | null;
  distance_km: number | null;
  notes: string | null;
}

interface TodayData {
  todayCalories: number;
  todayWater: number;
  todayWalks: number;
  treatsConsumed: number;
  treatCaloriesConsumed: number;
  todayScans: FoodScanSummary[];
  nextActivity: ActivitySummary | null;
  todayActivityMinutes: number;
  activityCompletionRate: number;
  todayProtein: number;
  todayCarbs: number;
  todayFats: number;
}

interface DerivedToday {
  adjustedTarget: number;
  adjustmentReason: string | null;
  caloriesRemaining: number;
  treatBudget: number;
  waterTarget: number;
  waterRemaining: number;
  calPercent: number;
  waterPercent: number;
}

interface TrendData {
  nutritionScore: { onTarget: number; total: number } | null;
  activityScore: { thisWeek: number; lastWeek: number } | null;
  hydrationScore: { avgMl: number; targetMl: number } | null;
  weightTrend: { latest: number; previous: number; direction: 'up' | 'down' | 'stable' } | null;
  avgTreatsPerDay: number | null;
  weeklyTreatCalPercent: number | null; // what % of weekly calories came from treats
  daysSinceLastWeighIn: number | null;
  hasWeightGoal: boolean;
  // Rolling 7-day calorie balance (consumed − target × 7). Positive = surplus.
  weeklyCaloriesConsumed: number | null;
  weeklyTarget: number | null;
  weeklyDelta: number | null;
  // Days in the last 3 where consumption was below 70% of target (chronic under-eating signal)
  daysUnderTarget: number | null;
  // New: Consecutive high-intensity days (recovery signal)
  consecutiveHighIntensityDays: number;
  // New: Days since last food log (churn detection)
  daysSinceLastFoodLog: number | null;
  // New: Exercise-calorie imbalance ratio (burned / consumed)
  exerciseCalorieRatio: number | null;
}

interface ClinicalContext {
  allergies: string[];
  medicalConditions: string[];
  dietType: string[];
  bcs: number | null;
  activityRestrictions: string[];
}

// ---- Store interface ----

interface PetContextState extends TodayData, DerivedToday, TrendData {
  clinical: ClinicalContext;
  nudge: Nudge | null;
  isTodayLoading: boolean;
  isTrendsLoading: boolean;
  isFreemiumActive?: boolean;
  daysSinceCreation?: number;

  // Internal freshness bookkeeping (F5 staleness guard). Kept on the store so a
  // skipped refetch survives component remounts. Short window → any missed
  // invalidation self-heals on the next focus rather than going permanently stale.
  _todayFetchedAt: number;
  _trendsFetchedAt: number;
  _contextPetId: string | null;

  fetchContext: (petId: string) => Promise<void>;
  injectSubscriptionData: (isFreemiumActive: boolean, daysSinceCreation: number) => void;
  refreshToday: (petId: string, opts?: { force?: boolean }) => Promise<void>;
  refreshTrends: (petId: string, opts?: { force?: boolean }) => Promise<void>;
  updateCalories: (newTotal: number) => void;
  updateWater: (newTotal: number) => void;
  updateWalks: (newCount: number) => void;
  dismissNudge: () => void;
  invalidateContext: () => void;
  clearContext: () => void;
}

// How long a refreshToday/refreshTrends result is considered fresh. Pure
// navigation within this window skips the network; writes call invalidateContext().
const CONTEXT_STALE_MS = 30_000;

// ---- Initial state ----

const initialTodayData: TodayData = {
  todayCalories: 0,
  todayWater: 0,
  todayWalks: 0,
  treatsConsumed: 0,
  treatCaloriesConsumed: 0,
  todayScans: [],
  nextActivity: null,
  todayActivityMinutes: 0,
  activityCompletionRate: 0,
  todayProtein: 0,
  todayCarbs: 0,
  todayFats: 0,
};

const initialDerived: DerivedToday = {
  adjustedTarget: 0,
  adjustmentReason: null,
  caloriesRemaining: 0,
  treatBudget: 0,
  waterTarget: 0,
  waterRemaining: 0,
  calPercent: 0,
  waterPercent: 0,
};

const initialTrends: TrendData = {
  nutritionScore: null,
  activityScore: null,
  hydrationScore: null,
  weightTrend: null,
  avgTreatsPerDay: null,
  weeklyTreatCalPercent: null,
  daysSinceLastWeighIn: null,
  hasWeightGoal: false,
  weeklyCaloriesConsumed: null,
  weeklyTarget: null,
  weeklyDelta: null,
  daysUnderTarget: null,
  consecutiveHighIntensityDays: 0,
  daysSinceLastFoodLog: null,
  exerciseCalorieRatio: null,
};

const initialClinical: ClinicalContext = {
  allergies: [],
  medicalConditions: [],
  dietType: [],
  bcs: null,
  activityRestrictions: [],
};

// ---- Helpers ----

function getLocalYMD(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function deriveClinical(pet: Pet | null): ClinicalContext {
  if (!pet) return initialClinical;

  const conditions = pet.medical_conditions || [];
  const restrictions: string[] = [];

  const restrictionMap: Record<string, string> = {
    'arthritis': 'no high-impact activities',
    'hip dysplasia': 'no jumping or stairs',
    'heart disease': 'limit vigorous exercise',
    'obesity': 'gradual activity increase only',
    'ivdd': 'no jumping, limit stairs',
  };

  for (const condition of conditions) {
    const lower = condition.toLowerCase();
    for (const [key, restriction] of Object.entries(restrictionMap)) {
      if (lower.includes(key)) restrictions.push(restriction);
    }
  }

  return {
    allergies: pet.allergies || [],
    medicalConditions: conditions,
    dietType: pet.diet_type || [],
    bcs: pet.body_condition_score || null,
    activityRestrictions: restrictions,
  };
}

export function computeDerived(
  today: TodayData,
  pet: Pet | null,
  weightTrend: TrendData['weightTrend'] | null = null,
  weeklyDelta: number | null = null,
): DerivedToday {
  const baseTarget = pet?.target_daily_calories || 0;
  const weightKg = pet?.current_weight_kg || 0;
  const waterTarget = Math.round(weightKg * 50);

  // Dynamic daily budget: adjust base target based on activity + weight trends + weekly balance
  const goal = deriveGoal(
    pet?.current_weight_kg || 0,
    pet?.target_weight_kg,
  );
  const { adjustedTarget, reason } = adjustDailyTarget(
    baseTarget,
    today.todayActivityMinutes,
    weightTrend?.direction ?? null,
    goal,
    weeklyDelta,
  );

  const target = adjustedTarget || baseTarget; // fallback to base if adjustment returns 0

  return {
    adjustedTarget: target,
    adjustmentReason: reason,
    caloriesRemaining: target - today.todayCalories, // negative when over limit
    treatBudget: Math.max(0, Math.round(Math.min(target * 0.1, target - today.todayCalories))),
    waterTarget,
    waterRemaining: Math.max(0, waterTarget - today.todayWater),
    calPercent: target > 0 ? Math.round((today.todayCalories / target) * 100) : 0, // uncapped — lets nudge engine see true overage
    waterPercent: waterTarget > 0 ? Math.min(today.todayWater / waterTarget, 1) : 0,
  };
}

function buildNudgeInput(state: PetContextState) {
  // Today's biggest single calorie contributor (used by nudges to name the offender)
  let topContributorScan: { food_name: string; calories: number } | null = null;
  if (state.todayScans && state.todayScans.length > 0) {
    const top = state.todayScans.reduce((max, s) =>
      (s.ai_estimated_calories || 0) > (max.ai_estimated_calories || 0) ? s : max
    );
    if ((top.ai_estimated_calories || 0) > 0) {
      topContributorScan = {
        food_name: top.ai_identified_food,
        calories: Math.round(top.ai_estimated_calories || 0),
      };
    }
  }

  return {
    todayCalories: state.todayCalories,
    calPercent: state.calPercent,
    caloriesRemaining: state.caloriesRemaining,
    waterPercent: state.waterPercent,
    todayWalks: state.todayWalks,
    treatsConsumed: state.treatsConsumed,
    treatCaloriesConsumed: state.treatCaloriesConsumed,
    treatBudget: state.treatBudget,
    todayActivityMinutes: state.todayActivityMinutes,
    activityCompletionRate: state.activityCompletionRate,
    weightTrend: state.weightTrend,
    clinical: {
      activityRestrictions: state.clinical.activityRestrictions,
      medicalConditions: state.clinical.medicalConditions,
    },
    avgTreatsPerDay: state.avgTreatsPerDay,
    weeklyTreatCalPercent: state.weeklyTreatCalPercent,
    daysSinceLastWeighIn: state.daysSinceLastWeighIn,
    hasWeightGoal: state.hasWeightGoal,
    weeklyDelta: state.weeklyDelta,
    daysUnderTarget: state.daysUnderTarget,
    topContributorScan,
    isFreemiumActive: state.isFreemiumActive,
    daysSinceCreation: state.daysSinceCreation,
    consecutiveHighIntensityDays: state.consecutiveHighIntensityDays,
    daysSinceLastFoodLog: state.daysSinceLastFoodLog,
    exerciseCalorieRatio: state.exerciseCalorieRatio,
  };
}

// ---- Store ----

export const usePetContextStore = create<PetContextState>((set, get) => ({
  ...initialTodayData,
  ...initialDerived,
  ...initialTrends,
  clinical: initialClinical,
  nudge: null,
  isTodayLoading: true,
  isTrendsLoading: true,
  _todayFetchedAt: 0,
  _trendsFetchedAt: 0,
  _contextPetId: null,

  fetchContext: async (petId: string) => {
    const state = get();
    await Promise.all([
      state.refreshToday(petId),
      state.refreshTrends(petId),
    ]);
  },

  injectSubscriptionData: (isFreemiumActive: boolean, daysSinceCreation: number) => {
    set({ isFreemiumActive, daysSinceCreation });
    // Recompute nudge with new sub data
    const nudge = computeNudge(buildNudgeInput(get()));
    set({ nudge });
  },

  refreshToday: async (petId: string, opts) => {
    // Staleness guard: skip the network if this slice was fetched for the same pet
    // within the freshness window (unless explicitly forced after a write).
    const prev = get();
    if (!opts?.force && prev._contextPetId === petId && (Date.now() - prev._todayFetchedAt) < CONTEXT_STALE_MS) {
      return;
    }
    set({ isTodayLoading: true });
    const pet = useActivePetStore.getState().activePet;
    const today = getLocalYMD(new Date());

    try {
      const [logRes, scansRes, activityRes, completedActsRes] = await Promise.all([
        supabase
          .from('daily_logs')
          .select('calories_consumed, water_ml, walks_count, treats_consumed')
          .eq('pet_id', petId)
          .eq('log_date', today)
          .single(),
        supabase
          .from('food_scans')
          .select('id, ai_identified_food, ai_estimated_calories, created_at, is_treat, protein_g, carbs_g, fat_g, image_url')
          .eq('pet_id', petId)
          .gte('created_at', `${today}T00:00:00`)
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from('activities')
          .select('id, activity_type, title, scheduled_time, status, duration_minutes, intensity, distance_km, notes')
          .eq('pet_id', petId)
          .eq('scheduled_date', today)
          .eq('status', 'pending')
          .order('scheduled_time', { ascending: true })
          .limit(1)
          .single(),
        // Fetch today's activity stats for nudge engine
        supabase
          .from('activities')
          .select('duration_minutes, status')
          .eq('pet_id', petId)
          .eq('scheduled_date', today)
          .in('activity_type', ['walk', 'play', 'training']),
      ]);

      // Compute today's activity minutes and completion rate
      const allActs = completedActsRes.data || [];
      const completedActs = allActs.filter((a: any) => a.status === 'completed');
      const todayActivityMinutes = completedActs.reduce(
        (sum: number, a: any) => sum + (a.duration_minutes || 0), 0
      );
      const activityCompletionRate = allActs.length > 0
        ? completedActs.length / allActs.length
        : 0;

      const scans = (scansRes.data as FoodScanSummary[]) || [];
      const treatCaloriesConsumed = scans
        .filter((s) => s.is_treat === true)
        .reduce((sum, s) => sum + (s.ai_estimated_calories || 0), 0);

      // Aggregate macronutrients from all scans today
      const todayProtein = Math.round(scans.reduce((sum, s) => sum + (s.protein_g || 0), 0));
      const todayCarbs = Math.round(scans.reduce((sum, s) => sum + (s.carbs_g || 0), 0));
      const todayFats = Math.round(scans.reduce((sum, s) => sum + (s.fat_g || 0), 0));

      const todayData: TodayData = {
        todayCalories: logRes.data?.calories_consumed || 0,
        todayWater: logRes.data?.water_ml || 0,
        todayWalks: logRes.data?.walks_count || 0,
        treatsConsumed: logRes.data?.treats_consumed || 0,
        treatCaloriesConsumed,
        todayScans: scans,
        nextActivity: (activityRes.data as ActivitySummary) || null,
        todayActivityMinutes,
        activityCompletionRate,
        todayProtein,
        todayCarbs,
        todayFats,
      };

      const derived = computeDerived(todayData, pet, get().weightTrend, get().weeklyDelta);
      const clinical = deriveClinical(pet);

      set({
        ...todayData,
        ...derived,
        clinical,
        isTodayLoading: false,
        _todayFetchedAt: Date.now(),
        _contextPetId: petId,
      });

      // Recompute nudge with fresh today data
      const nudge = computeNudge(buildNudgeInput(get()));
      set({ nudge });
    } catch (err) {
      console.error('[PetContext] refreshToday error:', err);
      set({ isTodayLoading: false });
    }
  },

  refreshTrends: async (petId: string, opts) => {
    // Staleness guard — mirrors refreshToday. Trends are heavier (9 queries), so
    // skipping redundant focus refetches is the bigger win here.
    const prevState = get();
    if (!opts?.force && prevState._contextPetId === petId && (Date.now() - prevState._trendsFetchedAt) < CONTEXT_STALE_MS) {
      return;
    }
    set({ isTrendsLoading: true });
    const pet = useActivePetStore.getState().activePet;

    const now = new Date();
    const todayStr = getLocalYMD(now);
    const sevenAgo = new Date(now);
    sevenAgo.setDate(sevenAgo.getDate() - 7);
    const sevenStr = getLocalYMD(sevenAgo);
    const fourteenAgo = new Date(now);
    fourteenAgo.setDate(fourteenAgo.getDate() - 14);
    const fourteenStr = getLocalYMD(fourteenAgo);

    try {
      // For consecutive high-intensity days: get all completed activities with intensity for last 7 days
      const [logs7Res, actsThisRes, actsLastRes, waterRes, weightRes, treats7Res, treatScans7Res, actsIntensityRes, foodLogsRes] = await Promise.all([
        supabase
          .from('daily_logs')
          .select('calories_consumed, log_date')
          .eq('pet_id', petId)
          .gte('log_date', sevenStr)
          .lte('log_date', todayStr),
        supabase
          .from('activities')
          .select('duration_minutes')
          .eq('pet_id', petId)
          .eq('status', 'completed')
          .in('activity_type', ['walk', 'play', 'training'])
          .gte('scheduled_date', sevenStr)
          .lte('scheduled_date', todayStr),
        supabase
          .from('activities')
          .select('duration_minutes, intensity, scheduled_date')
          .eq('pet_id', petId)
          .eq('status', 'completed')
          .in('activity_type', ['walk', 'play', 'training'])
          .gte('scheduled_date', fourteenStr)
          .lt('scheduled_date', sevenStr),
        supabase
          .from('daily_logs')
          .select('water_ml')
          .eq('pet_id', petId)
          .gte('log_date', sevenStr)
          .lte('log_date', todayStr),
        supabase
          .from('weight_logs')
          .select('weight_kg, logged_at')
          .eq('pet_id', petId)
          .order('logged_at', { ascending: false })
          .limit(2),
        // Treats over 7 days for average calculation
        supabase
          .from('daily_logs')
          .select('treats_consumed')
          .eq('pet_id', petId)
          .gte('log_date', sevenStr)
          .lte('log_date', todayStr),
        // Treat scans over 7 days for calorie percentage
        supabase
          .from('food_scans')
          .select('ai_estimated_calories, is_treat')
          .eq('pet_id', petId)
          .eq('is_treat', true)
          .gte('created_at', `${sevenStr}T00:00:00`),
        // Intensity data for consecutive high-intensity days (last 7 days)
        supabase
          .from('activities')
          .select('intensity, duration_minutes, scheduled_date')
          .eq('pet_id', petId)
          .eq('status', 'completed')
          .in('activity_type', ['walk', 'play', 'training'])
          .gte('scheduled_date', sevenStr)
          .lte('scheduled_date', todayStr),
        // Food scan logs for churn detection
        supabase
          .from('food_scans')
          .select('created_at')
          .eq('pet_id', petId)
          .order('created_at', { ascending: false })
          .limit(1),
      ]);

      // Nutrition score: days within ±10% of target
      let nutritionScore: TrendData['nutritionScore'] = null;
      if (logs7Res.data && pet?.target_daily_calories) {
        const target = pet.target_daily_calories;
        const onTarget = logs7Res.data.filter(
          (l: any) => l.calories_consumed >= target * 0.9 && l.calories_consumed <= target * 1.1
        ).length;
        nutritionScore = { onTarget, total: logs7Res.data.length || 7 };
      }

      // Activity score: this week vs last week minutes
      const thisWeek = (actsThisRes.data || []).reduce((s: number, a: any) => s + (a.duration_minutes || 0), 0);
      const lastWeek = (actsLastRes.data || []).reduce((s: number, a: any) => s + (a.duration_minutes || 0), 0);
      const activityScore = { thisWeek, lastWeek };

      // Hydration score: 7-day average vs target
      const waterLogs = waterRes.data || [];
      const totalWater = waterLogs.reduce((s: number, l: any) => s + (l.water_ml || 0), 0);
      const daysWithData = waterLogs.filter((l: any) => l.water_ml > 0).length || 1;
      const avgMl = Math.round(totalWater / daysWithData);
      const targetMl = Math.round((pet?.current_weight_kg || 10) * 50);
      const hydrationScore = { avgMl, targetMl };

      // Weight trend: compare last 2 entries
      let weightTrend: TrendData['weightTrend'] = null;
      const wData = weightRes.data || [];
      if (wData.length >= 2) {
        const latest = Number(wData[0].weight_kg);
        const previous = Number(wData[1].weight_kg);
        const diff = latest - previous;
        const direction: 'up' | 'down' | 'stable' = diff > 0.1 ? 'up' : diff < -0.1 ? 'down' : 'stable';
        weightTrend = { latest, previous, direction };
      } else if (wData.length === 1) {
        const latest = Number(wData[0].weight_kg);
        weightTrend = { latest, previous: latest, direction: 'stable' };
      }

      // Days since last weigh-in (for nudge engine)
      let daysSinceLastWeighIn: number | null = null;
      if (wData.length > 0 && wData[0].logged_at) {
        const lastLogDate = new Date(wData[0].logged_at);
        const msDiff = now.getTime() - lastLogDate.getTime();
        daysSinceLastWeighIn = Math.floor(msDiff / (1000 * 60 * 60 * 24));
      }

      // Has weight goal (target differs from current by >0.5kg)
      const hasWeightGoal = !!(pet?.target_weight_kg && pet?.current_weight_kg &&
        Math.abs(pet.target_weight_kg - pet.current_weight_kg) > 0.5);

      // Average treats per day over 7 days
      const treatsData = treats7Res.data || [];
      const totalTreats = treatsData.reduce((s: number, l: any) => s + (l.treats_consumed || 0), 0);
      const avgTreatsPerDay = treatsData.length > 0 ? totalTreats / treatsData.length : null;

      // Weekly treat calorie percentage
      const weeklyTreatCals = (treatScans7Res.data || []).reduce(
        (s: number, scan: any) => s + (scan.ai_estimated_calories || 0), 0
      );
      const weeklyTotalCals = (logs7Res.data || []).reduce(
        (s: number, l: any) => s + (l.calories_consumed || 0), 0
      );
      const weeklyTreatCalPercent = weeklyTotalCals > 0
        ? Math.round((weeklyTreatCals / weeklyTotalCals) * 100)
        : null;

      // Rolling 7-day calorie balance (consumed − target × 7)
      const baseTarget = pet?.target_daily_calories || 0;
      const weeklyTarget = baseTarget > 0 ? baseTarget * 7 : null;
      const weeklyCaloriesConsumed = (logs7Res.data?.length || 0) > 0 ? weeklyTotalCals : null;
      const weeklyDelta = weeklyTarget !== null && weeklyCaloriesConsumed !== null
        ? weeklyCaloriesConsumed - weeklyTarget
        : null;

      // Days under target in the last 3 days (chronic under-eating signal).
      // Counts only days with actual log data; missing days are not assumed under.
      let daysUnderTarget: number | null = null;
      if (baseTarget > 0 && logs7Res.data) {
        const last3Dates = [0, 1, 2].map(i => {
          const d = new Date(now);
          d.setDate(d.getDate() - i);
          return getLocalYMD(d);
        });
        const last3Logs = logs7Res.data.filter((l: any) => last3Dates.includes(l.log_date));
        if (last3Logs.length > 0) {
          daysUnderTarget = last3Logs.filter((l: any) =>
            (l.calories_consumed || 0) < baseTarget * 0.7
          ).length;
        }
      }

      // Consecutive high-intensity days: count back from today
      let consecutiveHighIntensityDays = 0;
      const intensityData = (actsIntensityRes ?? { data: [] }).data as any[];
      if (intensityData.length > 0) {
        const sortedDates = [...new Set(intensityData.map((a: any) => a.scheduled_date))].sort().reverse();
        for (const date of sortedDates) {
          const dayActs = intensityData.filter((a: any) => a.scheduled_date === date);
          const hasHighIntensity = dayActs.some((a: any) =>
            a.intensity === 'high' || (a.duration_minutes && a.duration_minutes >= 45)
          );
          if (hasHighIntensity) {
            consecutiveHighIntensityDays++;
          } else {
            break;
          }
        }
      }

      // Days since last food log (churn detection)
      let daysSinceLastFoodLog: number | null = null;
      const foodLogsData = (foodLogsRes ?? { data: [] }).data as any[];
      if (foodLogsData.length > 0) {
        const lastLog = foodLogsData[0];
        if (lastLog.created_at) {
          const lastLogDate = new Date(lastLog.created_at);
          const msDiff = now.getTime() - lastLogDate.getTime();
          daysSinceLastFoodLog = Math.floor(msDiff / (1000 * 60 * 60 * 24));
        }
      }

      // Exercise-calorie imbalance ratio (burned vs consumed today)
      let exerciseCalorieRatio: number | null = null;
      const todayTotalCals = (logs7Res.data || []).find((l: any) => l.log_date === todayStr);
      const todayMinsCalc = (actsThisRes.data || []).reduce((s: number, a: any) => s + (a.duration_minutes || 0), 0);
      if (todayTotalCals && todayTotalCals.calories_consumed > 0) {
        // Rough estimate: ~60 kcal burned per 10 min of activity
        const burnedEstimate = Math.round(todayMinsCalc * 6);
        exerciseCalorieRatio = Math.round((burnedEstimate / todayTotalCals.calories_consumed) * 100) / 100;
      }

      set({
        nutritionScore,
        activityScore,
        hydrationScore,
        weightTrend,
        avgTreatsPerDay,
        weeklyTreatCalPercent,
        daysSinceLastWeighIn,
        hasWeightGoal,
        weeklyCaloriesConsumed,
        weeklyTarget,
        weeklyDelta,
        daysUnderTarget,
        consecutiveHighIntensityDays,
        daysSinceLastFoodLog,
        exerciseCalorieRatio,
        isTrendsLoading: false,
        _trendsFetchedAt: Date.now(),
        _contextPetId: petId,
      });

      // Recompute derived (now includes weekly delta correction) and nudge
      const stateAfterTrends = get();
      const todayDataNow: TodayData = {
        todayCalories: stateAfterTrends.todayCalories,
        todayWater: stateAfterTrends.todayWater,
        todayWalks: stateAfterTrends.todayWalks,
        treatsConsumed: stateAfterTrends.treatsConsumed,
        treatCaloriesConsumed: stateAfterTrends.treatCaloriesConsumed,
        todayScans: stateAfterTrends.todayScans,
        nextActivity: stateAfterTrends.nextActivity,
        todayActivityMinutes: stateAfterTrends.todayActivityMinutes,
        activityCompletionRate: stateAfterTrends.activityCompletionRate,
        todayProtein: stateAfterTrends.todayProtein,
        todayCarbs: stateAfterTrends.todayCarbs,
        todayFats: stateAfterTrends.todayFats,
      };
      const derivedAfterTrends = computeDerived(todayDataNow, pet, weightTrend, weeklyDelta);
      set({ ...derivedAfterTrends });
      const nudge = computeNudge(buildNudgeInput(get()));
      set({ nudge });
    } catch (err) {
      console.error('[PetContext] refreshTrends error:', err);
      set({ isTrendsLoading: false });
    }
  },

  // ---- Optimistic updaters (no DB queries) ----

  updateCalories: (newTotal: number) => {
    const pet = useActivePetStore.getState().activePet;
    const current = get();
    const todayData: TodayData = { ...current, todayCalories: newTotal };
    const derived = computeDerived(todayData, pet, current.weightTrend, current.weeklyDelta);
    const nudge = computeNudge(buildNudgeInput({ ...current, todayCalories: newTotal, ...derived }));
    set({ todayCalories: newTotal, ...derived, nudge });
  },

  updateWater: (newTotal: number) => {
    const pet = useActivePetStore.getState().activePet;
    const current = get();
    const todayData: TodayData = { ...current, todayWater: newTotal };
    const derived = computeDerived(todayData, pet, current.weightTrend, current.weeklyDelta);
    set({ todayWater: newTotal, ...derived });
  },

  updateWalks: (newCount: number) => {
    set({ todayWalks: newCount });
  },

  dismissNudge: () => {
    set({ nudge: null });
  },

  // Mark today + trends stale so the next refreshToday/refreshTrends actually hits
  // the network. Called after any write that changes today's or trend data.
  invalidateContext: () => set({ _todayFetchedAt: 0, _trendsFetchedAt: 0 }),

  clearContext: () => set({
    ...initialTodayData,
    ...initialDerived,
    ...initialTrends,
    clinical: initialClinical,
    nudge: null,
    isTodayLoading: true,
    isTrendsLoading: true,
    _todayFetchedAt: 0,
    _trendsFetchedAt: 0,
    _contextPetId: null,
  }),
}));
