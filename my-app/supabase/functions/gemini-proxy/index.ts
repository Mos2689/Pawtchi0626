import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders } from '../_shared/cors.ts'

const GEMINI_MODEL = 'gemini-2.5-flash';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { imageBase64, mimeType, petProfile } = await req.json()

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not configured in Edge Function secrets.')
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`

    const targetWeightKg = parseFloat(petProfile?.target_weight_kg || petProfile?.current_weight_kg || '10');
    const weightKg = parseFloat(petProfile?.current_weight_kg || '10');
    const weightGap = weightKg - targetWeightKg;
    let weightRule = "";

    if (weightGap > 0.5) {
      weightRule = `WEIGHT LOSS WARNING: The pet is ${weightGap.toFixed(1)}kg overweight (Target: ${targetWeightKg}kg). If this food/treat is high in calories or carbs, you MUST explicitly warn the user and suggest strict portion limits in the recommendation.`;
    } else if (weightGap < -0.5) {
      weightRule = `WEIGHT GAIN GOAL: The pet is ${Math.abs(weightGap).toFixed(1)}kg underweight. If this food is nutrient-dense, highlight that it helps build healthy mass towards their ${targetWeightKg}kg goal.`;
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

- Body Condition Score: ${petProfile?.body_condition_score || '?'}/9
- Known Allergies: ${petProfile?.allergies?.join(', ') || 'None reported'}
- Medical Conditions: ${petProfile?.medical_conditions?.join(', ') || 'None reported'}
- Current Diet: ${petProfile?.diet_type?.join(', ') || 'Unknown'}
- Daily Calorie Target: ${petProfile?.target_daily_calories || '?'} kcal
- Known Food Pantry: ${petProfile?.food_pantry && petProfile.food_pantry.length > 0 ? petProfile.food_pantry.map((p: any) => `${p.brand} ${p.product_name} (${p.food_type}${p.is_primary ? ', primary' : ''}): ${p.kcal_per_serving || '?'} kcal/${p.serving_unit || 'serving'}`).join('; ') : 'No foods registered yet'}

IMPORTANT RULES:
1. Extract the food name, calorie content per serving, and serving size from the image.
2. Cross-reference the ingredient list against the pet's known allergies. Flag ANY match.
3. Identify ingredients of concern for the pet's species and medical conditions.
4. Provide a short recommendation (1-2 sentences).
5. ALWAYS PROVIDE A CALORIE ESTIMATE: If the label is missing or it is just "unknown kibble", use generic averages (e.g., standard dry food is ~350 kcal/cup). NEVER return null or 0 for calories_per_serving.
6. PANTRY MATCHING: If the image shows generic, unlabeled food (e.g. a bowl of kibble, a loose treat), match it against the pet's Known Food Pantry. Use the PRIMARY item for that food_type. Apply its exact kcal_per_serving for the calorie estimate and use its brand name in the title (e.g. "{pet name}'s Regular Kibble (Royal Canin Maxi Adult)").
7. NEW FOOD DETECTION: Only note "New food detected" if the image clearly shows a specific brand label that is DIFFERENT from the pantry items, OR if it is human food.
8. LABEL EXTRACTION: If a clear product label or packaging is visible, extract brand and product_name as separate fields. Also extract protein_pct, fat_pct, fibre_pct, and key_ingredients from the guaranteed analysis / ingredient list if visible.

You MUST respond with ONLY valid JSON in this exact format, no markdown, no extra text:
{
  "food_name": "string (brand + product combined for display)",
  "brand": "string or null if not identifiable",
  "product_name": "string or null if not identifiable",
  "food_type": "kibble | wet_food | treat | raw | supplement | human_food",
  "calories_per_serving": number,
  "serving_size": "string (e.g. '1 cup / 240g')",
  "serving_unit": "cup | pouch | piece | gram | can | null",
  "protein_pct": number or null,
  "fat_pct": number or null,
  "fibre_pct": number or null,
  "protein_g": number or null,
  "carbs_g": number or null,
  "fats_g": number or null,
  "key_ingredients": ["top 5-10 ingredients from label"] or null,
  "is_treat": boolean,
  "is_allergy_trigger": boolean,
  "allergy_warnings": ["string array of specific warnings"],
  "ingredients_of_concern": ["string array"],
  "recommendation": "string",
  "confidence": number between 0 and 1,
  "is_labeled_product": boolean
}

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
      }
    };

    const geminiRes = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiPayload)
    });

    const data = await geminiRes.json();

    // Extract the text response from Gemini
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Try to parse the JSON from the response
    let analysis = null;
    try {
      // Strip markdown code fences if present
      const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      analysis = JSON.parse(cleaned);

      // Failsafe: if the AI still returned null/0, provide a generic sensible default
      if (!analysis.calories_per_serving || typeof analysis.calories_per_serving !== 'number') {
        analysis.calories_per_serving = analysis.is_treat ? 35 : 350;
        if (analysis.food_name === 'Unknown' || analysis.food_name === 'string') {
          analysis.food_name = 'Generic Pet Food Estimate';
        }
      }
    } catch {
      analysis = {
        raw_response: rawText,
        parse_error: true,
        food_name: 'Unknown',
        calories_per_serving: 0,
        confidence: 0
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
