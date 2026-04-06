// eslint-disable-next-line import/no-unresolved
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders } from '../_shared/cors.ts'

const GEMINI_MODEL = 'gemini-2.5-flash';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { species, breed, age_years, age_months, current_weight_kg, gender } = await req.json();

    if (!species || !current_weight_kg) {
      throw new Error("Missing required parameters: species, current_weight_kg");
    }

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not configured in Edge Function secrets.')
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`

    const systemPrompt = `You are a world-class veterinary AI for a pet health app.
Your task is to mathematically estimate the IDEAL target weight for a pet based on their profile.

Pet Profile:
- Species: ${species}
- Breed: ${breed || 'Unknown / Mixed'}
- Gender: ${gender || 'Unknown'}
- Age: ${age_years ? `${age_years} years` : 'Unknown'}${age_months ? ` ${age_months} months` : ''}
- Current Weight: ${current_weight_kg} kg

RULES:
1. Estimate the ideal healthy weight in kg (as a number).
2. If the breed is known (e.g., "Golden Retriever", "Maine Coon"), use standard veterinary weight charts for that breed's average adult weight.
3. If the breed is mixed or unknown, analyze the current weight and age. Provide a conservative target close to their current weight (assuming they are near healthy), unless the current weight is extreme for the species.
4. Provide a very short explanation (max 15 words) starting with "Ideal for...". (e.g. "Ideal for an adult Golden Retriever", "Estimated healthy weight based on current metrics").

Respond with ONLY valid JSON fitting this schema:
{
  "ideal_weight_kg": Number,
  "explanation": String
}`;

    const parts = [{ text: systemPrompt }];

    const geminiPayload = {
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.1, // Low temperature for factual/mathematical consistency
        responseMimeType: 'application/json',
      }
    };

    const geminiRes = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiPayload)
    });

    const data = await geminiRes.json();

    if (data.error) {
      throw new Error(`Gemini API Error: ${data.error.message}`);
    }

    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    let result = null;
    try {
      const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      result = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('Failed to parse Gemini output:', rawText);
      // Fallback
      result = {
        ideal_weight_kg: current_weight_kg,
        explanation: "Maintained current weight due to calculation error"
      };
    }

    return new Response(
      JSON.stringify({ success: true, ...result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
