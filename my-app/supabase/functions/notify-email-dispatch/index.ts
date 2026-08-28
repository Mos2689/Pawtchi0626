/**
 * notify-email-dispatch — the single email engine.
 *
 * One dispatcher, for the same reason there is one push dispatcher: the August
 * 2026 audit's finding was that a forked notification path is how a pipeline
 * fails silently for four months. Adding a campaign means adding a rule and a
 * copy entry, never a new sender and never a new cron job.
 *
 * Guarantees, all deliberately identical to notify-dispatch:
 *   - Cron-only, fail-closed secret check before any work happens.
 *   - At most one email per owner per run (the rule engine returns one).
 *   - Timing is evaluated in the owner's own timezone, never a server clock.
 *     The retired weekly cron fired at a fixed 18:00 UTC, which is about 04:00
 *     on Monday for this user base.
 *   - Idempotent: `dedupe_key` is unique and the ledger row is written BEFORE
 *     the email leaves, so a double invocation cannot double-send.
 *   - A send that fails is recorded as failed, rather than leaving a claimed
 *     row that looks delivered.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import {
  CRON_SECRET_HEADER,
  isAuthorisedCronRequest,
  unauthorised,
} from '../_shared/notifications/cronAuth.ts';
import {
  EMAIL_CAMPAIGN_CATEGORY,
  renderEmail,
  type EmailCampaignKey,
  type EmailCopyContext,
  type PetSex,
} from '../_shared/email/copy.ts';
import {
  CROSS_CHANNEL_PAIRS,
  isEmailAllowed,
  isSuppressedByPush,
  selectEmailCampaign,
  type EmailPreferences,
  type EmailRuleInput,
} from '../_shared/email/rules.ts';
import { renderEmailHtml, renderEmailText, type PhotoIntent } from '../_shared/email/template.ts';
import {
  blocksForCampaign,
  replyFallbackBlocks,
  walkReportBlocks,
} from '../_shared/email/compositions.ts';

/** One row of get_email_reply_fallbacks(). */
interface ReplyFallbackRow {
  kind: 'founder' | 'support';
  reply_id: string;
  entity_id: string;
  user_id: string;
  email: string;
  body: string;
  created_at: string;
}

/** One row of get_walk_report_candidates(). */
interface WalkReportRow {
  user_id: string;
  email: string;
  timezone: string | null;
  unsubscribe_token: string;
  pet_id: string;
  pet_name: string;
  pet_sex: string | null;
  image_url: string | null;
  month_key: string;
  month_label: string;
  walk_count: number;
  total_km: number;
  longest_km: number | null;
  sniff_stops: number | null;
  favourite_place: string | null;
}

/**
 * Whether an `image_url` is a photograph of this animal or an onboarding
 * placeholder.
 *
 * 85 of 168 pets carry an `images.unsplash.com` URL left over from onboarding.
 * Those are stock photographs of somebody else's dog, and presenting one under
 * "here is your dog's week" is the fastest possible way to destroy the premise
 * of this channel. Treated as absent.
 */
function isOwnPhoto(url: string | null): boolean {
  if (!url) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  return !url.includes('unsplash.com');
}

/**
 * QA testing has created accounts directly against production on a
 * placeholder domain — `test001@email.com`, `hi1@email.com`, `pra9999@email.com`
 * — with new ones still arriving. As of Aug 2026 that is 143 of 199 accounts,
 * and the first live run (Aug 18) mailed dozens of them, most bouncing or
 * suppressed. There is no `is_test` flag anywhere to gate this in SQL, so it
 * is excluded here, once, ahead of every campaign — the same reason
 * isOwnPhoto sits in one place rather than being re-checked per template.
 *
 * Deliberately narrow: only the exact placeholder domain and its handful of
 * observed typos. A real person's mistyped `gmail.con` is still a real
 * person and is left alone.
 */
const TEST_EMAIL_DOMAINS = new Set([
  'email.com',
  'emaiil.com',
  'email.comt',
  'email.come',
  'enail.com',
]);
function isTestAccount(email: string): boolean {
  const domain = email.trim().toLowerCase().split('@')[1] ?? '';
  return TEST_EMAIL_DOMAINS.has(domain);
}

