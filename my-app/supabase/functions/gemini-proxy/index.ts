import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getCorsHeaders } from '../_shared/cors.ts'
import { verifyAuth } from '../_shared/auth.ts'
import { checkRateLimit, RATE_LIMITS } from '../_shared/rateLimit.ts'
import { validateImagePayload, safeParseBody } from '../_shared/validate.ts'

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_TIMEOUT_MS = 30_000; // 30 second timeout

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
    const rateLimited = await checkRateLimit(auth.userId, 'gemini-proxy', RATE_LIMITS['gemini-proxy'], corsHeaders);
    if (rateLimited) return rateLimited;

    // ── Security: Parse body with size limits ──
    const parsed = await safeParseBody(req);
    if (parsed.error) {
      return new Response(
        JSON.stringify({ success: false, error: parsed.error }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    const { imageBase64, mimeType, petProfile, selectedPantryItemId, todayState } = parsed.data as Record<string, any>;

    // ── Security: Validate image payload size ──
    const imageErr = validateImagePayload(imageBase64, mimeType);
    if (imageErr) {
      return new Response(
        JSON.stringify({ success: false, error: imageErr }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not configured in Edge Function secrets.')
    }

    // Use header-based auth instead of query parameter (security best practice)
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

    const targetWeightKg = parseFloat(petProfile?.target_weight_kg || petProfile?.current_weight_kg || '10');
    const weightKg = parseFloat(petProfile?.current_weight_kg || '10');
    const weightGap = weightKg - targetWeightKg;
    let weightRule = "";

    if (weightGap > 0.5) {
      weightRule = `WEIGHT LOSS WARNING: The pet is ${weightGap.toFixed(1)}kg overweight (Target: ${targetWeightKg}kg). If this food/treat is high in calories or carbs, you MUST explicitly warn the user and suggest strict portion limits in the recommendation.`;
    } else if (weightGap < -0.5) {
      weightRule = `WEIGHT GAIN GOAL: The pet is ${Math.abs(weightGap).toFixed(1)}kg underweight. If this food is nutrient-dense, highlight that it helps build healthy mass towards their ${targetWeightKg}kg goal.`;
    }

    // Today's live context — lets Gemini judge against the *remaining* budget
    // instead of the static daily ceiling.
    let todayRule = "";
    if (todayState && typeof todayState.today_calories_remaining === 'number') {
      const consumed = todayState.today_calories_consumed ?? 0;
      const remaining = todayState.today_calories_remaining;
      const treatConsumed = todayState.today_treat_calories_consumed ?? 0;
      const treatBudget = todayState.treat_budget ?? 0;
      const trend = todayState.weight_trend_direction;
      const trendNote = trend === 'up' ? ' Weight is also trending UP recently — be stricter.'
                      : trend === 'down' ? ' Weight is trending DOWN — progress is on track.'
                      : '';
      todayRule = `TODAY'S LIVE BUDGET: ${consumed} kcal consumed, ${remaining} kcal remaining today. Treats so far: ${treatConsumed}/${treatBudget} kcal.${trendNote}`;
    }

    // Build the clinical system prompt using the pet's medical profile
    const systemPrompt = `You are a veterinary nutritionist AI for a pet health app called PAWTCHI.
Your task is to analyze the provided pet food image (label, packaging, or treat) and return a structured nutritional assessment.

Pet Profile:
- Name: ${petProfile?.name || 'Unknown'}
- Species: ${petProfile?.species || 'dog'}
- Breed: ${petProfile?.breed || 'Unknown'}
- Gender: ${petProfile?.gender || 'Unknown'}
- Age: ${petProfile?.age_years ? `${petProfile.age_years} years` : 'Unknown'}
- Life Stage: ${petProfile?.life_stage || 'Unknown'}
- Weight: ${weightKg} kg

${weightRule}
${todayRule}

- Body Condition Score: ${petProfile?.body_condition_score || '?'}/9
- Known Allergies: ${petProfile?.allergies?.join(', ') || 'None reported'}
- Medical Conditions: ${petProfile?.medical_conditions?.join(', ') || 'None reported'}
- Current Diet: ${petProfile?.diet_type?.join(', ') || 'Unknown'}
- Daily Calorie Target: ${petProfile?.target_daily_calories || '?'} kcal
- Known Food Pantry: ${petProfile?.food_pantry && petProfile.food_pantry.length > 0 ? petProfile.food_pantry.map((p: any) => `[${p.brand} ${p.product_name} (${p.food_type}${p.is_primary ? ', PRIMARY' : ''})] Density: ${p.kcal_per_serving || 350} kcal/${p.serving_unit || 'cup'}. Macros: ${p.protein_pct || 0}% Protein, ${p.fat_pct || 0}% Fat, ${p.fibre_pct || 0}% Fibre. Ingredients: ${p.key_ingredients?.join(', ') || 'Unknown'}`).join(' | ') : 'No foods registered yet'}
${(() => {
  if (!selectedPantryItemId || !petProfile?.food_pantry) return '';
  const sel = petProfile.food_pantry.find((p: any) => p.id === selectedPantryItemId);
  if (!sel) return '';
  return `\nSELECTED FOOD CONTEXT: The user confirms they are scanning "${sel.brand} ${sel.product_name}" (${sel.food_type}). Use this item's known nutritional data with HIGH confidence: ${sel.kcal_per_serving || '?'} kcal/${sel.serving_unit || 'serving'}, ${sel.protein_pct || '?'}% Protein, ${sel.fat_pct || '?'}% Fat, ${sel.fibre_pct || '?'}% Fibre${sel.moisture_pct ? `, ${sel.moisture_pct}% Moisture` : ''}. Key ingredients: ${sel.key_ingredients?.join(', ') || 'Unknown'}. Match the image to this food and estimate portion/serving count from the visual. Do NOT re-identify the brand — trust the user's selection.`;
})()}

IMPORTANT RULES:
1. Extract the food name, calorie content per serving, and serving size from the image.
2. Cross-reference the ingredient list against the pet's known allergies. Flag ANY match.
3. Identify ingredients of concern for the pet's species and medical conditions.
4. Provide a short recommendation (1-2 sentences).
5. ALWAYS PROVIDE A CALORIE ESTIMATE: If the label is missing or it is just "unknown kibble", use generic averages (e.g., standard dry food is ~350 kcal/cup). NEVER return null or 0 for calories_per_serving.
   - FATAL ERROR PREVENTION: NEVER return calorie values > 5000. If your math results in a number like "196000", you incorrectly converted kcal into single calories. You MUST divide by 1000 and return the kcal value (e.g., 196) instead. The required unit is ALWAYS kilocalories (kcal).
6. PANTRY MATCHING & SERVING MATH: If scanning a generic unlabelled bowl/food, MATCH it to the pet's Known Food Pantry (use the PRIMARY item for that type). 
   - Estimate the physical weight/volume of the food in the image (e.g., 1 cup ≈ 100g).
   - Use the Pantry Item's kcal density to estimate total calories. 
   - CRITICAL: Calculate absolute grams for macros based on your weight estimate. If the Pantry item says 26% Protein, and you estimate 100g of food, then "protein_g" MUST be 26.
   - COPY the exact "Ingredients" from the matched Pantry Item into "key_ingredients". Do NOT output null.
7. NEW FOOD DETECTION (Labels): Only output "is_labeled_product: true" if a brand label is visible. If the label DOES NOT explicitly print its calorie count, calculate it safely (e.g., Protein% * 3.5 + Fat% * 8.5 + Carbs% * 3.5 = kcal per 100g) and base the calories_per_serving on a standard serving. DO NOT hallucinate extreme numbers. Default to standard veterinary averages (350 kcal/cup for kibble, 30 kcal/piece for treats).
8. LABEL EXTRACTION: If a clear product label or packaging is visible, extract brand and product_name as separate fields. Also extract protein_pct, fat_pct, fibre_pct, and key_ingredients from the guaranteed analysis/ingredient list.
9. MOISTURE EXTRACTION: If the guaranteed analysis lists "Moisture" (often shown as "Moisture (max.) X%"), extract the numeric value into "moisture_pct". This is critical for wet food and broths. If the label does not state moisture, return null — DO NOT guess.
10. CALORIE DENSITY EXTRACTION: If the label states a calorie content per kg (e.g. "1080 kcal ME/kg" or "3650 kcal/kg") OR per 100g (e.g. "365 kcal per 100g"), convert to per-100g (divide kcal/kg by 10) and return in "kcal_per_100g_as_fed". This is a separate field from the per-serving calories. If the label does not state any per-mass calorie figure, return null — DO NOT guess and DO NOT compute it from macros.
11. EXTRACTION ONLY — DO NOT SCORE OR RATE: Your job is to extract what is on the label and what is in the image. Do NOT rate, judge, or score this food. Health scoring happens deterministically client-side from the data you extract.
12. MACRO SANITY: protein_g, carbs_g, and fats_g must represent the absolute grams in ONE serving. A single serving can NEVER have more than 200g of any single macro. If your calculation produces a higher number, you have a math error. When a selected pantry item provides protein_pct / fat_pct / moisture_pct, the macro grams MUST be derived from that pantry item's label values using: meal_grams × nutrient_pct / 100.
13. TIME-OF-DAY JUDGMENT (use TODAY'S LIVE BUDGET if provided): Judge this scan against today's REMAINING budget, not just the static daily ceiling. If this food's calories_per_serving would push consumption over today_calories_remaining, the recommendation MUST advise to defer this food, split it across days, or reduce portion. If it's a treat and today_treat_calories_consumed already exceeds treat_budget, the recommendation MUST say to skip it today. When today's remaining budget is healthy (>30% of daily ceiling), DO NOT artificially scold — the food can be appropriate today even if it would be too rich on a tighter day. Be specific: cite remaining-kcal numbers in the recommendation when they drive the verdict.

VOICE RULES for recommendation field:
- Maximum 3 sentences
- Never use: exclamation marks, "immediately", "urgent", "ensure", "incredible", "amazing"
- Use the animal's name, never "your dog/cat/pet"
- Tone: calm, specific, plainspoken
- End with a calm action or note, never an emotional exclamation

You MUST respond with ONLY valid JSON in this exact format, no markdown, no extra text:
{
  "food_name": "string (brand + product combined for display)",
  "brand": "string or null if not identifiable",
  "product_name": "string or null if not identifiable",
  "food_type": "kibble | wet_food | treat | raw | supplement | human_food",
  "calories_per_serving": "number (MUST be in kcal and realistically between 10 and 2000)",
  "serving_size": "string (e.g. '1 cup / 240g')",
  "serving_unit": "cup | pouch | piece | gram | can | null",
  "protein_pct": number or null,
  "fat_pct": number or null,
  "fibre_pct": number or null,
  "moisture_pct": number or null,
  "kcal_per_100g_as_fed": number or null,
  "protein_g": number,
  "carbs_g": number,
  "fats_g": number,
  "key_ingredients": ["top 5-10 ingredients from label"] or null,
  "is_treat": boolean,
  "is_allergy_trigger": boolean,
  "allergy_warnings": ["string array of specific warnings"],
  "ingredients_of_concern": ["string array"],
  "recommendation": "string",
  "confidence": number between 0 and 1,
  "is_labeled_product": boolean,
  "matched_pantry_id": "string id of the pantry item this scan most likely matches, or null if no confident match",
  "match_confidence": "number between 0 and 1 — how confident you are in matched_pantry_id; 0 if no match"
}

PANTRY MATCH OUTPUT RULES:
- If a SELECTED FOOD CONTEXT block was provided above, set matched_pantry_id to that item's id and match_confidence ≥ 0.9 unless the image clearly contradicts (e.g. a wet-food pouch was selected but the image shows dry kibble — then set matched_pantry_id to null and match_confidence to 0).
- Otherwise, when matching a generic bowl against the Known Food Pantry, set matched_pantry_id to the matched item's id and match_confidence to your honest belief (0.6-0.9 typical).
- If no pantry item plausibly matches (e.g. brand-new labeled food, or pantry is empty), set matched_pantry_id to null and match_confidence to 0.

CLASSIFICATION RULES:
- "is_treat": true for treats, biscuits, chews, dental sticks, jerky, training treats, rawhide, bones, snack products, table scraps, human food given as reward. False for complete meals, kibble, wet food, raw diet, prescription diet, puppy/kitten food.
- "food_type": classify based on what you see. Use "kibble" for dry food, "wet_food" for cans/pouches, "treat" for snacks/chews, "raw" for raw diets, "supplement" for vitamins/oils, "human_food" for people food.
- "is_labeled_product": true ONLY if you can clearly read a brand name and product name on packaging/label in the image. False for bowls of food, loose treats, or unreadable labels.

If you cannot read the label clearly, set confidence below 0.5 and explain in recommendation.`;

    // Build the multimodal request payload
    const parts: Record<string, unknown>[] = [
      { text: systemPrompt }
    ];

    // Append the image if provided
    if (imageBase64) {
      parts.push({
        inlineData: {
          mimeType: mimeType || 'image/jpeg',
          data: imageBase64
        }
      });
    }

    const geminiPayload = {
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.2, // Low temp for clinical accuracy
        maxOutputTokens: 8192,
        responseMimeType: "application/json", // Enforce structured JSON output
      }
    };

    // Fetch with timeout + 1 retry
    let geminiRes: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

      try {
        geminiRes = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': GEMINI_API_KEY,
          },
          body: JSON.stringify(geminiPayload),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        // Retry on server errors (503, 429, 500)
        if (geminiRes.status >= 500 || geminiRes.status === 429) {
          console.warn(`[gemini-proxy] Attempt ${attempt + 1} got ${geminiRes.status}, retrying...`);
          if (attempt === 0) {
            await new Promise(r => setTimeout(r, 1500)); // Wait 1.5s before retry
            continue;
          }
        }
        break; // Success or client error — don't retry
      } catch (fetchErr: unknown) {
        clearTimeout(timeout);
        if (attempt === 0) {
          console.warn('[gemini-proxy] First attempt failed, retrying...', fetchErr);
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }
        throw new Error('Gemini API request timed out or failed after 2 attempts.');
      }
    }

    if (!geminiRes || !geminiRes.ok) {
      const errorBody = geminiRes ? await geminiRes.text() : 'No response';
      throw new Error(`Gemini API error (${geminiRes?.status || 'timeout'}): ${errorBody.substring(0, 300)}`);
    }

    const data = await geminiRes.json();

    // Extract the text response from Gemini
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Try to parse the JSON from the response
    let analysis = null;
    try {
      // Strip markdown code fences if present (shouldn't happen with JSON mode, but defensive)
      const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      analysis = JSON.parse(cleaned);

      // ---- Server-side validation & sanitization ----

      // 1. Calorie guardrails
      if (!analysis.calories_per_serving || typeof analysis.calories_per_serving !== 'number') {
        analysis.calories_per_serving = analysis.is_treat ? 35 : 350;
        if (analysis.food_name === 'Unknown' || analysis.food_name === 'string') {
          analysis.food_name = 'Generic Pet Food Estimate';
        }
      } else if (analysis.calories_per_serving > 5000) {
        // Fallback: Gemini likely multiplied kcal by 1000 to get pure calories. Revert to kcal.
        analysis.calories_per_serving = Math.round(analysis.calories_per_serving / 1000);
      }
      // Floor: no food item has negative or near-zero calories
      if (analysis.calories_per_serving < 1) {
        analysis.calories_per_serving = analysis.is_treat ? 35 : 350;
      }

      // 2. Normalize fat field naming (Gemini may return fats_g or fat_g)
      analysis.fat_g = analysis.fats_g ?? analysis.fat_g ?? 0;
      delete analysis.fats_g;

      // 3. Macro sanity: cap at 200g per serving, fix negatives
      for (const key of ['protein_g', 'carbs_g', 'fat_g'] as const) {
        const val = analysis[key];
        if (typeof val !== 'number' || val < 0) {
          analysis[key] = 0;
        } else if (val > 200) {
          // Likely a percentage misread as grams — scale down
          analysis[key] = Math.round(val / 10);
        }
      }

      // 4. Health score is now computed client-side (lib/healthScore.ts).
      //    Strip any health_score the model emits — the client recomputes it.
      delete analysis.health_score;

      // 5. Confidence: ensure 0-1 range
      if (typeof analysis.confidence !== 'number' || analysis.confidence < 0) {
        analysis.confidence = 0.5;
      } else if (analysis.confidence > 1) {
        analysis.confidence = analysis.confidence > 100 ? 0.5 : analysis.confidence / 100;
      }

      // 6. Pantry match validation. The model may hallucinate a matched id —
      //    silently null it if it doesn't exist on this pet's pantry, so the
      //    client can trust the field. Also derive `food_type_mismatch` when
      //    the selected/matched pantry item is a different food_type than the
      //    model's classification (e.g. user selected kibble, photo is wet).
      const pantry = Array.isArray(petProfile?.food_pantry) ? petProfile.food_pantry : [];
      if (analysis.matched_pantry_id) {
        const exists = pantry.some((p: any) => p?.id === analysis.matched_pantry_id);
        if (!exists) {
          analysis.matched_pantry_id = null;
          analysis.match_confidence = 0;
        }
      } else {
        analysis.matched_pantry_id = null;
      }
      if (typeof analysis.match_confidence !== 'number' || analysis.match_confidence < 0) {
        analysis.match_confidence = 0;
      } else if (analysis.match_confidence > 1) {
        analysis.match_confidence = Math.min(1, analysis.match_confidence / 100);
      }
      const referenceId = analysis.matched_pantry_id || selectedPantryItemId || null;
      const referenced = referenceId ? pantry.find((p: any) => p?.id === referenceId) : null;
      analysis.food_type_mismatch = !!(
        referenced && analysis.food_type && referenced.food_type && referenced.food_type !== analysis.food_type
      );

    } catch {
      analysis = {
        raw_response: rawText,
        parse_error: true,
        food_name: 'Unknown',
        calories_per_serving: 0,
        confidence: 0,
        matched_pantry_id: null,
        match_confidence: 0,
        food_type_mismatch: false,
      };
    }

    return new Response(
      JSON.stringify({ success: true, analysis }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
