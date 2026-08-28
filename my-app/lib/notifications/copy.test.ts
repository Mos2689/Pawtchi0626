import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ALL_CAMPAIGNS,
  ALL_WALK_INSIGHT_KINDS,
  CAMPAIGNS_WITHOUT_PET,
  CAMPAIGN_CATEGORY,
  objectPronoun,
  possessiveName,
  possessivePronoun,
  renderCopy,
  subjectPronoun,
  type CampaignKey,
  type CopyContext,
  type WalkInsightKind,
} from './copy';
import { INSIGHT_THRESHOLDS, NOVELTY_WINDOW, selectWalkInsight } from './walkInsights';
// CommonJS on purpose: scripts/ is plain Node so the sync script can run via
// `node scripts/sync-notification-shared.js` in CI without a TS toolchain.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { toDenoSource, MIRRORED_FILES, APP_DIR, EDGE_DIR } = require('../../scripts/sync-notification-shared.js');

// Words banned by the Pawtchi Copy Spec v1 (brand book § 6.04) — same list
// momentCard.test.ts and referral.test.ts enforce.
const BANNED_WORDS = [
  'immediately',
  'urgent',
  'ensure',
  'incredible',
  'amazing',
  'superstar',
  'alert',
  "don't forget",
  'ai-powered',
];

// Proper nouns that may legitimately carry a capital mid-sentence.
const PROPER_NOUNS = new Set(['Pawtchi', 'Walksign', 'Milo', 'Bella']);

const EMOJI =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u;

