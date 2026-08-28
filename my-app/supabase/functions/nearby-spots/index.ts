/**
 * nearby-spots — the only thing in Pawtchi that talks to Overpass.
 *
 * ── Why this is server-side ──
 * Overpass is volunteer infrastructure with no SLA and a usage policy that asks
 * callers not to do exactly what a mobile app naturally does: query per device,
 * per session, per pan. Putting one cache in front of it turns a whole
 * neighbourhood into a single upstream request per 72 hours, which is the
 * difference between polite use and getting Pawtchi's traffic blocked outright.
 *
 * ── The request never contains a user's position ──
 * The client quantizes to a ~2.2 km grid cell before calling (lib/spots/
 * cellKey.ts) and we re-quantize here anyway, because a client is not a
 * trustworthy source of its own constraints. Overpass is asked about the CELL
 * CENTRE. Nothing in this function, in spot_cache, or in Overpass's logs
 * records where a person was.
 *
 * ── Failure posture: always prefer stale to nothing ──
 * A three-day-old park is useful; an error screen is not. Every upstream
 * failure falls back to whatever cached row exists, at any age.
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

import { getCorsHeaders } from '../_shared/cors.ts';
import { verifyAuth } from '../_shared/auth.ts';
import { checkRateLimit, RATE_LIMITS } from '../_shared/rateLimit.ts';
import { safeParseBody } from '../_shared/validate.ts';
import { errorResponse, logInternal } from '../_shared/errors.ts';

import { SPOT_QUERY_VERSION } from '../_shared/spots/osmTags.ts';
import { normalizeResponse } from '../_shared/spots/normalize.ts';
import { dedupeSpots } from '../_shared/spots/dedupe.ts';
import {
  cellCentre,
  cellKey,
  queryRadiusFor,
  radiusBucketFor,
} from '../_shared/spots/cellKey.ts';
import {
  OVERPASS_ENDPOINTS,
  OVERPASS_USER_AGENT,
  buildOverpassQuery,
  isRetriableStatus,
  roundForQuery,
} from '../_shared/spots/overpassQuery.ts';
import type { PawtchiSpot } from '../_shared/spots/types.ts';

/** How long a cached cell is served without re-asking Overpass. */
const CACHE_TTL_MS = 72 * 60 * 60 * 1000;

/**
 * Total wall-clock budget for ALL upstream attempts combined, comfortably
 * inside the client's own 32 s ceiling.
 *
 * A budget rather than a per-attempt timeout, because per-attempt is how a
 * retry loop makes things worse: a probe of the mirrors had each of them take
 * ~33 s to return 504, so three sequential attempts would have spent over a
 * minute failing — long past the point the client gave up, and long past any
 * use to the person waiting.
 */
const UPSTREAM_BUDGET_MS = 24_000;

/**
 * Ceiling for the FIRST attempt. The main instance answers a warm cell in
 * ~1.5 s, so anything approaching this means it is struggling and the
 * remaining budget is better spent asking somebody else.
 */
const FIRST_ATTEMPT_MS = 14_000;

/**
 * An optional override, tried FIRST and then followed by the built-in mirrors.
 *
 * Unset is the normal case. Set it to pin a specific instance — or our own —
 * without a deploy.
 */
const OVERPASS_ENDPOINT = Deno.env.get('OVERPASS_ENDPOINT') ?? '';

interface CacheRow {
  spots: PawtchiSpot[];
  fetched_at: string;
}

function isFinite2(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** One attempt against one instance. Throws with a diagnosable message. */
async function fetchOnce(
  endpoint: string,
  query: string,
  timeoutMs: number,
): Promise<PawtchiSpot[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // A contactable UA is required by the Overpass usage policy. An
        // anonymous caller is the thing they block first.
        'User-Agent': OVERPASS_USER_AGENT,
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });

    if (!res.ok) {
      // Carry the status on the error so the caller can tell "busy, try a
      // sibling" from "our query is wrong, stop".
      const err = new Error(`overpass ${res.status} at ${endpoint}`) as Error & {
        status?: number;
      };
      err.status = res.status;
      throw err;
    }

    const body = await res.json();
    return dedupeSpots(normalizeResponse(body, new Date().toISOString()));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch one cell, falling through the mirrors.
 *
 * Overpass rate-limits by IP and Edge Functions egress from shared
 * infrastructure, so the main instance can refuse us for reasons that have
 * nothing to do with our own traffic. Each mirror is an independent deployment,
 * so a refusal from one says nothing about the next.
 *
 * A short backoff between attempts, and only for statuses that mean "busy" — a
 * 400 is our query being wrong, and retrying that elsewhere would just spend
 * someone else's capacity to get the same answer.
 */
