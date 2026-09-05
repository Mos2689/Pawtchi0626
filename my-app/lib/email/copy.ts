/**
 * Email copy catalogue — the single source of every owner-facing email string.
 *
 * Byte-mirrored to `supabase/functions/_shared/email/copy.ts` by
 * `npm run notifications:sync`, with the drift check in `copy.test.ts`. Same
 * convention, and the same reason, as `lib/notifications/copy.ts`: the August
 * 2026 audit found the live push dispatcher was a dashboard-only fork that had
 * drifted far enough to be sending a developer test string to real owners for
 * four months. A second channel is a second chance to make that mistake.
 *
 * Every string here must satisfy Copy Spec v1 (Pawtchi Brand Book §6.04), which
 * `copy.test.ts` enforces mechanically:
 *   - no exclamation marks, anywhere
 *   - no emoji
 *   - the animal's name, never "your pet" / "your dog" / "your cat"
 *   - pronouns from the animal's sex; never "their" for a known individual
 *   - sentence case; never Title Case or ALL CAPS
 *   - no guilt or panic framing; calm beats urgent
 *
 * Two rules are specific to this file:
 *
 *   1. **Every email is Pawtchi noticing something.** The tagline is "Notice
 *      everything". If a draft is not an observation about a specific animal,
 *      it is a newsletter and does not belong here.
 *
 *   2. **Hold one fact back.** The push catalogue already does this and it is
 *      the strongest mechanic in the product: "Open the walk to see *where* he
 *      lingered" works because the location is the reason to tap and printing
 *      it would spend the payoff. Emails have more room, which makes it easier
 *      to give everything away and leave no reason to open the app.
 *
 * Structure, not layout: these renderers return heading/paragraphs/CTA as data
 * and the React Email templates arrange them. Copy lives in one file so it can
 * be diffed, tested and mirrored; layout lives in the templates.
 */

import {
  possessiveName,
  possessivePronoun,
  subjectPronoun,
  type PetSex,
} from '../notifications/copy';

// Re-exported so the dispatcher can type a candidate row against one import
// rather than reaching across into the notification module for a type that
// this module's own context object already uses.
export type { PetSex };

export type EmailCampaignKey =
  | 'reading'
  | 'first_log'
  | 'reassessment'
  | 'weekly_digest_email'
  | 'walk_report'
  | 'open_question'
  | 'reply_fallback';

/**
 * Which preference column governs a campaign. These deliberately mirror the
 * push categories by name but not by value — an owner who silenced meal
 * reminders on their lock screen has said nothing about whether they want a
 * monthly walk report in their inbox.
 */
export type EmailCategory =
  | 'lifecycle'
  | 'digest'
  | 'insights'
  | 'walk'
  // Transactional, and not user-mutable. A reply to a letter someone chose to
  // write is not a campaign they can unsubscribe from. Same reasoning as the
  // `direct` push category, and the same reason RFC 8058 exempts transactional
  // mail from the one-click requirement.
  | 'direct';

export const EMAIL_CAMPAIGN_CATEGORY: Record<EmailCampaignKey, EmailCategory> = {
  reading: 'lifecycle',
  first_log: 'lifecycle',
  open_question: 'lifecycle',
  reassessment: 'insights',
  weekly_digest_email: 'digest',
  walk_report: 'walk',
  reply_fallback: 'direct',
};

/**
 * Where each campaign lands inside the app. Expo-router paths, the same shape
 * CAMPAIGN_ROUTE uses for push.
 */
export const EMAIL_CAMPAIGN_ROUTE: Record<EmailCampaignKey, string> = {
  reading: '/(tabs)/health',
  first_log: '/(tabs)/meal',
  reassessment: '/(tabs)/health',
  weekly_digest_email: '/(tabs)',
  walk_report: '/walk-gallery',
  open_question: '/(tabs)/meal',
  reply_fallback: '/letter',
};

/**
 * The public half of the same destination.
 *
 * An email cannot link to `/(tabs)/health` — it needs an https URL, both
 * because that is all a mail client will render and because a universal link is
 * the only thing that opens the app from an inbox. A custom `pawtchi://` scheme
 * does not survive Gmail.
 *
 * These slugs are the contract in three places at once, which is why they live
 * beside the routes rather than in the sender: the email builds
 * `https://pawtchi.com/app/<slug>`, the website serves a real page there for
 * anyone reading on a desktop, and the app's `routeForUrl()` inverts this map
 * to land a tap on the right screen. Changing a slug without changing all three
 * produces a link that silently opens the home tab.
 */
