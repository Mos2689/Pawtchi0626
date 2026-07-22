import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getCorsHeaders } from '../_shared/cors.ts'
import { verifyAuth } from '../_shared/auth.ts'
import { checkRateLimit, RATE_LIMITS } from '../_shared/rateLimit.ts'
import { validateImagePayload, safeParseBody } from '../_shared/validate.ts'
import { errorResponse, logInternal } from '../_shared/errors.ts'

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_TIMEOUT_MS = 30_000;

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── Security: Authenticate caller ──
    const auth = await verifyAuth(req, corsHeaders);
    if (auth.error) return auth.error;

    // ── Security: Rate limit (10 requests/hour) ──
    const rateLimited = await checkRateLimit(auth.userId, 'parse-onboarding-report', RATE_LIMITS['parse-onboarding-report'], corsHeaders);
    if (rateLimited) return rateLimited;

    // ── Security: Parse body with size limits ──
    const parsed = await safeParseBody(req);
    if (parsed.error) {
      logInternal('parse-onboarding-report', parsed.error.detail, 'body validation');
      return errorResponse(parsed.error.code, corsHeaders);
    }

    const { imageBase64, mimeType, species } = parsed.data as Record<string, any>;

    if (!imageBase64) {
      logInternal('parse-onboarding-report', 'imageBase64 missing from request');
      return errorResponse('invalid_input', corsHeaders);
    }

    // ── Security: Validate image payload ──
    const imageErr = validateImagePayload(imageBase64, mimeType);
    if (imageErr) {
      logInternal('parse-onboarding-report', imageErr.detail, 'image validation');
      return errorResponse(imageErr.code, corsHeaders);
    }

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) {
      logInternal('parse-onboarding-report', 'GEMINI_API_KEY is not configured.');
      return errorResponse('server_error', corsHeaders);
    }

    const today = new Date().toISOString().split('T')[0];
    const speciesLabel = species === 'cat' ? 'cat' : 'dog';

    const systemPrompt = `You are a veterinary document analysis AI for PAWTCHI, a pet health app.
Your task is to extract the pet's profile information from this veterinary report, vaccination card, or medical record.
The pet is a ${speciesLabel}. Today's date is ${today}.

EXTRACT the following if visible in the document:

1. **name** - The pet's name (usually in the header)
2. **breed** - The breed (e.g. "Labrador Retriever", "Domestic Shorthair")
3. **gender** - "male" or "female". Common abbreviations: M=male, F=female, MN=male neutered, FS=female spayed, MI=male intact, FI=female intact
4. **is_neutered** - true if neutered/spayed/desexed. MN and FS mean neutered. MI and FI mean intact.
5. **date_of_birth** - In YYYY-MM-DD format if a DOB or birth date is present
6. **age_years** - Integer years. Only use if DOB is not available.
7. **age_months** - Remaining months beyond years. Only use if DOB is not available.
8. **weight_kg** - Most recent weight in kilograms. If weight is in lbs, convert (1 lb = 0.4536 kg). Round to 1 decimal.
9. **body_condition_score** - Integer 1-9 if noted (BCS)
10. **allergies** - Array of confirmed allergens/sensitivities. Include any "Common Allergens", "Common Allergies", or sensitivities listed. Separate them into individual strings (e.g., ["Chicken", "Beef", "Certain grains"]).
11. **medical_conditions** - Array of diagnosed conditions
12. **microchip_number** - If visible

RULES:
- If DOB is present, calculate age_years and age_months from today (${today}). Prefer DOB over a stated age.
- If a field is not visible or cannot be determined, return null. Do NOT guess.
- For breed, use standard breed names. If mixed breed, return "Mixed Breed".
- Return STRICT JSON only, no markdown.

{
  "name": "string | null",
  "breed": "string | null",
  "gender": "male | female | null",
  "is_neutered": "boolean | null",
  "date_of_birth": "YYYY-MM-DD | null",
  "age_years": "number | null",
  "age_months": "number | null",
  "weight_kg": "number | null",
  "body_condition_score": "number | null",
  "allergies": ["string"] | null,
  "medical_conditions": ["string"] | null,
  "microchip_number": "string | null",
  "confidence": "high | medium | low"
}`;

    const geminiPayload = {
      contents: [{
        parts: [
          { text: systemPrompt },
          {
            inline_data: {
              mime_type: mimeType || 'image/jpeg',
              data: imageBase64,
            },
          },
        ],
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
      },
    };

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      logInternal('parse-onboarding-report', `upstream ${geminiRes.status}: ${errText.substring(0, 300)}`);
      return errorResponse('ai_unavailable', corsHeaders);
    }

    const geminiData = await geminiRes.json();
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

    // Clean markdown code blocks if present
    let cleanText = rawText.trim();
    if (cleanText.startsWith('```json')) {
      cleanText = cleanText.substring(7);
    } else if (cleanText.startsWith('```')) {
      cleanText = cleanText.substring(3);
    }
    if (cleanText.endsWith('```')) {
      cleanText = cleanText.substring(0, cleanText.length - 3);
    }
    cleanText = cleanText.trim();

    let extracted: any;
    try {
      extracted = JSON.parse(cleanText);
    } catch {
      // The model produced unparseable output for this document — for the
      // caller that reads the same as a document we couldn't read.
      logInternal('parse-onboarding-report', `model output was not valid JSON: ${cleanText.substring(0, 200)}`);
      return errorResponse('unreadable_image', corsHeaders);
    }

    // If DOB was extracted, compute age from it
    if (extracted.date_of_birth) {
      const dob = new Date(extracted.date_of_birth);
      const now = new Date();
      let years = now.getFullYear() - dob.getFullYear();
      let months = now.getMonth() - dob.getMonth();
      if (months < 0) {
        years--;
        months += 12;
      }
      if (now.getDate() < dob.getDate()) {
        months--;
        if (months < 0) {
          years--;
          months += 12;
        }
      }
      extracted.age_years = Math.max(0, years);
      extracted.age_months = Math.max(0, months);
    }

    return new Response(
      JSON.stringify({ success: true, data: extracted }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: unknown) {
    logInternal('parse-onboarding-report', err, 'unhandled');
    // AbortController timeouts land here — the upstream never answered.
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return errorResponse(isAbort ? 'ai_unavailable' : 'server_error', corsHeaders);
  }
});
