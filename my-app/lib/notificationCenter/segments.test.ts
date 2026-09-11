import {
  describeSegments,
  EMPTY_SEGMENT_COUNTS,
  MAX_VISIBLE_LANES,
  occupiedSegments,
  segmentForItem,
  SEGMENT_ICON,
  SEGMENT_ORDER,
  visibleLanes,
  type SegmentCounts,
} from './segments';
import { CAMPAIGN_ICON } from './catalogue';
import type { InboxItem } from './types';

function item(over: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'x',
    source: 'push',
    tone: 'info',
    title: 't',
    body: 'b',
    icon: 'i',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function counts(over: Partial<SegmentCounts> = {}): SegmentCounts {
  return { ...EMPTY_SEGMENT_COUNTS, ...over };
}

describe('segmentForItem — by campaign key', () => {
  it('files replies under replies — a person wrote back', () => {
    expect(segmentForItem(item({ meta: { campaign_key: 'founder_reply' } }))).toBe('replies');
    expect(segmentForItem(item({ meta: { campaign_key: 'support_reply' } }))).toBe('replies');
  });

  it('files each care campaign under the domain it is actually about', () => {
    expect(segmentForItem(item({ meta: { campaign_key: 'weigh_in_due' } }))).toBe('health');
    expect(segmentForItem(item({ meta: { campaign_key: 'vet_checkin' } }))).toBe('health');
    expect(segmentForItem(item({ meta: { campaign_key: 'meal_window' } }))).toBe('meal');
    expect(segmentForItem(item({ meta: { campaign_key: 'first_log_prompt' } }))).toBe('meal');
    expect(segmentForItem(item({ meta: { campaign_key: 'walk_insight' } }))).toBe('activity');
  });

  it('files earned things under wins', () => {
    expect(segmentForItem(item({ meta: { campaign_key: 'milestone' } }))).toBe('wins');
    expect(segmentForItem(item({ meta: { campaign_key: 'walksign_confirmed' } }))).toBe('wins');
    expect(segmentForItem(item({ meta: { campaign_key: 'weekly_recap' } }))).toBe('wins');
  });

  it('does not give re-engagement pushes a lane of their own', () => {
    // A winback is spent by the time the owner is reading this pill.
    expect(segmentForItem(item({ meta: { campaign_key: 'winback_7d' } }))).toBe('health');
    expect(segmentForItem(item({ meta: { campaign_key: 'streak_risk' } }))).toBe('activity');
  });
});

describe('segmentForItem — by route, for items with no campaign', () => {
  it('reads a nudge or banner from where it sends you', () => {
    expect(segmentForItem(item({ source: 'nudge', route: '/(tabs)/meal' }))).toBe('meal');
    expect(segmentForItem(item({ source: 'banner', route: '/(tabs)/health' }))).toBe('health');
    expect(segmentForItem(item({ source: 'nudge', route: '/(tabs)/activity' }))).toBe('activity');
    expect(segmentForItem(item({ source: 'runtime', route: '/support/abc' }))).toBe('replies');
    expect(segmentForItem(item({ source: 'push', route: '/letter/abc' }))).toBe('replies');
    expect(segmentForItem(item({ source: 'nudge', route: '/ask?case=1' }))).toBe('health');
  });

  it('prefers the campaign key over the route when both are present', () => {
    const it_ = item({ route: '/(tabs)/meal', meta: { campaign_key: 'founder_reply' } });
    expect(segmentForItem(it_)).toBe('replies');
  });
});

describe('segmentForItem — tone fallback', () => {
  it('treats a celebration with no route as a win', () => {
    expect(segmentForItem(item({ source: 'runtime', tone: 'celebration' }))).toBe('wins');
  });

  it('treats anything else with no route as care', () => {
    expect(segmentForItem(item({ source: 'banner', tone: 'clinical' }))).toBe('health');
    expect(segmentForItem(item({ source: 'nudge', tone: 'action' }))).toBe('health');
  });

  it('ignores an unrecognised campaign key rather than inventing a lane', () => {
    expect(segmentForItem(item({ tone: 'celebration', meta: { campaign_key: 'nope' } }))).toBe(
      'wins',
    );
  });
});

describe('visibleLanes', () => {
  it('never draws more than three, however many are occupied', () => {
    const all = counts({ replies: 1, health: 2, meal: 3, activity: 4, wins: 5 });
    expect(visibleLanes(all)).toHaveLength(MAX_VISIBLE_LANES);
    expect(visibleLanes(all)).toEqual(['replies', 'health', 'meal']);
  });

  it('keeps the human lane when it has to drop some', () => {
    const all = counts({ replies: 1, health: 9, meal: 9, activity: 9, wins: 9 });
    expect(visibleLanes(all)[0]).toBe('replies');
  });

  it('skips empty lanes rather than drawing a zero', () => {
    expect(visibleLanes(counts({ meal: 3, wins: 1 }))).toEqual(['meal', 'wins']);
    expect(visibleLanes(EMPTY_SEGMENT_COUNTS)).toEqual([]);
  });
});

describe('describeSegments', () => {
  it('speaks every lane, including ones the pill had to drop', () => {
    // The pill draws three; a screen reader has no width limit and gets all five.
    expect(describeSegments(counts({ replies: 1, health: 2, meal: 3, activity: 4, wins: 5 }))).toBe(
      '1 replies, 2 health, 3 meals, 4 activity, 5 wins',
    );
  });

  it('omits empty lanes', () => {
    expect(describeSegments(counts({ meal: 1 }))).toBe('1 meals');
  });
});

describe('occupiedSegments', () => {
  it('counts only lanes with something in them', () => {
    expect(occupiedSegments(EMPTY_SEGMENT_COUNTS)).toBe(0);
    expect(occupiedSegments(counts({ health: 4 }))).toBe(1);
    expect(occupiedSegments(counts({ replies: 1, health: 4, wins: 2 }))).toBe(3);
  });
});

describe('icons', () => {
  it('reuses the inbox glyph vocabulary rather than a second set', () => {
    // The pill and the inbox row for the same event must not disagree.
    expect(SEGMENT_ICON.health).toBe(CAMPAIGN_ICON.weigh_in_due);
    expect(SEGMENT_ICON.meal).toBe(CAMPAIGN_ICON.meal_window);
    expect(SEGMENT_ICON.activity).toBe(CAMPAIGN_ICON.walk_insight);
    expect(SEGMENT_ICON.wins).toBe(CAMPAIGN_ICON.milestone);
    expect(SEGMENT_ICON.replies).toBe(CAMPAIGN_ICON.support_reply);
  });
});

describe('SEGMENT_ORDER', () => {
  it('leads with the lane a human is on the other end of', () => {
    expect(SEGMENT_ORDER[0]).toBe('replies');
  });

  it('covers every key of the counts record', () => {
    expect([...SEGMENT_ORDER].sort()).toEqual(Object.keys(EMPTY_SEGMENT_COUNTS).sort());
  });
});
