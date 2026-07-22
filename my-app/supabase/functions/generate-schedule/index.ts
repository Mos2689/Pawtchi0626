import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getCorsHeaders } from '../_shared/cors.ts'
import { verifyAuth } from '../_shared/auth.ts'
import { checkRateLimit, RATE_LIMITS } from '../_shared/rateLimit.ts'
import { safeParseBody, isValidUUID } from '../_shared/validate.ts'
import { waterPerSessionMl } from '../_shared/hydration.ts'
import { errorResponse, logInternal } from '../_shared/errors.ts'

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_TIMEOUT_MS = 30_000;

// Interfaces for structured output
type DaySlotName = 'morning' | 'midday' | 'evening';
type Intensity = 'low' | 'moderate' | 'high';

interface ActivityArchetype {
  activity_type: string;
  title: string;
  how_to_do_it: string;
  why_its_good: string;
  intensity: string;
  duration_minutes: number;
  /** Which daily slot this suits — morning=physical, midday=mental, evening=social. */
  slot?: string;
}

/** Structured exercise restriction passed from the app (lib/activityRestrictions.ts). */
interface ActivityRestrictionInput {
  label: string;
  maxIntensity: Intensity;
}

const INTENSITY_ORDER: Record<Intensity, number> = { low: 0, moderate: 1, high: 2 };

function normalizeIntensity(value: string | undefined): Intensity {
  return value === 'low' || value === 'high' ? value : 'moderate';
}

/** Downgrade an intensity to a ceiling, preserving anything already below it. */
function capIntensity(value: Intensity, ceiling: Intensity): Intensity {
  return INTENSITY_ORDER[value] > INTENSITY_ORDER[ceiling] ? ceiling : value;
}

// ── Owner-aware slot solver (mirror of my-app/lib/scheduleSlots.ts) ──
// Inlined here because Deno edge functions don't share the TS import path
// with the app code. Keep both copies in sync if behaviour changes.

interface OwnerPrefs {
  wake_time: string | null;
  bedtime: string | null;
  work_start: string | null;
  work_end: string | null;
  weekend_shifts_hours: number | null;
}

interface DaySlots {
  breakfast: string;
  morningActivity: string;
  middayHydration: string;
  lunch: string | null;
  middayActivity: string;
  eveningHydration: string;
  dinner: string;
  eveningActivity: string;
  windDown: string;
}

function parseTime(t: string | null, fallback: string): number {
  const src = t ?? fallback;
  const [h, m] = src.split(':').map(Number);
  return h * 60 + (m || 0);
}

