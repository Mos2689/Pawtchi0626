/**
 * Segments — which lane an unread item counts toward.
 *
 * The bell has always been able to say "you have 6 things". This splits that
 * into "what kind of 6", so the entry point can distinguish a founder writing
 * back from a weigh-in falling due without opening anything.
 *
 * The lanes are the app's own domains — the same ones the tabs and the inbox
 * already speak in — and they deliberately reuse the glyphs from
 * ./catalogue rather than introducing a second icon vocabulary for the same
 * events. A weigh-in reminder is `monitor-weight` in the inbox; it is
 * `monitor-weight` in the pill.
 *
 * At most three render at once (see MAX_VISIBLE_LANES); the pill is an
 * announcement, not a report.
 *
 * Kept import-light for the same reason as ./types — the engine, the store, the
 * bell and the screen all pull this in.
 */

import type { CampaignKey } from '../notifications/copy';
import { CAMPAIGN_ICON } from './catalogue';
import type { InboxItem } from './types';

/**
 * `replies` is the only lane with a *person* on the other end, and it leads the
 * order for that reason. It stays small on purpose: file an automated campaign
 * here and the lane stops meaning "somebody wrote to you" and becomes another
 * word for "unread".
 */
export type InboxSegment = 'replies' | 'health' | 'meal' | 'activity' | 'wins';

/**
 * Priority order. When more lanes are occupied than the pill can draw, the ones
 * later in this list are the ones dropped — so a human reply is never the thing
 * that gets cut for a weekly recap.
 */
export const SEGMENT_ORDER: readonly InboxSegment[] = [
  'replies',
  'health',
  'meal',
  'activity',
  'wins',
] as const;

/**
 * Glyph per lane, taken from the campaign that most defines it so the pill and
 * the inbox row for the same event never disagree.
 */
export const SEGMENT_ICON: Record<InboxSegment, string> = {
  replies: CAMPAIGN_ICON.support_reply,
  health: CAMPAIGN_ICON.weigh_in_due,
  meal: CAMPAIGN_ICON.meal_window,
  activity: CAMPAIGN_ICON.walk_insight,
  wins: CAMPAIGN_ICON.milestone,
};

/** Spoken by screen readers — the pill itself is glyphs and digits only. */
export const SEGMENT_LABEL: Record<InboxSegment, string> = {
  replies: 'replies',
  health: 'health',
  meal: 'meals',
  activity: 'activity',
  wins: 'wins',
};

/**
 * Lane per push campaign. Exhaustive by construction, like CAMPAIGN_TONE in
 * ./catalogue — a new campaign key will not compile until it is filed.
 *
 * The re-engagement campaigns (`streak_risk`, `winback_*`) get no lane of their
 * own. A winback is already spent by the time the owner is reading this pill —
 * they came back — and a lane counting "we tried to get you here" would be
 * measuring us, not telling them anything.
 */
const CAMPAIGN_SEGMENT: Record<CampaignKey, InboxSegment> = {
  onboarding_incomplete: 'health',
  first_log_prompt: 'meal',
  meal_window: 'meal',
  weigh_in_due: 'health',
  plan_drift: 'health',
  milestone: 'wins',
  walksign_confirmed: 'wins',
  vet_checkin: 'health',
  weekly_recap: 'wins',
  streak_risk: 'activity',
  winback_7d: 'health',
  winback_30d: 'health',
  founder_reply: 'replies',
  support_reply: 'replies',
  walk_insight: 'activity',
};

/**
 * Lane by destination, for items with no campaign key.
 *
 * Nudges, banner rules and runtime items never carry one, but they do carry the
 * route they open — and where an item sends you is the most honest available
 * statement of what it is about. Longest prefix first.
 */
const ROUTE_SEGMENT: readonly [string, InboxSegment][] = [
  ['/(tabs)/meal', 'meal'],
  ['/(tabs)/health', 'health'],
  ['/(tabs)/activity', 'activity'],
  ['/walk', 'activity'],
  ['/support', 'replies'],
  ['/letter', 'replies'],
  ['/ask', 'health'],
  ['/achievements', 'wins'],
];

/**
 * The lane an item belongs to.
 *
 * Three fallbacks, narrowest first: the campaign key a push carries, then the
 * route anything else opens, then tone — a celebration is a win and everything
 * left is care, which is what `health` means when nothing more specific is
 * known.
 */
export function segmentForItem(item: InboxItem): InboxSegment {
  const key = item.meta?.campaign_key;
  if (typeof key === 'string' && key in CAMPAIGN_SEGMENT) {
    return CAMPAIGN_SEGMENT[key as CampaignKey];
  }

  if (item.route) {
    for (const [prefix, segment] of ROUTE_SEGMENT) {
      if (item.route.startsWith(prefix)) return segment;
    }
  }

  return item.tone === 'celebration' ? 'wins' : 'health';
}

export type SegmentCounts = Record<InboxSegment, number>;

export const EMPTY_SEGMENT_COUNTS: SegmentCounts = Object.freeze({
  replies: 0,
  health: 0,
  meal: 0,
  activity: 0,
  wins: 0,
});

/** How many lanes actually have something in them. */
export function occupiedSegments(counts: SegmentCounts): number {
  return SEGMENT_ORDER.reduce((n, key) => (counts[key] > 0 ? n + 1 : n), 0);
}

/** Never more than three at once, however many lanes are occupied. */
export const MAX_VISIBLE_LANES = 3;

/** The lanes the pill draws, in priority order — the human one first. */
export function visibleLanes(counts: SegmentCounts): InboxSegment[] {
  return SEGMENT_ORDER.filter(key => counts[key] > 0).slice(0, MAX_VISIBLE_LANES);
}

/**
 * Every occupied lane as one spoken phrase, e.g. "2 replies, 3 health".
 *
 * Deliberately NOT capped at MAX_VISIBLE_LANES: a screen reader has no width
 * limit, so there is no reason to hand it the abbreviated version the pill is
 * forced into.
 */
export function describeSegments(counts: SegmentCounts): string {
  return SEGMENT_ORDER.filter(key => counts[key] > 0)
    .map(key => `${counts[key]} ${SEGMENT_LABEL[key]}`)
    .join(', ');
}