/**
 * Same fallback and the same reasoning as notify-dispatch: profiles.timezone is
 * populated at push-token registration, so for an email-only owner it is
 * usually null. Australia/Sydney is the right guess for this user base and it
 * stays a guess — the column is left null so "unknown" is never mistaken for
 * "known". Capturing the zone for every authed session, not just push
 * registrants, is the proper fix and is tracked separately.
 */
const FALLBACK_TIMEZONE = Deno.env.get('DEFAULT_TIMEZONE') ?? 'Australia/Sydney';

const PUBLIC_BASE = Deno.env.get('PUBLIC_WEB_BASE') ?? 'https://pawtchi.com';

/** Where the hosted photographs and icons live. */
const ASSETS = `${PUBLIC_BASE}/email`;

/**
 * The faceless default — a person and a dog from behind, no legible breed.
 *
 * It is the only default safe to place beside copy that names the animal. The
 * other three show an identifiable dog that is not theirs; see
 * `pawtchi-website/public/email/README.md`.
 */
const DEFAULT_PET_PHOTO = `${ASSETS}/default-together.jpg`;
const DEFAULT_MOOD_PHOTO = `${ASSETS}/default-together.jpg`;

/** What the owner is told they are leaving, per category. */
const UNSUB_LABEL: Record<string, string> = {
  lifecycle: 'setup and check-in emails',
  digest: 'the weekly recap',
  insights: 'health and plan emails',
  walk: 'walk reports',
};

/**
 * The small label in the top-right of the header. It tells the reader what kind
 * of message this is before they read a word of it, which is the one job the
 * masthead row has.
 */
const KICKER: Record<string, string> = {
  reading: 'First assessment',
  first_log: 'Getting started',
  reassessment: 'Health insight',
  weekly_digest_email: 'Your weekly update',
  walk_report: 'Walk report',
  open_question: 'A note',
  reply_fallback: 'A reply',
};

const UNSUB_SCOPE: Record<string, string> = {
  lifecycle: 'lifecycle',
  digest: 'digest',
  insights: 'insights',
  walk: 'walk',
};

interface Candidate {
  user_id: string;
  email: string;
  owner_name: string;
  timezone: string | null;
  unsubscribe_token: string;

  pet_id: string | null;
  pet_name: string | null;
  pet_sex: string | null;
  hours_since_pet_created: number | null;
  days_since_signup: number;

  email_enabled: boolean;
  cat_email_lifecycle: boolean;
  cat_email_digest: boolean;
  cat_email_insights: boolean;
  cat_email_walk: boolean;

  total_logs: number;
  days_since_last_session: number | null;
  reassessment_due_days: number | null;

  breed: string | null;
  current_weight_kg: number | null;
  ideal_weight_kg: number | null;
  healthy_band_low_kg: number | null;
  healthy_band_high_kg: number | null;
  body_condition_score: number | null;
  target_daily_calories: number | null;
  age_years: number | null;
  species: string | null;
  image_url: string | null;

  sent_this_week: number;
  already_sent: string[];
  /** campaign_key → hours since the most recent push of that campaign. */
  recent_push_hours: Record<string, number>;
}

interface DigestRow {
  user_id: string;
  pet_name: string;
  days_logged: number;
  walks_logged: number;
  calories_consumed: number;
  calorie_goal: number;
  weight_change_kg: number;
}