export const EMAIL_CAMPAIGN_WEB_PATH: Record<EmailCampaignKey, string> = {
  reading: 'health',
  first_log: 'meal',
  reassessment: 'health',
  weekly_digest_email: 'home',
  walk_report: 'walks',
  open_question: 'meal',
  reply_fallback: 'letters',
};

/**
 * Inverse of EMAIL_CAMPAIGN_WEB_PATH, for the app's link handler.
 *
 * Defined in `links.ts` and re-exported here, where it has always been read
 * from. It moved because the public engagement-click function needs the route
 * table and nothing else in this file: importing it from here would drag the
 * whole copy catalogue and the notification copy module into the cold start of
 * an endpoint that sits on the critical path of a tap.
 */
export { WEB_PATH_TO_ROUTE } from './links';

export interface EmailCopyContext {
  petName?: string | null;
  petSex?: PetSex;
  ownerName?: string | null;

  /** The Reading. All computed by the caller from the single sources. */
  currentWeightKg?: number | null;
  idealWeightKg?: number | null;
  healthyBandLowKg?: number | null;
  healthyBandHighKg?: number | null;
  /** From CLASSIFICATION_LABEL in lib/bcsOptions.ts, e.g. "looks just right". */
  conditionLabel?: string | null;
  calorieTarget?: number | null;
  lifeStageLabel?: string | null;
  breed?: string | null;
  breedWatchOut?: string | null;

  /** Reassessment. */
  daysSinceWeighIn?: number | null;

  /** Weekly digest. */
  daysLogged?: number;
  walksLogged?: number;
  caloriesConsumed?: number;
  calorieGoal?: number;
  /** One sentence derived from real numbers, or null when none is supported. */
  insight?: string | null;

  /** Walk report. */
  monthLabel?: string | null;
  totalKm?: number | null;
  walkCount?: number | null;
  longestKm?: number | null;
  favouritePlace?: string | null;
  sniffStops?: number | null;

  /** Reactivation. */
  daysQuiet?: number | null;
}

export interface RenderedEmail {
  subject: string;
  /** The grey line clients show after the subject. Never a repeat of it. */
  preheader: string;
  heading: string;
  /** Paragraphs, rendered in order. */
  body: string[];
  cta: { label: string; path: string };
}

/** Renders a campaign, or null when the data does not support sending it. */
export function renderEmail(
  campaign: EmailCampaignKey,
  ctx: EmailCopyContext,
): RenderedEmail | null {
  const name = (ctx.petName ?? '').trim();
  const route = EMAIL_CAMPAIGN_ROUTE[campaign];

  // Every campaign except the transactional one is about a specific animal.
  // A nameless email is worse than no email, so the dispatcher treats null as
  // "skip this candidate" rather than substituting "your pet".
  if (!name && campaign !== 'reply_fallback') return null;

  switch (campaign) {
    case 'reading':
      return renderReading(name, ctx, route);

    case 'first_log':
      return {
        subject: `${possessiveName(name)} plan has not started yet`,
        preheader: `It is waiting on one thing.`,
        heading: `${possessiveName(name)} plan is ready. It just has nothing to measure yet.`,
        body: [
          `Pawtchi worked out ${possessivePronoun(name, ctx.petSex)} calorie target when you set ${possessivePronoun(name, ctx.petSex)} up. Until a meal is logged against it, the plan cannot tell you whether it is right — it has nothing to compare.`,
          `The first one takes about twenty seconds. After that the plan starts adjusting to what ${subjectPronoun(name, ctx.petSex)} actually eats, rather than what the average dog ${possessivePronoun(name, ctx.petSex)} size eats.`,
        ],
        cta: { label: 'Log the first meal', path: route },
      };

    case 'reassessment':
      return {
        subject: `${possessiveName(name)} plan is running on old numbers`,
        preheader: 'A weigh-in takes under a minute and re-tunes the target.',
        // The day count is dropped rather than filled with a vague stand-in
        // when it is unknown: "a weight from some weeks days ago" is the kind
        // of seam that makes an email look generated.
        heading: ctx.daysSinceWeighIn
          ? `${possessiveName(name)} plan was built on a weight from ${ctx.daysSinceWeighIn} days ago`
          : `${possessiveName(name)} plan was built on an old weight`,
        body: [
          `Calorie targets are calculated from weight, so a stale weight quietly makes the whole plan less accurate. Nothing has gone wrong — this is just the point where it is worth checking.`,
          `A fresh weigh-in takes under a minute, and Pawtchi will re-tune ${possessivePronoun(name, ctx.petSex)} daily target against it.`,
        ],
        cta: { label: 'Log a weight', path: route },
      };

    case 'weekly_digest_email':
      return renderWeeklyDigest(name, ctx, route);

    case 'walk_report':
      return renderWalkReport(name, ctx, route);

    case 'open_question':
      return {
        subject: `Is ${name} still on the same food?`,
        preheader: 'One question, and it takes a tap to answer.',
        heading: `A quick question about ${name}`,
        body: [
          `It has been a few weeks since anything changed in ${possessivePronoun(name, ctx.petSex)} record. That is usually fine — but a new bag, a different portion or a vet visit would all change what ${possessivePronoun(name, ctx.petSex)} plan should say.`,
          `If something has moved, updating it keeps the plan honest. If nothing has, that is worth knowing too.`,
        ],
        cta: { label: 'Check what Pawtchi has', path: route },
      };

    // The only campaign that is about the app rather than the animal, so it
    // names neither. Body text is supplied by the sender, because the whole
    // point is that a person wrote it.
    case 'reply_fallback':
      return {
        subject: 'You have a reply waiting',
        preheader: 'Someone wrote back.',
        heading: 'You have a reply waiting',
        body: [
          'You wrote to us, and there is an answer waiting in the app.',
        ],
        cta: { label: 'Read the reply', path: route },
      };
  }
}

