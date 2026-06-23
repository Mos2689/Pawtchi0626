import { createClient } from 'jsr:@supabase/supabase-js@2'

/**
 * Per-user, per-endpoint rate limiter backed by Supabase.
 *
 * Uses an in-memory Map as a fast first-pass check (avoids a DB round-trip
 * on every call), and falls back to the `rate_limits` table for persistence
 * across edge function cold starts.
 *
 * Usage:
 *   const rl = checkRateLimit(userId, 'gemini-proxy', 30, corsHeaders);
 *   if (rl) return rl; // 429 response
 */

// In-memory cache: "userId:endpoint" -> { count, windowStart }
const memoryCache = new Map<string, { count: number; windowStart: number }>();

const WINDOW_MS = 60 * 60 * 1000; // 1 hour window

/**
 * Check and increment the rate limit for a user + endpoint.
 * Returns null if allowed, or a 429 Response if rate-limited.
 */
export async function checkRateLimit(
  userId: string,
  endpoint: string,
  maxRequests: number,
  corsHeaders: Record<string, string>,
): Promise<Response | null> {
  const key = `${userId}:${endpoint}`;
  const now = Date.now();

  // Fast path: in-memory check
  const cached = memoryCache.get(key);
  if (cached) {
    if (now - cached.windowStart > WINDOW_MS) {
      // Window expired — reset
      cached.count = 1;
      cached.windowStart = now;
      memoryCache.set(key, cached);
      return null;
    }

    cached.count++;
    memoryCache.set(key, cached);

    if (cached.count > maxRequests) {
      const retryAfter = Math.ceil((cached.windowStart + WINDOW_MS - now) / 1000);
      return new Response(
        JSON.stringify({
          success: false,
          error: `Rate limit exceeded. Maximum ${maxRequests} requests per hour for this endpoint.`,
          retry_after_seconds: retryAfter,
        }),
        {
          status: 429,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Retry-After': String(retryAfter),
          },
        },
      );
    }

    return null; // Allowed
  }

  // Cold start: try DB-backed check
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (supabaseUrl && serviceKey) {
      const sb = createClient(supabaseUrl, serviceKey);
      const windowStart = new Date(now - WINDOW_MS).toISOString();

      const { count } = await sb
        .from('rate_limits')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('endpoint', endpoint)
        .gte('created_at', windowStart);

      const dbCount = count ?? 0;

      if (dbCount >= maxRequests) {
        // Seed memory cache so subsequent calls are fast
        memoryCache.set(key, { count: dbCount, windowStart: now - WINDOW_MS + 1000 });
        return new Response(
          JSON.stringify({
            success: false,
            error: `Rate limit exceeded. Maximum ${maxRequests} requests per hour for this endpoint.`,
          }),
          {
            status: 429,
            headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '3600' },
          },
        );
      }

      // Log this request
      await sb.from('rate_limits').insert({
        user_id: userId,
        endpoint,
      });

      // Seed memory cache
      memoryCache.set(key, { count: dbCount + 1, windowStart: now });
    } else {
      // No DB available — memory-only tracking
      memoryCache.set(key, { count: 1, windowStart: now });
    }
  } catch (err) {
    // Rate limiting should never block the request on DB errors — fail open
    console.warn('[rateLimit] DB check failed, falling back to memory-only:', err);
    memoryCache.set(key, { count: 1, windowStart: now });
  }

  return null; // Allowed
}

/**
 * Rate limit presets for each endpoint (requests per hour).
 */
export const RATE_LIMITS: Record<string, number> = {
  'gemini-proxy': 30,
  'gemini-verdict': 30,
  'scan-vet-report': 5,
  'generate-health-insight': 3,
  'ask-vet': 5, // hourly abuse guard; the real limit is the 4/month quota in vet_questions
  'generate-schedule': 30,
  'estimate-weight': 10,
  'parse-onboarding-report': 10,
  'send-email': 5,
  'update-streak': 60,
};