/** The last sentence must land on something the owner can do. */
const ACTION_VERBS = [
  'log',
  'open',
  'add',
  'check',
  'tap',
  'weigh',
  'share',
  'see',
  'start',
  'keep',
  'pick',
];

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function assertBrandVoice(text: string, label: string) {
  // Immutable rule: no exclamation marks, anywhere, including celebrations.
  expect(`${label}: ${text}`).not.toContain('!');
  expect(EMOJI.test(text)).toBe(false);

  const lower = text.toLowerCase();
  expect(lower).not.toContain('your pet');
  expect(lower).not.toContain('your dog');
  expect(lower).not.toContain('your cat');
  for (const word of BANNED_WORDS) {
    expect(lower).not.toContain(word);
  }

  // Never a plural pronoun for a known individual animal.
  expect(lower).not.toMatch(/\btheir\b/);
  expect(lower).not.toMatch(/\bthem\b/);
  expect(lower).not.toMatch(/\bthey\b/);

  // Sentence case: no ALL CAPS words, and no mid-sentence capitals beyond
  // proper nouns. This is what catches Title Case creeping back in.
  for (const word of text.split(/\s+/)) {
    const bare = word.replace(/[^A-Za-z']/g, '');
    if (bare.length > 1) {
      expect(bare).not.toBe(bare.toUpperCase());
    }
  }
  for (const sentence of sentences(text)) {
    const words = sentence.split(/\s+/).slice(1);
    for (const word of words) {
      // Strip punctuation, then the possessive, so "Milo's" checks as "Milo".
      const bare = word.replace(/[^A-Za-z']/g, '').replace(/'s?$/, '');
      if (!bare || !/^[A-Z]/.test(bare)) continue;
      expect({ sentence, word, known: PROPER_NOUNS.has(bare) }).toMatchObject({ known: true });
    }
  }

  // Three sentences max.
  expect(sentences(text).length).toBeLessThanOrEqual(3);
}

const CONTEXTS: Record<CampaignKey, CopyContext> = {
  onboarding_incomplete: {},
  first_log_prompt: { petName: 'Milo', petSex: 'male' },
  meal_window: { petName: 'Milo', petSex: 'male', minutes: 10, mealLabel: 'Dinner' },
  weigh_in_due: { petName: 'Milo', petSex: 'male', days: 16 },
  plan_drift: { petName: 'Milo', petSex: 'male' },
  milestone: { petName: 'Milo', petSex: 'male', weightKg: 12.4 },
  walksign_confirmed: { petName: 'Milo', petSex: 'male' },
  vet_checkin: { petName: 'Milo', petSex: 'male', reason: 'on the limp you asked about' },
  weekly_recap: { petName: 'Milo', petSex: 'male', mealsLogged: 7, walksLogged: 2 },
  streak_risk: { petName: 'Milo', petSex: 'male', streakDays: 4 },
  winback_7d: { petName: 'Milo', petSex: 'male' },
  winback_30d: { petName: 'Milo', petSex: 'male' },
  // Deliberately empty: this campaign is about the app, not the animal, and
  // renders without touching the pet context at all.
  founder_reply: {},
  // Same — a support answer names no animal. See CAMPAIGNS_WITHOUT_PET.
  support_reply: {},
  // One representative variant. Every kind is covered separately below, because
  // a single context would leave five of the six strings untested.
  walk_insight: { petName: 'Milo', petSex: 'male', insightKind: 'sniff_count', sniffCount: 9 },
};

describe('Copy Spec v1 compliance', () => {
  test.each(ALL_CAMPAIGNS)('%s satisfies the brand voice', (campaign) => {
    const { title, body } = renderCopy(campaign, CONTEXTS[campaign]);
    assertBrandVoice(title, `${campaign}.title`);
    assertBrandVoice(body, `${campaign}.body`);
    expect(title.length).toBeGreaterThan(0);
    expect(body.length).toBeGreaterThan(0);
  });

  test.each(ALL_CAMPAIGNS)('%s ends on an action, not a feeling', (campaign) => {
    const { body } = renderCopy(campaign, CONTEXTS[campaign]);
    const last = sentences(body).pop() ?? '';
    // Stem match so "keeps"/"logging" count the same as "keep"/"log".
    const hasAction = ACTION_VERBS.some((verb) =>
      new RegExp(`\\b${verb}(s|ed|ing)?\\b`, 'i').test(last),
    );
    expect({ campaign, last, hasAction }).toMatchObject({ hasAction: true });
  });

  test.each(ALL_CAMPAIGNS)('%s names the animal unless it predates the pet', (campaign) => {
    const rendered = renderCopy(campaign, CONTEXTS[campaign]);
    const combined = `${rendered.title} ${rendered.body}`;
    if (CAMPAIGNS_WITHOUT_PET.includes(campaign)) return;
    expect(combined).toContain('Milo');
  });

  test('every campaign maps to a preference category', () => {
    for (const campaign of ALL_CAMPAIGNS) {
      expect(CAMPAIGN_CATEGORY[campaign]).toBeTruthy();
    }
  });

  test('a female animal reads with her pronouns', () => {
    const { body } = renderCopy('weigh_in_due', {
      petName: 'Bella',
      petSex: 'female',
      days: 16,
    });
    expect(body).toContain('her plan');
    assertBrandVoice(body, 'weigh_in_due.female');
  });

  test('unknown sex repeats the name rather than reaching for "their"', () => {
    const { body } = renderCopy('weigh_in_due', { petName: 'Milo', petSex: null, days: 16 });
    expect(body).toContain("Milo's plan");
    assertBrandVoice(body, 'weigh_in_due.unknown');
  });

  test('a name ending in s takes a bare possessive', () => {
    expect(possessiveName('Gus')).toBe("Gus'");
    expect(possessiveName('Milo')).toBe("Milo's");
  });
});

// walk_insight renders six different strings off one campaign key, so the
// per-campaign tests above only ever exercise one of them. Each kind gets the
// full brand-voice treatment here.
const INSIGHT_CONTEXTS: Record<WalkInsightKind, CopyContext> = {
  long_pause: { petName: 'Milo', petSex: 'male', insightKind: 'long_pause', pauseMinutes: 4 },
  new_ground: { petName: 'Milo', petSex: 'male', insightKind: 'new_ground' },
  sniff_count: { petName: 'Milo', petSex: 'male', insightKind: 'sniff_count', sniffCount: 9 },
  longest_recent: { petName: 'Milo', petSex: 'male', insightKind: 'longest_recent', days: 21 },
  duration_trend: { petName: 'Milo', petSex: 'male', insightKind: 'duration_trend', trendWeeks: 3 },
  familiar_route: { petName: 'Milo', petSex: 'male', insightKind: 'familiar_route', repeatCount: 3 },
};

describe('walk insight copy', () => {
  test.each(ALL_WALK_INSIGHT_KINDS)('%s satisfies the brand voice', (kind) => {
    const { title, body } = renderCopy('walk_insight', INSIGHT_CONTEXTS[kind]);
    assertBrandVoice(title, `walk_insight.${kind}.title`);
    assertBrandVoice(body, `walk_insight.${kind}.body`);
  });

  test.each(ALL_WALK_INSIGHT_KINDS)('%s ends on an action', (kind) => {
    const { body } = renderCopy('walk_insight', INSIGHT_CONTEXTS[kind]);
    const last = sentences(body).pop() ?? '';
    const hasAction = ACTION_VERBS.some((verb) =>
      new RegExp(`\\b${verb}(s|ed|ing)?\\b`, 'i').test(last),
    );
    expect({ kind, last, hasAction }).toMatchObject({ hasAction: true });
  });

  test.each(ALL_WALK_INSIGHT_KINDS)('%s names the animal', (kind) => {
    const { title, body } = renderCopy('walk_insight', INSIGHT_CONTEXTS[kind]);
    expect(`${title} ${body}`).toContain('Milo');
  });

  // The location is the payoff. Putting it in the tray spends it, so every
  // variant has to promise it rather than deliver it.
  test.each(ALL_WALK_INSIGHT_KINDS)('%s drives into the app rather than resolving', (kind) => {
    const { body } = renderCopy('walk_insight', INSIGHT_CONTEXTS[kind]);
    expect(body.toLowerCase()).toContain('open the');
  });

  test('every kind renders a distinct string', () => {
    const rendered = ALL_WALK_INSIGHT_KINDS.map((kind) => {
      const { title, body } = renderCopy('walk_insight', INSIGHT_CONTEXTS[kind]);
      return `${title}|${body}`;
    });
    expect(new Set(rendered).size).toBe(ALL_WALK_INSIGHT_KINDS.length);
  });
});

// The behaviour that keeps this from becoming nudge_water, which fired on a
// condition true for nearly everyone nearly every day.
describe('walk insight selection', () => {
  const ordinary = {
    sniffCount: 1,
    longestPauseSeconds: 20,
    newStreetCount: 0,
    daysSinceLongerWalk: null,
    risingWeeks: 0,
    routeRepeatsThisWeek: 1,
    recentKinds: [],
  };

  test('an unremarkable walk earns no notification', () => {
    expect(selectWalkInsight(ordinary)).toBeNull();
  });

  test('thresholds are exclusive at the boundary', () => {
    expect(
      selectWalkInsight({ ...ordinary, sniffCount: INSIGHT_THRESHOLDS.sniffCount - 1 }),
    ).toBeNull();
    expect(
      selectWalkInsight({ ...ordinary, sniffCount: INSIGHT_THRESHOLDS.sniffCount })?.kind,
    ).toBe('sniff_count');
  });

  test('the novelty guard blocks a kind sent recently', () => {
    const input = { ...ordinary, sniffCount: 9 };
    expect(selectWalkInsight(input)?.kind).toBe('sniff_count');
    expect(selectWalkInsight({ ...input, recentKinds: ['sniff_count'] })).toBeNull();
  });

  test('the novelty guard only looks back NOVELTY_WINDOW sends', () => {
    const stale: WalkInsightKind[] = [
      'new_ground',
      'long_pause',
      'duration_trend',
      'sniff_count', // older than the window, so eligible again
    ];
    expect(stale.length).toBeGreaterThan(NOVELTY_WINDOW);
    expect(selectWalkInsight({ ...ordinary, sniffCount: 9, recentKinds: stale })?.kind).toBe(
      'sniff_count',
    );
  });

  test('a more interesting observation outranks a lesser one', () => {
    const rich = { ...ordinary, sniffCount: 9, longestPauseSeconds: 300, newStreetCount: 2 };
    expect(selectWalkInsight(rich)?.kind).toBe('long_pause');
    expect(selectWalkInsight({ ...rich, recentKinds: ['long_pause'] })?.kind).toBe('new_ground');
  });

  test('pause minutes floor rather than round up', () => {
    // 2m31s must not be reported as three minutes.
    const match = selectWalkInsight({ ...ordinary, longestPauseSeconds: 151 });
    expect(match).toMatchObject({ kind: 'long_pause', pauseMinutes: 2 });
  });

  test('unknown walk history never becomes a "longest in N days" claim', () => {
    expect(selectWalkInsight({ ...ordinary, daysSinceLongerWalk: null })).toBeNull();
  });
});

describe('pronouns', () => {
  test('map from the animal sex', () => {
    expect(subjectPronoun('Milo', 'male')).toBe('he');
    expect(subjectPronoun('Bella', 'female')).toBe('she');
    expect(possessivePronoun('Milo', 'male')).toBe('his');
    expect(possessivePronoun('Bella', 'female')).toBe('her');
    expect(objectPronoun('Milo', 'male')).toBe('him');
  });

  test('fall back to the name when sex is unknown', () => {
    expect(subjectPronoun('Milo', null)).toBe('Milo');
    expect(possessivePronoun('Milo', undefined)).toBe("Milo's");
    expect(objectPronoun('Milo', null)).toBe('Milo');
  });
});

// Root cause D of the August 2026 audit: the live dispatcher was a fork of the
// app's rule engine that lived only in the Supabase dashboard. It drifted until
// it was pushing a developer test string to real owners. This test makes that
// class of drift impossible — the Deno mirror must be exactly what the sync
// script would write.
describe('Deno mirror', () => {
  test.each(MIRRORED_FILES as string[])('_shared/notifications/%s is in sync', (file) => {
    const expected = toDenoSource(readFileSync(join(APP_DIR, file), 'utf8'));
    const actual = readFileSync(join(EDGE_DIR, file), 'utf8');
    expect(actual).toBe(expected);
  });
});
