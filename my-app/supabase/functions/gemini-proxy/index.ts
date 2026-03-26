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
- Weight: ${weightKg} kg

${weightRule}

- Body Condition Score: ${petProfile?.body_condition_score || '?'}/9
- Known Allergies: ${petProfile?.allergies?.join(', ') || 'None reported'}
- Medical Conditions: ${petProfile?.medical_conditions?.join(', ') || 'None reported'}
- Current Diet: ${petProfile?.diet_type?.join(', ') || 'Unknown'}
- Daily Calorie Target: ${petProfile?.target_daily_calories || '?'} kcal

IMPORTANT RULES:
1. Extract the food name, calorie content per serving, and serving size from the image.
2. Cross-reference the ingredient list against the pet's known allergies. Flag ANY match.
3. Identify ingredients of concern for the pet's species and medical conditions.
4. Provide a short recommendation (1-2 sentences).

You MUST respond with ONLY valid JSON in this exact format, no markdown, no extra text:
{
  "food_name": "string",
  "calories_per_serving": number,
  "serving_size": "string (e.g. '1 cup / 240g')",
  "is_allergy_trigger": boolean,
  "allergy_warnings": ["string array of specific warnings"],
  "ingredients_of_concern": ["string array"],
  "recommendation": "string",
  "confidence": number between 0 and 1
}

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
        maxOutputTokens: 1024,
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
