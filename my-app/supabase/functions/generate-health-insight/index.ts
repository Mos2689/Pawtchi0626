import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { verifyAuth } from '../_shared/auth.ts'
import { checkRateLimit, RATE_LIMITS } from '../_shared/rateLimit.ts'
import { safeParseBody, isValidUUID } from '../_shared/validate.ts'
import { computeWaterTargetMl } from '../_shared/hydration.ts'
import { errorResponse, logInternal } from '../_shared/errors.ts'

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_TIMEOUT_MS = 30_000;

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
    const rateLimited = await checkRateLimit(auth.userId, 'generate-health-insight', RATE_LIMITS['generate-health-insight'], corsHeaders);
    if (rateLimited) return rateLimited;

    // ── Security: Parse body with size limits ──
    const parsed = await safeParseBody(req);
    if (parsed.error) {
      logInternal('generate-health-insight', parsed.error.detail, 'body validation');
      return errorResponse(parsed.error.code, corsHeaders);
    }

    const { petId } = parsed.data as Record<string, any>;
    if (!petId || !isValidUUID(petId)) {
      logInternal('generate-health-insight', 'missing or malformed petId');
      return errorResponse('invalid_input', corsHeaders);
    }

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
    if (!GEMINI_API_KEY) {
      logInternal('generate-health-insight', 'GEMINI_API_KEY not configured.');
      return errorResponse('server_error', corsHeaders);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sb = createClient(supabaseUrl, supabaseKey)

    // ── Security: Verify the caller owns this pet ──
    const { data: petOwnerCheck } = await sb
      .from('pets')
      .select('owner_id')
      .eq('id', petId)
      .single();
    
    if (!petOwnerCheck || petOwnerCheck.owner_id !== auth.userId) {
      return errorResponse('forbidden', corsHeaders);
    }

    // Gather pet data
    const { data: pet } = await sb.from('pets').select('*').eq('id', petId).single()
    if (!pet) {
      logInternal('generate-health-insight', `pet ${petId} passed ownership check but full row fetch returned null`);
      return errorResponse('not_found', corsHeaders);
    }

    const today = new Date()
    const sevenDaysAgo = new Date(today)
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const fourteenDaysAgo = new Date(today)
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)
    const todayStr = today.toISOString().split('T')[0]
    const sevenStr = sevenDaysAgo.toISOString().split('T')[0]
    const fourteenStr = fourteenDaysAgo.toISOString().split('T')[0]

    // Fetch this week + last week data for comparison
    const [logsRes, logsLastRes, actsRes, actsLastRes, weightRes, scansRes, treatsRes] = await Promise.all([
      // This week
      sb.from('daily_logs').select('*').eq('pet_id', petId).gte('log_date', sevenStr).lte('log_date', todayStr),
      // Last week (for comparison)
      sb.from('daily_logs').select('*').eq('pet_id', petId).gte('log_date', fourteenStr).lt('log_date', sevenStr),
      // Activities this week
      sb.from('activities').select('*').eq('pet_id', petId).gte('scheduled_date', sevenStr).lte('scheduled_date', todayStr),
      // Activities last week
      sb.from('activities').select('*').eq('pet_id', petId).gte('scheduled_date', fourteenStr).lt('scheduled_date', sevenStr),
      // Weight history
      sb.from('weight_logs').select('*').eq('pet_id', petId).order('logged_at', { ascending: false }).limit(5),
      // Recent food scans
      sb.from('food_scans').select('*').eq('pet_id', petId).order('created_at', { ascending: false }).limit(10),
      // Treat data this week
      sb.from('food_scans').select('ai_estimated_calories, is_treat').eq('pet_id', petId).eq('is_treat', true).gte('created_at', `${sevenStr}T00:00:00`),
    ])

    const logs = logsRes.data || []
    const logsLast = logsLastRes.data || []
    const acts = actsRes.data || []
    const actsLast = actsLastRes.data || []
    const weights = weightRes.data || []
    const scans = scansRes.data || []
    const treatScans = treatsRes.data || []

    // ── This week aggregates ──
    const totalCal = logs.reduce((s: number, l: any) => s + (l.calories_consumed || 0), 0)
    const avgCal = logs.length > 0 ? Math.round(totalCal / logs.length) : 0
    const totalWater = logs.reduce((s: number, l: any) => s + (l.water_ml || 0), 0)
    const avgWater = logs.length > 0 ? Math.round(totalWater / logs.length) : 0
    const daysWaterOnTarget = logs.filter((l: any) => (l.water_ml || 0) >= computeWaterTargetMl(pet.current_weight_kg, pet.diet_type) * 0.7).length

    const completedActs = acts.filter((a: any) => a.status === 'completed')
    const skippedActs = acts.filter((a: any) => a.status === 'skipped')
    const totalExerciseMins = completedActs.reduce((s: number, a: any) => s + (a.duration_minutes || 0), 0)

    // ── Last week aggregates (for comparison) ──
    const lastTotalCal = logsLast.reduce((s: number, l: any) => s + (l.calories_consumed || 0), 0)
    const lastAvgCal = logsLast.length > 0 ? Math.round(lastTotalCal / logsLast.length) : 0
    const lastCompletedActs = actsLast.filter((a: any) => a.status === 'completed')
    const lastExerciseMins = lastCompletedActs.reduce((s: number, a: any) => s + (a.duration_minutes || 0), 0)
    const lastTotalWater = logsLast.reduce((s: number, l: any) => s + (l.water_ml || 0), 0)
    const lastAvgWater = logsLast.length > 0 ? Math.round(lastTotalWater / logsLast.length) : 0

    // ── Comparison deltas ──
    const calDelta = lastAvgCal > 0 ? Math.round(((avgCal - lastAvgCal) / lastAvgCal) * 100) : null
    const exerciseDelta = lastExerciseMins > 0 ? Math.round(((totalExerciseMins - lastExerciseMins) / lastExerciseMins) * 100) : null
    const waterDelta = lastAvgWater > 0 ? Math.round(((avgWater - lastAvgWater) / lastAvgWater) * 100) : null

    // ── Weight & treats ──
    const weightTrend = weights.length >= 2
      ? `${weights[0].weight_kg}kg (latest) vs ${weights[weights.length-1].weight_kg}kg (oldest)`
      : `Current: ${pet.current_weight_kg}kg`

    const recentFoods = scans.map((s: any) => s.ai_identified_food).filter(Boolean).join(', ')
    const totalTreatCals = treatScans.reduce((s: number, t: any) => s + (t.ai_estimated_calories || 0), 0)
    const totalTreats = logs.reduce((s: number, l: any) => s + (l.treats_consumed || 0), 0)

    const targetCal = pet.target_daily_calories || 0
    const targetWater = computeWaterTargetMl(pet.current_weight_kg, pet.diet_type)
    const pronoun = pet.gender === 'female' ? 'her' : pet.gender === 'male' ? 'his' : 'their'
    const pronounSubj = pet.gender === 'female' ? 'she' : pet.gender === 'male' ? 'he' : 'they'

    // ── Deterministic observations ──
    // We compute the specific facts of the week in code, then hand them to
    // Gemini as a "must reference" list. This is what stops the model from
    // reaching for filler like "areas for improvement" when data is thin —
    // it now has to pick from a set of concrete truths.
    const kcalPctOfTarget = targetCal > 0 && avgCal > 0 ? Math.round((avgCal / targetCal) * 100) : null
    const waterPctOfTarget = targetWater > 0 && avgWater > 0 ? Math.round((avgWater / targetWater) * 100) : null
    const treatPctOfDaily = targetCal > 0 && totalTreatCals > 0 ? Math.round((totalTreatCals / 7 / targetCal) * 100) : null
    const daysLogged = logs.length
    const weightDeltaKg = weights.length >= 2 ? Number((weights[0].weight_kg - weights[weights.length - 1].weight_kg).toFixed(1)) : null
    const observations: string[] = []
    if (daysLogged >= 3) {
      if (kcalPctOfTarget !== null) observations.push(`${pet.name} averaged ${avgCal} kcal/day — that is ${kcalPctOfTarget}% of ${pronoun} ${targetCal} kcal target.`)
      if (waterPctOfTarget !== null) observations.push(`Water averaged ${avgWater} ml/day (${waterPctOfTarget}% of the ${targetWater} ml target); ${daysWaterOnTarget}/7 days hit the target.`)
      if (totalExerciseMins > 0) observations.push(`${totalExerciseMins} minutes of activity across ${completedActs.length} sessions this week.`)
      if (skippedActs.length >= 2) observations.push(`${skippedActs.length} scheduled activities were skipped.`)
      if (treatPctOfDaily !== null && treatPctOfDaily >= 8) observations.push(`Treats are ${treatPctOfDaily}% of ${pronoun} daily kcal — vets typically cap at 10%.`)
      if (weightDeltaKg !== null && Math.abs(weightDeltaKg) >= 0.2) observations.push(`Weight moved ${weightDeltaKg > 0 ? '+' : ''}${weightDeltaKg} kg across the ${weights.length} logged weigh-ins.`)
      if (calDelta !== null && Math.abs(calDelta) >= 10) observations.push(`Calorie intake is ${calDelta > 0 ? 'up' : 'down'} ${Math.abs(calDelta)}% versus last week.`)
      if (exerciseDelta !== null && Math.abs(exerciseDelta) >= 15) observations.push(`Activity is ${exerciseDelta > 0 ? 'up' : 'down'} ${Math.abs(exerciseDelta)}% versus last week.`)
      if (waterDelta !== null && Math.abs(waterDelta) >= 15) observations.push(`Water is ${waterDelta > 0 ? 'up' : 'down'} ${Math.abs(waterDelta)}% versus last week.`)
    }

    const thinData = daysLogged < 3 && weights.length < 2 && completedActs.length < 2

    const dataPrompt = `You are Pawtchi, a calm veterinary companion. You are writing this week's reflection card for ONE specific pet. Your job is to notice patterns the owner would miss and turn them into one clear action. You are not a general advice column — every sentence must be grounded in the numbers below.

PET
- Name: ${pet.name} (use this name, never "your dog/cat/pet")
- Species: ${pet.species}, Breed: ${pet.breed || 'Mixed'}
- Sex: ${pet.gender || 'unknown'} — use ${pronoun}/${pronounSubj}, never "they" for a known individual
- Age: ${pet.age_years || '?'} years
- Weight: ${pet.current_weight_kg} kg, target ${pet.target_weight_kg || 'not set'} kg, BCS ${pet.body_condition_score || '?'}/9
- Activity level: ${pet.activity_level}
- Allergies: ${pet.allergies?.join(', ') || 'None'}
- Conditions: ${pet.medical_conditions?.join(', ') || 'None'}
- Daily target: ${targetCal} kcal, ~${targetWater} ml water

RAW DATA (this week, 7 days)
- Days with any log: ${daysLogged}/7
- Avg calories: ${avgCal} kcal ${kcalPctOfTarget !== null ? `(${kcalPctOfTarget}% of target)` : ''}
- Avg water: ${avgWater} ml ${waterPctOfTarget !== null ? `(${waterPctOfTarget}% of target)` : ''}, on-target days ${daysWaterOnTarget}/7
- Exercise: ${totalExerciseMins} min / ${completedActs.length} sessions; skipped ${skippedActs.length}
- Weight: ${weightTrend}${weightDeltaKg !== null ? ` (${weightDeltaKg > 0 ? '+' : ''}${weightDeltaKg} kg net)` : ''}
- Treats: ${totalTreats} logged (${totalTreatCals} kcal from treats)${treatPctOfDaily !== null ? `, ~${treatPctOfDaily}% of daily kcal` : ''}
- Recent foods scanned: ${recentFoods || 'None'}

VS LAST WEEK
- Calories ${calDelta !== null ? `${calDelta > 0 ? '+' : ''}${calDelta}%` : 'no prior data'}
- Activity ${exerciseDelta !== null ? `${exerciseDelta > 0 ? '+' : ''}${exerciseDelta}%` : 'no prior data'}
- Water ${waterDelta !== null ? `${waterDelta > 0 ? '+' : ''}${waterDelta}%` : 'no prior data'}

PRE-COMPUTED OBSERVATIONS — the wins/concerns/tip MUST reference specific numbers from this list. Do not invent metrics that are not here.
${observations.length > 0 ? observations.map(o => `• ${o}`).join('\n') : '• (Not enough logged days this week to compute reliable patterns.)'}

${thinData ? `THIN-DATA MODE: fewer than 3 logged days and fewer than 2 weight logs.
- Headline: acknowledge this is the first pattern-forming week for ${pet.name} — do NOT pretend to see a trend.
- Wins: only include something if it is literally in the data (e.g., "${daysLogged}/7 days logged", "${completedActs.length} activity session${completedActs.length === 1 ? '' : 's'} completed"). Otherwise return [].
- Concerns: []
- Tip: name ONE specific logging action for this week (e.g., "Log ${pet.name}'s water at each refill for 3 days — Pawtchi needs a baseline before ${pronoun} target flexes.").
` : ''}
BANNED PHRASES — if any of these appear, the output is rejected:
- "areas for improvement", "room for improvement", "shows improvement"
- "consult your vet", "speak to your vet", "check with a vet" (unless a red-flag concern genuinely warrants it)
- "overall health", "well-being", "wellbeing"
- "ensure", "make sure", "be sure to"
- "keep up the good work", "great job", "amazing", "incredible", "AI-powered"
- exclamation marks, "immediately", "urgent"
- generic tips like "try to exercise more", "give more water", "watch the diet"
- "your dog/cat/pet" instead of the name

STYLE
- Max 3 sentences per field. Plainspoken Australian English. Third person — Pawtchi narrates, never speaks as ${pet.name}.
- Every wins/concerns line names a number OR a concrete food/activity — no adjectives standing alone.
- The tip is a single sentence naming: (1) what to do, (2) when/how much, (3) why (linked to a number above). It must be doable this week without buying anything.

FORMAT — respond with exactly one JSON block in \`\`\`json fences:
{
  "headline": "One sentence naming ${pet.name} + the single most important pattern from this week's numbers.",
  "wins": ["1-3 items, each references a number from the observations above"],
  "concerns": ["0-2 items, only if genuinely concerning — reference the number that concerned you"],
  "tip": "One specific action for THIS week, tied to a number above.",
  "comparison": {
    "caloriesVsLastWeek": "${calDelta !== null ? `${calDelta > 0 ? '+' : ''}${calDelta}%` : 'N/A'}",
    "activityVsLastWeek": "${exerciseDelta !== null ? `${exerciseDelta > 0 ? '+' : ''}${exerciseDelta}%` : 'N/A'}",
    "waterVsLastWeek": "${waterDelta !== null ? `${waterDelta > 0 ? '+' : ''}${waterDelta}%` : 'N/A'}"
  }
}

EXAMPLES

Good headline: "Bruno hit ${pronoun} water target only 3/7 days this week, and it's the biggest slip Pawtchi has seen this month."
Bad headline: "Bruno's weekly data shows areas for improvement in his daily nutrition and hydration." (banned phrase, no numbers)

Good tip: "Move Bruno's afternoon bowl refill to right after ${pronoun} walk — that is when the 3/7 dry days landed, and a wet mouth drinks faster."
Bad tip: "Review Bruno's current food label and consult your vet." (banned phrase, unrelated to the observations)

Good win: "Bruno finished 5 of 6 walks — 42 min more than last week."
Bad win: "Bruno is doing great with his exercise routine." (no number, generic praise)`

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

    const geminiRes = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: dataPrompt }] }],
        generationConfig: {
          temperature: 0.5,
          maxOutputTokens: 8192,
        },
      }),
      signal: controller.signal,
    })
    clearTimeout(timeoutId);

    if (!geminiRes.ok) {
      const errText = await geminiRes.text()
      logInternal('generate-health-insight', `upstream ${geminiRes.status}: ${errText.substring(0, 300)}`);
      return errorResponse('ai_unavailable', corsHeaders);
    }

    const geminiData = await geminiRes.json()
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || ''

    // Parse structured response
    let structured = null
    let insightText = ''
    try {
      const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      structured = JSON.parse(cleaned)
      // Build a readable fallback text from the structured data
      insightText = structured.headline || 'Weekly health summary generated.'
    } catch {
      // Fallback: treat as plain text (backward compatible)
      insightText = rawText.trim() || 'Unable to generate insight.'
      structured = null
    }

    // Store in health_insights table — insight_text for backward compat, structured in insight_data
    const insertPayload: Record<string, unknown> = {
      pet_id: petId,
      insight_text: insightText,
      insight_type: 'weekly_summary',
    }

    // Store structured JSON in insight_data column if available
    if (structured) {
      insertPayload.insight_data = structured
    }

    const { data: insight, error: insertErr } = await sb
      .from('health_insights')
      .insert(insertPayload)
      .select()
      .single()

    if (insertErr) throw insertErr

    return new Response(
      JSON.stringify({ success: true, insight }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err: unknown) {
    logInternal('generate-health-insight', err, 'unhandled');
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return errorResponse(isAbort ? 'ai_unavailable' : 'server_error', corsHeaders);
  }
})
