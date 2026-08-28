/**
 * notify-receipts — resolves Expo push tickets into delivery receipts.
 *
 * Until this existed, nothing in the codebase read what Expo returned. Sends
 * were `await fetch(...)` with the response discarded, so:
 *   - a token from an uninstalled app was pushed to forever;
 *   - `DeviceNotRegistered` was never observed;
 *   - delivery rate was unmeasurable in principle, not just unmeasured.
 *
 * Expo holds receipts for roughly 24 hours, so this runs every 30 minutes and
 * looks back a day. Tickets that never resolve are left alone rather than
 * guessed at.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { isAuthorisedCronRequest, unauthorised } from '../_shared/notifications/cronAuth.ts';
import { fetchReceipts, isPermanentTokenFailure } from '../_shared/notifications/expo.ts';

interface PendingRow {
  id: string;
  expo_ticket_id: string;
  push_token: string | null;
}

serve(async (req: Request) => {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  if (!(await isAuthorisedCronRequest(req, admin))) {
    return unauthorised();
  }

  try {
    // Expo expires receipts after ~24h. Anything older will never resolve;
    // leave it unresolved rather than recording a fiction.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await admin
      .from('notification_history')
      .select('id, expo_ticket_id, push_token')
      .not('expo_ticket_id', 'is', null)
      .is('receipt_status', null)
      .gte('sent_at', since)
      .limit(1000);
    if (error) throw error;

    const pending = (data ?? []) as PendingRow[];
    if (pending.length === 0) {
      return json({ ok: true, pending: 0, resolved: 0, tokensDisabled: 0 });
    }

    const receipts = await fetchReceipts(pending.map((r) => r.expo_ticket_id));

    const now = new Date().toISOString();
    const deadTokens = new Set<string>();
    let resolved = 0;
    let delivered = 0;

    await Promise.all(
      pending.map(async (row) => {
        const receipt = receipts[row.expo_ticket_id];
        if (!receipt) return; // not ready yet — try again next run

        resolved++;
        const errorCode = receipt.details?.error;

        if (receipt.status === 'ok') {
          delivered++;
        } else if (row.push_token && isPermanentTokenFailure(errorCode)) {
          // The app was uninstalled or the token revoked. Stop sending to it.
          deadTokens.add(row.push_token);
        }

        await admin
          .from('notification_history')
          .update({
            receipt_status: receipt.status,
            receipt_error: receipt.status === 'ok' ? null : (errorCode ?? receipt.message ?? 'unknown'),
            receipt_checked_at: now,
          })
          .eq('id', row.id);
      }),
    );

    if (deadTokens.size > 0) {
      const { error: disableError } = await admin
        .from('push_tokens')
        .update({ disabled_at: now, disabled_reason: 'DeviceNotRegistered' })
        .in('token', [...deadTokens])
        .is('disabled_at', null);
      if (disableError) {
        console.error('[notify-receipts] could not disable tokens:', disableError.message);
      }
    }

    return json({
      ok: true,
      pending: pending.length,
      resolved,
      delivered,
      tokensDisabled: deadTokens.size,
    });
  } catch (e) {
    const detail = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
    console.error('[notify-receipts]', detail);
    return json({ ok: false, error: 'receipts_failed' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
