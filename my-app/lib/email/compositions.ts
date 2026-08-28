/**
 * Campaign compositions — which blocks each email is made of.
 *
 * This is the layer between the copy catalogue and the renderer. `copy.ts`
 * decides *what to say*, `template.ts` decides *how a block looks*, and this
 * decides *which blocks a campaign uses and in what order*. Keeping the third
 * thing separate is what lets the milestone and the health card be genuinely
 * different compositions without either of the other two files growing a
 * per-campaign branch.
 *
 * ── The rule every composition here obeys ───────────────────────────────────
 *
 * **A slot whose data is missing is dropped, never filled.** Every builder
 * takes already-computed values and omits the block when they are absent. The
 * retired weekly digest hardcoded `waterIntakeScore: 'Good'` and shipped that
 * to every owner for four months; a card full of confident numbers is worse
 * than a plain paragraph when one of the numbers is invented.
 *
 * That is also why there is no `rest` row in the health composition. The design
 * reference has one, and Pawtchi has no sleep data of any kind — not a thin
 * signal, no column at all. Weight took the slot instead, which 167 of 168 pets
 * actually have.
 */

import type { EmailBlock } from './template';
import type { EmailCampaignKey, RenderedEmail } from './copy';
import { EMAIL_CAMPAIGN_WEB_PATH } from './copy';

// ── Weekly summary ──────────────────────────────────────────────────────────

export interface WeeklySummaryData {
  petName: string;
  walks: number;
  walksDelta: number | null;
  distanceKm: number;
  distanceDeltaPct: number | null;
  totalMinutes: number;
  /** Real photo when the owner has uploaded one; the sender resolves the URL. */
  hasOwnPhoto: boolean;
  /** One derived observation, or null when the numbers support none. */
  insight: string | null;
}

export function weeklySummaryBlocks(d: WeeklySummaryData): EmailBlock[] {
  const blocks: EmailBlock[] = [
    { kind: 'hero', text: `Good week, ${d.petName}.` },
    { kind: 'text', text: 'Here is a look at your week together.' },
    {
      kind: 'photoStats',
      photo: {
        intent: 'pet',
        // Alt text describes the animal generically when the photo is a
        // default, because claiming it shows their dog would be a lie told
        // specifically to the people who cannot see it.
        alt: d.hasOwnPhoto ? `${d.petName}` : 'A dog and their owner outdoors',
      },
      stats: [
        {
          value: String(d.walks),
          label: d.walks === 1 ? 'Walk' : 'Walks',
          delta: deltaCount(d.walksDelta, 'vs last week'),
        },
        {
          value: oneDp(d.distanceKm),
          unit: 'km',
          label: 'Total distance',
          delta: deltaPct(d.distanceDeltaPct),
        },
        { value: hoursMinutes(d.totalMinutes), label: 'Total time' },
      ],
    },
  ];

  if (d.insight) blocks.push({ kind: 'quote', text: d.insight, attribution: 'Pawtchi' });
  blocks.push({ kind: 'cta', label: 'See full summary', url: '/app/home' });
  return blocks;
}

// ── Milestone ───────────────────────────────────────────────────────────────

export interface MilestoneData {
  petName: string;
  count: number;
  /** Facts that earned the milestone. Any that cannot be computed are omitted. */
  totalKm: number | null;
  distinctStreets: number | null;
  hasOwnPhoto: boolean;
}

/**
 * The screenshot piece. Deliberately the shortest composition in the set — a
 * number, a photograph, one sentence. The reference used a ring around the
 * numeral; that would have to be a hosted PNG because Gmail strips SVG, and a
 * 96px Georgia numeral is both more striking and survives image blocking.
 */
export function milestoneBlocks(d: MilestoneData): EmailBlock[] {
  const facts: string[] = [];
  if (d.totalKm !== null) facts.push(`${oneDp(d.totalKm)} kilometres`);
  if (d.distinctStreets !== null) facts.push(`${d.distinctStreets} different streets`);

  const blocks: EmailBlock[] = [
    { kind: 'bignum', value: String(d.count), caption: 'walks together' },
  ];

  if (facts.length > 0) {
    blocks.push({
      kind: 'text',
      text: `That is ${joinList(facts)}, and a great many more to come.`,
    });
  }

  blocks.push(
    { kind: 'photo', intent: 'pet', alt: d.hasOwnPhoto ? d.petName : 'A dog resting at home' },
    { kind: 'cta', label: `See ${d.petName}'s journey`, url: '/app/walks' },
  );
  return blocks;
}

