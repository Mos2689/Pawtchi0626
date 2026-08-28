/**
 * notify-monitor — watches the notification pipeline and says so when it breaks.
 *
 * This function is the direct answer to the August 2026 audit. The pipeline had
 * been dead for months and nothing noticed, because every available signal
 * reported health: cron said "succeeded", the functions returned
 * {"success": true}, and pg_net's response rows were empty. Running the
 * detection query in this file against production before any fix was applied
 * returns 98 failed cron runs in 24 hours — the outage would have been caught
 * on its first day.
 *
 * Detection lives in `get_notification_alerts()` so a human can run the same
 * query by hand. This function only records state transitions and notifies.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { isAuthorisedCronRequest, unauthorised } from '../_shared/notifications/cronAuth.ts';

interface Finding {
  code: string;
  severity: 'critical' | 'warning' | 'info';
  detail: string;
  metric: number | null;
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 };

serve(async (req: Request) => {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  if (!(await isAuthorisedCronRequest(req, admin))) {
    return unauthorised();
  }

  try {
    const { data, error } = await admin.rpc('get_notification_alerts');
    if (error) throw error;

    const findings = ((data ?? []) as Finding[]).sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    );
    const now = new Date().toISOString();
    const activeCodes = findings.map((f) => f.code);

    // ── Resolve anything that has stopped firing ──────────────────────────────
    // Done first so a recovered alert can re-open cleanly later.
    const resolveQuery = admin
      .from('notification_alerts')
      .update({ resolved_at: now })
      .is('resolved_at', null);
    const { data: resolved } = await (activeCodes.length > 0
      ? resolveQuery.not('code', 'in', `(${activeCodes.map((c) => `"${c}"`).join(',')})`)
      : resolveQuery
    ).select('code');

    // ── Record current findings ───────────────────────────────────────────────
    // The partial unique index on (code) WHERE resolved_at IS NULL means an
    // ongoing problem bumps last_seen_at instead of spawning a new row every
    // day. `notified_at` stays null until an email actually goes out, so a
    // failed send retries tomorrow rather than being silently dropped.
    const fresh: Finding[] = [];
    for (const finding of findings) {
      const { data: existing } = await admin
        .from('notification_alerts')
        .select('id, notified_at')
        .eq('code', finding.code)
        .is('resolved_at', null)
        .maybeSingle();

      if (existing) {
        await admin
          .from('notification_alerts')
          .update({ last_seen_at: now, detail: finding.detail, metric: finding.metric })
          .eq('id', existing.id);
        if (!existing.notified_at) fresh.push(finding);
      } else {
        await admin.from('notification_alerts').insert({
          code: finding.code,
          severity: finding.severity,
          detail: finding.detail,
          metric: finding.metric,
          first_seen_at: now,
          last_seen_at: now,
        });
        fresh.push(finding);
      }
    }

    // ── Notify ────────────────────────────────────────────────────────────────
    let notified = false;
    const alertEmail = Deno.env.get('ALERT_EMAIL');
    if (fresh.length > 0 && alertEmail) {
      notified = await sendAlertEmail(admin, alertEmail, fresh, req);
      if (notified) {
        await admin
          .from('notification_alerts')
          .update({ notified_at: now })
          .in('code', fresh.map((f) => f.code))
          .is('resolved_at', null);
      }
    }

    // Always log. If ALERT_EMAIL is unconfigured the alerts still land in the
    // table and in the function logs — never silently discarded.
    if (findings.length > 0) {
      console.error(
        `[notify-monitor] ${findings.length} finding(s):\n` +
          findings.map((f) => `  [${f.severity}] ${f.code} — ${f.detail}`).join('\n'),
      );
    }

    return json({
      ok: true,
      findings: findings.length,
      newlyFiring: fresh.length,
      resolved: (resolved ?? []).length,
      emailed: notified,
      emailConfigured: Boolean(alertEmail),
      codes: activeCodes,
    });
  } catch (e) {
    const detail = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
    console.error('[notify-monitor]', detail);
    return json({ ok: false, error: 'monitor_failed' }, 500);
  }
});

async function sendAlertEmail(
  admin: ReturnType<typeof createClient>,
  to: string,
  findings: Finding[],
  req: Request,
): Promise<boolean> {
  const worst = findings[0].severity;
  const lines = findings
    .map((f) => `<li><strong>[${f.severity}] ${f.code}</strong><br/>${escapeHtml(f.detail)}</li>`)
    .join('');

  try {
    const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Same fail-closed cron secret the scheduler used to reach us. This is
        // the service path send-email grew for machine senders; the anon JWT the
        // old weekly-summary job used could never satisfy verifyAuth.
        'x-cron-secret': req.headers.get('x-cron-secret') ?? '',
      },
      body: JSON.stringify({
        to,
        subject: `Pawtchi notifications: ${findings.length} ${worst} issue(s)`,
        html:
          `<p>The notification pipeline reported the following. Detection query: ` +
          `<code>SELECT * FROM public.get_notification_alerts();</code></p><ul>${lines}</ul>`,
        text: findings.map((f) => `[${f.severity}] ${f.code} — ${f.detail}`).join('\n\n'),
      }),
    });
    if (!res.ok) {
      console.error(`[notify-monitor] alert email failed: ${res.status}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[notify-monitor] alert email threw:', e instanceof Error ? e.message : String(e));
    return false;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
