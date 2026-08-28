import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { useActivePetStore, Pet } from './useActivePetStore';
import { computeNudge, Nudge } from '../lib/nudgeEngine';
import { adjustDailyTarget, deriveGoal, calculateRER } from '../lib/healthMath';
import { computeObservedMer, type ObservedMerResult, MIN_DAYS_FOR_RECALIB } from '../lib/observedMer';
import { deriveActivityRestrictionLabels } from '../lib/activityRestrictions';
import { computeWaterTargetMl } from '../lib/hydration';
import { checkFeature } from '../lib/health/featureRequirements';
import { getLocalYMD, localDayStartUtcISO } from '../lib/dateUtils';
import { track } from '../lib/analytics';

// Persisted across app launches so a tapped nudge stays gone for the day even
// after process death.
const NUDGES_DISMISSED_KEY = 'nudges_dismissed_today';

// Stable key for a nudge — prefer the actionType (stable across re-computes
// when stats wiggle); fall back to the title for info-only nudges that don't
// carry an actionType.
function nudgeKey(n: Pick<Nudge, 'actionType' | 'title'>): string {
  return n.actionType ? `action:${n.actionType}` : `info:${n.title}`;
}

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
  /** Sum of scheduled (non-skipped) walk/play/training minutes today. The
   *  Home "moving" stat measures completed minutes against THIS, so a fully
   *  completed plan always closes the ring (was a hardcoded 45). */
  todayActivityTargetMinutes: number;
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
  /**
   * Personalized MER v0 — implied maintenance calories back-fit from the pet's
   * observed weight trend and calorie logs. Populated in refreshTrends. Null
   * until we have enough history OR when the calculator returns any status
   * other than 'recalibration_suggested'/'stable' (i.e. gating branches keep
   * the field null so the UI doesn't render anything).
   */
  observedMer: ObservedMerResult | null;
}

interface ClinicalContext {
  allergies: string[];
  medicalConditions: string[];
  dietType: string[];
  bcs: number | null;
  activityRestrictions: string[];
}

// ---- Store interface ----

interface DismissedNudgesToday {
  date: string;       // local YMD; cleared when the day rolls over
  keys: string[];     // nudgeKey() values dismissed today
}

interface PetContextState extends TodayData, DerivedToday, TrendData {
  clinical: ClinicalContext;
  nudge: Nudge | null;
  dismissedNudges: DismissedNudgesToday | null;
  _dismissedHydrated: boolean;
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

  /**
   * Monotonic "the pet's logged data changed" counter, bumped by
   * invalidateContext().
   *
   * The timestamps above answer "is my copy stale?" for this store's own
   * fetches. This answers a different question, for everyone else: "has
   * anything been logged, completed or regenerated since I last looked?" —
   * which a timestamp reset to 0 and then back to Date.now() cannot express.
   *
   * It exists so screens holding derived aggregates can refetch on a real
   * change instead of on every focus. Every mutation path in the app already
   * calls invalidateContext (manual logs, plan generation, and both completion
   * routes via lib/completeActivity.ts), so tracked walks finishing on the walk
   * screen bump it too. Never reset — a counter that goes backwards would read
   * as "unchanged" to anyone comparing against it.
   */
  dataVersion: number;

  fetchContext: (petId: string) => Promise<void>;
  injectSubscriptionData: (isFreemiumActive: boolean, daysSinceCreation: number) => void;
  refreshToday: (petId: string, opts?: { force?: boolean }) => Promise<void>;
  refreshTrends: (petId: string, opts?: { force?: boolean }) => Promise<void>;
  updateCalories: (newTotal: number) => void;
  updateWater: (newTotal: number) => void;
  updateWalks: (newCount: number) => void;
  dismissNudge: () => void;
  hydrateDismissedNudges: () => Promise<void>;
  invalidateContext: () => void;
  clearContext: () => void;
}

// How long a refreshToday/refreshTrends result is considered fresh. Pure
// navigation within this window skips the network; writes call invalidateContext().
const CONTEXT_STALE_MS = 30_000;

// ---- Single-round-trip dashboard fetch ----
//
// get_pet_dashboard returns the RAW ROWS of all 15 today+trends queries in one
// payload; the reduction logic below stays byte-identical and only the
// transport collapses (15 PostgREST requests → 1 per refresh). refreshToday and
// refreshTrends fire concurrently from fetchContext, so the in-flight promise
// is shared between them and cleared as soon as it settles (no staleness
// window). Resolves null whenever the RPC is missing or errors — callers then
// run the original per-table fan-out unchanged.

