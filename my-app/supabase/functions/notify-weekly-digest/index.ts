/**
 * ████ DEPRECATED — DO NOT SCHEDULE ████
 *
 * Superseded by notify-email-dispatch (Aug 2026). Its cron job was unscheduled
 * in 20260809000003_email_cron.sql and the weekly recap is now a campaign
 * inside the single email dispatcher, decided by lib/email/rules.ts and subject
 * to the same two-per-week cap as everything else.
 *
 * Two reasons it cannot come back:
 *
 *   1. It is a second sender. The August 2026 audit's finding was that a forked
 *      notification path is how a pipeline fails silently for four months, and
 *      re-scheduling this would recreate the fork in the email channel.
 *
 *   2. Its schedule was wrong in a way that cannot be fixed here. '0 18 * * 0'
 *      is 18:00 UTC, roughly 04:00 Monday in Australia/Sydney — a "Sunday
 *      evening" email arriving before dawn on Monday for the entire user base.
 *      Per-timezone timing needs a frequent tick plus a local-hour gate, which
 *      is what the dispatcher does.
 *
 * Left in the tree rather than deleted so the derivation of deriveInsight() and
 * the history in this header stay findable. It should also be UNDEPLOYED from
 * Supabase — an unscheduled function is still an invokable URL, and a
 * deployed-only artifact with no repo owner is exactly what pet-reminders was.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *
 * notify-weekly-digest — the weekly recap email.
 *
 * Replaces the `run_weekly_summaries()` plpgsql function, which:
 *   - looped EVERY pet in the database (165 rows) with no engagement filter,
 *     so owners who had logged nothing all week still got a stats email;
 *   - had no unsubscribe check of any kind;
 *   - hardcoded `waterIntakeScore: 'Good'` regardless of actual intake;
 *   - authenticated to send-email with a legacy anon JWT, which cannot satisfy
 *     verifyAuth — so it 401'd on every run and has never delivered anything.
 *
 * The template it fed was worse: the "What we noticed this week" paragraph was
 * a hardcoded string telling every owner their animal was "slightly over the
 * weekly calorie goal", true or not. The insight is now derived from the
 * owner's actual numbers, and omitted when the data does not support one.
 *
 * Under the new engagement gate (three or more days logged), the current
 * production database produces zero recipients. That is the correct answer, and
 * a more honest read on engagement than a 165-person send would have been.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { isAuthorisedCronRequest, unauthorised } from '../_shared/notifications/cronAuth.ts';
import { possessiveName, possessivePronoun, type PetSex } from '../_shared/notifications/copy.ts';

interface Candidate {
  user_id: string;
  email: string;
  owner_name: string;
  pet_id: string;
  pet_name: string;
  pet_sex: string | null;
  calories_consumed: number;
  calorie_goal: number;
  days_logged: number;
  walks_logged: number;
  weight_change_kg: number;
}

/**
 * One sentence about the week, derived from the owner's real numbers. Returns
 * null when nothing in the data supports a claim — better to say nothing than
 * to invent an observation, which is what the old template did.
 */
function deriveInsight(c: Candidate): string | null {
  const name = c.pet_name;
  const their = possessivePronoun(name, c.pet_sex as PetSex);

  if (c.calorie_goal > 0) {
    const pct = Math.round((c.calories_consumed / c.calorie_goal) * 100);
    if (pct >= 110) {
      return `Intake came in around ${pct}% of ${their} weekly target. Trimming portions slightly, or adding a walk, would bring it back in line.`;
    }
    if (pct <= 70 && c.days_logged >= 5) {
      return `Intake came in around ${pct}% of ${their} weekly target. If that was not deliberate, it is worth checking appetite with your vet.`;
    }
  }

  if (Math.abs(c.weight_change_kg) >= 0.3) {
    const direction = c.weight_change_kg > 0 ? 'up' : 'down';
    return `Weight moved ${direction} ${Math.abs(c.weight_change_kg).toFixed(1)} kg this week. Log another weigh-in soon to confirm the trend.`;
  }

  if (c.days_logged >= 6) {
    return `${c.days_logged} days logged out of seven. That consistency is what makes the rest of the plan work.`;
  }

  return null;
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
    const { data, error } = await admin.rpc('get_weekly_digest_candidates');
    if (error) throw error;

    const candidates = (data ?? []) as Candidate[];
    if (candidates.length === 0) {
      return json({ ok: true, candidates: 0, sent: 0 });
    }

    const cronSecret = req.headers.get('x-cron-secret') ?? '';
    const weekEnding = new Date().toISOString().slice(0, 10);
    let sent = 0;
    const failures: string[] = [];

    for (const c of candidates) {
      // Claim first, exactly like notify-dispatch: the unique dedupe_key means
      // a retried or overlapping run cannot double-email.
      const dedupeKey = `${c.user_id}:weekly_digest_email:${weekEnding}`;
      const { data: claimed, error: claimError } = await admin
        .from('notification_history')
        .upsert(
          {
            user_id: c.user_id,
            pet_id: c.pet_id,
            event_type: 'weekly_digest_email',
            campaign_key: 'weekly_digest_email',
            channel: 'email',
            sent_at: new Date().toISOString(),
            dedupe_key: dedupeKey,
          },
          { onConflict: 'dedupe_key', ignoreDuplicates: true },
        )
        .select('id');

      if (claimError) {
        failures.push(`${c.user_id}: claim failed`);
        continue;
      }
      if (!claimed || claimed.length === 0) continue; // already sent this week

      const rowId = (claimed[0] as { id: string }).id;

      const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-cron-secret': cronSecret },
        body: JSON.stringify({
          to: c.email,
          subject: `${possessiveName(c.pet_name)} week`,
          template: 'weekly_summary',
          templateData: {
            ownerName: c.owner_name,
            petName: c.pet_name,
            weekRange: 'this past week',
            insight: deriveInsight(c),
            stats: {
              caloriesConsumed: Number(c.calories_consumed) || 0,
              calorieGoal: Number(c.calorie_goal) || 0,
              activitiesLogged: c.walks_logged,
              daysLogged: c.days_logged,
            },
          },
        }),
      });

      if (res.ok) {
        sent++;
      } else {
        // Record the failure on the ledger row rather than letting a claimed
        // row masquerade as a delivered email.
        failures.push(`${c.user_id}: ${res.status}`);
        await admin
          .from('notification_history')
          .update({
            receipt_status: 'error',
            receipt_error: `send-email ${res.status}`,
            receipt_checked_at: new Date().toISOString(),
          })
          .eq('id', rowId);
      }
    }

    if (failures.length > 0) console.error('[notify-weekly-digest] failures:', failures.join('; '));

    return json({ ok: true, candidates: candidates.length, sent, failed: failures.length });
  } catch (e) {
    const detail = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
    console.error('[notify-weekly-digest]', detail);
    return json({ ok: false, error: 'digest_failed' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
