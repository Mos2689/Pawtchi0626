/**
 * Notification copy catalogue — the single source of every push string.
 *
 * This file is byte-mirrored to
 * `supabase/functions/_shared/notifications/copy.ts` (same convention as
 * `_shared/hydration.ts`). `copy.test.ts` fails the build if the two drift, so
 * the server can never again ship copy the app has never seen. That is exactly
 * how production ended up pushing "Testing, testing! 1, 2, 3 Dad!" to real
 * owners for four months.
 *
 * Every string here must satisfy Copy Spec v1 (Pawtchi Brand Book §6.04),
 * which `copy.test.ts` enforces mechanically:
 *   - no exclamation marks, anywhere
 *   - no emoji
 *   - the animal's name, never "your pet" / "your dog" / "your cat"
 *   - pronouns from the animal's sex; never "their" for a known individual
 *   - sentence case; never Title Case or ALL CAPS
 *   - three sentences maximum, ending on an action rather than a feeling
 *   - no guilt or panic framing; calm beats urgent
 *
 * Keep this file import-free. It is compiled by both the Expo bundler and the
 * Deno edge runtime, and the mirror check compares raw file contents.
 */

export type PetSex = 'male' | 'female' | null | undefined;

export type CampaignKey =
  | 'onboarding_incomplete'
  | 'first_log_prompt'
  | 'meal_window'
  | 'weigh_in_due'
  | 'plan_drift'
  | 'milestone'
  | 'walksign_confirmed'
  | 'vet_checkin'
  | 'weekly_recap'
  | 'streak_risk'
  | 'winback_7d'
  | 'winback_30d'
  | 'founder_reply'
  | 'support_reply'
  | 'walk_insight';

/**
 * The rotating pool behind `walk_insight`. Each kind is a genuinely different
 * *shape* of observation, not a reworded version of the same one — that is what
 * makes the reward variable rather than merely repeated.
 *
 * Ordered by how interesting the observation is when it is available. The
 * selector in `walkInsights.ts` walks this order, skips anything the data does
 * not support, and skips anything sent recently.
 *
 * Deliberately absent: pace. A slowing dog is a health signal that belongs in
 * its own campaign with its own cadence and wording, not in a cheerful
 * post-walk note.
 */
export type WalkInsightKind =
  | 'long_pause'
  | 'new_ground'
  | 'sniff_count'
  | 'longest_recent'
  | 'duration_trend'
  | 'familiar_route';

export const ALL_WALK_INSIGHT_KINDS: readonly WalkInsightKind[] = [
  'long_pause',
  'new_ground',
  'sniff_count',
  'longest_recent',
  'duration_trend',
  'familiar_route',
];

/** Which preference toggle governs a campaign. */
export type NotificationCategory =
  | 'care_reminders'
  | 'health_insights'
  | 'milestones'
  | 'digest'
  | 'lifecycle'
  // Walk content gets its own switch so an owner who has stopped walking — for
  // a sprain, a surgery, or a bereavement — can silence it without losing meal
  // reminders. Folding it into `milestones` would have made "leave me alone
  // about walks" cost them everything else too.
  | 'walk'
  // Transactional, and deliberately not user-mutable. A reply to a letter
  // someone chose to write is not marketing, and must not be swallowed by a
  // toggle they set months earlier for meal reminders. `push_enabled` still
  // applies — turning pushes off entirely is a different, explicit choice.
  | 'direct';

/**
 * Who signs the letters. Lives here so the notification copy and the letter
 * screens cannot drift apart; lib/founderLetters.ts re-exports it as
 * FOUNDER_NAMES for the UI.
 *
 * Two people, so every sentence built around this takes a plural verb ("Pra and
 * Mos read every letter", not "reads"). Where the sentence can carry it, the
 * screens say "we" instead — it is warmer than the third person, and it removes
 * the agreement trap entirely.
 */
export const FOUNDER_DISPLAY_NAME = 'Pra and Mos';

export interface CopyContext {
  /** The animal's name. Falsy only before onboarding creates a pet. */
  petName?: string | null;
  petSex?: PetSex;
  /** Campaign-specific numbers. Absent values fall back to a shorter sentence. */
  days?: number;
  minutes?: number;
  streakDays?: number;
  mealLabel?: string;
  weightKg?: number;
  mealsLogged?: number;
  walksLogged?: number;
  reason?: string | null;

  /** Which observation `walk_insight` should render. */
  insightKind?: WalkInsightKind;
  sniffCount?: number;
  pauseMinutes?: number;
  trendWeeks?: number;
  repeatCount?: number;
}

export interface RenderedCopy {
  title: string;
  body: string;
}