/**
 * The Reading — the assessment the owner has almost certainly never read.
 *
 * This is the highest-reach email Pawtchi can send and it needs no logging at
 * all: onboarding already produced an ideal weight, a healthy band, a body
 * condition and a calorie target for ~150 animals. Most owners saw those
 * numbers once, on a reveal screen, while still setting the app up.
 *
 * It answers the question every owner has and few can answer — *is my dog a
 * healthy weight* — about their specific animal. Everything here is a fact
 * Pawtchi already holds; nothing is invented, and any line whose data is
 * missing is dropped rather than guessed.
 */
function renderReading(
  name: string,
  ctx: EmailCopyContext,
  route: string,
): RenderedEmail {
  const their = possessivePronoun(name, ctx.petSex);
  const body: string[] = [];

  body.push(
    `You set ${name} up on Pawtchi a little while ago. Here is what those details actually add up to — it is worth two minutes, because the rest of the plan is built on it.`,
  );

  if (ctx.currentWeightKg && ctx.conditionLabel) {
    body.push(`At ${fmt1dp(ctx.currentWeightKg)} kg, ${name} ${ctx.conditionLabel}.`);
  }

  if (ctx.healthyBandLowKg && ctx.healthyBandHighKg) {
    const subject = describeDog(ctx);
    body.push(
      `A healthy weight for ${indefiniteArticle(subject)} ${subject} sits between ${fmt1dp(ctx.healthyBandLowKg)} and ${fmt1dp(ctx.healthyBandHighKg)} kg. That band, not a single number, is the target.`,
    );
  }

  if (ctx.calorieTarget) {
    body.push(
      `${possessiveName(name)} daily calorie target is ${ctx.calorieTarget} calories. That is the number every meal you log gets measured against.`,
    );
  }

  if (ctx.breedWatchOut) {
    body.push(ctx.breedWatchOut);
  }

  // The withheld fact. There is a week-by-week shape to the plan that does not
  // compress into an email, and saying so is the reason to open the app.
  body.push(
    `There is one more piece Pawtchi worked out that does not fit in an email: how ${their} target changes week by week as ${subjectPronoun(name, ctx.petSex)} gets closer to that band.`,
  );

  return {
    subject: `What we noticed about ${name}`,
    preheader: `${possessiveName(name)} healthy weight range, body condition and daily target.`,
    heading: `Here is what Pawtchi worked out about ${name}`,
    body,
    cta: { label: 'See the full plan', path: route },
  };
}

/**
 * The Sunday Read. Three numbers at most, one observation, one thing to do.
 *
 * Explicitly not a dashboard dump: the owner can open the app for that. The
 * value of a weekly email is that somebody looked at the week and had a view
 * about it, which is why `insight` is allowed to be null and the paragraph
 * simply disappears when the data supports no honest claim.
 */
