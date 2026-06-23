import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getCorsHeaders } from '../_shared/cors.ts'
import { verifyAuth } from '../_shared/auth.ts'
import { checkRateLimit, RATE_LIMITS } from '../_shared/rateLimit.ts'
import { safeParseBody, isValidUUID } from '../_shared/validate.ts'

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_TIMEOUT_MS = 30_000;

// Interfaces for structured output
interface ActivityArchetype {
  activity_type: string;
  title: string;
  how_to_do_it: string;
  why_its_good: string;
  intensity: string;
  duration_minutes: number;
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
  targetDailyCalories: number
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
  const targetDeficitPerWeek = targetDailyCalories > 0 ? targetDailyCalories * 7 * 0.20 : 0; // ~20% deficit for weight loss
  const activityContributionPercent = targetDailyCalories > 0
    ? Math.round((dailyBurnKcal / targetDailyCalories) * 100)
    : 0;
  const deficitContributionPercent = targetDeficitPerWeek > 0
    ? Math.round((weeklyBurnKcal / targetDeficitPerWeek) * 100)
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

Deno.serve(async (req) => {
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
      return new Response(
        JSON.stringify({ success: false, error: parsed.error }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    const { petProfile, daysToGenerate, performanceContext } = parsed.data as Record<string, any>;
    const numDays = daysToGenerate || 7;
    const petId = petProfile?.id;
    if (!petId) throw new Error('Pet ID is required.');
    if (!isValidUUID(petId)) throw new Error('Invalid Pet ID format.');

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not configured.')
    }

    // ==========================================
    // LAYER 1: DETERMINISTIC HEALTH MATH
    // ==========================================
    // Water Calculation: ~50ml per kg of body weight
    const weightKg = parseFloat(petProfile?.current_weight_kg || '10');
    const totalWaterDaily = Math.round(weightKg * 50);
    const waterPerSession = Math.round(totalWaterDaily / 3);

    const hasMedicalConditions = petProfile?.medical_conditions && petProfile.medical_conditions.length > 0;
    const isNeutered = petProfile?.is_neutered ?? true;
    const bcs = petProfile?.body_condition_score ?? 5; // 1-9 scale, default to ideal
    const ageYears = petProfile?.age_years ?? 3;
    const targetDailyCalories = petProfile?.target_daily_calories ?? 0;
    const species = petProfile?.species || 'dog';

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
8. Use the "why_its_good" field to indicate which daily slot this activity suits (morning=physical, midday=mental, evening=social).

Respond ONLY with valid JSON matching this schema:
{
  "archetypes": [
    {
      "activity_type": "(walk|play|grooming|training|other)",
      "title": "Engaging Title",
      "how_to_do_it": "Actionable instructions...",
      "why_its_good": "Empathetic reason based on profile...",
      "intensity": "(low|moderate|high)",
      "duration_minutes": 15
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
      console.error('[generate-schedule] Gemini API error:', JSON.stringify(data.error));
      throw new Error(data.error.message || 'Gemini API error');
    }

    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    let parsedArchetypes: { archetypes: ActivityArchetype[] };
    try {
      const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsedArchetypes = JSON.parse(cleaned);
    } catch (_e) {
      console.error('[generate-schedule] JSON parse failed. Raw:', rawText.substring(0, 500));
      throw new Error('Failed to parse AI archetype response.');
    }

    const archetypes = parsedArchetypes.archetypes || [];
    if (archetypes.length === 0) throw new Error('AI returned 0 archetypes.');

    // ── Duration sanity check: enforce age-based limits ──
    // Puppies: 5 min/month of age (e.g., 6mo puppy = 30 min max)
    // Seniors: max 30 min per session (joint protection)
    // All others: capped at 90 min to prevent unrealistic suggestions
    let maxDuration: number;
    if (ageYears < 1) {
      maxDuration = Math.round(ageYears * 12 * 5);
    } else if (ageYears >= 8) {
      maxDuration = 30;
    } else {
      maxDuration = 90;
    }
    for (const arch of archetypes) {
      if (arch.duration_minutes > maxDuration) {
        const original = arch.duration_minutes;
        arch.duration_minutes = maxDuration;
        console.log(`[generate-schedule] Capped "${arch.title}" from ${original}min to ${maxDuration}min (age=${ageYears}yr)`);
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

    // Helper to get date string in YYYY-MM-DD format
    const getDateStr = (d: Date) => d.toISOString().split('T')[0];

    // Build one day's worth of activities (water + activity slots)
    const buildDayRows = (dateStr: string, archetypes: ActivityArchetype[], hasMedicalConditions: boolean, dayIndex: number): Record<string, unknown>[] => {
      const dayRows: Record<string, unknown>[] = [];

      // 1. Morning Routine
      dayRows.push({
        pet_id: petId,
        activity_type: 'water',
        title: 'Morning Hydration',
        notes: `Ensure fresh water is available to start the day. Recommended: ${waterPerSession}ml`,
        water_ml: waterPerSession,
        duration_minutes: null,
        intensity: null,
        scheduled_date: dateStr,
        scheduled_time: '08:00:00',
        status: 'pending',
        is_core_task: true,
        is_ai_generated: true,
        created_at: new Date().toISOString(),
      });

      const morningArc = archetypes[Math.floor(Math.random() * archetypes.length)];
      dayRows.push({
        pet_id: petId,
        activity_type: morningArc.activity_type,
        title: morningArc.title,
        notes: `${morningArc.how_to_do_it}\n\nWhy it's good: ${morningArc.why_its_good}`,
        water_ml: null,
        duration_minutes: morningArc.duration_minutes,
        intensity: morningArc.intensity,
        scheduled_date: dateStr,
        scheduled_time: '09:00:00',
        status: 'pending',
        is_core_task: false,
        is_ai_generated: true,
        created_at: new Date().toISOString(),
      });

      // 2. Midday Routine
      dayRows.push({
        pet_id: petId,
        activity_type: 'water',
        title: 'Midday Refresh',
        notes: `Replenish water bowl. Keeping hydrated aids digestion. Recommended: ${waterPerSession}ml`,
        water_ml: waterPerSession,
        duration_minutes: null,
        intensity: null,
        scheduled_date: dateStr,
        scheduled_time: '13:00:00',
        status: 'pending',
        is_core_task: true,
        is_ai_generated: true,
        created_at: new Date().toISOString(),
      });

      const middayArc = archetypes[Math.floor(Math.random() * archetypes.length)];
      dayRows.push({
        pet_id: petId,
        activity_type: middayArc.activity_type,
        title: middayArc.title,
        notes: `${middayArc.how_to_do_it}\n\nWhy it's good: ${middayArc.why_its_good}`,
        water_ml: null,
        duration_minutes: middayArc.duration_minutes,
        intensity: middayArc.intensity,
        scheduled_date: dateStr,
        scheduled_time: '14:30:00',
        status: 'pending',
        is_core_task: false,
        is_ai_generated: true,
        created_at: new Date().toISOString(),
      });

      // 3. Evening Routine
      dayRows.push({
        pet_id: petId,
        activity_type: 'water',
        title: 'Evening Hydration',
        notes: `Final water top-off for the day. Recommended: ${waterPerSession}ml`,
        water_ml: waterPerSession,
        duration_minutes: null,
        intensity: null,
        scheduled_date: dateStr,
        scheduled_time: '18:30:00',
        status: 'pending',
        is_core_task: true,
        is_ai_generated: true,
        created_at: new Date().toISOString(),
      });

      if (hasMedicalConditions && dayIndex % 2 === 0) {
        // Schedule medicine every other day (or daily) if they have conditions
        dayRows.push({
          pet_id: petId,
          activity_type: 'medicine',
          title: 'Health Check & Meds',
          notes: `Check in on their ${petProfile.medical_conditions[0]} and administer sorted meds as needed.`,
          water_ml: null,
          duration_minutes: null,
          intensity: null,
          scheduled_date: dateStr,
          scheduled_time: '19:30:00',
          status: 'pending',
          is_core_task: true,
          is_ai_generated: true,
          created_at: new Date().toISOString(),
        });
      } else {
        const eveningArc = archetypes[Math.floor(Math.random() * archetypes.length)];
        dayRows.push({
          pet_id: petId,
          activity_type: eveningArc.activity_type,
          title: eveningArc.title,
          notes: `${eveningArc.how_to_do_it}\n\nWhy it's good: ${eveningArc.why_its_good}`,
          water_ml: null,
          duration_minutes: eveningArc.duration_minutes,
          intensity: eveningArc.intensity,
          scheduled_date: dateStr,
          scheduled_time: '20:00:00',
          status: 'pending',
          is_core_task: false,
          is_ai_generated: true,
          created_at: new Date().toISOString(),
        });
      }

      return dayRows;
    };

    // Day 0 = TODAY (so user immediately sees activities after generation)
    const todayStr = getDateStr(new Date());
    rows.push(...buildDayRows(todayStr, archetypes, hasMedicalConditions, 0));

    // Days 1 through numDays-1 = tomorrow onward
    let currentDate = new Date();
    currentDate.setDate(currentDate.getDate() + 1);
    for (let day = 0; day < numDays - 1; day++) {
      const dateStr = currentDate.toISOString().split('T')[0];
      rows.push(...buildDayRows(dateStr, archetypes, hasMedicalConditions, day + 1));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    console.log(`[generate-schedule] Built ${rows.length} total activities from Archetypes & Math`);

    // ==========================================
    // LAYER 3.5: ACTIVITY BURN FEEDBACK LOOP
    // Compute estimated calorie burn so user sees activity's contribution
    // ==========================================
    const burnSummary = computeBurnSummary(rows, weightKg, targetDailyCalories);
    console.log(`[generate-schedule] Burn summary: ${burnSummary.weeklyBurnKcal} kcal/wk, ${burnSummary.dailyBurnKcal} kcal/day, ${burnSummary.deficitContributionPercent}% of deficit`);

    // ==========================================
    // LAYER 4: DATABASE INSERT
    // ==========================================
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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
      console.error('[generate-schedule] Insert error:', errText);
      throw new Error('Failed to insert schedule: ' + errText);
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
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[generate-schedule] Error:', message);
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
