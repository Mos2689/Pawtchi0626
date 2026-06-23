import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { verifyAuth } from '../_shared/auth.ts'
import { checkRateLimit, RATE_LIMITS } from '../_shared/rateLimit.ts'
import { safeParseBody, isValidUUID } from '../_shared/validate.ts'

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

    // ── Security: Rate limit (3 requests/hour) ──
    const rateLimited = await checkRateLimit(auth.userId, 'generate-health-insight', RATE_LIMITS['generate-health-insight'], corsHeaders);
    if (rateLimited) return rateLimited;

    // ── Security: Parse body with size limits ──
    const parsed = await safeParseBody(req);
    if (parsed.error) {
      return new Response(
        JSON.stringify({ success: false, error: parsed.error }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    const { petId } = parsed.data as Record<string, any>;
    if (!petId) throw new Error('petId is required.')
    if (!isValidUUID(petId)) throw new Error('Invalid petId format.')

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured.')

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
      return new Response(
        JSON.stringify({ success: false, error: 'You do not own this pet.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
      );
    }

    // Gather pet data
    const { data: pet } = await sb.from('pets').select('*').eq('id', petId).single()
    if (!pet) throw new Error('Pet not found.')

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
    const daysWaterOnTarget = logs.filter((l: any) => (l.water_ml || 0) >= Math.round(pet.current_weight_kg * 50) * 0.7).length

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
    const targetWater = Math.round(pet.current_weight_kg * 50)

    const dataPrompt = `You are a veterinary health advisor AI for PAWTCHI.
Analyze this pet's last 7 days of data and provide a STRUCTURED weekly health reflection.

Pet Profile:
- Name: ${pet.name}
- Species: ${pet.species}, Breed: ${pet.breed || 'Mixed'}
- Age: ${pet.age_years || '?'} years, Weight: ${pet.current_weight_kg}kg
- Target Weight: ${pet.target_weight_kg || 'Not set'}kg
- Body Condition Score: ${pet.body_condition_score || '?'}/9
- Activity Level: ${pet.activity_level}
- Known Allergies: ${pet.allergies?.join(', ') || 'None'}
- Medical Conditions: ${pet.medical_conditions?.join(', ') || 'None'}
- Target Calories: ${targetCal} kcal/day

This Week (7 days):
- Average daily calories: ${avgCal} kcal (target: ${targetCal})
- Average daily water: ${avgWater}ml (target: ~${targetWater}ml)
- Days water on target: ${daysWaterOnTarget}/7
- Total exercise: ${totalExerciseMins} min across ${completedActs.length} sessions
- Skipped activities: ${skippedActs.length}
- Weight trend: ${weightTrend}
- Treats: ${totalTreats} total (${totalTreatCals} kcal from treats)
- Recent foods: ${recentFoods || 'No food scans'}

Comparison vs Last Week:
- Calories: ${calDelta !== null ? `${calDelta > 0 ? '+' : ''}${calDelta}%` : 'No data'}
- Exercise: ${exerciseDelta !== null ? `${exerciseDelta > 0 ? '+' : ''}${exerciseDelta}%` : 'No data'}
- Water: ${waterDelta !== null ? `${waterDelta > 0 ? '+' : ''}${waterDelta}%` : 'No data'}

IMPORTANT VOICE RULES — follow these for every response:
- Maximum 3 sentences for any text field (headline, tip, wins, concerns)
- Use the animal's name, never "your dog/cat/pet"
- Use correct pronouns (his/her based on profile sex, never "their" for a known individual)
- Never use: exclamation marks, "immediately", "urgent", "ensure", "incredible", "amazing", "AI-powered"
- End with a calm action or note, never an emotional exclamation
- Tone: calm, specific, direct, plainspoken Australian English
- Never speak as the animal — Pawtchi narrates in third person

IMPORTANT: You MUST respond with a valid JSON block enclosed in \`\`\`json fences, using this exact structure:
{
  "headline": "One-sentence summary of the week (warm, specific to the pet by name)",
  "wins": ["Array of 1-3 positive things from this week — be specific with numbers"],
  "concerns": ["Array of 0-2 concerns — only include if genuinely concerning, reference numbers"],
  "tip": "One specific, actionable tip the owner can implement THIS week. Be practical, not generic.",
  "comparison": {
    "caloriesVsLastWeek": "${calDelta !== null ? `${calDelta > 0 ? '+' : ''}${calDelta}%` : 'N/A'}",
    "activityVsLastWeek": "${exerciseDelta !== null ? `${exerciseDelta > 0 ? '+' : ''}${exerciseDelta}%` : 'N/A'}",
    "waterVsLastWeek": "${waterDelta !== null ? `${waterDelta > 0 ? '+' : ''}${waterDelta}%` : 'N/A'}"
  }
}

Rules:
- "wins" should celebrate real achievements (e.g., "Hit water target 5/7 days", "30% more exercise than last week")
- "concerns" should only flag real issues — empty array [] if everything looks fine
- "tip" must be specific and practical, not vague (e.g., "Try replacing one afternoon treat with a 5-min fetch game" NOT "Try to exercise more")
- Reference the pet by name in the headline
- Keep tone warm, encouraging, and vet-informed`

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
      throw new Error(`Gemini error: ${geminiRes.status} - ${errText}`)
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

  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