/** The owner's wall-clock time. Never a server clock. */
function localClock(timezone: string | null): {
  hour: number;
  weekday: number;
  dateISO: string;
} {
  const zone = timezone || FALLBACK_TIMEZONE;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      weekday: 'short',
    }).formatToParts(new Date());
  } catch {
    // A malformed IANA string from a device. Retry once against UTC; passing
    // 'UTC' explicitly terminates the recursion after exactly one hop.
    if (zone !== 'UTC') return localClock('UTC');
    const now = new Date();
    return {
      hour: now.getUTCHours(),
      weekday: now.getUTCDay() === 0 ? 7 : now.getUTCDay(),
      dateISO: now.toISOString().slice(0, 10),
    };
  }

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekdayMap: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };

  return {
    hour: Number(get('hour')) % 24,
    weekday: weekdayMap[get('weekday')] ?? 1,
    dateISO: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

/**
 * One sentence about the week, derived from the owner's real numbers. Returns
 * null when nothing in the data supports a claim — better to say nothing than
 * to invent an observation, which is exactly what the retired template did when
 * it told every owner their animal was "slightly over the weekly calorie goal".
 */
function deriveWeeklyInsight(d: DigestRow, their: string): string | null {
  if (d.calorie_goal > 0) {
    const pct = Math.round((d.calories_consumed / d.calorie_goal) * 100);
    if (pct >= 110) {
      return `Intake came in around ${pct}% of ${their} weekly target. Trimming portions slightly, or adding a walk, would bring it back in line.`;
    }
    if (pct <= 70 && d.days_logged >= 5) {
      return `Intake came in around ${pct}% of ${their} weekly target. If that was not deliberate, it is worth checking appetite with your vet.`;
    }
  }
  if (Math.abs(d.weight_change_kg) >= 0.3) {
    const direction = d.weight_change_kg > 0 ? 'up' : 'down';
    return `Weight moved ${direction} ${Math.abs(d.weight_change_kg).toFixed(1)} kg this week. Log another weigh-in soon to confirm the trend.`;
  }
  if (d.days_logged >= 6) {
    return `${d.days_logged} days logged out of seven. That consistency is what makes the rest of the plan work.`;
  }
  return null;
}

/** Possessive pronoun, matching the copy module's rules. */
function theirOf(name: string, sex: string | null): string {
  if (sex === 'male') return 'his';
  if (sex === 'female') return 'her';
  return `${name}'s`;
}

serve(async (req: Request) => {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  if (!(await isAuthorisedCronRequest(req, admin))) {
    return unauthorised();
  }

  // Lets the pre-flight check in the plan assert the candidate set without
  // sending anything to a real person.
  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dry_run') === '1';

  const skipped: Record<string, number> = {};
  const note = (reason: string) => { skipped[reason] = (skipped[reason] ?? 0) + 1; };

  try {
    const { data: candidateRows, error } = await admin.rpc('get_email_candidates');
    if (error) throw error;
    const candidates = (candidateRows ?? []) as Candidate[];

    // Fetched up front rather than in its own pass, so one call to
    // selectEmailCampaign decides everything for an owner. A separate digest
    // pass would be a second decision point that the weekly cap and the
    // precedence order could not see.
    const { data: digestRows, error: digestError } =
      await admin.rpc('get_weekly_digest_candidates');
    if (digestError) {
      console.error('[notify-email-dispatch] digest candidates:', digestError.message);
    }
    const digestByUser = new Map<string, DigestRow>(
      ((digestRows ?? []) as DigestRow[]).map((d) => [d.user_id, d]),
    );

    interface Plan {
      userId: string;
      petId: string | null;
      campaign: EmailCampaignKey;
      dedupeKey: string;
      to: string;
      subject: string;
      /** Rendered here, not in send-email. The dispatcher owns composition. */
      html: string;
      text: string;
      unsubscribeToken: string | null;
      unsubscribeScope: string | null;
    }

    const planned: Plan[] = [];

    for (const c of candidates) {
      if (isTestAccount(c.email)) { note('test_account'); continue; }

      const clock = localClock(c.timezone);

      const ruleInput: EmailRuleInput = {
        localHour: clock.hour,
        localWeekday: clock.weekday,
        hasPet: Boolean(c.pet_id),
        hoursSincePetCreated: c.hours_since_pet_created,
        daysSinceSignup: c.days_since_signup,
        totalLogs: c.total_logs,
        daysSinceLastSession: c.days_since_last_session,
        reassessmentDueDays: c.reassessment_due_days,
        digestEligible: digestByUser.has(c.user_id),
        sentThisWeek: c.sent_this_week,
        alreadySent: (c.already_sent ?? []) as EmailCampaignKey[],
      };

      const match = selectEmailCampaign(ruleInput, clock.dateISO);
      if (!match) continue;

      const prefs: EmailPreferences = {
        email_enabled: c.email_enabled,
        cat_email_lifecycle: c.cat_email_lifecycle,
        cat_email_digest: c.cat_email_digest,
        cat_email_insights: c.cat_email_insights,
        cat_email_walk: c.cat_email_walk,
      };
      if (!isEmailAllowed(match.campaign, prefs)) { note('category_off'); continue; }

      // Cross-channel: push wins the tie, because it is the more perishable of
      // the two and its recipient is by definition already reachable. The
      // window itself lives in rules.ts so the SQL and the engine cannot
      // disagree about how recent "recently" is.
      const pairedPush = CROSS_CHANNEL_PAIRS[match.campaign];
      const hoursSincePush = pairedPush
        ? (c.recent_push_hours ?? {})[pairedPush] ?? null
        : null;
      if (isSuppressedByPush(match.campaign, hoursSincePush)) {
        note('duplicate_of_push');
        continue;
      }

      const ctx = buildContext(match.campaign, c, digestByUser.get(c.user_id));
      const rendered = renderEmail(match.campaign, ctx);
      // The copy module refuses to render without the facts it needs. That is
      // a skip, not a fallback — an email naming no animal is worse than none.
      if (!rendered) { note('copy_declined'); continue; }

      const category = EMAIL_CAMPAIGN_CATEGORY[match.campaign];
      const transactional = category === 'direct';
      const scope = UNSUB_SCOPE[category] ?? 'all';
      // The VISIBLE footer link, and it deliberately points at the website
      // rather than at the edge function.
      //
      // Supabase rewrites a `text/html` response to `text/plain` on
      // *.supabase.co/functions/v1/* — a platform guard against hosting
      // arbitrary HTML, and therefore phishing, on a Supabase domain. Verified
      // against the deployed function: JSON passes through, HTML comes back as
      // text/plain and the page renders as a wall of source.
      //
      // So the two halves of RFC 8058 are served from different places. This
      // link is for a person; the List-Unsubscribe header that send-email adds
      // still targets the function directly, because Gmail POSTs to it and
      // reads JSON.
      const unsubUrl = transactional
        ? null
        : `${PUBLIC_BASE}/unsubscribe.html` +
          `?t=${encodeURIComponent(c.unsubscribe_token)}&s=${encodeURIComponent(scope)}`;

      // The owner's own photograph when they have uploaded one, and the
      // faceless default otherwise. Never an onboarding placeholder — see
      // isOwnPhoto.
      const ownPhoto = isOwnPhoto(c.image_url);
      const photos: Record<PhotoIntent, string> = {
        pet: ownPhoto ? (c.image_url as string) : DEFAULT_PET_PHOTO,
        mood: DEFAULT_MOOD_PHOTO,
      };

      const digest = digestByUser.get(c.user_id);
      const templateInput = {
        preheader: rendered.preheader,
        kicker: KICKER[match.campaign] ?? 'Pawtchi',
        blocks: blocksForCampaign(match.campaign, rendered, {
          weekly: digest
            ? {
                petName: c.pet_name ?? '',
                walks: digest.walks_logged,
                walksDelta: null,
                distanceKm: 0,
                distanceDeltaPct: null,
                totalMinutes: 0,
                hasOwnPhoto: ownPhoto,
                insight: deriveWeeklyInsight(digest, theirOf(c.pet_name ?? '', c.pet_sex)),
              }
            : undefined,
          reactivation:
            match.campaign === 'open_question'
              ? { petName: c.pet_name ?? '', daysQuiet: c.days_since_last_session ?? 14 }
              : undefined,
        }),
        photos,
        unsubscribeUrl: unsubUrl,
        unsubscribeLabel: UNSUB_LABEL[category] ?? 'these emails',
        iconBase: `${ASSETS}/icons`,
        baseUrl: PUBLIC_BASE,
      };

      planned.push({
        userId: c.user_id,
        petId: c.pet_id,
        campaign: match.campaign,
        dedupeKey: `${c.user_id}:${match.campaign}:${match.window}`,
        to: c.email,
        subject: rendered.subject,
        html: renderEmailHtml(templateInput),
        text: renderEmailText(templateInput),
        unsubscribeToken: transactional ? null : c.unsubscribe_token,
        unsubscribeScope: transactional ? null : scope,
      });
    }

    // ── Reply fallback ────────────────────────────────────────────────────────
    // Event-driven, and deliberately exempt from the weekly cap, the category
    // gates and the cross-channel suppression. Those exist to ration nudges we
    // initiate; this is an answer somebody is waiting for. The candidate query
    // already enforces the 60-minute floor that lets push try first.
    //
    // Runs even for owners who are not in the rule-driven candidate set at all
    // — no pet, gone quiet, email_enabled false. None of that should stand
    // between a person and the reply to a letter they wrote.
    try {
      const { data: replyRows, error: replyError } =
        await admin.rpc('get_email_reply_fallbacks');
      if (replyError) throw new Error(replyError.message);

      for (const r of (replyRows ?? []) as ReplyFallbackRow[]) {
        if (isTestAccount(r.email)) { note('test_account'); continue; }

        const rendered = renderEmail('reply_fallback', {});
        if (!rendered) continue;

        const blocks = replyFallbackBlocks({
          kind: r.kind,
          body: r.body,
          entityId: r.entity_id,
        });
        const templateInput = {
          preheader: r.kind === 'founder' ? 'Your letter has an answer.' : 'Your request has an answer.',
          kicker: r.kind === 'founder' ? 'A reply' : 'Support',
          blocks,
          photos: { pet: DEFAULT_PET_PHOTO, mood: DEFAULT_MOOD_PHOTO },
          // Transactional mail carries no unsubscribe, by RFC 8058 and by
          // common sense: this is not a list anyone joined.
          unsubscribeUrl: null,
          unsubscribeLabel: '',
          iconBase: `${ASSETS}/icons`,
          baseUrl: PUBLIC_BASE,
        };

        planned.push({
          userId: r.user_id,
          petId: null,
          campaign: 'reply_fallback',
          dedupeKey: `reply_fallback:${r.kind}:${r.reply_id}`,
          to: r.email,
          subject: rendered.subject,
          html: renderEmailHtml(templateInput),
          text: renderEmailText(templateInput),
          unsubscribeToken: null,
          unsubscribeScope: null,
        });
      }
    } catch (e) {
      // A failure here must not take the whole run down.
      console.error('[notify-email-dispatch] reply fallback:', e instanceof Error ? e.message : String(e));
    }

    // ── Monthly walk report ───────────────────────────────────────────────────
    // Its own pass because it aggregates a finished calendar month rather than
    // reading per-owner state, and because it is the one campaign whose gate is
    // "did enough happen" rather than "is it time".
    try {
      const { data: walkRows, error: walkError } =
        await admin.rpc('get_walk_report_candidates');
      if (walkError) throw new Error(walkError.message);

      for (const w of (walkRows ?? []) as WalkReportRow[]) {
        if (isTestAccount(w.email)) { note('test_account'); continue; }

        const clock = localClock(w.timezone);
        // Sent in the first week of the month, mid-morning local. A report on
        // a month that ended three weeks ago is history, not news.
        if (clock.hour !== 10) { note('walk_report_wrong_hour'); continue; }

        const ownPhoto = isOwnPhoto(w.image_url);
        const templateInput = {
          preheader: `${w.walk_count} walks, and one route ${w.pet_name} kept going back to.`,
          kicker: 'Walk report',
          blocks: walkReportBlocks({
            petName: w.pet_name,
            petIsMale: w.pet_sex === 'male' ? true : w.pet_sex === 'female' ? false : null,
            monthLabel: w.month_label,
            walkCount: w.walk_count,
            totalKm: Number(w.total_km),
            longestKm: w.longest_km === null ? null : Number(w.longest_km),
            sniffStops: w.sniff_stops,
            favouritePlace: w.favourite_place,
            hasOwnPhoto: ownPhoto,
          }),
          photos: {
            pet: ownPhoto ? (w.image_url as string) : DEFAULT_PET_PHOTO,
            mood: DEFAULT_MOOD_PHOTO,
          },
          unsubscribeUrl:
            `${PUBLIC_BASE}/unsubscribe.html` +
            `?t=${encodeURIComponent(w.unsubscribe_token)}&s=walk`,
          unsubscribeLabel: UNSUB_LABEL.walk,
          iconBase: `${ASSETS}/icons`,
          baseUrl: PUBLIC_BASE,
        };

        planned.push({
          userId: w.user_id,
          petId: w.pet_id,
          campaign: 'walk_report',
          dedupeKey: `${w.user_id}:walk_report:${w.month_key}`,
          to: w.email,
          subject: `${w.pet_name} covered ${w.total_km} km in ${w.month_label}`,
          html: renderEmailHtml(templateInput),
          text: renderEmailText(templateInput),
          unsubscribeToken: w.unsubscribe_token,
          unsubscribeScope: 'walk',
        });
      }
    } catch (e) {
      console.error('[notify-email-dispatch] walk report:', e instanceof Error ? e.message : String(e));
    }

    if (dryRun) {
      return json({
        ok: true,
        dry_run: true,
        candidates: candidates.length,
        planned: planned.length,
        by_campaign: countBy(planned.map((p) => p.campaign)),
        skipped,
      });
    }

    if (planned.length === 0) {
      return json({ ok: true, candidates: candidates.length, planned: 0, sent: 0, skipped });
    }

    // ── Claim before sending ─────────────────────────────────────────────────
    // The unique index on dedupe_key means a concurrent or repeated run loses
    // the race and sends nothing, rather than double-emailing.
    const { data: claimed, error: claimError } = await admin
      .from('notification_history')
      .upsert(
        planned.map((p) => ({
          user_id: p.userId,
          pet_id: p.petId,
          event_type: p.campaign,
          campaign_key: p.campaign,
          channel: 'email',
          variant: 'a',
          sent_at: new Date().toISOString(),
          dedupe_key: p.dedupeKey,
        })),
        { onConflict: 'dedupe_key', ignoreDuplicates: true },
      )
      .select('id, dedupe_key');
    if (claimError) throw claimError;

    const claimedRows = (claimed ?? []) as { id: string; dedupe_key: string }[];
    const idByKey = new Map(claimedRows.map((r) => [r.dedupe_key, r.id]));
    const toSend = planned.filter((p) => idByKey.has(p.dedupeKey));
    if (planned.length > toSend.length) {
      skipped.already_sent = planned.length - toSend.length;
    }

    const cronSecret = req.headers.get(CRON_SECRET_HEADER) ?? '';
    let sent = 0;
    const failures: string[] = [];

    for (const p of toSend) {
      const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [CRON_SECRET_HEADER]: cronSecret },
        body: JSON.stringify({
          to: p.to,
          subject: p.subject,
          html: p.html,
          // A real text part, generated from the same blocks. A multipart
          // message without one is a spam signal, and send-email's old default
          // was a single boilerplate line shared by every message — which is
          // itself a fingerprint.
          text: p.text,
          unsubscribeToken: p.unsubscribeToken,
          unsubscribeScope: p.unsubscribeScope,
        }),
      });

      if (res.ok) {
        sent++;
        // Store Resend's message id so email-events can turn a later
        // "delivered" / "bounced" / "complained" webhook into a fact about this
        // exact row. Without it the whole channel is unmeasurable, which is the
        // failure the August rebuild exists to prevent.
        const messageId = await readMessageId(res);
        if (messageId) {
          await admin
            .from('notification_history')
            .update({ provider_message_id: messageId })
            .eq('id', idByKey.get(p.dedupeKey));
        } else {
          console.warn('[notify-email-dispatch] no message id for', p.campaign);
        }
        continue;
      }

      // Record the failure on the ledger row rather than letting a claimed row
      // masquerade as a delivered email — precisely how the old pipeline hid
      // four months of total failure.
      failures.push(`${p.campaign}: ${res.status}`);
      await admin
        .from('notification_history')
        .update({
          receipt_status: 'error',
          receipt_error: `send-email ${res.status}`,
          receipt_checked_at: new Date().toISOString(),
        })
        .eq('id', idByKey.get(p.dedupeKey));
    }

    if (failures.length > 0) {
      console.error('[notify-email-dispatch] failures:', failures.join('; '));
    }

    return json({
      ok: true,
      candidates: candidates.length,
      planned: planned.length,
      sent,
      failed: failures.length,
      skipped,
    });
  } catch (e) {
    const detail = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
    console.error('[notify-email-dispatch]', detail);
    return json({ ok: false, error: 'dispatch_failed' }, 500);
  }
});

