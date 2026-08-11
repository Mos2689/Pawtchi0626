/**
 * email-events — Resend webhook receiver.
 *
 * ── Why this ships with the first campaign, not after it ────────────────────
 *
 * The August 2026 audit's central finding was not that the push pipeline was
 * broken. It was that it had been broken for four months and nothing was
 * watching: `cron.job_run_details` said "succeeded" on every run while every
 * request 401'd, because nothing recorded what actually happened at the far
 * end. Sending email with no delivery telemetry would rebuild that exact
 * situation in a new channel.
 *
 * It also has a harder consequence here than it did for push. A push that fails
 * is a message nobody reads. An email that bounces or draws a complaint damages
 * the sending domain for every future message, and Google's threshold for
 * rejecting rather than delaying is a spam rate of 0.30%. `get_email_alerts()`
 * cannot see any of that without these rows.
 *
 * ── DEPLOYMENT ──────────────────────────────────────────────────────────────
 *
 *   supabase functions deploy email-events --no-verify-jwt
 *
 * Resend signs with Svix and carries no Supabase session. JWT verification must
 * be off, which is exactly why the signature check below is mandatory and fails
 * closed — without it this endpoint would let anyone write delivery status onto
 * arbitrary rows. Set RESEND_WEBHOOK_SECRET (the `whsec_...` value from the
 * Resend dashboard) before pointing the webhook at it.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

/**
 * Resend event → the receipt_status we record.
 *
 * `email.sent` is deliberately absent: the dispatcher already wrote the row
 * when it sent, and overwriting a later 'delivered' with an out-of-order 'sent'
 * would lose the more informative state. Webhooks arrive out of order routinely.
 */
const STATUS_BY_EVENT: Record<string, string> = {
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delayed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
};

/** Ranked so a late-arriving weaker event cannot overwrite a stronger one. */
const STATUS_RANK: Record<string, number> = {
  delayed: 1,
  delivered: 2,
  bounced: 3,
  // A complaint is the most consequential thing that can happen to a send and
  // must never be overwritten by anything.
  complained: 4,
};

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET') ?? '';
  const raw = await req.text();

  // Fail closed. An unset secret authenticates nobody, so it must deny rather
  // than wave everything through — the precise shape of the fail-open bug the
  // retired check-reminders function shipped with.
  if (!secret || !(await verifySvix(req, raw, secret))) {
    console.error('[email-events] signature rejected');
    return new Response(JSON.stringify({ error: 'unauthorised' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let payload: { type?: string; data?: { email_id?: string } };
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: 'bad_json' }, 400);
  }

  const eventType = payload.type ?? '';
  const messageId = payload.data?.email_id ?? '';
  if (!messageId) return json({ ok: true, ignored: 'no_message_id' });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  try {
    // Opens are a different column, and a deliberately soft signal: Apple Mail
    // Privacy Protection pre-fetches images for a large share of the base, so
    // an open is evidence the message arrived, not that a person read it. It is
    // recorded for parity with the push ledger and should never be the metric
    // a campaign is judged on.
    if (eventType === 'email.opened') {
      await admin
        .from('notification_history')
        .update({ opened_at: new Date().toISOString() })
        .eq('provider_message_id', messageId)
        .is('opened_at', null);
      return json({ ok: true, recorded: 'opened' });
    }

    if (eventType === 'email.clicked') {
      // A click is the real engagement signal, and unlike an open it cannot be
      // manufactured by an image pre-fetcher. Stored on the same column the
      // push side uses for a tap so the two channels stay comparable.
      await admin
        .from('notification_history')
        .update({ opened_at: new Date().toISOString() })
        .eq('provider_message_id', messageId)
        .is('opened_at', null);
      return json({ ok: true, recorded: 'clicked' });
    }

    const status = STATUS_BY_EVENT[eventType];
    if (!status) return json({ ok: true, ignored: eventType });

    // Read-then-write rather than a blind update, because these arrive out of
    // order. Without the rank check a delayed 'delivered' landing after a
    // 'bounced' would erase the bounce, and the bounce is the row that matters.
    const { data: existing } = await admin
      .from('notification_history')
      .select('id, receipt_status')
      .eq('provider_message_id', messageId)
      .maybeSingle();

    if (!existing) return json({ ok: true, ignored: 'unknown_message' });

    const current = (existing as { receipt_status: string | null }).receipt_status;
    const currentRank = current ? STATUS_RANK[current] ?? 0 : 0;
    if (STATUS_RANK[status] <= currentRank) {
      return json({ ok: true, ignored: 'stale_event' });
    }

    await admin
      .from('notification_history')
      .update({
        receipt_status: status,
        receipt_checked_at: new Date().toISOString(),
        receipt_error: status === 'delivered' ? null : eventType,
      })
      .eq('id', (existing as { id: string }).id);

    return json({ ok: true, recorded: status });
  } catch (e) {
    console.error('[email-events]', e instanceof Error ? e.message : String(e));
    return json({ ok: false, error: 'server_error' }, 500);
  }
});

/**
 * Svix signature verification, which is what Resend uses.
 *
 * The signed payload is `${id}.${timestamp}.${body}`, HMAC-SHA256 with the
 * secret after its `whsec_` prefix is stripped and base64-decoded. The
 * `svix-signature` header may carry several space-separated `v1,<sig>` values
 * during a secret rotation, so any match is accepted.
 */
async function verifySvix(req: Request, body: string, secret: string): Promise<boolean> {
  const id = req.headers.get('svix-id');
  const timestamp = req.headers.get('svix-timestamp');
  const signature = req.headers.get('svix-signature');
  if (!id || !timestamp || !signature) return false;

  // Reject anything older than five minutes so a captured request cannot be
  // replayed indefinitely.
  const sentAt = Number(timestamp) * 1000;
  if (!Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt) > 5 * 60 * 1000) {
    return false;
  }

  try {
    const keyBytes = base64Decode(secret.replace(/^whsec_/, ''));
    const key = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const mac = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`${id}.${timestamp}.${body}`),
    );
    const expected = base64Encode(new Uint8Array(mac));

    return signature
      .split(' ')
      .map((part) => part.split(',')[1])
      .some((candidate) => candidate && timingSafeEqual(candidate, expected));
  } catch (e) {
    console.error('[email-events] verify failed:', e instanceof Error ? e.message : String(e));
    return false;
  }
}

/** Constant-time-ish compare, so a mismatch does not leak its position. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function base64Decode(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
