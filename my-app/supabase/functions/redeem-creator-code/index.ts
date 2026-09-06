/**
 * redeem-creator-code — the audience half of the creator programme.
 *
 * Someone watched a creator's video, installed Pawtchi, and typed the code they
 * heard. This turns that into three months of Pawtchi Plus.
 *
 * ── Order of operations, and why it is this way round ───────────────────────
 *
 *   1. claim_creator_code() in Postgres, under a row lock.
 *   2. Only then, grant the RevenueCat promotional entitlement.
 *   3. Mark the claim granted or failed.
 *
 * The claim happens first because it is the only step that can be made atomic.
 * Two devices submitting the same code in the same second produce ONE
 * redemption row (owner_id is UNIQUE) and therefore one grant. Granting first
 * and recording afterwards would invert that: the entitlement would already
 * exist by the time we discovered the person had redeemed a different code last
 * month.
 *
 * Step 3 can fail on its own — the network dies between RevenueCat answering
 * and Postgres hearing about it. The row is then left `pending` with a live
 * entitlement behind it. That is the acceptable direction of failure: the user
 * has what they were promised, and `claim_creator_code` returns `retry_grant`
 * for a pending row, so a retry re-grants (RevenueCat treats a near-duplicate
 * as the same entitlement rather than extending it) and settles the ledger.
 *
 * ── Why business rejections are 200s ────────────────────────────────────────
 *
 * "That code has already been used" is a product state with its own sentence,
 * not a transport failure. The EdgeErrorCode set in _shared/errors.ts is a
 * stable machine contract that lib/appError.ts maps to generic apology copy —
 * routing an already-redeemed code through it would render "Something went
 * wrong on our side", which is both wrong and unhelpful. So refusals come back
 * `200 { success: false, reason }` and the app owns the wording.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { verifyAuth } from '../_shared/auth.ts';
import { checkRateLimit, RATE_LIMITS } from '../_shared/rateLimit.ts';
import { errorResponse, logInternal } from '../_shared/errors.ts';
import {
  grantPromotionalEntitlement,
  type PromotionalDuration,
} from '../_shared/revenuecat/promotional.ts';

/** Outcomes of claim_creator_code() that mean "no grant, and here is why". */
const REFUSALS = new Set([
  'not_found',
  'inactive',
  'code_expired',
  'code_exhausted',
  'already_redeemed',
  'ever_subscribed',
  'own_code',
]);

interface ClaimRow {
  outcome: string;
  creator_name: string | null;
  duration: string | null;
  redemption_id: string | null;
}

function json(body: unknown, corsHeaders: Record<string, string>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
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
      'redeem-creator-code',
      RATE_LIMITS['redeem-creator-code'],
      corsHeaders,
    );
    if (rateLimited) return rateLimited;

    let code: unknown;
    try {
      ({ code } = await req.json());
    } catch {
      return errorResponse('invalid_input', corsHeaders);
    }

    if (typeof code !== 'string' || code.trim().length === 0 || code.length > 64) {
      // Length-capped before it reaches Postgres. The RPC normalises anyway,
      // but there is no reason to hand the database a megabyte of text.
      return errorResponse('invalid_input', corsHeaders);
    }

    // The user's own JWT, so auth.uid() resolves inside claim_creator_code.
    // A service-role client here would silently claim on behalf of nobody.
    const asUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      {
        global: { headers: { Authorization: req.headers.get('Authorization')! } },
        auth: { persistSession: false },
      },
    );

    const { data, error } = await asUser.rpc('claim_creator_code', { p_code: code });
    if (error) {
      logInternal('redeem-creator-code', error, 'claim');
      return errorResponse('server_error', corsHeaders);
    }

    const claim = (Array.isArray(data) ? data[0] : data) as ClaimRow | null;
    if (!claim?.outcome) {
      logInternal('redeem-creator-code', 'claim returned no outcome row');
      return errorResponse('server_error', corsHeaders);
    }

    if (REFUSALS.has(claim.outcome)) {
      return json(
        { success: false, reason: claim.outcome, creator_name: claim.creator_name },
        corsHeaders,
      );
    }

    if (claim.outcome !== 'claimed' && claim.outcome !== 'retry_grant') {
      logInternal('redeem-creator-code', `unrecognised outcome: ${claim.outcome}`);
      return errorResponse('server_error', corsHeaders);
    }

    if (!claim.redemption_id || !claim.duration) {
      logInternal('redeem-creator-code', `claim ${claim.outcome} without id or duration`);
      return errorResponse('server_error', corsHeaders);
    }

    // Service role for the bookkeeping write — mark_creator_redemption is
    // revoked from `authenticated` precisely so a user cannot mark their own
    // pending row granted without an entitlement ever existing.
    const asService = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const grant = await grantPromotionalEntitlement(
      auth.userId,
      claim.duration as PromotionalDuration,
    );

    if (!grant.ok) {
      await asService.rpc('mark_creator_redemption', {
        p_redemption_id: claim.redemption_id,
        p_status: 'failed',
        p_expires_at: null,
        p_error: grant.detail ?? 'grant_failed',
      });
      logInternal('redeem-creator-code', grant.detail ?? 'grant_failed', 'revenuecat');
      return errorResponse('server_error', corsHeaders);
    }

    const { error: markError } = await asService.rpc('mark_creator_redemption', {
      p_redemption_id: claim.redemption_id,
      p_status: 'granted',
      p_expires_at: grant.expiresAt,
      p_error: null,
    });

    if (markError) {
      // The entitlement is live. Reporting a failure now would tell someone who
      // just received three months that they did not — so this is logged for us
      // and the user is told the truth about their access. The row stays
      // `pending` and settles on their next retry, or by hand.
      logInternal('redeem-creator-code', markError, 'mark granted');
    }

    return json(
      {
        success: true,
        creator_name: claim.creator_name,
        expires_at: grant.expiresAt,
      },
      corsHeaders,
    );
  } catch (e) {
    logInternal('redeem-creator-code', e, 'unhandled');
    return errorResponse('server_error', corsHeaders);
  }
});
