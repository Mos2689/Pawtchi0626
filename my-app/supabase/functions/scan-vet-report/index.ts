import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { verifyAuth } from '../_shared/auth.ts'
import { checkRateLimit, RATE_LIMITS } from '../_shared/rateLimit.ts'
import { validateImagePayload, safeParseBody, isValidUUID } from '../_shared/validate.ts'
import { errorResponse, logInternal } from '../_shared/errors.ts'

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_TIMEOUT_MS = 30_000;

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  const t0 = Date.now();

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ── Security: Authenticate caller ──
    const auth = await verifyAuth(req, corsHeaders);
    if (auth.error) return auth.error;

    // ── Security: Rate limit (5 requests/hour) ──
    const rateLimited = await checkRateLimit(auth.userId, 'scan-vet-report', RATE_LIMITS['scan-vet-report'], corsHeaders);
    if (rateLimited) return rateLimited;

    // ── Security: Parse body with size limits ──
    const parsed = await safeParseBody(req);
    if (parsed.error) {
      logInternal('scan-vet-report', parsed.error.detail, 'body validation');
      return errorResponse(parsed.error.code, corsHeaders);
    }

    const { imageBase64, mimeType, petId, petProfile } = parsed.data as Record<string, any>;

    if (!imageBase64 || !petId) {
      logInternal('scan-vet-report', 'imageBase64 or petId missing from request');
      return errorResponse('invalid_input', corsHeaders);
    }

    console.log(`[scan-vet-report] start user=${auth.userId} mime=${mimeType || 'unknown'} bytes=${typeof imageBase64 === 'string' ? imageBase64.length : 0}`);

    // ── Security: Validate inputs ──
    if (!isValidUUID(petId)) {
      logInternal('scan-vet-report', `invalid petId format: ${String(petId).substring(0, 50)}`);
      return errorResponse('invalid_input', corsHeaders);
    }

    const imageErr = validateImagePayload(imageBase64, mimeType);
    if (imageErr) {
      logInternal('scan-vet-report', imageErr.detail, 'image validation');
      return errorResponse(imageErr.code, corsHeaders);
    }

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
    if (!GEMINI_API_KEY) {
      logInternal('scan-vet-report', 'GEMINI_API_KEY is not configured.');
      return errorResponse('server_error', corsHeaders);
    }

    // ── Security: API key via header, not URL parameter ──
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

    const systemPrompt = `You are a veterinary document analysis AI for PAWTCHI, a pet health app.
Your task is to extract structured medical data from the provided vet report/document image.

Pet Profile:
- Name: ${petProfile?.name || 'Unknown'}
- Species: ${petProfile?.species || 'dog'}
- Breed: ${petProfile?.breed || 'Unknown'}
- Age: ${petProfile?.age_years || '?'} years
- Weight: ${petProfile?.current_weight_kg || '?'} kg

EXTRACT the following if visible in the document:
1. weight_kg - The pet's recorded weight
2. body_condition_score - Integer from 1-9 representing BCS
3. diagnoses - Array of diagnosed conditions
4. allergies - Array of identified allergens/allergies
5. medications - Array of {name, dosage, frequency}
6. vaccinations - Array of {name, date, next_due}
7. vitals - {temperature, heart_rate, respiratory_rate}
8. lab_results - Any blood work or urinalysis findings
9. vet_notes - Summary of veterinarian's notes/recommendations
10. next_appointment - Next scheduled visit date
11. report_date - Date of the report

RESPOND in STRICT JSON format only. Use null for missing fields:
{
  "weight_kg": number | null,
  "body_condition_score": number | null,
  "diagnoses": ["string"] | null,
  "allergies": ["string"] | null,
  "medications": [{"name": "string", "dosage": "string", "frequency": "string"}] | null,
  "vaccinations": [{"name": "string", "date": "string", "next_due": "string"}] | null,
  "vitals": {"temperature": "string", "heart_rate": "string", "respiratory_rate": "string"} | null,
  "lab_results": "string" | null,
  "vet_notes": "string" | null,
  "next_appointment": "string" | null,
  "report_date": "string" | null
}`

    const geminiPayload = {
      contents: [{
        parts: [
          { text: systemPrompt },
          {
            inline_data: {
              mime_type: mimeType || 'image/jpeg',
              data: imageBase64
            }
          }
        ]
      }],
      generationConfig: {
        temperature: 0.2,
        // Rich reports (multiple diagnoses + meds + vaccinations) exceeded 2048
        // tokens and got truncated mid-JSON. 4096 leaves comfortable headroom.
        maxOutputTokens: 4096,
        responseMimeType: 'application/json'
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

    console.log('[scan-vet-report] gemini call');
    const tGemini = Date.now();
    const geminiRes = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY,
      },
      body: JSON.stringify(geminiPayload),
      signal: controller.signal,
    })
    clearTimeout(timeout);
    console.log(`[scan-vet-report] gemini done ms=${Date.now() - tGemini} ok=${geminiRes.ok}`);

    if (!geminiRes.ok) {
      const errText = await geminiRes.text()
      logInternal('scan-vet-report', `upstream ${geminiRes.status}: ${errText.substring(0, 300)}`);
      return errorResponse('ai_unavailable', corsHeaders);
    }

    const geminiData = await geminiRes.json()
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '{}'

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
    // Gemini sometimes emits a short preamble before the JSON. Trim to the
    // first '{' so the parser sees only the object.
    const firstBrace = cleanText.indexOf('{');
    if (firstBrace > 0) cleanText = cleanText.slice(firstBrace);

    let extractedData: any = null;
    let parseOutcome: 'ok' | 'repaired' | 'failed' = 'ok';
    try {
      extractedData = JSON.parse(cleanText)
    } catch {
      // Salvage repair: when the tail of a long response is cut, walk back to
      // the last balanced '}' and retry. Most truncations clip an array late
      // in the document — this typically recovers everything before that.
      let depth = 0, lastBalanced = -1;
      for (let i = 0; i < cleanText.length; i++) {
        const ch = cleanText[i];
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) lastBalanced = i; }
      }
      if (lastBalanced > 0) {
        try {
          extractedData = JSON.parse(cleanText.slice(0, lastBalanced + 1));
          parseOutcome = 'repaired';
        } catch { parseOutcome = 'failed'; }
      } else {
        parseOutcome = 'failed';
      }
    }
    console.log(`[scan-vet-report] parse outcome=${parseOutcome} chars=${cleanText.length}`);

    // If parsing still failed, refuse to persist a phantom vet visit. The
    // client routes this to the calm "couldn't read" error state.
    // Status stays 200 so functions.invoke() delivers the body (older shipped
    // clients read data.error on 200 responses).
    if (!extractedData || typeof extractedData !== 'object') {
      return errorResponse('unreadable_image', corsHeaders, { status: 200 });
    }

    // Require at least one useful structured field before saving — otherwise
    // the row appears in the vet timeline as a real visit with no details.
    const hasUsefulField =
      (typeof extractedData.weight_kg === 'number' && extractedData.weight_kg > 0) ||
      (typeof extractedData.body_condition_score === 'number') ||
      (Array.isArray(extractedData.diagnoses) && extractedData.diagnoses.length > 0) ||
      (Array.isArray(extractedData.allergies) && extractedData.allergies.length > 0) ||
      (Array.isArray(extractedData.medications) && extractedData.medications.length > 0) ||
      (Array.isArray(extractedData.vaccinations) && extractedData.vaccinations.length > 0) ||
      !!extractedData.next_appointment ||
      !!extractedData.vet_notes;
    if (!hasUsefulField) {
      return errorResponse('unreadable_image', corsHeaders, { status: 200 });
    }

    // Store in Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sb = createClient(supabaseUrl, supabaseKey)

    // Insert vet report — validate the date so a malformed string from the
    // model doesn't poison the timeline rendering.
    const isoDate = /^\d{4}-\d{2}-\d{2}$/;
    const safeReportDate = typeof extractedData.report_date === 'string' && isoDate.test(extractedData.report_date)
      ? extractedData.report_date
      : new Date().toISOString().split('T')[0];
    const { data: report, error: reportErr } = await sb
      .from('vet_reports')
      .insert({
        pet_id: petId,
        image_url: 'uploaded_scan',
        ai_extracted_data: extractedData,
        report_date: safeReportDate,
      })
      .select()
      .single()

    if (reportErr) throw reportErr

    // Weight and BCS are returned as evidence, then applied by the app's
    // canonical measurement/assessment pipeline. This function must not
    // bypass plan reconciliation or silently redefine the confirmed ideal.
    // Diagnoses and allergies remain simple additive profile fields.
    const updates: any = {};
    let shouldUpdatePet = false;

    // Check if we need to fetch existing arrays from DB
    if ((extractedData.diagnoses && extractedData.diagnoses.length > 0) ||
      (extractedData.allergies && extractedData.allergies.length > 0)) {

      const { data: pet } = await sb.from('pets').select('medical_conditions, allergies').eq('id', petId).single()

      if (extractedData.diagnoses && extractedData.diagnoses.length > 0) {
        const existing = pet?.medical_conditions || []
        updates.medical_conditions = [...new Set([...existing, ...extractedData.diagnoses])]
        shouldUpdatePet = true;
      }

      if (extractedData.allergies && extractedData.allergies.length > 0) {
        const existing = pet?.allergies || []
        updates.allergies = [...new Set([...existing, ...extractedData.allergies])]
        shouldUpdatePet = true;
      }
    }

    if (shouldUpdatePet) {
      await sb.from('pets').update(updates).eq('id', petId)
    }

    console.log(`[scan-vet-report] sent success=true reportId=${report.id} elapsedMs=${Date.now() - t0}`);
    return new Response(
      JSON.stringify({
        success: true,
        report_id: report.id,
        extracted_data: extractedData,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err: unknown) {
    logInternal('scan-vet-report', err, `crash elapsedMs=${Date.now() - t0}`);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return errorResponse(isAbort ? 'ai_unavailable' : 'server_error', corsHeaders);
  }
})