// ── Pronouns ────────────────────────────────────────────────────────────────
// The spec bans "their" for a known individual animal. When sex is unknown we
// repeat the name rather than reaching for a plural pronoun.

export function subjectPronoun(name: string, sex: PetSex): string {
  if (sex === 'male') return 'he';
  if (sex === 'female') return 'she';
  return name;
}

export function possessivePronoun(name: string, sex: PetSex): string {
  if (sex === 'male') return 'his';
  if (sex === 'female') return 'her';
  return `${name}'s`;
}

export function objectPronoun(name: string, sex: PetSex): string {
  if (sex === 'male') return 'him';
  if (sex === 'female') return 'her';
  return name;
}

/** Possessive form of a name, handling names that already end in s. */
export function possessiveName(name: string): string {
  return name.endsWith('s') ? `${name}'` : `${name}'s`;
}

// ── Category mapping ────────────────────────────────────────────────────────

export const CAMPAIGN_CATEGORY: Record<CampaignKey, NotificationCategory> = {
  onboarding_incomplete: 'lifecycle',
  first_log_prompt: 'lifecycle',
  meal_window: 'care_reminders',
  weigh_in_due: 'care_reminders',
  plan_drift: 'health_insights',
  milestone: 'milestones',
  walksign_confirmed: 'milestones',
  vet_checkin: 'health_insights',
  weekly_recap: 'digest',
  streak_risk: 'care_reminders',
  winback_7d: 'lifecycle',
  winback_30d: 'lifecycle',
  founder_reply: 'direct',
  support_reply: 'direct',
  walk_insight: 'walk',
};

// ── Renderers ───────────────────────────────────────────────────────────────
// One function per campaign. They return plain strings so the same catalogue
// drives push payloads, the settings-screen previews, and the tests.

export function renderCopy(campaign: CampaignKey, ctx: CopyContext): RenderedCopy {
  const name = (ctx.petName ?? '').trim();
  // Only onboarding_incomplete legitimately has no animal yet. Everything else
  // without a name is a data bug, and a nameless push is worse than none — the
  // dispatcher treats a null return as "skip this candidate".
  switch (campaign) {
    case 'onboarding_incomplete':
      return {
        title: 'Your plan is waiting',
        body: 'Add your companion to get a feeding and activity plan.',
      };

    case 'first_log_prompt':
      return {
        title: `${possessiveName(name)} plan is ready`,
        body: `Log ${possessivePronoun(name, ctx.petSex)} first meal to start tracking against it.`,
      };

    case 'meal_window': {
      const meal = (ctx.mealLabel ?? 'meal').toLowerCase();
      const mins = ctx.minutes;
      return {
        title: `${possessiveName(name)} ${meal} is coming up`,
        body: mins
          ? `The window opens in ${mins} minutes. Log it once ${subjectPronoun(name, ctx.petSex)} has eaten.`
          : `Log it once ${subjectPronoun(name, ctx.petSex)} has eaten.`,
      };
    }

    case 'weigh_in_due':
      return {
        title: `Time to weigh ${name}`,
        body: ctx.days
          ? `It has been ${ctx.days} days since the last weigh-in. Log a fresh weight to keep ${possessivePronoun(name, ctx.petSex)} plan accurate.`
          : `Log a fresh weight to keep ${possessivePronoun(name, ctx.petSex)} plan accurate.`,
      };

    case 'plan_drift':
      return {
        title: `${name} has been eating less`,
        body: `Two of the last three days came in under 70% of ${possessivePronoun(name, ctx.petSex)} target. Open Pawtchi to check the plan still fits.`,
      };

    case 'milestone':
      return {
        title: `${name} reached a milestone`,
        body: ctx.weightKg
          ? `${subjectPronoun(name, ctx.petSex) === name ? name : capitalise(subjectPronoun(name, ctx.petSex))} is down to ${ctx.weightKg} kg. Open Pawtchi to see the next stage.`
          : 'Open Pawtchi to see the next stage.',
      };

    case 'walksign_confirmed':
      return {
        title: `${possessiveName(name)} Walksign is confirmed`,
        body: `Five walks in, the reading held. Open Pawtchi to see what it says about ${objectPronoun(name, ctx.petSex)}.`,
      };

    case 'vet_checkin':
      return {
        title: `How is ${name} doing?`,
        body: ctx.reason
          ? `Pawtchi is checking in ${ctx.reason}. Tap to share how things are going.`
          : 'Pawtchi is checking in on the question you asked. Tap to share how things are going.',
      };

    case 'weekly_recap': {
      const meals = ctx.mealsLogged ?? 0;
      const walks = ctx.walksLogged ?? 0;
      return {
        title: `${possessiveName(name)} week`,
        body: `${meals} meals and ${walks} walks logged. Open the recap to see how the week landed.`,
      };
    }

    case 'streak_risk':
      return {
        title: `${possessiveName(name)} streak is at ${ctx.streakDays ?? 0} days`,
        body: 'Nothing is logged yet today. Log a meal to keep it going.',
      };

    case 'winback_7d':
      return {
        title: `${possessiveName(name)} log has been quiet`,
        body: `It has been a week since the last entry. Log a meal to pick ${possessivePronoun(name, ctx.petSex)} plan back up.`,
      };

    case 'winback_30d':
      return {
        title: `${possessiveName(name)} plan is still here`,
        body: 'Open Pawtchi whenever you are ready to start logging again.',
      };

    // The one campaign that is about the app rather than the animal, so it
    // names neither. It also never promises a reply to anything else — this
    // fires only because a specific letter already has one.
    case 'founder_reply':
      return {
        title: `${FOUNDER_DISPLAY_NAME} wrote back`,
        body: 'Your letter has a reply waiting. Open it to read.',
      };

    // The support counterpart of founder_reply, and deliberately worded to
    // sound like a different sender. That one is two people writing back; this
    // one is the team answering a request. Naming nobody is the point — if this
    // said "Pra and Mos", the letter would stop feeling personal, because the
    // same signature would be arriving on routine support answers too.
    case 'support_reply':
      return {
        title: 'We replied to your request',
        body: 'Your support request has an answer waiting. Open it to read.',
      };

    // The post-walk reinforcer. One observation, never a summary of the walk —
    // the owner was there, so distance and duration tell them nothing new.
    //
    // Every variant deliberately withholds *where*. "Open the walk to see where
    // he lingered" is the whole mechanism: the location is the reason to tap,
    // and putting it in the notification would spend the payoff in the tray.
    case 'walk_insight':
      return renderWalkInsight(name, ctx);
  }
}

