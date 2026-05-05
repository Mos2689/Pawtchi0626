import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders } from '../_shared/cors.ts'

const GEMINI_MODEL = 'gemini-2.5-flash';

// Interfaces for structured output
interface ActivityArchetype {
  activity_type: string;
  title: string;
  how_to_do_it: string;
  why_its_good: string;
  intensity: string;
  duration_minutes: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { petProfile, daysToGenerate, performanceContext } = await req.json()
    const numDays = daysToGenerate || 7;
    const petId = petProfile?.id;
    if (!petId) throw new Error('Pet ID is required.');

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

${weightRule}

- Medical Conditions: ${petProfile?.medical_conditions?.join(', ') || 'None'}
- Allergies: ${petProfile?.allergies?.join(', ') || 'None'}
- Activity Level: ${petProfile?.activity_level || 'moderate'}
${performanceRules}

RULES (CRITICAL):
1. Focus on Practical Personalization. Do not use pretentious buzzwords. Suggest actionable mini-games, indoor puzzles, or specific types of walks.
2. Tailor explicitly to breed, age, and medical conditions (e.g., Joint-friendly games for seniors; problem-solving for working breeds, indoor AC tasks for flat-faced dogs).
3. The "how_to_do_it" field must be a 1-2 sentence actionable instruction.
4. The "why_its_good" field must be a plain-English empathetic explanation of why it fits this specific pet's profile.
5. activity_type MUST be one of: walk, play, grooming, training, other. (Do NOT generate water or medicine, code handles that).

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

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`
    const geminiPayload = {
      contents: [{ parts: [{ text: systemPrompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json'
      }
    };

    console.log('[generate-schedule] Calling Gemini for 8 Activity Archetypes...');
    const geminiRes = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiPayload)
    });

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
        archetypes_used: archetypes.length
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
