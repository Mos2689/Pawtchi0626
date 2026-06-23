import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getCorsHeaders } from '../_shared/cors.ts'
import { verifyAuth } from '../_shared/auth.ts'
import { checkRateLimit, RATE_LIMITS } from '../_shared/rateLimit.ts'
import { safeParseBody } from '../_shared/validate.ts'

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_TIMEOUT_MS = 30_000;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ── Security: Authenticate caller ──
    const auth = await verifyAuth(req, corsHeaders);
    if (auth.error) return auth.error;

    // ── Security: Rate limit (30 requests/hour) ──
    const rateLimited = await checkRateLimit(auth.userId, 'gemini-verdict', RATE_LIMITS['gemini-verdict'], corsHeaders);
    if (rateLimited) return rateLimited;

    // ── Security: Parse body with size limits ──
    const parsed = await safeParseBody(req);
    if (parsed.error) {
      return new Response(
        JSON.stringify({ success: false, error: parsed.error }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    const {
      pet,
      scan,
      macros,
      // Pre-computed analysis — the LLM narrates this, not judges independently
      analysis,
      // Weight & calorie context — holistic view of the pet's day and journey
      weight_context,
    } = parsed.data as Record<string, any>;

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not configured.')
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

    // --- Resolve display values from context ---
    const petName = pet?.name ?? 'Unknown'
    const species = pet?.species ?? 'dog'
    const ageYears = pet?.age_years ?? null
    const currentWeight = parseFloat(pet?.current_weight_kg || '10')
    const targetWeight = parseFloat(pet?.target_weight_kg || '0')
    const activityLevel = pet?.activity_level ?? 'normal'
    const conditions = pet?.confirmed_condition_keys ?? pet?.medical_conditions ?? []

    // Activity label
    const activityLabels: Record<string, string> = {
      sedentary: 'low-energy',
      normal: 'moderately active',
      active: 'active',
      highly_active: 'highly active',
    }
    const activityDesc = activityLabels[activityLevel] ?? 'active'

    // Life stage
    const isSenior = (ageYears ?? 0) >= 8
    const isPuppy = (ageYears ?? 0) <= 1

    // Allergen names from scan context
    const warnings = scan?.allergy_warnings ?? []
    const allergenNames: string[] = []
    for (const w of warnings) {
      const stripped = w.replace(/,\s*which[^,]*(is on|may be|are on)[^,]*/gi, '').trim()
      const ingredient = stripped.replace(/^contains\s+/i, '').trim()
      if (ingredient && ingredient.length > 1 && ingredient.length < 50) {
        allergenNames.push(ingredient)
      }
    }
    const allergenList = allergenNames.length > 0
      ? allergenNames.slice(0, 2).join(' and ')
      : null

    // --- Analysis context (pre-computed by client) ---
    const healthScore = analysis?.health_score ?? 5
    const healthScoreReasons = analysis?.health_score_reasons ?? []
    const verdictCategory = analysis?.verdict_category ?? 'fair'
    const nutrientStatuses = analysis?.nutrient_statuses ?? []
    const clinicalAdjustments = analysis?.active_clinical_adjustments ?? []

    // --- Weight & calorie context (pre-computed by client) ---
    const wCtx = weight_context ?? {}
    const goal = wCtx.goal ?? 'maintain'
    const weightGapKg = wCtx.weight_gap_kg ?? 0
    const weightTrendDirection = wCtx.weight_trend_direction ?? null
    const caloriesConsumedToday = wCtx.calories_consumed_today ?? 0
    const dailyKcalTarget = wCtx.daily_kcal_target ?? 0
    const caloriesRemaining = wCtx.calories_remaining ?? 0
    const calPercent = wCtx.cal_percent ?? 0
    const mealKcal = macros?.total_kcal ?? scan?.calories_per_serving ?? 0
    const mealPctOfDaily = dailyKcalTarget > 0 ? Math.round((mealKcal / dailyKcalTarget) * 100) : 0

    // Projected values after logging this meal
    const projectedTotal = caloriesConsumedToday + mealKcal
    const projectedRemaining = dailyKcalTarget - projectedTotal

    // --- Build the prompt with COMPLETE context ---
    const systemPrompt = `You are writing a verdict summary for a pet food scan in the PAWTCHI app.

The analysis has ALREADY been computed by our deterministic engine. Your job is to NARRATE the decision in 3–5 plain-English sentences. You must NOT contradict the analysis below.

--- DECISION (already computed — narrate accordingly) ---
Verdict Category: ${verdictCategory.toUpperCase()}
Health Score: ${healthScore}/10
Score Reasons: ${healthScoreReasons.length > 0 ? healthScoreReasons.join('; ') : 'No specific concerns'}

--- PET PROFILE ---
Name: ${petName}
Species: ${species}
Age: ${ageYears ? `${ageYears} years` : 'Unknown'}
Weight: ${currentWeight} kg${targetWeight > 0 ? ` (target: ${targetWeight} kg)` : ''}
Activity: ${activityDesc}
${allergenList ? `Allergies: ${allergenList}` : 'Allergies: None reported'}
Medical conditions: ${conditions.length > 0 ? conditions.join(', ') : 'None'}
${clinicalAdjustments.length > 0 ? `Active clinical adjustments: ${clinicalAdjustments.join(', ')}` : ''}
${isSenior ? 'Life stage: Senior' : isPuppy ? 'Life stage: Puppy/Kitten' : 'Life stage: Adult'}

--- FOOD SCANNED ---
Food: ${scan?.food_name ?? 'Unknown food'}
Food type: ${scan?.food_type ?? 'unknown'}
Is treat: ${scan?.is_treat ? 'Yes' : 'No'}
${allergenList ? `⛔ ALLERGEN TRIGGER: Contains ${allergenList} — this food is UNSAFE for ${petName}.` : 'Allergen trigger: None'}
Calories per serving: ${mealKcal} kcal
${macros ? `Macros: Protein ${macros.protein_g}g, Fat ${macros.fat_g}g, Carbs ${macros.carbs_g}g` : ''}
${macros?.kcal_per_100g ? `Calorie density: ${macros.kcal_per_100g} kcal/100g` : ''}

--- NUTRIENT ANALYSIS ---
${nutrientStatuses.length > 0
  ? nutrientStatuses.map((n: { nutrient: string; status: string }) =>
      `${n.nutrient}: ${n.status}`).join('\n')
  : 'No nutrient data available'}

--- WEIGHT & CALORIE CONTEXT ---
Weight goal: ${goal}${weightGapKg > 0 ? ` (${weightGapKg.toFixed(1)} kg ${goal === 'lose' ? 'to lose' : goal === 'gain' ? 'to gain' : 'from target'})` : ''}
${weightTrendDirection ? `Weight trend: ${weightTrendDirection}` : ''}
${dailyKcalTarget > 0 ? `Daily calorie target: ${dailyKcalTarget} kcal` : ''}
${caloriesConsumedToday > 0 ? `Already consumed today: ${caloriesConsumedToday} kcal (${calPercent}% of target)` : 'No meals logged today yet'}
This meal: ${mealKcal} kcal (${mealPctOfDaily}% of daily target)
${dailyKcalTarget > 0 ? `After this meal: ${projectedRemaining > 0 ? `${projectedRemaining} kcal remaining` : `${Math.abs(projectedRemaining)} kcal OVER target`}` : ''}

--- VOICE RULES (apply to all generated text) ---
- Maximum 3 sentences total
- Use the animal's name, never "your dog/cat/pet"
- Never use: exclamation marks, "immediately", "urgent", "ensure", "incredible", "amazing"
- End with a calm action or note, never an emotional exclamation
- Tone: calm, specific, direct, plainspoken Australian English
- Never speak as the animal — Pawtchi narrates in third person

--- RULES ---
1. The verdict_category is ${verdictCategory.toUpperCase()}. Your tone and language MUST match:
   - UNSAFE: Lead with the safety issue. Be direct. Advise finding a different food.
   - POOR: Be honest about concerns. Do NOT say "good choice" or anything positive about the food.
   - FAIR: Acknowledge it's acceptable but not ideal. Give actionable improvement tips.
   - GOOD: Affirm the choice. Reference what makes it work for this pet.
   - EXCELLENT: Celebrate the choice. Be enthusiastic but concise.
2. Address ${petName} by name throughout.
3. Reference the food by name.
4. When the pet has a weight goal, connect the food's calorie impact to the weight journey.
5. If calories consumed today are relevant, reference the daily budget context naturally.
6. Give one concrete, actionable suggestion (portion adjustment, meal pairing, alternative food, etc.).
7. NEVER use jargon like "AAFCO", "DMB", "g/1000kcal", "MER". Speak to a pet owner, not a vet.
8. If the daily total would exceed the target after this meal, say so clearly and suggest a specific portion reduction.

Output ONLY the paragraph. No preamble, no bullets, no markdown formatting.`

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemPrompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 512,
        },
      }),
      signal: controller.signal,
    })
    clearTimeout(timeout);

    if (!response.ok) {
      const errBody = await response.text()
      throw new Error(`Gemini API error (${response.status}): ${errBody.substring(0, 200)}`)
    }

    const data = await response.json()
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''

    // Clean up any markdown backticks or extra whitespace
    const verdict = rawText.replace(/```/g, '').trim()

    return new Response(
      JSON.stringify({ success: true, verdict }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})