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

  fetchContext: (petId: string) => Promise<void>;
  refreshToday: (petId: string) => Promise<void>;
  refreshTrends: (petId: string) => Promise<void>;
  updateCalories: (newTotal: number) => void;
  updateWater: (newTotal: number) => void;
  updateWalks: (newCount: number) => void;
  clearContext: () => void;
}

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

function computeDerived(
  today: TodayData,
  pet: Pet | null,
  weightTrend: TrendData['weightTrend'] | null = null,
): DerivedToday {
  const baseTarget = pet?.target_daily_calories || 0;
  const weightKg = pet?.current_weight_kg || 0;
  const waterTarget = Math.round(weightKg * 50);

  // Dynamic daily budget: adjust base target based on activity + weight trends
  const goal = deriveGoal(
    pet?.current_weight_kg || 0,
    pet?.target_weight_kg,
  );
  const { adjustedTarget, reason } = adjustDailyTarget(
    baseTarget,
    today.todayActivityMinutes,
    weightTrend?.direction ?? null,
    goal,
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

  fetchContext: async (petId: string) => {
    const state = get();
    await Promise.all([
      state.refreshToday(petId),
      state.refreshTrends(petId),
    ]);
  },

  refreshToday: async (petId: string) => {
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
          .select('id, ai_identified_food, ai_estimated_calories, created_at, is_treat')
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
      };

      const derived = computeDerived(todayData, pet, get().weightTrend);
      const clinical = deriveClinical(pet);

      set({
        ...todayData,
        ...derived,
        clinical,
        isTodayLoading: false,
      });

      // Recompute nudge with fresh today data
      const nudge = computeNudge(buildNudgeInput(get()));
      set({ nudge });
    } catch (err) {
      console.error('[PetContext] refreshToday error:', err);
      set({ isTodayLoading: false });
    }
  },

  refreshTrends: async (petId: string) => {
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
      const [logs7Res, actsThisRes, actsLastRes, waterRes, weightRes, treats7Res, treatScans7Res] = await Promise.all([
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
          .select('duration_minutes')
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

      set({
        nutritionScore,
        activityScore,
        hydrationScore,
        weightTrend,
        avgTreatsPerDay,
        weeklyTreatCalPercent,
        isTrendsLoading: false,
      });

      // Recompute nudge with fresh trends
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
    const derived = computeDerived(todayData, pet, current.weightTrend);
    const nudge = computeNudge(buildNudgeInput({ ...current, todayCalories: newTotal, ...derived }));
    set({ todayCalories: newTotal, ...derived, nudge });
  },

  updateWater: (newTotal: number) => {
    const pet = useActivePetStore.getState().activePet;
    const current = get();
    const todayData: TodayData = { ...current, todayWater: newTotal };
    const derived = computeDerived(todayData, pet, current.weightTrend);
    set({ todayWater: newTotal, ...derived });
  },

  updateWalks: (newCount: number) => {
    set({ todayWalks: newCount });
  },

  clearContext: () => set({
    ...initialTodayData,
    ...initialDerived,
    ...initialTrends,
    clinical: initialClinical,
    nudge: null,
    isTodayLoading: true,
    isTrendsLoading: true,
  }),
}));