/**
 * Assembles the facts a campaign needs. Everything here is read from columns
 * onboarding already populated — nothing is derived twice, and nothing is
 * invented when a column is null. The copy module drops the line instead.
 */
function buildContext(
  campaign: EmailCampaignKey,
  c: Candidate,
  digest: DigestRow | undefined,
): EmailCopyContext {
  const base: EmailCopyContext = {
    petName: c.pet_name,
    petSex: (c.pet_sex as PetSex) ?? null,
    ownerName: c.owner_name,
  };

  if (campaign === 'reading') {
    return {
      ...base,
      currentWeightKg: c.current_weight_kg,
      idealWeightKg: c.ideal_weight_kg,
      healthyBandLowKg: c.healthy_band_low_kg,
      healthyBandHighKg: c.healthy_band_high_kg,
      conditionLabel: conditionLabelFor(c),
      calorieTarget: c.target_daily_calories,
      breed: c.breed,
      lifeStageLabel: lifeStageLabelFor(c),
    };
  }

  if (campaign === 'reassessment') {
    return { ...base, daysSinceWeighIn: c.reassessment_due_days };
  }

  if (campaign === 'weekly_digest_email' && digest) {
    return {
      ...base,
      daysLogged: digest.days_logged,
      walksLogged: digest.walks_logged,
      caloriesConsumed: digest.calories_consumed,
      calorieGoal: digest.calorie_goal,
      insight: deriveWeeklyInsight(digest, theirOf(c.pet_name ?? '', c.pet_sex)),
    };
  }

  return base;
}