function renderWalkInsight(name: string, ctx: CopyContext): RenderedCopy {
  const he = subjectPronoun(name, ctx.petSex);
  const him = objectPronoun(name, ctx.petSex);

  switch (ctx.insightKind) {
    case 'long_pause':
      return {
        title: `${name} stayed at one spot for ${ctx.pauseMinutes ?? 0} minutes`,
        body: `Something was going on there. Open the walk to see where ${he} stopped.`,
      };

    case 'new_ground':
      return {
        title: `${name} covered new ground`,
        body: `Part of the route today was somewhere ${he} has not walked before. Open the walk to see it.`,
      };

    case 'sniff_count':
      return {
        title: `${name} stopped to sniff ${ctx.sniffCount ?? 0} times`,
        body: `Open the walk to see where ${he} lingered.`,
      };

    case 'longest_recent':
      return {
        title: `${possessiveName(name)} longest walk in ${ctx.days ?? 0} days`,
        body: `Open the walk to see how far ${he} got.`,
      };

    case 'duration_trend':
      return {
        title: `${possessiveName(name)} walks are getting longer`,
        body: `${ctx.trendWeeks ?? 0} weeks running now. Open the recap to see the shape of it.`,
      };

    case 'familiar_route':
      return {
        title: `${name} went the same way again`,
        body: `That is ${ctx.repeatCount ?? 0} times on that route this week. Open the walk to see what draws ${him} back.`,
      };

    // A walk with nothing worth saying about it is not a notification. The
    // selector returns null in that case, so this is unreachable in the
    // dispatcher — it exists so the switch is total.
    default:
      return {
        title: `${possessiveName(name)} walk is saved`,
        body: 'Open the walk to see the route.',
      };
  }
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Campaigns that read correctly without a pet record. `founder_reply` is here
 * for a different reason than `onboarding_incomplete`: not "there is no animal
 * yet", but "this one is about the app, and naming the animal would be a
 * non-sequitur".
 */
export const CAMPAIGNS_WITHOUT_PET: readonly CampaignKey[] = [
  'onboarding_incomplete',
  'founder_reply',
  // Same reasoning as founder_reply: this is about the app, not the animal, and
  // naming a pet in "we replied to your request" would be a non-sequitur.
  'support_reply',
];

export const ALL_CAMPAIGNS: readonly CampaignKey[] = [
  'onboarding_incomplete',
  'first_log_prompt',
  'meal_window',
  'weigh_in_due',
  'plan_drift',
  'milestone',
  'walksign_confirmed',
  'vet_checkin',
  'weekly_recap',
  'streak_risk',
  'winback_7d',
  'winback_30d',
  'founder_reply',
  'support_reply',
  'walk_insight',
];
