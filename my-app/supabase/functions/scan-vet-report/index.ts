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
2. diagnoses - Array of diagnosed conditions
3. medications - Array of {name, dosage, frequency}
4. vaccinations - Array of {name, date, next_due}
5. vitals - {temperature, heart_rate, respiratory_rate}
6. lab_results - Any blood work or urinalysis findings
7. vet_notes - Summary of veterinarian's notes/recommendations
8. next_appointment - Next scheduled visit date
9. report_date - Date of the report

RESPOND in STRICT JSON format only. Use null for missing fields:
{
  "weight_kg": number | null,
  "diagnoses": ["string"] | null,
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
    
    let extractedData: any
    try {
      extractedData = JSON.parse(rawText)
    } catch {
      extractedData = { vet_notes: rawText }
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

    // If diagnoses found, merge into medical conditions
    if (extractedData.diagnoses && extractedData.diagnoses.length > 0) {
      const { data: pet } = await sb.from('pets').select('medical_conditions').eq('id', petId).single()
      const existing = pet?.medical_conditions || []
      const merged = [...new Set([...existing, ...extractedData.diagnoses])]
      await sb.from('pets').update({ medical_conditions: merged }).eq('id', petId)
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