// ── Health insight ──────────────────────────────────────────────────────────

export interface HealthRow {
  label: string;
  value: string;
  /** 0-100. The caller computes it; a row it cannot compute is not passed in. */
  pct: number;
  note?: string;
  icon?: 'activity' | 'nutrition' | 'hydration' | 'weight';
}

export interface HealthInsightData {
  petName: string;
  headline: string;
  rows: HealthRow[];
  tip: { title: string; text: string } | null;
}

/**
 * The health card. `rows` is whatever the caller could actually compute, in
 * order — there is no fixed set, and a pet with two measurable signals gets a
 * two-row card rather than four rows padded out with "Good".
 */
export function healthInsightBlocks(d: HealthInsightData): EmailBlock[] {
  const blocks: EmailBlock[] = [
    { kind: 'eyebrow', text: 'This week' },
    { kind: 'hero', text: d.headline },
  ];

  if (d.rows.length > 0) {
    blocks.push({ kind: 'bars', rows: d.rows });
  }

  if (d.tip) {
    blocks.push({ kind: 'note', title: d.tip.title, text: d.tip.text, icon: 'sun' });
  }

  blocks.push({ kind: 'cta', label: `See ${d.petName}'s health`, url: '/app/health' });
  return blocks;
}

// ── Reactivation ────────────────────────────────────────────────────────────

export interface ReactivationData {
  petName: string;
  daysQuiet: number;
}

/**
 * The 14-day nudge. Uses the overlapping photo card because this is the one
 * email whose job is emotional rather than informational — there is no data to
 * report, which is precisely why it is being sent.
 *
 * The photo intent is `mood`, not `pet`: this composition never claims the
 * image is their animal, so any default is safe here.
 */
export function reactivationBlocks(d: ReactivationData): EmailBlock[] {
  return [
    { kind: 'hero', text: 'Some stories are worth continuing.' },
    {
      kind: 'text',
      text: `It has been a few weeks since your last walk together. ${d.petName}'s next one is a tap away.`,
    },
    {
      kind: 'photoOverlay',
      intent: 'mood',
      alt: 'A person sitting beside their dog, looking out over water at sunset',
      lines: ['Same dog.', 'New moments waiting.'],
      cta: { label: 'Pick it back up', url: '/app/home' },
    },
  ];
}

// ── Walk report ─────────────────────────────────────────────────────────────

export interface WalkReportData {
  petName: string;
  petIsMale: boolean | null;
  monthLabel: string;
  walkCount: number;
  totalKm: number;
  longestKm: number | null;
  /** Null on all but a handful of walks — sniff_points exists on 7 rows total. */
  sniffStops: number | null;
  /** Only set when a start label recurred; one visit is not a favourite. */
  favouritePlace: string | null;
  hasOwnPhoto: boolean;
}

/**
 * The monthly walk report — the one email that tells an owner something their
 * own senses could not have collected. They were present for every one of these
 * walks, so distance alone is not news; the count of sniff stops and the route
 * they keep returning to are.
 *
 * Holds the location back on purpose. "One route came up more than any other"
 * names the payoff and stops, exactly as the post-walk push copy does — putting
 * the place name here would spend the only reason to open the app.
 */
export function walkReportBlocks(d: WalkReportData): EmailBlock[] {
  const she = d.petIsMale === null ? d.petName : d.petIsMale ? 'he' : 'she';

  const blocks: EmailBlock[] = [
    { kind: 'eyebrow', text: `${d.monthLabel} · walk report` },
    { kind: 'hero', text: `${d.petName} covered ${oneDp(d.totalKm)} km in ${d.monthLabel}.` },
    {
      kind: 'photoStats',
      photo: {
        intent: 'pet',
        alt: d.hasOwnPhoto ? d.petName : 'A dog and their owner outdoors',
      },
      stats: [
        { value: String(d.walkCount), label: 'Walks' },
        ...(d.longestKm !== null
          ? [{ value: oneDp(d.longestKm), unit: 'km', label: 'Longest walk' }]
          : []),
        ...(d.sniffStops !== null
          ? [{ value: String(d.sniffStops), label: 'Sniff stops' }]
          : []),
      ],
    },
  ];

  if (d.sniffStops !== null) {
    blocks.push({
      kind: 'text',
      text: `${d.petName} stopped to sniff ${d.sniffStops} times. Scent is most of how a dog reads a place — those stops are the walk, not an interruption to it.`,
    });
  }

  if (d.favouritePlace) {
    blocks.push({
      kind: 'text',
      text: `One route came up more than any other this month. The map shows where it goes, and where ${she} kept stopping along it.`,
    });
  }

  blocks.push({ kind: 'cta', label: 'See the month', url: '/app/walks' });
  return blocks;
}