function formatTime(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

function resolveSlots(prefs: OwnerPrefs | null, isWeekend: boolean, species: string): DaySlots {
  const defaultWake = species === 'cat' ? '06:30' : '07:00';
  const wake = parseTime(prefs?.wake_time ?? null, defaultWake);
  const bedtime = parseTime(prefs?.bedtime ?? null, '22:30');
  const workStart = prefs?.work_start ? parseTime(prefs.work_start, '09:00') : null;
  const workEnd = prefs?.work_end ? parseTime(prefs.work_end, '17:30') : null;

  const shiftHours = Math.max(-2, Math.min(4, prefs?.weekend_shifts_hours ?? 0));
  const shift = isWeekend ? shiftHours * 60 : 0;

  const breakfast = wake + 30;
  const morningActivity = workStart !== null ? workStart - 75 : wake + 45;
  const midday = workStart !== null && workEnd !== null ? Math.round((workStart + workEnd) / 2) : 12 * 60;
  const middayActivity = midday + 30;
  const eveningHydrationBase = workEnd !== null ? workEnd + 15 : 17 * 60;
  const dinner = workEnd !== null ? workEnd + 60 : 18 * 60 + 30;
  const eveningActivity = dinner + 75;
  const windDown = bedtime - 60;
  const lunch = species === 'cat' ? midday - 15 : null;

  return {
    breakfast: formatTime(breakfast + shift),
    morningActivity: formatTime(morningActivity + shift),
    middayHydration: formatTime(midday + shift),
    lunch: lunch !== null ? formatTime(lunch + shift) : null,
    middayActivity: formatTime(middayActivity + shift),
    eveningHydration: formatTime(eveningHydrationBase + shift),
    dinner: formatTime(dinner + shift),
    eveningActivity: formatTime(eveningActivity + shift),
    windDown: formatTime(windDown + shift),
  };
}

function isWeekendDay(dateStr: string): boolean {
  // YYYY-MM-DD → parsed as local. Sun=0, Sat=6.
  const [y, m, d] = dateStr.split('-').map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return day === 0 || day === 6;
}

// Activity calorie burn rates (kcal/kg per hour) — veterinary exercise science
// Source: NRC Nutrient Requirements of Dogs and Cats, Pendlebury et al.
// Swimming is highest because water removes body heat = highest thermogenic effect
const BURN_RATES: Record<string, Record<string, number>> = {
  walk:     { low: 1.5,   moderate: 3.0,   high: 5.0 },   // kcal/kg/hr at each intensity
  play:     { low: 2.0,   moderate: 4.0,   high: 6.0 },
  training: { low: 1.8,   moderate: 3.5,   high: 5.5 },
  grooming: { low: 0.3,   moderate: 0.5,   high: 0.8 },  // light touch/handling
  other:    { low: 1.0,   moderate: 2.0,   high: 3.0 },
  water:    { low: 0,     moderate: 0,     high: 0 },     // water activities don't burn — they're hydration
  medicine: { low: 0,     moderate: 0,     high: 0 },      // medicine doesn't burn
};

/**
 * Estimate kcal burned for a single activity based on type, intensity, and pet weight.
 * Uses per-hour burn rate scaled to activity duration.
 */
function estimateActivityBurn(
  activityType: string,
  intensity: string,
  durationMinutes: number | null,
  weightKg: number
): number {
  if (!durationMinutes || durationMinutes <= 0) return 0;
  const rates = BURN_RATES[activityType] || BURN_RATES['other'];
  const rate = rates[intensity as keyof typeof rates] ?? rates.moderate;
  const hours = durationMinutes / 60;
  return Math.round(rate * weightKg * hours * 10) / 10; // 1 decimal precision
}

/**
 * Compute weekly activity burn summary from generated activity rows.
 */
function computeBurnSummary(
  rows: Record<string, unknown>[],
  weightKg: number,
  targetDailyCalories: number,
  dailyDeficitKcal: number,
): {
  weeklyBurnKcal: number;
  dailyBurnKcal: number;
  activityContributionPercent: number;  // % of daily target contributed by activity
  deficitContributionPercent: number;   // % of weekly calorie deficit from activity
  activityDays: number;
  totalMinutes: number;
  byType: Record<string, { count: number; totalKcal: number; totalMinutes: number }>;
} {
  const byType: Record<string, { count: number; totalKcal: number; totalMinutes: number }> = {};
  let totalKcal = 0;
  let totalMinutes = 0;

  for (const row of rows) {
    const type = row.activity_type as string;
    const intensity = (row.intensity as string) || 'moderate';
    const duration = row.duration_minutes as number | null;
    const kcal = estimateActivityBurn(type, intensity, duration, weightKg);

    if (!byType[type]) {
      byType[type] = { count: 0, totalKcal: 0, totalMinutes: 0 };
    }
    byType[type].count++;
    byType[type].totalKcal += kcal;
    byType[type].totalMinutes += duration || 0;
    totalKcal += kcal;
    totalMinutes += duration || 0;
  }

  const activityDays = new Set(rows.map(r => r.scheduled_date as string)).size || 1;
  const weeklyBurnKcal = Math.round(totalKcal * 10) / 10;
  const dailyBurnKcal = Math.round(weeklyBurnKcal / activityDays);
  // Real planned deficit (estimated maintenance − prescribed target), supplied
  // by the app from its kcal engine. Zero for maintain/gain plans, in which
  // case the "% of deficit" framing is suppressed entirely — activity isn't
  // servicing a deficit that doesn't exist.
  const targetDeficitPerWeek = dailyDeficitKcal > 0 ? dailyDeficitKcal * 7 : 0;
  const activityContributionPercent = targetDailyCalories > 0
    ? Math.round((dailyBurnKcal / targetDailyCalories) * 100)
    : 0;
  const deficitContributionPercent = targetDeficitPerWeek > 0
    ? Math.min(100, Math.round((weeklyBurnKcal / targetDeficitPerWeek) * 100))
    : 0;

  return {
    weeklyBurnKcal,
    dailyBurnKcal,
    activityContributionPercent,
    deficitContributionPercent,
    activityDays,
    totalMinutes,
    byType,
  };
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ── Security: Authenticate caller ──
    const auth = await verifyAuth(req, corsHeaders);
    if (auth.error) return auth.error;

    // ── Security: Rate limit (3 requests/hour) ──
    const rateLimited = await checkRateLimit(auth.userId, 'generate-schedule', RATE_LIMITS['generate-schedule'], corsHeaders);
    if (rateLimited) return rateLimited;

    // ── Security: Parse body with size limits ──
    const parsed = await safeParseBody(req);
    if (parsed.error) {
      logInternal('generate-schedule', parsed.error.detail, 'body validation');
      return errorResponse(parsed.error.code, corsHeaders);
    }

    const { petProfile, daysToGenerate, performanceContext, localDate, localTime, activityRestrictions, dailyDeficitKcal } = parsed.data as Record<string, any>;
    const numDays = daysToGenerate || 7;
    const petId = petProfile?.id;
    if (!petId || !isValidUUID(petId)) {
      logInternal('generate-schedule', 'missing or malformed pet id');
      return errorResponse('invalid_input', corsHeaders);
    }

    // ── The caller's local calendar date. The server's UTC "today" can be a
    // day off for most of the world (an evening generation in the Americas
    // lands under tomorrow's date; an early-morning one in Asia under
    // yesterday's). The app reads activities by LOCAL date, so the plan must
    // be anchored to the client's date, not the server's. ──
    const startDate: string = typeof localDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(localDate)
      ? localDate
      : new Date().toISOString().split('T')[0];

    // The caller's local wall-clock time (HH:MM[:SS]). When present, day-0
    // rows whose slot has already passed are dropped: a fresh plan "begins
    // now", and a mid-day regeneration can't insert a second pending
    // Breakfast/Midday row next to the one already completed this morning.
    // (The pending-only wipe before insert — see LAYER 4 — preserves the
    // completed rows this drop leaves standing.)
    const startTime: string | null = typeof localTime === 'string' && /^\d{2}:\d{2}(:\d{2})?$/.test(localTime)
      ? (localTime.length === 5 ? `${localTime}:00` : localTime)
      : null;

    // ── Structured exercise restrictions from clinical conditions. These are
    // enforced in code below (intensity ceiling), not just fed to the LLM. ──
    const restrictions: ActivityRestrictionInput[] = Array.isArray(activityRestrictions)
      ? activityRestrictions
          .filter((r: any) => r && typeof r.label === 'string')
          .map((r: any) => ({
            label: String(r.label).slice(0, 120),
            maxIntensity: normalizeIntensity(r.maxIntensity),
          }))
          .slice(0, 10)
      : [];
    const restrictionCeiling: Intensity | null = restrictions.length > 0
      ? restrictions.reduce<Intensity>(
          (min, r) => (INTENSITY_ORDER[r.maxIntensity] < INTENSITY_ORDER[min] ? r.maxIntensity : min),
          'high',
        )
      : null;

    // Real planned daily deficit from the app's kcal engine (0 = not a
    // hypocaloric plan). Clamped to a sane range to reject garbage input.
    const deficitKcal: number = typeof dailyDeficitKcal === 'number' && Number.isFinite(dailyDeficitKcal)
      ? Math.max(0, Math.min(2000, Math.round(dailyDeficitKcal)))
      : 0;

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
    if (!GEMINI_API_KEY) {
      logInternal('generate-schedule', 'GEMINI_API_KEY is not configured.');
      return errorResponse('server_error', corsHeaders);
    }

    // ==========================================
    // LAYER 1: DETERMINISTIC HEALTH MATH
    // ==========================================
    // Water Calculation: ~50ml/kg total requirement, diet-aware — wet-fed
    // pets get most of their water from food, so their DRINKING target is
    // lower (see _shared/hydration.ts). Session = target/3; the builder
    // schedules exactly 3 hydration tasks so a completed day meets the target.
    const weightKg = parseFloat(petProfile?.current_weight_kg || '10');
    const dietType: string[] | null = Array.isArray(petProfile?.diet_type) ? petProfile.diet_type : null;
    const waterPerSession = waterPerSessionMl(weightKg, dietType);

    const hasMedicalConditions = petProfile?.medical_conditions && petProfile.medical_conditions.length > 0;
    const isNeutered = petProfile?.is_neutered ?? true;
    const bcs = petProfile?.body_condition_score ?? 5; // 1-9 scale, default to ideal
    const ageYears = petProfile?.age_years ?? 3;
    const targetDailyCalories = petProfile?.target_daily_calories ?? 0;
    const species = petProfile?.species || 'dog';
    const mealGramsPerServing: number | null = petProfile?.meal_grams_per_serving ?? null;

    // ── Fetch owner routine prefs for slot solver ──
    // Null prefs → slot solver returns species-aware defaults (07:00 wake etc),
    // matching the legacy hardcoded behaviour. Existing users see no regression.
    const SUPABASE_URL_FOR_PREFS = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    let ownerPrefs: OwnerPrefs | null = null;
    try {
      const prefsRes = await fetch(
        `${SUPABASE_URL_FOR_PREFS}/rest/v1/owner_preferences?owner_id=eq.${auth.userId}&select=wake_time,bedtime,work_start,work_end,weekend_shifts_hours`,
        {
          headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          },
        },
      );
      if (prefsRes.ok) {
        const rows = await prefsRes.json();
        if (Array.isArray(rows) && rows.length > 0) ownerPrefs = rows[0] as OwnerPrefs;
      } else {
        console.warn('[generate-schedule] owner_preferences fetch non-ok:', prefsRes.status);
      }
    } catch (e) {
      console.warn('[generate-schedule] owner_preferences fetch failed (using defaults):', e);
    }

    // ── BCS-based intensity modifier (Purina Body Condition System) ──
    // Direct fat reserve signal — more accurate than weight-gap heuristic
    let bcsRule = '';
    if (bcs >= 7) {
      bcsRule = `BODY CONDITION (BCS ${bcs}/9 — OVERWEIGHT): Prioritize LOW-IMPACT fat-burning activities. Max session length ${Math.min(20 + (9 - bcs) * 3, 35)} minutes to protect joints. Prefer flat terrain, sniffing, nose-work. Avoid jumping, stairs, or high-impact movements. Every activity should mention joint protection in "why_its_good".`;
    } else if (bcs <= 4) {
      bcsRule = `BODY CONDITION (BCS ${bcs}/9 — UNDERWEIGHT): Focus on gentle, joint-safe conditioning. Moderate intensity OK, but prioritize enrichment and mental engagement over exhausting physical exercise. Avoid activities that burn excessive calories. Support healthy muscle building with low-impact play.`;
    } else {
      bcsRule = `BODY CONDITION (BCS ${bcs}/9 — IDEAL): Full activity programming. Maintain healthy baseline with varied activities. No restrictions needed.`;
    }

    // ── Age-based exercise limits (WSAVA/AAHA guidelines) ──
    let ageRule = '';
    if (ageYears < 1) {
      const maxMin = Math.round(ageYears * 12 * 5);
      ageRule = `AGE: Puppy (${ageYears}yr old) — max ${maxMin} min per session. Focus on mental + physical development. Enforced rest periods required. No long-distance running.`;
    } else if (ageYears >= 8) {
      ageRule = `AGE: Senior (${ageYears}yr old) — LOW-IMPACT preferred. Max 20-30 min per session. Prioritize joint health and mobility over intensity. Prefer sniffing, slow walks, gentle play over brisk running.`;
    } else {
      ageRule = `AGE: Adult (${ageYears}yr old) — full programming allowed. 30-90 min/day structured activity is appropriate.`;
    }

    // ── Neutered metabolism context ──
    const neuteredNote = isNeutered
      ? `Metabolic note: Pet is neutered — baseline RER is reduced by ~10%. This means fewer calories burned at rest, making consistent activity even more important for weight management.`
      : '';

    // ── Activity calorie budget context ──
    let calorieBudgetNote = '';
    if (targetDailyCalories > 0) {
      const targetActivityBurn = Math.round(targetDailyCalories * 0.12); // ~12% of daily target as activity burn target
      const weeklyBurn = targetActivityBurn * 7;
      calorieBudgetNote = `ACTIVITY CALORIE TARGET: Daily target is ${targetDailyCalories} kcal. Activity plan should target burning ~${targetActivityBurn} kcal/day (~${weeklyBurn} kcal/week) through exercise. This contributes ~12% of the daily energy budget. Schedule activities that include this context in the notes.`;
    }

    // ── Recovery cycle rule ──
    const recoveryRule = `RECOVERY RULE: Do NOT schedule "high" intensity activities on 3+ consecutive days. Alternate physical activities with mental enrichment (sniff walks, puzzle games, training sessions). After every intense session, include a "gentle" or "enrichment" day. This is based on veterinary exercise science for joint/muscle recovery.`;

    // ── Mental vs Physical balance ──
    const mentalPhysicalBalance = `DAILY SLOT STRUCTURE: Design activities to fit this balance across the day:
    - MORNING slot: Physical activity (brisk walk, fetch, active play)
    - MIDDAY slot: Mental enrichment (sniff walk, puzzle feeder, obedience training, nose-work)
    - EVENING slot: Social/gentle (bonding, grooming, calm play, enrichment)
    For each archetype, specify which slot it belongs to via the "why_its_good" field (e.g., "Mental enrichment — great for midday").`;

    // ==========================================
    // LAYER 2: GENERATIVE AI (Archetype Pool)
    // ==========================================
    const targetWeightKg = parseFloat(petProfile?.target_weight_kg || weightKg.toString());
    const weightGap = weightKg - targetWeightKg;
    let weightRule = "";
    
    if (weightGap > 0.5) {
      weightRule = `WEIGHT LOSS GOAL: The pet is ${weightGap.toFixed(1)}kg overweight. You MUST prioritize low-impact, fat-burning activities. Remind the user in 'why_its_good' that this helps reach their ${targetWeightKg}kg goal. Do NOT suggest high-calorie feeding games unless using their measured daily kibble.`;
    } else if (weightGap < -0.5) {
      weightRule = `WEIGHT GAIN GOAL: The pet is ${Math.abs(weightGap).toFixed(1)}kg underweight. Prioritize gentle, mass-building enrichment. Remind the user in 'why_its_good' that this builds strength towards their ${targetWeightKg}kg goal. Suggest high-value treats.`;
    } else {
      weightRule = `WEIGHT MAINTENANCE: The pet is at their ideal healthy weight of ${targetWeightKg}kg. Prioritize sustaining this healthy baseline.`;
    }

    // ── Build performance-aware prompt additions ──
    let performanceRules = '';
    let durationMultiplier = 1.0;

    if (performanceContext) {
      const cr = performanceContext.lastWeekCompletionRate ?? null;
      const skipped = performanceContext.lastWeekSkippedCount ?? 0;
      const avgDuration = performanceContext.avgCompletedDurationMins ?? null;
      const calPercent = performanceContext.todayCalPercent ?? null;
      const weightDir = performanceContext.weightTrendDirection ?? null;
      const fatigued = performanceContext.fatigueDetected ?? false;

      console.log(`[generate-schedule] Performance context: CR=${cr}, skipped=${skipped}, avgDur=${avgDuration}, calPct=${calPercent}, weightDir=${weightDir}, fatigue=${fatigued}`);

      // Fatigue detection: user is overwhelmed, switch to gentle activities
      if (fatigued) {
        performanceRules += `\nADAPTIVE RULE — FATIGUE DETECTED: The owner has been struggling to keep up. Focus on ENRICHMENT and GENTLE PLAY over physical exercise. Suggest short nose-work games, gentle grooming sessions, and calm bonding activities. Keep everything under 15 minutes. Be encouraging, not demanding.`;
        durationMultiplier = 0.5;
      }
      // Low completion: make activities shorter and more achievable
      else if (cr !== null && cr < 0.5) {
        performanceRules += `\nADAPTIVE RULE — LOW COMPLETION (${Math.round(cr * 100)}%): The owner completed less than half of last week's activities. Generate SHORTER, MORE ACHIEVABLE activities. Prioritize 5-10 minute quick wins. Use encouraging language in "why_its_good" — celebrate small efforts, don't guilt-trip.`;
        durationMultiplier = 0.6;
      }
      // Moderate completion: slightly reduce
      else if (cr !== null && cr < 0.7) {
        performanceRules += `\nADAPTIVE RULE — MODERATE COMPLETION (${Math.round(cr * 100)}%): Activities are slightly too long. Shorten durations by ~20% and ensure variety to maintain engagement.`;
        durationMultiplier = 0.8;
      }

      // If we know the average duration the user actually completes, cap suggestions
      if (avgDuration !== null && avgDuration > 0 && !fatigued) {
        performanceRules += `\nDURATION INSIGHT: The owner typically completes activities around ${avgDuration} minutes on average. Keep suggestions close to this sweet spot.`;
      }

      // Calorie-aware: if pet is running high on calories, add extra walk
      if (calPercent !== null && calPercent > 85) {
        performanceRules += `\nCALORIE CONTEXT: The pet's calorie intake is high (${calPercent}% of daily target). Include at least one extra moderate walk in the daily plan to help balance energy intake. A vet would recommend consistent moderate exercise for calorie management.`;
      }

      // Weight trending up: emphasize calorie-burning activities
      if (weightDir === 'up') {
        performanceRules += `\nWEIGHT TREND: Weight is trending up. Prioritize low-impact but consistent calorie-burning activities (brisk walks, fetch). Avoid treat-based training games unless using measured kibble from daily allowance.`;
      }
      // Weight trending down toward goal: celebrate and maintain
      else if (weightDir === 'down') {
        performanceRules += `\nWEIGHT TREND: Weight is trending down (good progress toward goal). Maintain current activity levels. Mention progress encouragingly in "why_its_good".`;
      }
    }

    const systemPrompt = `You are an empathetic, practical pet care expert.
Your job is to generate a pool of 8 highly personalized, actionable "Activity Archetypes" for the pet below.

Pet Profile:
- Name: ${petProfile?.name || 'Buddy'}
- Species: ${petProfile?.species || 'dog'}
- Breed: ${petProfile?.breed || 'Mixed'}
- Age: ${petProfile?.age_years || '?'} years
- Weight: ${weightKg} kg
- Activity Level: ${petProfile?.activity_level || 'normal'}
${petProfile?.body_condition_score ? `\n- Body Condition Score: ${petProfile.body_condition_score}/9 (Purina 9-point scale)` : ''}
${isNeutered ? '\n- Neutered: Yes (RER reduced ~10% — activity is extra important)' : ''}

${weightRule}
${bcsRule}
${ageRule}
${neuteredNote}
${calorieBudgetNote}
${recoveryRule}
${mentalPhysicalBalance}

- Medical Conditions: ${petProfile?.medical_conditions?.join(', ') || 'None'}
- Allergies: ${petProfile?.allergies?.join(', ') || 'None'}
${restrictions.length > 0 ? `\nEXERCISE RESTRICTIONS (clinical — MUST be respected in every archetype):\n${restrictions.map(r => `- ${r.label} (max intensity: ${r.maxIntensity})`).join('\n')}` : ''}
${performanceRules}

VOICE RULES — apply to all generated text:
- Maximum 3 sentences for any field (why_its_good, title, how_to_do_it)
- Use the animal's name, never "your dog/cat/pet"
- Use correct pronouns (his/her based on profile sex, never "their" for a known individual)
- Never use: exclamation marks, "immediately", "urgent", "ensure", "incredible", "amazing"
- Tone: calm, specific, direct, plainspoken Australian English
- Never speak as the animal — Pawtchi narrates in third person

RULES (CRITICAL):
1. Focus on Practical Personalization. Do not use pretentious buzzwords. Suggest actionable mini-games, indoor puzzles, or specific types of walks.
2. Tailor explicitly to breed, age, BCS, and medical conditions (e.g., Joint-friendly games for seniors; problem-solving for working breeds, BCS-aware intensity).
3. The "how_to_do_it" field must be a 1-2 sentence actionable instruction.
4. The "why_its_good" field must be a plain-English empathetic explanation that references the pet's specific profile (BCS, age, weight goal, medical conditions).
5. activity_type MUST be one of: walk, play, grooming, training, other. (Do NOT generate water or medicine, code handles that).
6. Duration MUST respect the age rule (puppies: 5 min/month age max; seniors: max 30 min). Never exceed the age-based cap.
7. For BCS 7+ pets, every activity MUST be explicitly LOW-IMPACT with joint protection mentioned.
8. Set the "slot" field to the daily slot this activity suits: "morning" (physical exercise), "midday" (mental enrichment), or "evening" (social/gentle). Generate a MIX across all three slots — at least 2 archetypes per slot.

Respond ONLY with valid JSON matching this schema:
{
  "archetypes": [
    {
      "activity_type": "(walk|play|grooming|training|other)",
      "title": "Engaging Title",
      "how_to_do_it": "Actionable instructions...",
      "why_its_good": "Empathetic reason based on profile...",
      "intensity": "(low|moderate|high)",
      "duration_minutes": 15,
      "slot": "(morning|midday|evening)"
    }
  ]
}`;

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`
    const geminiPayload = {
      contents: [{ parts: [{ text: systemPrompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json'
      }
    };

    console.log('[generate-schedule] Calling Gemini for 8 Activity Archetypes...');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

    const geminiRes = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY,
      },
      body: JSON.stringify(geminiPayload),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const data = await geminiRes.json();
    if (data.error) {
      logInternal('generate-schedule', `upstream error: ${JSON.stringify(data.error).substring(0, 300)}`);
      return errorResponse('ai_unavailable', corsHeaders);
    }

    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    let parsedArchetypes: { archetypes: ActivityArchetype[] };
    try {
      const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsedArchetypes = JSON.parse(cleaned);
    } catch (_e) {
      console.error('[generate-schedule] JSON parse failed. Raw:', rawText.substring(0, 500));
      return errorResponse('ai_unavailable', corsHeaders);
    }

    const archetypes = parsedArchetypes.archetypes || [];
    if (archetypes.length === 0) {
      logInternal('generate-schedule', 'model returned 0 archetypes');
      return errorResponse('ai_unavailable', corsHeaders);
    }

    // ── ENFORCEMENT: the safety rules above are also in the prompt, but the
    // prompt is a request — this is the guarantee. Every archetype is clamped
    // in code so an LLM miss can never schedule an unsafe session. ──

    // Duration ceiling — puppies: 5 min/month of age; seniors: 30 min
    // (joint protection); adults: 90 min sanity cap.
    let maxDuration: number;
    if (ageYears < 1) {
      maxDuration = Math.round(ageYears * 12 * 5);
    } else if (ageYears >= 8) {
      maxDuration = 30;
    } else {
      maxDuration = 90;
    }
    // BCS 7+ session cap (same formula the prompt quotes): protects joints
    // carrying excess load. Tighter of the two caps wins.
    if (bcs >= 7) {
      maxDuration = Math.min(maxDuration, Math.min(20 + (9 - bcs) * 3, 35));
    }

    // Intensity ceiling — tightest of: clinical restrictions, BCS extremes
    // (overweight joints / underweight energy reserves), senior age.
    let intensityCeiling: Intensity = 'high';
    if (restrictionCeiling) intensityCeiling = capIntensity(intensityCeiling, restrictionCeiling);
    if (bcs >= 7 || bcs <= 3) intensityCeiling = capIntensity(intensityCeiling, 'moderate');
    if (ageYears >= 8) intensityCeiling = capIntensity(intensityCeiling, 'moderate');

    const VALID_SLOTS: DaySlotName[] = ['morning', 'midday', 'evening'];
    for (const arch of archetypes) {
      // Normalize + clamp intensity.
      const normalized = normalizeIntensity(arch.intensity);
      const clamped = capIntensity(normalized, intensityCeiling);
      if (clamped !== normalized) {
        console.log(`[generate-schedule] Intensity of "${arch.title}" clamped ${normalized} → ${clamped}`);
      }
      arch.intensity = clamped;

      // Normalize slot; infer from intensity when the LLM omitted it
      // (high-energy → morning, gentle → evening, the rest → midday).
      if (!VALID_SLOTS.includes(arch.slot as DaySlotName)) {
        arch.slot = clamped === 'high' ? 'morning' : clamped === 'low' ? 'evening' : 'midday';
      }

      // Clamp duration.
      if (arch.duration_minutes > maxDuration) {
        const original = arch.duration_minutes;
        arch.duration_minutes = maxDuration;
        console.log(`[generate-schedule] Capped "${arch.title}" from ${original}min to ${maxDuration}min (age=${ageYears}yr, bcs=${bcs})`);
      }
      // Sanity floor: never go below 5 min
      if (arch.duration_minutes < 5) {
        arch.duration_minutes = 5;
      }
    }

    // Apply duration multiplier from performance context
    if (durationMultiplier !== 1.0) {
      console.log(`[generate-schedule] Applying duration multiplier: ${durationMultiplier}x`);
      for (const arch of archetypes) {
        arch.duration_minutes = Math.max(5, Math.round(arch.duration_minutes * durationMultiplier));
      }
    }

    
    // ==========================================
    // LAYER 3: SYNTHESIS (Schedule Builder)
    // Generates TODAY + (numDays - 1) future days for a total of numDays days
    // ==========================================
    const rows: Record<string, unknown>[] = [];

    // Calendar-safe date arithmetic on YYYY-MM-DD strings (no TZ drift).
    const addDaysYMD = (ymd: string, days: number): string => {
      const [y, m, d] = ymd.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, d + days)).toISOString().split('T')[0];
    };

    // Build one day's worth of activities. Slot times now come from the
    // owner-aware resolveSlots() rather than hardcoded clock literals.
    const feedingPortionNote = mealGramsPerServing && mealGramsPerServing > 0
      ? `Recommended portion: ~${mealGramsPerServing}g of their daily food.`
      : `Use the portion size shown on the food bag for ${petProfile?.name ?? 'your pet'}'s weight.`;

    // ── Deterministic archetype picker ──
    // The prompt's recovery/slot/variety rules are enforced HERE, not left to
    // chance: slot-matched pools, round-robin rotation for day-to-day variety,
    // no repeated archetype within a day, and no 'high' session once the two
    // previous days both contained one (joint/muscle recovery).
    const poolsBySlot: Record<DaySlotName, ActivityArchetype[]> = { morning: [], midday: [], evening: [] };
    for (const a of archetypes) poolsBySlot[a.slot as DaySlotName].push(a);
    const slotCursor: Record<DaySlotName, number> = { morning: 0, midday: 0, evening: 0 };
    let consecutiveHighDays = 0;

    const pickArchetype = (slot: DaySlotName, usedToday: Set<string>, allowHigh: boolean): ActivityArchetype => {
      const pool = poolsBySlot[slot].length > 0 ? poolsBySlot[slot] : archetypes;
      const n = pool.length;
      for (let i = 0; i < n; i++) {
        const cand = pool[(slotCursor[slot] + i) % n];
        if (usedToday.has(cand.title)) continue;
        if (!allowHigh && cand.intensity === 'high') continue;
        slotCursor[slot] = (slotCursor[slot] + i + 1) % n;
        return cand;
      }
      // Tiny pool and everything excluded — relax the no-repeat rule but keep
      // the recovery rule: a high pick on a recovery day is served downgraded.
      const fallback = pool.find(c => allowHigh || c.intensity !== 'high') ?? pool[0];
      if (!allowHigh && fallback.intensity === 'high') {
        return { ...fallback, intensity: 'moderate' };
      }
      return fallback;
    };

    const buildDayRows = (dateStr: string): Record<string, unknown>[] => {
      const dayRows: Record<string, unknown>[] = [];
      const slots = resolveSlots(ownerPrefs, isWeekendDay(dateStr), species);
      const now = new Date().toISOString();
      const usedToday = new Set<string>();
      const allowHigh = consecutiveHighDays < 2;
      let dayHasHigh = false;

      // Helper to push a row with shared defaults.
      const push = (row: Record<string, unknown>) => dayRows.push({
        pet_id: petId,
        water_ml: null,
        duration_minutes: null,
        intensity: null,
        scheduled_date: dateStr,
        status: 'pending',
        is_ai_generated: true,
        created_at: now,
        ...row,
      });

      const pushActivity = (slot: DaySlotName, scheduledTime: string) => {
        const arc = pickArchetype(slot, usedToday, allowHigh);
        usedToday.add(arc.title);
        if (arc.intensity === 'high') dayHasHigh = true;
        push({
          activity_type: arc.activity_type,
          title: arc.title,
          notes: `${arc.how_to_do_it}\n\nWhy it's good: ${arc.why_its_good}`,
          duration_minutes: arc.duration_minutes,
          intensity: arc.intensity,
          scheduled_time: scheduledTime,
          is_core_task: false,
        });
      };

      // ── Breakfast feeding ──
      push({
        activity_type: 'feeding',
        title: 'Breakfast',
        notes: feedingPortionNote,
        scheduled_time: slots.breakfast,
        is_core_task: true,
      });

      // ── Morning fill (1st of 3 hydration sessions) ──
      // waterPerSession = dailyTarget / 3, so THREE sessions must exist for a
      // fully completed day to reach the daily water target. The old plan only
      // scheduled midday + evening — completing everything topped out at 67%.
      push({
        activity_type: 'water',
        title: 'Morning Fill',
        notes: `Start the day with a fresh bowl of water. Recommended: ${waterPerSession}ml`,
        water_ml: waterPerSession,
        scheduled_time: formatTime(parseTime(slots.breakfast, '07:30') + 15),
        is_core_task: true,
      });

      // ── Morning activity (physical) ──
      pushActivity('morning', slots.morningActivity);

      // ── Midday hydration ──
      push({
        activity_type: 'water',
        title: 'Midday Refresh',
        notes: `Replenish water bowl. Keeping hydrated aids digestion. Recommended: ${waterPerSession}ml`,
        water_ml: waterPerSession,
        scheduled_time: slots.middayHydration,
        is_core_task: true,
      });

      // ── Optional lunch feeding (cats only by default) ──
      if (slots.lunch) {
        push({
          activity_type: 'feeding',
          title: 'Lunch',
          notes: feedingPortionNote,
          scheduled_time: slots.lunch,
          is_core_task: true,
        });
      }

      // ── Midday activity (mental enrichment) ──
      pushActivity('midday', slots.middayActivity);

      // ── Evening hydration ──
      push({
        activity_type: 'water',
        title: 'Evening Hydration',
        notes: `Final water top-off for the day. Recommended: ${waterPerSession}ml`,
        water_ml: waterPerSession,
        scheduled_time: slots.eveningHydration,
        is_core_task: true,
      });

      // ── Dinner feeding ──
      push({
        activity_type: 'feeding',
        title: 'Dinner',
        notes: feedingPortionNote,
        scheduled_time: slots.dinner,
        is_core_task: true,
      });

      // ── Evening activity (social/gentle) ──
      // Pets with medical conditions keep their evening session — gentle,
      // structured movement is usually what they need most.
      pushActivity('evening', slots.eveningActivity);

      // ── Daily meds check (wind-down) — medication is a daily routine, not
      // an every-other-day one, and it no longer displaces the evening activity.
      if (hasMedicalConditions) {
        push({
          activity_type: 'medicine',
          title: 'Health Check & Meds',
          notes: `Check in on their ${petProfile.medical_conditions[0]} and administer scheduled meds as needed.`,
          scheduled_time: slots.windDown,
          is_core_task: true,
        });
      }

      // Recovery-rule bookkeeping for the next day.
      consecutiveHighDays = dayHasHigh ? consecutiveHighDays + 1 : 0;

      return dayRows;
    };

    // Day 0 = the CLIENT's today (so the user immediately sees activities,
    // on the correct local calendar day), then numDays-1 days onward.
    for (let day = 0; day < numDays; day++) {
      let dayRows = buildDayRows(addDaysYMD(startDate, day));
      if (day === 0 && startTime) {
        dayRows = dayRows.filter(r => (r.scheduled_time as string) >= startTime);
      }
      rows.push(...dayRows);
    }

    console.log(`[generate-schedule] Built ${rows.length} total activities from Archetypes & Math`);

    // ==========================================
    // LAYER 3.5: ACTIVITY BURN FEEDBACK LOOP
    // Compute estimated calorie burn so user sees activity's contribution
    // ==========================================
    const burnSummary = computeBurnSummary(rows, weightKg, targetDailyCalories, deficitKcal);
    console.log(`[generate-schedule] Burn summary: ${burnSummary.weeklyBurnKcal} kcal/wk, ${burnSummary.dailyBurnKcal} kcal/day, ${burnSummary.deficitContributionPercent}% of deficit`);

    // ==========================================
    // LAYER 4: DATABASE INSERT
    // ==========================================
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // ── Idempotency: wipe the existing PENDING AI plan across the same date
    // range before inserting the fresh one. Without this, a second generation
    // (re-tapping "Generate", the auto-adjuster, or a client retry after a
    // response that failed *after* the insert already committed) stacks a
    // duplicate plan — two "Evening Hydration" rows, etc. Completed/skipped
    // rows are preserved (history), and manual logs (is_ai_generated=false)
    // are untouched. Runs here, right before insert, so a failed Gemini call
    // never destroys the user's current plan. ──
    const endDate = addDaysYMD(startDate, numDays - 1);
    const wipeRes = await fetch(
      `${supabaseUrl}/rest/v1/activities?pet_id=eq.${petId}` +
        `&is_ai_generated=eq.true&status=eq.pending` +
        `&scheduled_date=gte.${startDate}&scheduled_date=lte.${endDate}`,
      {
        method: 'DELETE',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          Prefer: 'return=minimal',
        },
      },
    );
    if (!wipeRes.ok) {
      const wipeErr = await wipeRes.text();
      logInternal('generate-schedule', `pending wipe failed: ${wipeErr.substring(0, 300)}`);
      return errorResponse('server_error', corsHeaders);
    }

    const insertRes = await fetch(`${supabaseUrl}/rest/v1/activities`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(rows)
    });

    if (!insertRes.ok) {
      const errText = await insertRes.text();
      logInternal('generate-schedule', `schedule insert failed: ${errText.substring(0, 300)}`);
      return errorResponse('server_error', corsHeaders);
    }

    console.log('[generate-schedule] Schedule created successfully!');

    return new Response(
      JSON.stringify({
        success: true,
        days_generated: numDays,
        activities_created: rows.length,
        archetypes_used: archetypes.length,
        activity_burn: {
          weekly_kcal: burnSummary.weeklyBurnKcal,
          daily_kcal: burnSummary.dailyBurnKcal,
          contribution_pct: burnSummary.activityContributionPercent,
          deficit_contribution_pct: burnSummary.deficitContributionPercent,
          total_minutes: burnSummary.totalMinutes,
          by_type: burnSummary.byType,
        },
        weight_kg: weightKg,
        target_daily_calories: targetDailyCalories,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    logInternal('generate-schedule', error, 'unhandled');
    const isAbort = error instanceof Error && error.name === 'AbortError';
    return errorResponse(isAbort ? 'ai_unavailable' : 'server_error', corsHeaders);
  }
});
