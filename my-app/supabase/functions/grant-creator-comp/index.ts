/**
 * grant-creator-comp — gives a collaborating creator their own year of Plus.
 *
 * A creator cannot make content about features they cannot see, so comping them
 * is not a courtesy, it is a precondition of the collaboration. This is the
 * button behind "Comp creator" in the admin panel.
 *
 * ── Why this is a separate function ─────────────────────────────────────────
 *
 * It would have been fewer files to add a `mode: 'comp'` branch to
 * redeem-creator-code. The two do share a shape — verify, grant, record — but
 * they do not share an AUTHORITY:
 *
 *   redeem-creator-code : any signed-in user, acting on themselves, once ever.
 *   grant-creator-comp  : an admin, acting on someone ELSE, repeatedly.
 *
 * Collapsing those into one handler means one missed branch turns a
 * self-service endpoint into "grant a year of Plus to an arbitrary user id".
 * The duplication is a few dozen lines; the confusion would be a privilege
 * escalation waiting for a refactor.
 *
 * ── Why the comp is not a redemption ────────────────────────────────────────
 *
 * It writes to creator_codes.comp_* rather than creator_code_redemptions. If it
 * were a redemption it would consume a slot from the creator's own cap and,
 * worse, put the creator inside their own conversion numbers — every
 * collaboration would report at least one redeemer who never converts.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { verifyAuth } from '../_shared/auth.ts';
import { errorResponse, logInternal } from '../_shared/errors.ts';
import { grantPromotionalEntitlement } from '../_shared/revenuecat/promotional.ts';

/** A year, so a comp outlives the collaboration rather than expiring mid-shoot. */
const COMP_DURATION = 'yearly' as const;

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const auth = await verifyAuth(req, corsHeaders);
    if (auth.error) return auth.error;

    let code: unknown;
    try {
      ({ code } = await req.json());
    } catch {
      return errorResponse('invalid_input', corsHeaders);
    }

    if (typeof code !== 'string' || code.trim().length === 0 || code.length > 64) {
      return errorResponse('invalid_input', corsHeaders);
    }

    const asUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      {
        global: { headers: { Authorization: req.headers.get('Authorization')! } },
        auth: { persistSession: false },
      },
    );

    // The gate, asked of the database rather than assumed from the caller. The
    // admin panel ships the anon key, so "the panel only shows this button to
    // admins" is not access control — is_admin() reads admin_users, which no
    // client can read or write.
    const { data: isAdmin, error: adminError } = await asUser.rpc('is_admin');
    if (adminError) {
      logInternal('grant-creator-comp', adminError, 'is_admin');
      return errorResponse('server_error', corsHeaders);
    }
    if (isAdmin !== true) {
      return errorResponse('forbidden', corsHeaders);
    }

    const asService = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: normalised, error: normError } = await asService.rpc(
      'normalize_creator_code',
      { p_code: code },
    );
    if (normError || typeof normalised !== 'string' || !normalised) {
      logInternal('grant-creator-comp', normError ?? 'normalise returned nothing');
      return errorResponse('invalid_input', corsHeaders);
    }

    const { data: row, error: lookupError } = await asService
      .from('creator_codes')
      .select('code, creator_owner_id')
      .eq('code', normalised)
      .maybeSingle<{ code: string; creator_owner_id: string | null }>();

    if (lookupError) {
      logInternal('grant-creator-comp', lookupError, 'lookup');
      return errorResponse('server_error', corsHeaders);
    }
    if (!row) {
      return errorResponse('not_found', corsHeaders);
    }

    // An unlinked code is the normal state right after creation — the deal is
    // agreed before the creator has signed up. There is nobody to comp yet, and
    // saying so is more useful than a generic failure.
    if (!row.creator_owner_id) {
      return new Response(
        JSON.stringify({ success: false, reason: 'not_linked' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const grant = await grantPromotionalEntitlement(row.creator_owner_id, COMP_DURATION);
    if (!grant.ok) {
      logInternal('grant-creator-comp', grant.detail ?? 'grant_failed', 'revenuecat');
      return errorResponse('server_error', corsHeaders);
    }

    const { error: recordError } = await asService.rpc('record_creator_comp', {
      p_code: row.code,
      p_expires_at: grant.expiresAt,
    });
    if (recordError) {
      // The creator has their access; only our record of it is missing. Logged
      // rather than surfaced as a failure that would invite a second grant.
      logInternal('grant-creator-comp', recordError, 'record_creator_comp');
    }

    return new Response(
      JSON.stringify({ success: true, expires_at: grant.expiresAt }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    logInternal('grant-creator-comp', e, 'unhandled');
    return errorResponse('server_error', corsHeaders);
  }
});
