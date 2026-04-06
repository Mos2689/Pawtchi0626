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
    const { imageBase64, mimeType, petId, petProfile } = await req.json()

    if (!imageBase64 || !petId) {
      throw new Error('imageBase64 and petId are required.')
    }

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not configured.')
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`

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
        maxOutputTokens: 2048,
        responseMimeType: 'application/json'
      }
    }

    const geminiRes = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiPayload),
    })

    if (!geminiRes.ok) {
      const errText = await geminiRes.text()
      throw new Error(`Gemini API error: ${geminiRes.status} - ${errText}`)
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

    let extractedData: any
    try {
      extractedData = JSON.parse(cleanText)
    } catch {
      extractedData = { vet_notes: cleanText }
    }

    // Store in Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sb = createClient(supabaseUrl, supabaseKey)

    // Insert vet report
    const { data: report, error: reportErr } = await sb
      .from('vet_reports')
      .insert({
        pet_id: petId,
        image_url: 'uploaded_scan',
        ai_extracted_data: extractedData,
        report_date: extractedData.report_date || new Date().toISOString().split('T')[0],
      })
      .select()
      .single()

    if (reportErr) throw reportErr

    // If weight was extracted, also log it
    if (extractedData.weight_kg) {
      await sb.from('weight_logs').insert({
        pet_id: petId,
        weight_kg: extractedData.weight_kg,
        notes: 'Extracted from vet report',
        source: 'vet_report',
      })
      await sb.from('pets').update({ current_weight_kg: extractedData.weight_kg }).eq('id', petId)
    }

    // Prepare pet profile updates
    const updates: any = {};
    let shouldUpdatePet = false;

    if (extractedData.body_condition_score) {
      updates.body_condition_score = extractedData.body_condition_score;
      shouldUpdatePet = true;
    }

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

    return new Response(
      JSON.stringify({
        success: true,
        report_id: report.id,
        extracted_data: extractedData,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
