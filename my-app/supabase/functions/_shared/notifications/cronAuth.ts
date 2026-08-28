/**
 * Fail-closed cron authentication for notification functions.
 *
 * Background: `check-reminders` and `vet-checkins` shipped a guard shaped like
 *
 *     if (expectedSecret && cronSecret !== expectedSecret) return 401;
 *
 * which is fail-*open* — with `CRON_SECRET` unset it authenticates nobody and
 * lets everybody through. `pet-reminders` had no guard at all, was deployed
 * with `verify_jwt: false`, and accepted `{ test_mode: true, user_id }`, so any
 * caller who knew the URL could fire five pushes at any user in the database.
 *
 * The replacement holds the secret in Vault and verifies it through a
 * SECURITY DEFINER RPC that only the service role may call. Every failure path
 * — missing header, missing secret, RPC error — denies.
 */

export const CRON_SECRET_HEADER = 'x-cron-secret';

/**
 * Structural, not a `SupabaseClient` import: callers in this repo construct
 * their client from two different specifiers (`jsr:@supabase/supabase-js@2` in
 * send-email, `esm.sh/...@2.7.1` in the notify-* functions). Importing the
 * nominal type from either one makes the other fail to typecheck.
 */
interface RpcCapable {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export async function isAuthorisedCronRequest(
  req: Request,
  admin: RpcCapable,
): Promise<boolean> {
  const candidate = req.headers.get(CRON_SECRET_HEADER);
  if (!candidate) return false;

  const { data, error } = await admin.rpc('verify_cron_secret', { candidate });
  if (error) {
    // Deny on error. An unreachable verifier is not permission to proceed.
    console.error('[cronAuth] verify_cron_secret failed:', error.message);
    return false;
  }
  return data === true;
}

export function unauthorised(): Response {
  return new Response(JSON.stringify({ error: 'unauthorised' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
