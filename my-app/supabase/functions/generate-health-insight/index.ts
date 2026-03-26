import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GEMINI_MODEL = 'gemini-2.5-flash';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { petId } = await req.json()
    if (!petId) throw new Error('petId is required.')

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured.')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sb = createClient(supabaseUrl, supabaseKey)

    // Gather pet data
    const { data: pet } = await sb.from('pets').select('*').eq('id', petId).single()
    if (!pet) throw new Error('Pet not found.')

    const today = new Date()
    const sevenDaysAgo = new Date(today)
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const todayStr = today.toISOString().split('T')[0]
    const sevenStr = sevenDaysAgo.toISOString().split('T')[0]

    // Fetch 7-day data
    const [logsRes, actsRes, weightRes, scansRes] = await Promise.all([
      sb.from('daily_logs').select('*').eq('pet_id', petId).gte('log_date', sevenStr).lte('log_date', todayStr),
      sb.from('activities').select('*').eq('pet_id', petId).gte('scheduled_date', sevenStr).lte('scheduled_date', todayStr),
      sb.from('weight_logs').select('*').eq('pet_id', petId).order('logged_at', { ascending: false }).limit(5),
      sb.from('food_scans').select('*').eq('pet_id', petId).order('created_at', { ascending: false }).limit(10),
    ])

    const logs = logsRes.data || []
    const acts = actsRes.data || []
    const weights = weightRes.data || []
    const scans = scansRes.data || []

    // Build data summary for Gemini
    const totalCal = logs.reduce((s: number, l: any) => s + (l.calories_consumed || 0), 0)
    const avgCal = logs.length > 0 ? Math.round(totalCal / logs.length) : 0
    const totalWater = logs.reduce((s: number, l: any) => s + (l.water_ml || 0), 0)
    const avgWater = logs.length > 0 ? Math.round(totalWater / logs.length) : 0

    const completedActs = acts.filter((a: any) => a.status === 'completed')
    const skippedActs = acts.filter((a: any) => a.status === 'skipped')
    const totalExerciseMins = completedActs.reduce((s: number, a: any) => s + (a.duration_minutes || 0), 0)

    const weightTrend = weights.length >= 2
      ? `${weights[0].weight_kg}kg (latest) vs ${weights[weights.length-1].weight_kg}kg (oldest)`
      : `Current: ${pet.current_weight_kg}kg`

    const recentFoods = scans.map((s: any) => s.ai_identified_food).filter(Boolean).join(', ')

    const dataPrompt = `You are a veterinary health advisor AI for PAWTCHI.
Analyze this pet's last 7 days of data and provide 2-3 specific, actionable health insights.

Pet Profile:
- Name: ${pet.name}
- Species: ${pet.species}, Breed: ${pet.breed || 'Mixed'}
- Age: ${pet.age_years || '?'} years, Weight: ${pet.current_weight_kg}kg
- Target Weight: ${pet.target_weight_kg || 'Not set'}kg
- Body Condition Score: ${pet.body_condition_score || '?'}/9
- Activity Level: ${pet.activity_level}
- Known Allergies: ${pet.allergies?.join(', ') || 'None'}
- Medical Conditions: ${pet.medical_conditions?.join(', ') || 'None'}
- Target Calories: ${pet.target_daily_calories || '?'} kcal/day

7-Day Summary:
- Average daily calories: ${avgCal} kcal (target: ${pet.target_daily_calories || '?'})
- Average daily water: ${avgWater}ml (recommended: ~${Math.round(pet.current_weight_kg * 50)}ml)
- Total exercise: ${totalExerciseMins} minutes across ${completedActs.length} sessions
- Skipped activities: ${skippedActs.length}
- Weight trend: ${weightTrend}
- Recent foods: ${recentFoods || 'No food scans'}

Provide your analysis as a single paragraph, 2-4 sentences maximum. Be specific, warm, and actionable. Reference the pet by name. Do NOT use bullet points or headers — just flowing text.`

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`

    const geminiRes = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: dataPrompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 300 },
      }),
    })

    if (!geminiRes.ok) {
      const errText = await geminiRes.text()
      throw new Error(`Gemini error: ${geminiRes.status} - ${errText}`)
    }

    const geminiData = await geminiRes.json()
    const insightText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || 'Unable to generate insight.'

    // Store in health_insights table
    const { data: insight, error: insertErr } = await sb
      .from('health_insights')
      .insert({
        pet_id: petId,
        insight_text: insightText.trim(),
        insight_type: 'weekly_summary',
      })
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