function renderWeeklyDigest(
  name: string,
  ctx: EmailCopyContext,
  route: string,
): RenderedEmail | null {
  const days = ctx.daysLogged ?? 0;
  const walks = ctx.walksLogged ?? 0;
  const body: string[] = [];

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} ${days === 1 ? 'day' : 'days'} logged`);
  if (walks > 0) parts.push(`${walks} ${walks === 1 ? 'walk' : 'walks'}`);
  // The candidate query already guarantees at least one of these, but a recap
  // of a week containing nothing would read as " this week." and is worse than
  // sending nothing at all. renderEmail returns null and the owner is skipped.
  if (parts.length === 0) return null;
  body.push(`${parts.join(' and ')} this week.`);

  if (ctx.insight) body.push(ctx.insight);

  return {
    subject: `${possessiveName(name)} week`,
    preheader: ctx.insight ?? `${days} days logged and ${walks} walks.`,
    heading: `${possessiveName(name)} week`,
    body,
    cta: { label: 'See the week', path: route },
  };
}

/**
 * The monthly walk report. The one email that tells an owner something their
 * own eyes could not have collected — they were on every one of these walks,
 * so distance and duration alone are not news. Sniff stops, repeated routes and
 * new ground are.
 *
 * Monthly rather than weekly on purpose: a month is long enough that the shape
 * of it is genuinely unfamiliar, and rare enough that it stays an event.
 */
function renderWalkReport(
  name: string,
  ctx: EmailCopyContext,
  route: string,
): RenderedEmail {
  const body: string[] = [];
  const month = ctx.monthLabel ?? 'last month';

  body.push(
    `${name} went out ${ctx.walkCount ?? 0} times in ${month}, covering ${fmt1dp(ctx.totalKm ?? 0)} km between you.`,
  );

  if (ctx.longestKm) {
    body.push(`The longest single walk was ${fmt1dp(ctx.longestKm)} km.`);
  }

  if (ctx.sniffStops) {
    body.push(
      `${subjectPronoun(name, ctx.petSex) === name ? name : capitalise(subjectPronoun(name, ctx.petSex))} stopped to sniff ${ctx.sniffStops} times. Those stops are not wasted time — scent is most of how a dog reads a place.`,
    );
  }

  // Withheld: which route, and where the stops clustered. Both are on the map.
  if (ctx.favouritePlace) {
    body.push(
      `One route came up more than any other this month. The map shows where it goes, and where ${subjectPronoun(name, ctx.petSex)} kept stopping along it.`,
    );
  }

  return {
    subject: `${name} covered ${fmt1dp(ctx.totalKm ?? 0)} km in ${month}`,
    preheader: `${ctx.walkCount ?? 0} walks, and one route ${subjectPronoun(name, ctx.petSex)} kept going back to.`,
    heading: `${possessiveName(name)} ${month}`,
    body,
    cta: { label: 'See the month', path: route },
  };
}

/** "six-year-old labrador", or the parts of it we actually know. */
function describeDog(ctx: EmailCopyContext): string {
  const breed = (ctx.breed ?? '').trim().toLowerCase();
  const stage = (ctx.lifeStageLabel ?? '').trim().toLowerCase();
  if (stage && breed) return `${stage} ${breed}`;
  if (breed) return breed;
  if (stage) return `${stage} dog`;
  return 'dog this size';
}

/**
 * "an adult beagle", not "a adult beagle".
 *
 * The phrase is assembled from breed and life stage, both owner-supplied, so
 * the article cannot be hardcoded. Vowel-letter matching is wrong for a handful
 * of English words but right for every value this actually sees: the stages are
 * puppy/kitten/adult/senior, and a breed only leads when the stage is missing.
 */
function indefiniteArticle(phrase: string): string {
  return /^[aeiou]/i.test(phrase.trim()) ? 'an' : 'a';
}

/** One decimal, but never a trailing ".0" — "12 kg", not "12.0 kg". */
function fmt1dp(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export const ALL_EMAIL_CAMPAIGNS: readonly EmailCampaignKey[] = [
  'reading',
  'first_log',
  'reassessment',
  'weekly_digest_email',
  'walk_report',
  'open_question',
  'reply_fallback',
];

/**
 * Campaigns that read correctly without a pet record. Only the transactional
 * one: naming an animal in "you have a reply waiting" would be a non-sequitur,
 * and the person may not have a pet at all.
 */
export const EMAIL_CAMPAIGNS_WITHOUT_PET: readonly EmailCampaignKey[] = [
  'reply_fallback',
];