// ── Reply fallback ──────────────────────────────────────────────────────────

export interface ReplyFallbackData {
  kind: 'founder' | 'support';
  body: string;
  entityId: string;
}

/**
 * The answer itself, in the email.
 *
 * Not a notification that a reply exists — the reply. Someone who wrote in and
 * waited should not have to open an app to discover what was said, and this
 * only fires because push already failed to reach them.
 *
 * The two senders are worded to sound like different people without either one
 * naming anyone, matching the push catalogue and the letter screens: the letter
 * quote carries no attribution at all (unsigned, same as the app), support's
 * carries "The Pawtchi team". Collapsing the two would make the letter read
 * like a routine support answer.
 */
export function replyFallbackBlocks(d: ReplyFallbackData): EmailBlock[] {
  const isLetter = d.kind === 'founder';
  return [
    { kind: 'hero', text: isLetter ? 'We wrote back.' : 'We replied to your request.' },
    { kind: 'quote', text: d.body, attribution: isLetter ? undefined : 'The Pawtchi team' },
    {
      kind: 'text',
      text: isLetter
        ? 'You can reply to this in the app, and we will read it.'
        : 'If this did not solve it, reply in the app and we will pick it back up.',
    },
    {
      kind: 'cta',
      label: isLetter ? 'Read and reply' : 'Open the request',
      url: `/app/${isLetter ? 'letters' : 'support'}/${d.entityId}`,
    },
  ];
}

// ── Bridge from the copy catalogue ──────────────────────────────────────────

/**
 * Turns a campaign into blocks.
 *
 * Two layers meet here. `copy.ts` owns the words and is what `copy.test.ts`
 * checks for brand voice; this file owns the arrangement. A campaign with a
 * bespoke composition above gets it, and everything else falls back to the
 * plain shape — headline, paragraphs, one call to action — built from the same
 * rendered copy.
 *
 * The fallback is deliberate rather than a stub. Not every email wants to be a
 * dashboard: the transactional reply and the day-zero assessment read better as
 * prose, and forcing a stat grid onto them would be decoration standing in for
 * information.
 */
export function blocksForCampaign(
  campaign: EmailCampaignKey,
  rendered: RenderedEmail,
  data: { weekly?: WeeklySummaryData; reactivation?: ReactivationData } = {},
): EmailBlock[] {
  if (campaign === 'weekly_digest_email' && data.weekly) {
    return weeklySummaryBlocks(data.weekly);
  }
  if (campaign === 'open_question' && data.reactivation) {
    return reactivationBlocks(data.reactivation);
  }

  const blocks: EmailBlock[] = [{ kind: 'hero', text: rendered.heading }];
  for (const paragraph of rendered.body) blocks.push({ kind: 'text', text: paragraph });
  blocks.push({
    kind: 'cta',
    label: rendered.cta.label,
    // The web slug, not the in-app route: an email link has to be an https URL
    // the universal-link handler can invert. See EMAIL_CAMPAIGN_WEB_PATH.
    url: `/app/${EMAIL_CAMPAIGN_WEB_PATH[campaign]}`,
  });
  return blocks;
}

// ── Formatting ──────────────────────────────────────────────────────────────

/** One decimal, but never a trailing ".0" — "12 km", not "12.0 km". */
function oneDp(value: number): string {
  const r = Math.round(value * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function hoursMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * Deltas render only when there is a real prior period to compare against, and
 * only when the direction is genuinely up. A down arrow on a week somebody was
 * ill, or busy, is a reproach dressed as a statistic — the copy spec bans guilt
 * framing and this is where a stats block would smuggle it back in.
 */
function deltaCount(delta: number | null, suffix: string): string | undefined {
  if (delta === null || delta <= 0) return undefined;
  return `↑ ${delta} ${suffix}`;
}

function deltaPct(pct: number | null): string | undefined {
  if (pct === null || pct <= 0) return undefined;
  return `↑ ${Math.round(pct)}%`;
}

/** "a, b and c" — serial list without the Oxford comma, matching the copy spec. */
function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