async function fetchFromOverpass(
  lat: number,
  lng: number,
  queryRadius: number,
): Promise<PawtchiSpot[]> {
  const query = buildOverpassQuery(roundForQuery(lat), roundForQuery(lng), queryRadius);
  const endpoints = OVERPASS_ENDPOINT
    ? [OVERPASS_ENDPOINT, ...OVERPASS_ENDPOINTS.filter(e => e !== OVERPASS_ENDPOINT)]
    : [...OVERPASS_ENDPOINTS];

  const deadline = Date.now() + UPSTREAM_BUDGET_MS;
  let lastError: unknown;

  for (let i = 0; i < endpoints.length; i++) {
    const remaining = deadline - Date.now();
    // Out of budget. Better to fail now — and let the caller serve stale — than
    // to hold the request open past the point anyone is still waiting.
    if (remaining < 2_000) break;

    const timeout = i === 0 ? Math.min(FIRST_ATTEMPT_MS, remaining) : remaining;
    try {
      return await fetchOnce(endpoints[i], query, timeout);
    } catch (err) {
      lastError = err;
      const status = (err as { status?: number }).status;
      // A definite rejection of the query itself is not worth re-asking.
      if (status !== undefined && !isRetriableStatus(status)) throw err;
      // Logged per attempt: without this, "all endpoints failed" is one opaque
      // line with no way to tell a rate-limit from a timeout from a bad query.
      logInternal(
        'nearby-spots',
        err,
        `overpass attempt ${i + 1}/${endpoints.length} (${endpoints[i]}, ${timeout}ms budget)`,
      );
      // No backoff between endpoints: these are independent hosts, so pausing
      // buys nothing and only spends budget that a live mirror could use.
    }
  }
  throw lastError ?? new Error('overpass: budget exhausted with no response');
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const auth = await verifyAuth(req, corsHeaders);
    if (auth.error) return auth.error;

    const rateLimited = await checkRateLimit(
      auth.userId,
      'nearby-spots',
      RATE_LIMITS['nearby-spots'],
      corsHeaders,
    );
    if (rateLimited) return rateLimited;

    const parsed = await safeParseBody(req);
    if (parsed.error) {
      logInternal('nearby-spots', parsed.error.detail, 'body validation');
      return errorResponse(parsed.error.code, corsHeaders);
    }

    const { lat, lng, radius } = parsed.data as {
      lat?: unknown;
      lng?: unknown;
      radius?: unknown;
    };

    // Validate server-side rather than trusting the client's own quantization.
    // A caller could otherwise ask for a 500 km radius and turn this endpoint
    // into a way to hammer Overpass on our credentials.
    if (!isFinite2(lat) || !isFinite2(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      logInternal('nearby-spots', 'lat/lng missing or out of range');
      return errorResponse('invalid_input', corsHeaders);
    }

    // Snapping (not rejecting) an odd radius: the client and server agreeing on
    // buckets is what keeps the cache shared, and a clamp is friendlier than a
    // 400 for a value that is merely unhelpful rather than hostile.
    const radiusBucket = radiusBucketFor(isFinite2(radius) ? radius : NaN);
    const cell = cellKey(lat, lng);
    const centre = cellCentre(lat, lng);
    const queryRadius = queryRadiusFor(radiusBucket);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: cached } = await supabase
      .from('spot_cache')
      .select('spots, fetched_at')
      .eq('cell_key', cell)
      .eq('radius_bucket', radiusBucket)
      .eq('query_version', SPOT_QUERY_VERSION)
      .maybeSingle<CacheRow>();

    const fresh =
      cached && Date.now() - Date.parse(cached.fetched_at) < CACHE_TTL_MS;

    if (fresh) {
      return new Response(
        JSON.stringify({
          success: true,
          spots: cached.spots,
          cacheStatus: 'server_hit',
          radiusMeters: radiusBucket,
          fetchedAt: cached.fetched_at,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    try {
      const spots = await fetchFromOverpass(centre.lat, centre.lng, queryRadius);
      const fetchedAt = new Date().toISOString();

      // Upsert on the natural key so two devices racing the same cold cell
      // produce one row rather than a unique-violation and a failed request.
      await supabase.from('spot_cache').upsert(
        {
          cell_key: cell,
          radius_bucket: radiusBucket,
          query_version: SPOT_QUERY_VERSION,
          spots,
          fetched_at: fetchedAt,
        },
        { onConflict: 'cell_key,radius_bucket,query_version' },
      );

      return new Response(
        JSON.stringify({
          success: true,
          spots,
          cacheStatus: 'upstream_fetch',
          radiusMeters: radiusBucket,
          fetchedAt,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    } catch (upstreamErr) {
      logInternal('nearby-spots', upstreamErr, 'overpass fetch failed');

      // Stale beats nothing. A park from three days ago is still a park.
      if (cached) {
        return new Response(
          JSON.stringify({
            success: true,
            spots: cached.spots,
            cacheStatus: 'stale_hit',
            radiusMeters: radiusBucket,
            fetchedAt: cached.fetched_at,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      // Nothing cached and upstream is down. `ai_unavailable` is the existing
      // code for "a third-party service we depend on is briefly out" — the
      // client maps it to retryable copy via lib/appError.ts. Overpass's own
      // error text never reaches the response body.
      return errorResponse('ai_unavailable', corsHeaders);
    }
  } catch (err) {
    logInternal('nearby-spots', err, 'unhandled');
    return errorResponse('server_error', corsHeaders);
  }
});