/**
 * Owner-facing condition phrasing.
 *
 * Mirrors CLASSIFICATION_LABEL in lib/bcsOptions.ts. It is duplicated rather
 * than imported because that module pulls in a React Native icon type, which
 * the Deno runtime cannot compile — the same constraint that keeps the design
 * tokens duplicated in CampaignEmail.tsx. Keeping the phrasing identical is the
 * point: the email must describe the animal the same way the app does.
 *
 * Derived from BCS rather than from the weight delta, because BCS is what the
 * owner actually answered during the hands-on check.
 */
function conditionLabelFor(c: Candidate): string | null {
  const bcs = c.body_condition_score;
  if (bcs === null || bcs === undefined) return null;
  if (bcs <= 3) return 'looks underweight';
  if (bcs <= 5) return 'looks just right';
  if (bcs <= 7) return 'looks a bit over ideal';
  return 'needs weight-loss support';
}

/**
 * A coarse life stage, only specific enough for the phrase "adult beagle".
 * Deliberately not the full deriveLifeStage() ladder from lib/lifeStage.ts: the
 * email uses this as an adjective, and importing the real thing would mean
 * mirroring another module for one word. If this ever needs to be precise, it
 * should be mirrored properly rather than refined here.
 */
function lifeStageLabelFor(c: Candidate): string | null {
  const age = c.age_years;
  if (age === null || age === undefined) return null;
  const isCat = (c.species ?? '').toLowerCase().startsWith('cat');
  if (age < 1) return isCat ? 'kitten' : 'puppy';
  if (age < 7) return 'adult';
  return 'senior';
}

/**
 * Pulls the Resend message id out of send-email's response.
 *
 * Two shapes are accepted because the Resend SDK changed: older versions
 * resolve to `{ id }`, current ones to `{ data: { id }, error }`. send-email
 * forwards whatever it got verbatim, so handling both here is cheaper than
 * pinning a version and cheaper than a silent null when it next changes.
 */
async function readMessageId(res: Response): Promise<string | null> {
  try {
    const body = await res.json();
    return body?.data?.id ?? body?.id ?? null;
  } catch {
    return null;
  }
}

function countBy(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
