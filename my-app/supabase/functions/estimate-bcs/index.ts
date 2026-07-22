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

    // ── Security: Rate limit ──
    const rateLimited = await checkRateLimit(auth.userId, 'estimate-bcs', RATE_LIMITS['estimate-bcs'], corsHeaders);
    if (rateLimited) return rateLimited;

    // ── Security: Parse body with size limits ──
    const parsed = await safeParseBody(req);
    if (parsed.error) {
      logInternal('estimate-bcs', parsed.error.detail, 'body validation');
      return errorResponse(parsed.error.code, corsHeaders);
    }

    const { imageBase64, mimeType, species, breed, sex, ageMonths, weightKg } = parsed.data as Record<string, any>;

    if (!imageBase64) {
      logInternal('estimate-bcs', 'imageBase64 missing from request');
      return errorResponse('invalid_input', corsHeaders);
    }

    // ── Security: Validate image payload ──
    const imageErr = validateImagePayload(imageBase64, mimeType);
    if (imageErr) {
      logInternal('estimate-bcs', imageErr.detail, 'image validation');
      return errorResponse(imageErr.code, corsHeaders);
    }

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) {
      logInternal('estimate-bcs', 'GEMINI_API_KEY is not configured.');
      return errorResponse('server_error', corsHeaders);
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

    const speciesLabel = species === 'cat' ? 'cat' : 'dog';
    const weightLine = typeof weightKg === 'number' && weightKg > 0 ? `${weightKg} kg` : 'Unknown';
    const ageLine = typeof ageMonths === 'number' && ageMonths > 0
      ? `${Math.floor(ageMonths / 12)} years ${ageMonths % 12} months`
      : 'Unknown';

    const systemPrompt = `You are a veterinary body-condition assessment AI for PAWTCHI, a pet health app.
Your task is to estimate the Body Condition Score (BCS) of the ${speciesLabel} in the provided photo, on the 9-point WSAVA/Purina scale.

Pet context (use it to calibrate, never to substitute for what the image shows):
- Species: ${speciesLabel}
- Breed: ${breed || 'Unknown'}
- Sex: ${sex || 'Unknown'}
- Age: ${ageLine}
- Owner-reported weight: ${weightLine}

THE 9-POINT SCALE (WSAVA/Purina):
- 1-3 (under-conditioned): ribs, spine, pelvic bones visible from a distance; obvious loss of muscle mass; severe abdominal tuck.
- 4-5 (ideal): ribs palpable with slight fat cover; waist clearly visible from above; abdominal tuck present from the side.
- 6-7 (over-conditioned): ribs covered by noticeable fat; waist barely visible or absent; abdominal tuck reduced or absent.
- 8-9 (obese): heavy fat deposits over chest, spine and tail base; no waist; abdominal distension; fat deposits on limbs and neck.

ASSESSMENT RULES:
1. FIRST decide whether a real, live ${speciesLabel} is actually in the photo. Cartoons, drawings, toys, statues, other species, or photos with no animal → set "pet_visible" to false and stop assessing (all BCS fields null, confidence 0).
2. Judge visibility honestly: "full_body_visible" is true ONLY when the torso from shoulders to hindquarters is in frame. A face close-up, or a body cut off by the frame or blocked by objects/people, is NOT a full body.
3. Report the posture you actually see: "is_side_profile" (roughly lateral view) and "is_standing" (standing on all fours; sitting/lying/curled = false).
4. Coat honesty: classify "coat_length" as "short", "medium", or "long". Medium and long coats hide the waist and rib contour — WIDEN the bcs band by at least 1 point and LOWER confidence. Never report high confidence on a long-coated ${speciesLabel}.
5. Breed context: some breeds are lean at ideal condition (sighthounds like Greyhounds and Whippets show ribs at BCS 4-5); some are stocky at ideal (Bulldogs, Staffies, Pugs). Calibrate to the breed if known — do not score a healthy sighthound as underweight or a fit Staffy as overweight.
6. Give a BCS BAND, not false precision: "bcs_low" and "bcs_high" are integers 1-9 with bcs_low <= bcs_high. A clear side-on photo of a short-coated ${speciesLabel} justifies a tight band (width 0-1); poor angle, sitting posture, or heavy coat justify a wide band (width 2-4).
7. "visual_indicators" lists the concrete cues you used, e.g. "visible waist tuck from above", "ribs not visible under coat", "no abdominal tuck", "fat pad at tail base". 2-4 short phrases, all-lowercase.
8. "photo_quality_issues" lists problems that reduced your read, e.g. "pet is sitting", "only head and chest in frame", "low light", "motion blur", "long coat obscures contour". Empty array when the photo is good.
9. "confidence" is your honest 0-1 belief that the true BCS falls inside your band AND the band is narrow enough to be useful. Rules of thumb: full-body standing side profile of a short-coated pet in good light = 0.75-0.9; sitting or front-on = at most 0.55; medium coat = at most 0.65; long coat = at most 0.45; anything without the full body = at most 0.3.
10. "reasoning_short" is ONE calm sentence explaining the band. No exclamation marks, no alarmist language.

You MUST respond with ONLY valid JSON in this exact format, no markdown, no extra text:
{
  "pet_visible": boolean,
  "full_body_visible": boolean,
  "is_side_profile": boolean,
  "is_standing": boolean,
  "coat_length": "short" | "medium" | "long" | null,
  "photo_quality_issues": ["string array, empty when none"],
  "bcs_low": integer 1-9 or null,
  "bcs_high": integer 1-9 or null,
  "confidence": number between 0 and 1,
  "visual_indicators": ["string array"],
  "reasoning_short": "string or null"
}`;

    const geminiPayload = {
      contents: [{
        parts: [
          { text: systemPrompt },
          { inlineData: { mimeType: mimeType || 'image/jpeg', data: imageBase64 } },
        ],
      }],
      generationConfig: {
        temperature: 0.2, // Low temp for clinical consistency
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
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

        if (geminiRes.status >= 500 || geminiRes.status === 429) {
          console.warn(`[estimate-bcs] Attempt ${attempt + 1} got ${geminiRes.status}, retrying...`);
          if (attempt === 0) {
            await new Promise(r => setTimeout(r, 1500));
            continue;
          }
        }
        break;
      } catch (fetchErr: unknown) {
        clearTimeout(timeout);
        if (attempt === 0) {
          console.warn('[estimate-bcs] First attempt failed, retrying...', fetchErr);
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }
        logInternal('estimate-bcs', fetchErr, 'upstream timed out/failed after 2 attempts');
        return errorResponse('ai_unavailable', corsHeaders);
      }
    }

    if (!geminiRes || !geminiRes.ok) {
      const errorBody = geminiRes ? await geminiRes.text() : 'No response';
      logInternal('estimate-bcs', `upstream ${geminiRes?.status || 'timeout'}: ${errorBody.substring(0, 300)}`);
      return errorResponse('ai_unavailable', corsHeaders);
    }

    const data = await geminiRes.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // ---- Server-side validation & sanitization ----
    // The client gates the suggestion on these fields, so they must be
    // trustworthy: booleans coerced, band ordered and clamped to 1-9,
    // confidence normalized to 0-1. A parse failure returns a well-formed
    // "no read" result instead of an error — photo BCS is best-effort.
    let estimate: Record<string, unknown>;
    try {
      const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsedOut = JSON.parse(cleaned);

      const petVisible = parsedOut.pet_visible === true;
      const clampBcs = (v: unknown): number | null => {
        if (typeof v !== 'number' || !Number.isFinite(v)) return null;
        return Math.max(1, Math.min(9, Math.round(v)));
      };
      let bcsLow = petVisible ? clampBcs(parsedOut.bcs_low) : null;
      let bcsHigh = petVisible ? clampBcs(parsedOut.bcs_high) : null;
      if (bcsLow != null && bcsHigh != null && bcsLow > bcsHigh) {
        [bcsLow, bcsHigh] = [bcsHigh, bcsLow];
      }
      // A band needs both ends — a half-band is a non-read.
      if (bcsLow == null || bcsHigh == null) { bcsLow = null; bcsHigh = null; }

      let confidence = typeof parsedOut.confidence === 'number' ? parsedOut.confidence : 0;
      if (confidence > 1) confidence = confidence > 100 ? 0 : confidence / 100;
      if (confidence < 0 || !petVisible || bcsLow == null) confidence = 0;

      const coat = ['short', 'medium', 'long'].includes(parsedOut.coat_length) ? parsedOut.coat_length : null;
      const strArray = (v: unknown): string[] =>
        Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string').slice(0, 6) : [];

      estimate = {
        pet_visible: petVisible,
        full_body_visible: petVisible && parsedOut.full_body_visible === true,
        is_side_profile: petVisible && parsedOut.is_side_profile === true,
        is_standing: petVisible && parsedOut.is_standing === true,
        coat_length: coat,
        photo_quality_issues: strArray(parsedOut.photo_quality_issues),
        bcs_low: bcsLow,
        bcs_high: bcsHigh,
        confidence,
        visual_indicators: strArray(parsedOut.visual_indicators),
        reasoning_short: typeof parsedOut.reasoning_short === 'string' ? parsedOut.reasoning_short : null,
      };
    } catch {
      estimate = {
        pet_visible: false,
        full_body_visible: false,
        is_side_profile: false,
        is_standing: false,
        coat_length: null,
        photo_quality_issues: ['unreadable model response'],
        bcs_low: null,
        bcs_high: null,
        confidence: 0,
        visual_indicators: [],
        reasoning_short: null,
        parse_error: true,
      };
    }

    return new Response(
      JSON.stringify({ success: true, estimate }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    logInternal('estimate-bcs', error, 'unhandled');
    return errorResponse('server_error', corsHeaders);
  }
});