interface DashboardPayload {
  today_log: { calories_consumed: number | null; water_ml: number | null; walks_count: number | null; treats_consumed: number | null } | null;
  today_scans: any[];
  next_activity: any | null;
  today_activities: any[];
  logs7: any[];
  acts_this: any[];
  acts_last: any[];
  water7: any[];
  weight2: any[];
  treats7: any[];
  treat_scans7: any[];
  acts_intensity: any[];
  food_last: any[];
  logs28: any[];
  weight_logs28: any[];
}

let _dashInflight: { petId: string; promise: Promise<DashboardPayload | null> } | null = null;

function fetchDashboard(petId: string): Promise<DashboardPayload | null> {
  if (_dashInflight && _dashInflight.petId === petId) {
    return _dashInflight.promise;
  }
  const promise = (async (): Promise<DashboardPayload | null> => {
    try {
      // Same boundary math (and helpers) the per-table queries used — the SQL
      // does no timezone work of its own.
      const now = new Date();
      const todayStr = getLocalYMD(now);
      const sevenAgo = new Date(now);
      sevenAgo.setDate(sevenAgo.getDate() - 7);
      const fourteenAgo = new Date(now);
      fourteenAgo.setDate(fourteenAgo.getDate() - 14);
      const twentyEightAgo = new Date(now);
      twentyEightAgo.setDate(twentyEightAgo.getDate() - 28);

      const { data, error } = await supabase.rpc('get_pet_dashboard', {
        p_pet_id: petId,
        p_today: todayStr,
        p_seven_ago: getLocalYMD(sevenAgo),
        p_fourteen_ago: getLocalYMD(fourteenAgo),
        p_twenty_eight_ago: getLocalYMD(twentyEightAgo),
        p_day_start_utc: localDayStartUtcISO(),
        p_seven_ago_utc: localDayStartUtcISO(sevenAgo),
        p_twenty_eight_ago_utc: localDayStartUtcISO(twentyEightAgo),
      });
      if (error || !data) return null;
      return data as DashboardPayload;
    } catch {
      return null;
    }
  })();
  _dashInflight = { petId, promise };
  // Clear as soon as it settles — the promise is shared only while in flight.
  promise.finally(() => {
    if (_dashInflight?.promise === promise) _dashInflight = null;
  });
  return promise;
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
  todayActivityTargetMinutes: 0,
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
  observedMer: null,
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

function deriveClinical(pet: Pet | null): ClinicalContext {
  if (!pet) return initialClinical;

  const conditions = pet.medical_conditions || [];
  // Shared with generate-schedule payloads — lib/activityRestrictions.ts is
  // the single source of truth for condition → restriction mapping.
  const restrictions = deriveActivityRestrictionLabels(conditions);

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
  // Diet-aware: wet-fed pets get most water from food (lib/hydration.ts).
  const waterTarget = computeWaterTargetMl(weightKg, pet?.diet_type);

  // Dynamic daily budget: adjust base target based on activity + weight trends + weekly balance
  const goal = deriveGoal(
    pet?.current_weight_kg || 0,
    pet?.target_weight_kg,
    pet?.body_condition_score,
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

/**
 * Shapes the store's today/trend slices into the engine's input.
 *
 * Exported for the notification center, which needs the identical input to
 * derive its items. A second, hand-rolled copy of this mapping in the center
 * store is exactly how the two would drift into disagreeing about whether a
 * nudge applies.
 */
export function buildNudgeInput(state: PetContextState) {
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
    goalDirection: (() => {
      const pet = useActivePetStore.getState().activePet;
      if (!pet) return null;
      return deriveGoal(
        pet.current_weight_kg || 0,
        pet.target_weight_kg,
        pet.body_condition_score,
      );
    })(),
    weeklyDelta: state.weeklyDelta,
    daysUnderTarget: state.daysUnderTarget,
    topContributorScan,
    isFreemiumActive: state.isFreemiumActive,
    daysSinceCreation: state.daysSinceCreation,
    consecutiveHighIntensityDays: state.consecutiveHighIntensityDays,
    daysSinceLastFoodLog: state.daysSinceLastFoodLog,
    exerciseCalorieRatio: state.exerciseCalorieRatio,
    // Lets the engine address the animal by name rather than "your pet", which
    // the copy spec bans. Absent before a pet is loaded; every message has a
    // name-free fallback.
    petName: useActivePetStore.getState().activePet?.name ?? null,
    ...buildReadiness(state),
  };
}

/**
 * Which health domains this pet is actually set up for.
 *
 * Reuses `checkFeature` — the same gate `HealthProfileGate` puts in front of the
 * Meal, Activity and Health tabs. Before this, that gate had exactly one
 * consumer in the whole app and the nudge path walked straight past it, which is
 * why a walk-first account could be told its meals were missing while the Meal
 * tab it was being sent to was itself gated shut.
 */
function buildReadiness(state: PetContextState) {
  const pet = useActivePetStore.getState().activePet;

  // `checkFeature` gates on weight, age and BCS — but NOT on
  // `target_daily_calories`, which is the number `calPercent` actually divides
  // by. A pet can clear the gate and still have no target, so check it here.
  const mealPlanned =
    checkFeature('meal_logging', pet).ready && (pet?.target_daily_calories ?? 0) > 0;

  return {
    mealPlanned,
    // The hydration target derives purely from weight, so a non-zero target IS
    // the weight check — see computeWaterTargetMl.
    hydrationPlanned: state.waterTarget > 0,
    activityPlanned: checkFeature('activity_plan', pet).ready,

    // Exact: `food_last` in get_pet_dashboard is unwindowed, so null here means
    // this pet has never had a food scan at all.
    hasEverLoggedMeal: state.daysSinceLastFoodLog !== null,

    // Water and activity have no unwindowed equivalent, so these are 7-day
    // proxies. The imprecision is in the safe direction and the failure mode is
    // mild: an owner who logged water once a fortnight ago goes quiet for a week
    // rather than being nagged. Adding `water_last` / `activity_last` to
    // get_pet_dashboard, mirroring `food_last`, would make them exact.
    hasEverLoggedWater: state.todayWater > 0 || (state.hydrationScore?.avgMl ?? 0) > 0,
    hasEverCompletedActivity:
      state.activityCompletionRate > 0 ||
      (state.activityScore?.thisWeek ?? 0) > 0 ||
      (state.activityScore?.lastWeek ?? 0) > 0,
  };
}

// ---- Store ----

function getAllowedNudge(computedNudge: Nudge | null, dismissed: DismissedNudgesToday | null): Nudge | null {
  if (!computedNudge) return null;
  if (!dismissed) return computedNudge;
  // Stale (yesterday's) list — let everything through; the dismissNudge call
  // will reset it for today on the next dismissal.
  if (dismissed.date !== getLocalYMD(new Date())) return computedNudge;
  if (dismissed.keys.includes(nudgeKey(computedNudge))) return null;
  return computedNudge;
}

export const usePetContextStore = create<PetContextState>((set, get) => ({
  ...initialTodayData,
  ...initialDerived,
  ...initialTrends,
  clinical: initialClinical,
  nudge: null,
  dismissedNudges: null,
  _dismissedHydrated: false,
  isTodayLoading: true,
  isTrendsLoading: true,
  _todayFetchedAt: 0,
  _trendsFetchedAt: 0,
  _contextPetId: null,
  dataVersion: 0,

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
    const computedNudge = computeNudge(buildNudgeInput(get()));
    const nudge = getAllowedNudge(computedNudge, get().dismissedNudges);
    set({ nudge });
  },

  refreshToday: async (petId: string, opts) => {
    // Hydrate the persisted "dismissed today" list on first call so a tapped
    // nudge stays gone after process death / Fast Refresh.
    if (!get()._dismissedHydrated) {
      get().hydrateDismissedNudges();
    }
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
      // .maybeSingle() instead of .single() on rows that may not exist yet.
      // .single() returns an error on 0 rows (PGRST116); the destructuring
      // works the same but `.error` would be populated and could mask future
      // bugs. .maybeSingle() returns { data: null, error: null } cleanly.
      //
      // The food_scans filter uses localDayStartUtcISO() instead of the naive
      // `${today}T00:00:00` because the column is timestamptz. The naive
      // pattern is interpreted as UTC by Postgres and silently excludes scans
      // whose created_at falls in the user's first few local hours east of UTC
      // (e.g. IST owners logging between 00:00 and 05:30 had their scans drop
      // off the home tab even though daily_logs.calories_consumed updated
      // correctly).
      const todayStart = localDayStartUtcISO();

      // Preferred path: one get_pet_dashboard round trip (shared with a
      // concurrent refreshTrends). Fallback: the original 4-query fan-out.
      const dash = await fetchDashboard(petId);
      let logData: DashboardPayload['today_log'];
      let scansData: any[] | null;
      let activityData: any | null;
      let allActsData: any[] | null;
      if (dash) {
        logData = dash.today_log;
        scansData = dash.today_scans;
        activityData = dash.next_activity;
        allActsData = dash.today_activities;
      } else {
        const [logRes, scansRes, activityRes, completedActsRes] = await Promise.all([
          supabase
            .from('daily_logs')
            .select('calories_consumed, water_ml, walks_count, treats_consumed')
            .eq('pet_id', petId)
            .eq('log_date', today)
            .maybeSingle(),
          supabase
            .from('food_scans')
            .select('id, ai_identified_food, ai_estimated_calories, created_at, is_treat, protein_g, carbs_g, fat_g, image_url')
            .eq('pet_id', petId)
            .gte('created_at', todayStart)
            .order('created_at', { ascending: false })
            // 50, not 5: today's treat calories and macro totals are reduced
            // from this array below, so a capped list under-counts the day
            // while daily_logs.calories_consumed keeps the full number. The
            // feed still renders only the first three. Mirrors the limit in
            // get_pet_dashboard.
            .limit(50),
          supabase
            .from('activities')
            .select('id, activity_type, title, scheduled_time, status, duration_minutes, intensity, distance_km, notes')
            .eq('pet_id', petId)
            .eq('scheduled_date', today)
            .eq('status', 'pending')
            .order('scheduled_time', { ascending: true })
            .limit(1)
            .maybeSingle(),
          // Fetch today's activity stats for nudge engine
          supabase
            .from('activities')
            .select('duration_minutes, status')
            .eq('pet_id', petId)
            .eq('scheduled_date', today)
            .in('activity_type', ['walk', 'play', 'training']),
        ]);
        logData = logRes.data;
        scansData = scansRes.data;
        activityData = activityRes.data;
        allActsData = completedActsRes.data;
      }

      // Compute today's activity minutes and completion rate
      const allActs = allActsData || [];
      const completedActs = allActs.filter((a: any) => a.status === 'completed');
      const todayActivityMinutes = completedActs.reduce(
        (sum: number, a: any) => sum + (a.duration_minutes || 0), 0
      );
      // Today's movement goal = what the plan actually scheduled (skipped rows
      // excluded — a consciously skipped task shouldn't hold the ring open).
      const todayActivityTargetMinutes = allActs
        .filter((a: any) => a.status !== 'skipped')
        .reduce((sum: number, a: any) => sum + (a.duration_minutes || 0), 0);
      const activityCompletionRate = allActs.length > 0
        ? completedActs.length / allActs.length
        : 0;

      const scans = (scansData as FoodScanSummary[]) || [];
      const treatCaloriesConsumed = scans
        .filter((s) => s.is_treat === true)
        .reduce((sum, s) => sum + (s.ai_estimated_calories || 0), 0);

      // Aggregate macronutrients from all scans today
      const todayProtein = Math.round(scans.reduce((sum, s) => sum + (s.protein_g || 0), 0));
      const todayCarbs = Math.round(scans.reduce((sum, s) => sum + (s.carbs_g || 0), 0));
      const todayFats = Math.round(scans.reduce((sum, s) => sum + (s.fat_g || 0), 0));

      // Diagnostic: if daily_logs says calories were consumed today but the
      // food_scans query returned zero rows, the two read paths disagree —
      // which is exactly the timezone-filter bug that produced the "headline
      // updates but meals list is empty" screenshots. Fires once per
      // inconsistent refresh so we can catch any future regression in PostHog.
      if (logData && (logData.calories_consumed ?? 0) > 0 && scans.length === 0) {
        try {
          track('today_data_inconsistent', {
            pet_id: petId,
            calories_consumed: logData.calories_consumed,
            scans_returned: 0,
          });
        } catch { /* analytics best-effort */ }
      }

      const todayData: TodayData = {
        todayCalories: logData?.calories_consumed || 0,
        todayWater: logData?.water_ml || 0,
        todayWalks: logData?.walks_count || 0,
        treatsConsumed: logData?.treats_consumed || 0,
        treatCaloriesConsumed,
        todayScans: scans,
        nextActivity: (activityData as ActivitySummary) || null,
        todayActivityMinutes,
        todayActivityTargetMinutes,
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
      const computedNudge = computeNudge(buildNudgeInput(get()));
      const nudge = getAllowedNudge(computedNudge, get().dismissedNudges);
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
    // Observed-MER window: 28-day history for the personalized-MER back-fit.
    const twentyEightAgo = new Date(now);
    twentyEightAgo.setDate(twentyEightAgo.getDate() - 28);
    const twentyEightStr = getLocalYMD(twentyEightAgo);
    const twentyEightAgoUtc = localDayStartUtcISO(twentyEightAgo);
    // Proper UTC ISO boundary for timestamptz comparisons — see localDayStartUtcISO.
    const sevenAgoUtc = localDayStartUtcISO(sevenAgo);

    try {
      // Preferred path: one get_pet_dashboard round trip (shared with a
      // concurrent refreshToday). Fallback: the original 11-query fan-out.
      const dash = await fetchDashboard(petId);
      let logs7Data: any[] | null;
      let actsThisData: any[] | null;
      let actsLastData: any[] | null;
      let waterData: any[] | null;
      let weightData: any[] | null;
      let treats7Data: any[] | null;
      let treatScans7Data: any[] | null;
      let actsIntensityData: any[] | null;
      let foodLogsData_: any[] | null;
      let logs28Data: any[] | null;
      let weightLogs28Data: any[] | null;
      if (dash) {
        logs7Data = dash.logs7;
        actsThisData = dash.acts_this;
        actsLastData = dash.acts_last;
        waterData = dash.water7;
        weightData = dash.weight2;
        treats7Data = dash.treats7;
        treatScans7Data = dash.treat_scans7;
        actsIntensityData = dash.acts_intensity;
        foodLogsData_ = dash.food_last;
        logs28Data = dash.logs28;
        weightLogs28Data = dash.weight_logs28;
      } else {
        // For consecutive high-intensity days: get all completed activities with intensity for last 7 days
        const [logs7Res, actsThisRes, actsLastRes, waterRes, weightRes, treats7Res, treatScans7Res, actsIntensityRes, foodLogsRes, logs28Res, weightLogs28Res] = await Promise.all([
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
          // Treat scans over 7 days for calorie percentage.
          // Uses localDayStartUtcISO(sevenAgo) so timezone-east-of-UTC owners
          // don't lose the boundary day to the UTC interpretation of the bare
          // ${sevenStr}T00:00:00 string.
          supabase
            .from('food_scans')
            .select('ai_estimated_calories, is_treat')
            .eq('pet_id', petId)
            .eq('is_treat', true)
            .gte('created_at', sevenAgoUtc),
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
          // Observed-MER: 28-day daily calorie logs (density > 70% needed to trust the back-fit).
          supabase
            .from('daily_logs')
            .select('calories_consumed, log_date')
            .eq('pet_id', petId)
            .gte('log_date', twentyEightStr)
            .lte('log_date', todayStr),
          // Observed-MER: 28-day weight-log time series (slope drives the back-fit).
          supabase
            .from('weight_logs')
            .select('weight_kg, logged_at')
            .eq('pet_id', petId)
            .gte('logged_at', twentyEightAgoUtc)
            .order('logged_at', { ascending: true }),
        ]);
        logs7Data = logs7Res.data;
        actsThisData = actsThisRes.data;
        actsLastData = actsLastRes.data;
        waterData = waterRes.data;
        weightData = weightRes.data;
        treats7Data = treats7Res.data;
        treatScans7Data = treatScans7Res.data;
        actsIntensityData = actsIntensityRes.data;
        foodLogsData_ = foodLogsRes.data;
        logs28Data = logs28Res.data;
        weightLogs28Data = weightLogs28Res.data;
      }

      // Nutrition score: days within ±10% of target
      let nutritionScore: TrendData['nutritionScore'] = null;
      if (logs7Data && pet?.target_daily_calories) {
        const target = pet.target_daily_calories;
        const onTarget = logs7Data.filter(
          (l: any) => l.calories_consumed >= target * 0.9 && l.calories_consumed <= target * 1.1
        ).length;
        nutritionScore = { onTarget, total: logs7Data.length || 7 };
      }

      // Activity score: this week vs last week minutes
      const thisWeek = (actsThisData || []).reduce((s: number, a: any) => s + (a.duration_minutes || 0), 0);
      const lastWeek = (actsLastData || []).reduce((s: number, a: any) => s + (a.duration_minutes || 0), 0);
      const activityScore = { thisWeek, lastWeek };

      // Hydration score: 7-day average vs target
      const waterLogs = waterData || [];
      const totalWater = waterLogs.reduce((s: number, l: any) => s + (l.water_ml || 0), 0);
      const daysWithData = waterLogs.filter((l: any) => l.water_ml > 0).length || 1;
      const avgMl = Math.round(totalWater / daysWithData);
      const targetMl = computeWaterTargetMl(pet?.current_weight_kg || 10, pet?.diet_type);
      const hydrationScore = { avgMl, targetMl };

      // Weight trend: compare last 2 entries
      let weightTrend: TrendData['weightTrend'] = null;
      const wData = weightData || [];
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
      const treatsData = treats7Data || [];
      const totalTreats = treatsData.reduce((s: number, l: any) => s + (l.treats_consumed || 0), 0);
      const avgTreatsPerDay = treatsData.length > 0 ? totalTreats / treatsData.length : null;

      // Weekly treat calorie percentage
      const weeklyTreatCals = (treatScans7Data || []).reduce(
        (s: number, scan: any) => s + (scan.ai_estimated_calories || 0), 0
      );
      const weeklyTotalCals = (logs7Data || []).reduce(
        (s: number, l: any) => s + (l.calories_consumed || 0), 0
      );
      const weeklyTreatCalPercent = weeklyTotalCals > 0
        ? Math.round((weeklyTreatCals / weeklyTotalCals) * 100)
        : null;

      // Rolling 7-day calorie balance (consumed − target × 7)
      const baseTarget = pet?.target_daily_calories || 0;
      const weeklyTarget = baseTarget > 0 ? baseTarget * 7 : null;
      const weeklyCaloriesConsumed = (logs7Data?.length || 0) > 0 ? weeklyTotalCals : null;
      const weeklyDelta = weeklyTarget !== null && weeklyCaloriesConsumed !== null
        ? weeklyCaloriesConsumed - weeklyTarget
        : null;

      // Days under target in the last 3 days (chronic under-eating signal).
      // Counts only days with actual log data; missing days are not assumed under.
      let daysUnderTarget: number | null = null;
      if (baseTarget > 0 && logs7Data) {
        const last3Dates = [0, 1, 2].map(i => {
          const d = new Date(now);
          d.setDate(d.getDate() - i);
          return getLocalYMD(d);
        });
        const last3Logs = logs7Data.filter((l: any) => last3Dates.includes(l.log_date));
        if (last3Logs.length > 0) {
          daysUnderTarget = last3Logs.filter((l: any) =>
            (l.calories_consumed || 0) < baseTarget * 0.7
          ).length;
        }
      }

      // Consecutive high-intensity days: count back from today
      let consecutiveHighIntensityDays = 0;
      const intensityData = (actsIntensityData ?? []) as any[];
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
      const foodLogsData = (foodLogsData_ ?? []) as any[];
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
      const todayTotalCals = (logs7Data || []).find((l: any) => l.log_date === todayStr);
      const todayMinsCalc = (actsThisData || []).reduce((s: number, a: any) => s + (a.duration_minutes || 0), 0);
      if (todayTotalCals && todayTotalCals.calories_consumed > 0) {
        // Rough estimate: ~60 kcal burned per 10 min of activity
        const burnedEstimate = Math.round(todayMinsCalc * 6);
        exerciseCalorieRatio = Math.round((burnedEstimate / todayTotalCals.calories_consumed) * 100) / 100;
      }

      // Observed-MER back-fit. Only computed when we have a pet with a target
      // and a current weight; result carries its own gating status so the UI
      // renders nothing until 'recalibration_suggested' fires.
      let observedMer: ObservedMerResult | null = null;
      if (pet && pet.current_weight_kg > 0 && pet.target_daily_calories && pet.target_daily_calories > 0) {
        const createdAt = (pet as { created_at?: string | null }).created_at;
        const daysSincePlanStart = createdAt
          ? Math.max(0, Math.floor((now.getTime() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24)))
          : 0;
        // Only bother computing once the window has enough headroom. Cheap gate.
        if (daysSincePlanStart >= MIN_DAYS_FOR_RECALIB) {
          const predictedRer = calculateRER(pet.current_weight_kg);
          const predictedMerFactor = predictedRer > 0
            ? pet.target_daily_calories / predictedRer
            : 1.0;
          const kcalLogs = (logs28Data || [])
            .filter((l: any) => typeof l.calories_consumed === 'number' && l.calories_consumed > 0)
            .map((l: any) => ({ logDate: l.log_date, caloriesConsumed: l.calories_consumed }));
          const weightLogs = (weightLogs28Data || [])
            .filter((w: any) => typeof w.weight_kg === 'number' && w.weight_kg > 0)
            .map((w: any) => ({ loggedAt: w.logged_at, weightKg: Number(w.weight_kg) }));
          observedMer = computeObservedMer({
            currentWeightKg: pet.current_weight_kg,
            predictedMerFactor,
            kcalLogs,
            weightLogs,
            daysSincePlanStart,
          });
        }
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
        observedMer,
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
        todayActivityTargetMinutes: stateAfterTrends.todayActivityTargetMinutes,
        activityCompletionRate: stateAfterTrends.activityCompletionRate,
        todayProtein: stateAfterTrends.todayProtein,
        todayCarbs: stateAfterTrends.todayCarbs,
        todayFats: stateAfterTrends.todayFats,
      };
      const derivedAfterTrends = computeDerived(todayDataNow, pet, weightTrend, weeklyDelta);
      set({ ...derivedAfterTrends });
      const computedNudge = computeNudge(buildNudgeInput(get()));
      const nudge = getAllowedNudge(computedNudge, get().dismissedNudges);
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
    const computedNudge = computeNudge(buildNudgeInput({ ...current, todayCalories: newTotal, ...derived }));
    const nudge = getAllowedNudge(computedNudge, current.dismissedNudges);
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
    const currentNudge = get().nudge;
    if (!currentNudge) {
      set({ nudge: null });
      return;
    }
    const today = getLocalYMD(new Date());
    const existing = get().dismissedNudges;
    const keys = existing && existing.date === today ? existing.keys : [];
    const key = nudgeKey(currentNudge);
    const nextKeys = keys.includes(key) ? keys : [...keys, key];
    const next: DismissedNudgesToday = { date: today, keys: nextKeys };
    set({ nudge: null, dismissedNudges: next });
    // Persist asynchronously — failure is logged but non-blocking.
    AsyncStorage.setItem(NUDGES_DISMISSED_KEY, JSON.stringify(next)).catch((err) => {
      console.warn('[PetContext] failed to persist dismissedNudges', err);
    });
  },

  hydrateDismissedNudges: async () => {
    if (get()._dismissedHydrated) return;
    try {
      const raw = await AsyncStorage.getItem(NUDGES_DISMISSED_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as DismissedNudgesToday;
        if (parsed && typeof parsed.date === 'string' && Array.isArray(parsed.keys)) {
          if (parsed.date === getLocalYMD(new Date())) {
            // Same day → re-apply the dismissals and recompute the current nudge.
            const allowed = getAllowedNudge(get().nudge, parsed);
            set({ dismissedNudges: parsed, nudge: allowed, _dismissedHydrated: true });
            return;
          }
          // Stale (different day) → drop the persisted list.
          AsyncStorage.removeItem(NUDGES_DISMISSED_KEY).catch(() => {});
        }
      }
    } catch (err) {
      console.warn('[PetContext] failed to hydrate dismissedNudges', err);
    }
    set({ _dismissedHydrated: true });
  },

  // Mark today + trends stale so the next refreshToday/refreshTrends actually hits
  // the network. Called after any write that changes today's or trend data.
  invalidateContext: () => set(s => ({
    _todayFetchedAt: 0,
    _trendsFetchedAt: 0,
    dataVersion: s.dataVersion + 1,
  })),

  clearContext: () => set({
    ...initialTodayData,
    ...initialDerived,
    ...initialTrends,
    clinical: initialClinical,
    nudge: null,
    // Wipe the persisted dismissals on sign-out — next user starts clean.
    dismissedNudges: (() => { AsyncStorage.removeItem(NUDGES_DISMISSED_KEY).catch(() => {}); return null; })(),
    _dismissedHydrated: false,
    isTodayLoading: true,
    isTrendsLoading: true,
    _todayFetchedAt: 0,
    _trendsFetchedAt: 0,
    _contextPetId: null,
  }),
}));
