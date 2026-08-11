import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ALL_EMAIL_CAMPAIGNS,
  EMAIL_CAMPAIGNS_WITHOUT_PET,
  EMAIL_CAMPAIGN_CATEGORY,
  EMAIL_CAMPAIGN_ROUTE,
  renderEmail,
  type EmailCampaignKey,
  type EmailCopyContext,
} from './copy';
import {
  CROSS_CHANNEL_PAIRS,
  EMAIL_WEEKLY_CAP,
  NEVER_EMAIL,
  isEmailAllowed,
  isSuppressedByPush,
  selectEmailCampaign,
  type EmailPreferences,
  type EmailRuleInput,
} from './rules';
// CommonJS on purpose: scripts/ is plain Node so the sync script can run via
// `node scripts/sync-notification-shared.js` in CI without a TS toolchain.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { toDenoSource, MIRROR_GROUPS } = require('../../scripts/sync-notification-shared.js');

// Same list the push catalogue enforces (brand book § 6.04).
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

const PROPER_NOUNS = new Set(['Pawtchi', 'Walksign', 'Milo', 'Bella', 'Pra', 'Mos', 'July']);

const EMOJI =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The push spec's rules minus the three-sentence cap, which is a constraint of
 * the notification tray rather than of the brand. Everything else applies
 * identically — an email is not a licence to start shouting.
 */
function assertBrandVoice(text: string, label: string) {
  expect(`${label}: ${text}`).not.toContain('!');
  expect(EMOJI.test(text)).toBe(false);

  const lower = text.toLowerCase();
  expect(lower).not.toContain('your pet');
  expect(lower).not.toContain('your dog');
  expect(lower).not.toContain('your cat');
  for (const word of BANNED_WORDS) {
    expect(`${label}: ${lower}`).not.toContain(word);
  }

  // Never a plural pronoun for a known individual animal.
  expect(lower).not.toMatch(/\btheir\b/);
  expect(lower).not.toMatch(/\bthem\b/);
  expect(lower).not.toMatch(/\bthey\b/);

  for (const word of text.split(/\s+/)) {
    const bare = word.replace(/[^A-Za-z']/g, '');
    if (bare.length > 1) {
      expect(`${label}: ${bare}`).not.toBe(bare.toUpperCase());
    }
  }
  for (const sentence of sentences(text)) {
    const words = sentence.split(/\s+/).slice(1);
    for (const word of words) {
      const bare = word.replace(/[^A-Za-z']/g, '').replace(/'s?$/, '');
      if (!bare || !/^[A-Z]/.test(bare)) continue;
      expect({ label, sentence, word, known: PROPER_NOUNS.has(bare) }).toMatchObject({
        known: true,
      });
    }
  }
}

const CONTEXTS: Record<EmailCampaignKey, EmailCopyContext> = {
  reading: {
    petName: 'Milo',
    petSex: 'male',
    currentWeightKg: 14.2,
    healthyBandLowKg: 11,
    healthyBandHighKg: 13.5,
    conditionLabel: 'looks a bit over ideal',
    calorieTarget: 780,
    breed: 'beagle',
    lifeStageLabel: 'adult',
  },
  first_log: { petName: 'Milo', petSex: 'male' },
  reassessment: { petName: 'Milo', petSex: 'male', daysSinceWeighIn: 34 },
  weekly_digest_email: {
    petName: 'Milo',
    petSex: 'male',
    daysLogged: 4,
    walksLogged: 3,
    insight: 'Intake came in around 92% of his weekly target, which is close enough to hold.',
  },
  walk_report: {
    petName: 'Milo',
    petSex: 'male',
    monthLabel: 'July',
    totalKm: 23.4,
    walkCount: 17,
    longestKm: 4.2,
    sniffStops: 61,
    favouritePlace: 'Enmore Park',
  },
  open_question: { petName: 'Milo', petSex: 'male', daysQuiet: 16 },
  // Deliberately empty: this campaign is about the app, not the animal.
  reply_fallback: {},
};

describe('Copy Spec v1 compliance', () => {
  test.each(ALL_EMAIL_CAMPAIGNS)('%s satisfies the brand voice', (campaign) => {
    const rendered = renderEmail(campaign, CONTEXTS[campaign]);
    expect(rendered).not.toBeNull();
    if (!rendered) return;

    assertBrandVoice(rendered.subject, `${campaign}.subject`);
    assertBrandVoice(rendered.preheader, `${campaign}.preheader`);
    assertBrandVoice(rendered.heading, `${campaign}.heading`);
    rendered.body.forEach((para, i) => assertBrandVoice(para, `${campaign}.body[${i}]`));
    assertBrandVoice(rendered.cta.label, `${campaign}.cta`);
  });

  test.each(ALL_EMAIL_CAMPAIGNS)('%s names the animal unless it is transactional', (campaign) => {
    const rendered = renderEmail(campaign, CONTEXTS[campaign]);
    if (!rendered) throw new Error(`${campaign} rendered null`);
    if (EMAIL_CAMPAIGNS_WITHOUT_PET.includes(campaign)) return;
    const combined = `${rendered.subject} ${rendered.heading} ${rendered.body.join(' ')}`;
    expect(combined).toContain('Milo');
  });

  test.each(ALL_EMAIL_CAMPAIGNS)('%s has a subject, a body and a route', (campaign) => {
    const rendered = renderEmail(campaign, CONTEXTS[campaign]);
    if (!rendered) throw new Error(`${campaign} rendered null`);
    expect(rendered.subject.length).toBeGreaterThan(0);
    expect(rendered.body.length).toBeGreaterThan(0);
    expect(rendered.cta.path).toBe(EMAIL_CAMPAIGN_ROUTE[campaign]);
  });

  // The preheader is the second line every client shows. Repeating the subject
  // wastes the only other piece of pre-open real estate there is.
  test.each(ALL_EMAIL_CAMPAIGNS)('%s preheader does not repeat the subject', (campaign) => {
    const rendered = renderEmail(campaign, CONTEXTS[campaign]);
    if (!rendered) throw new Error(`${campaign} rendered null`);
    expect(rendered.preheader).not.toBe(rendered.subject);
  });

  test('every campaign maps to a preference category', () => {
    for (const campaign of ALL_EMAIL_CAMPAIGNS) {
      expect(EMAIL_CAMPAIGN_CATEGORY[campaign]).toBeTruthy();
    }
  });

  test('a female animal reads with her pronouns', () => {
    const rendered = renderEmail('reassessment', {
      petName: 'Bella',
      petSex: 'female',
      daysSinceWeighIn: 30,
    });
    expect(rendered?.body.join(' ')).toContain('her daily target');
  });

  test('unknown sex repeats the name rather than reaching for "their"', () => {
    const rendered = renderEmail('reassessment', { petName: 'Milo', petSex: null });
    expect(rendered?.body.join(' ')).toContain("Milo's daily target");
  });

  // A nameless email is worse than one that says "your pet".
  test('a campaign about an animal refuses to render without one', () => {
    expect(renderEmail('reading', { petName: '  ' })).toBeNull();
    expect(renderEmail('walk_report', {})).toBeNull();
  });

  test('the transactional campaign renders with no pet at all', () => {
    expect(renderEmail('reply_fallback', {})).not.toBeNull();
  });

  test('a week containing nothing renders nothing', () => {
    const rendered = renderEmail('weekly_digest_email', {
      petName: 'Milo',
      petSex: 'male',
      daysLogged: 0,
      walksLogged: 0,
    });
    expect(rendered).toBeNull();
  });

  test('whole numbers do not render a trailing decimal', () => {
    const rendered = renderEmail('walk_report', {
      ...CONTEXTS.walk_report,
      totalKm: 12,
    });
    expect(rendered?.subject).toContain('12 km');
    expect(rendered?.subject).not.toContain('12.0');
  });

  // The breed-and-stage phrase is assembled from owner-supplied values, so the
  // article in front of it cannot be hardcoded.
  test('the reading agrees its indefinite article', () => {
    const vowel = renderEmail('reading', {
      ...CONTEXTS.reading,
      lifeStageLabel: 'adult',
    });
    expect(vowel?.body.join(' ')).toContain('for an adult beagle');

    const consonant = renderEmail('reading', {
      ...CONTEXTS.reading,
      lifeStageLabel: 'senior',
    });
    expect(consonant?.body.join(' ')).toContain('for a senior beagle');

    // Breed leads when the stage is unknown, so it has to agree too.
    const breedOnly = renderEmail('reading', {
      ...CONTEXTS.reading,
      lifeStageLabel: null,
      breed: 'akita',
    });
    expect(breedOnly?.body.join(' ')).toContain('for an akita');
  });

  // The Reading is assembled from whatever onboarding actually captured. A
  // missing band or calorie target must drop its line, never print "null".
  test('the reading drops lines it has no data for', () => {
    const rendered = renderEmail('reading', { petName: 'Milo', petSex: 'male' });
    expect(rendered).not.toBeNull();
    const joined = rendered?.body.join(' ') ?? '';
    expect(joined).not.toContain('null');
    expect(joined).not.toContain('undefined');
    expect(joined).not.toContain('NaN');
  });
});

describe('email rules', () => {
  const base: EmailRuleInput = {
    localHour: 11,
    localWeekday: 3,
    hasPet: true,
    hoursSincePetCreated: 500,
    daysSinceSignup: 20,
    totalLogs: 5,
    daysSinceLastSession: 1,
    reassessmentDueDays: null,
    digestEligible: false,
    sentThisWeek: 0,
    alreadySent: [],
  };

  test('the weekly cap stops everything', () => {
    const input = { ...base, hoursSincePetCreated: 1, alreadySent: [] };
    expect(selectEmailCampaign(input, '2026-08-09')?.campaign).toBe('reading');
    expect(
      selectEmailCampaign({ ...input, sentThisWeek: EMAIL_WEEKLY_CAP }, '2026-08-09'),
    ).toBeNull();
  });

  test('the reading fires once, inside its window', () => {
    const input = { ...base, hoursSincePetCreated: 2 };
    expect(selectEmailCampaign(input, '2026-08-09')).toMatchObject({
      campaign: 'reading',
      window: 'once',
    });
    // Already sent — never again.
    expect(
      selectEmailCampaign({ ...input, alreadySent: ['reading'] }, '2026-08-09')?.campaign,
    ).not.toBe('reading');
  });

  // A backfill or an outage must not mail the whole existing user base a
  // "welcome" months after they signed up.
  test('the reading will not fire for an old account', () => {
    expect(
      selectEmailCampaign({ ...base, hoursSincePetCreated: 5000 }, '2026-08-09')?.campaign,
    ).not.toBe('reading');
  });

  test('the reading waits for the plan to compute', () => {
    expect(
      selectEmailCampaign({ ...base, hoursSincePetCreated: 0.1 }, '2026-08-09')?.campaign,
    ).not.toBe('reading');
  });

  test('activation fires exactly twice, with distinct windows', () => {
    const day2 = { ...base, totalLogs: 0, daysSinceSignup: 2, hoursSincePetCreated: 100 };
    const day5 = { ...day2, daysSinceSignup: 5, alreadySent: ['first_log' as const] };
    expect(selectEmailCampaign(day2, '2026-08-09')).toMatchObject({
      campaign: 'first_log',
      window: 'a',
    });
    expect(selectEmailCampaign(day5, '2026-08-09')).toMatchObject({
      campaign: 'first_log',
      window: 'b',
    });
    // Day 9 is past both windows.
    expect(
      selectEmailCampaign({ ...day5, daysSinceSignup: 9 }, '2026-08-09')?.campaign,
    ).not.toBe('first_log');
  });

  test('reassessment is daytime only', () => {
    const due = { ...base, reassessmentDueDays: 30 };
    expect(selectEmailCampaign({ ...due, localHour: 10 }, '2026-08-09')?.campaign).toBe(
      'reassessment',
    );
    expect(selectEmailCampaign({ ...due, localHour: 21 }, '2026-08-09')).toBeNull();
    expect(selectEmailCampaign({ ...due, localHour: 6 }, '2026-08-09')).toBeNull();
  });

  test('reassessment needs a full week of staleness', () => {
    expect(
      selectEmailCampaign({ ...base, reassessmentDueDays: 6, localHour: 10 }, '2026-08-09'),
    ).toBeNull();
    expect(
      selectEmailCampaign({ ...base, reassessmentDueDays: 7, localHour: 10 }, '2026-08-09')
        ?.campaign,
    ).toBe('reassessment');
  });

  test('the digest is Sunday evening in the owner local time', () => {
    const sunday = { ...base, digestEligible: true, localWeekday: 7, localHour: 18 };
    expect(selectEmailCampaign(sunday, '2026-08-09')).toMatchObject({
      campaign: 'weekly_digest_email',
      window: '2026-W32',
    });
    // Same instant, wrong local hour — the old cron sent this at 04:00 local.
    expect(selectEmailCampaign({ ...sunday, localHour: 4 }, '2026-08-09')).toBeNull();
    expect(selectEmailCampaign({ ...sunday, localWeekday: 1 }, '2026-08-09')).toBeNull();
  });

  test('an empty week earns no digest', () => {
    expect(
      selectEmailCampaign(
        { ...base, digestEligible: false, localWeekday: 7, localHour: 18 },
        '2026-08-09',
      ),
    ).toBeNull();
  });

  test('reactivation fires once, and not before 14 days', () => {
    const quiet = { ...base, daysSinceLastSession: 16, localHour: 10 };
    expect(selectEmailCampaign(quiet, '2026-08-09')).toMatchObject({
      campaign: 'open_question',
      window: 'once',
    });
    expect(
      selectEmailCampaign({ ...quiet, daysSinceLastSession: 9 }, '2026-08-09'),
    ).toBeNull();
    expect(
      selectEmailCampaign({ ...quiet, alreadySent: ['open_question'] }, '2026-08-09'),
    ).toBeNull();
  });

  // Somebody who never logged anything is an activation problem, not a
  // reactivation one, and first_log already owns them.
  test('reactivation ignores an owner who never logged', () => {
    expect(
      selectEmailCampaign(
        { ...base, totalLogs: 0, daysSinceLastSession: 16, localHour: 10, daysSinceSignup: 40 },
        '2026-08-09',
      ),
    ).toBeNull();
  });

  test('an owner with no pet gets nothing from the rule engine', () => {
    expect(
      selectEmailCampaign({ ...base, hasPet: false, hoursSincePetCreated: null }, '2026-08-09'),
    ).toBeNull();
  });
});

describe('preference gating', () => {
  const allOn: EmailPreferences = {
    email_enabled: true,
    cat_email_lifecycle: true,
    cat_email_digest: true,
    cat_email_insights: true,
    cat_email_walk: true,
  };

  test('the master switch silences campaigns', () => {
    const off = { ...allOn, email_enabled: false };
    expect(isEmailAllowed('reading', off)).toBe(false);
    expect(isEmailAllowed('weekly_digest_email', off)).toBe(false);
    expect(isEmailAllowed('walk_report', off)).toBe(false);
  });

  // "Stop sending me campaigns" is not "withhold the reply to the letter I
  // wrote you".
  test('the master switch never silences a transactional reply', () => {
    expect(isEmailAllowed('reply_fallback', { ...allOn, email_enabled: false })).toBe(true);
  });

  test('categories are independent of one another', () => {
    const noWalk = { ...allOn, cat_email_walk: false };
    expect(isEmailAllowed('walk_report', noWalk)).toBe(false);
    expect(isEmailAllowed('weekly_digest_email', noWalk)).toBe(true);
    expect(isEmailAllowed('reading', noWalk)).toBe(true);
  });

  test('every campaign is decidable', () => {
    for (const campaign of ALL_EMAIL_CAMPAIGNS) {
      expect(typeof isEmailAllowed(campaign, allOn)).toBe('boolean');
    }
  });
});

describe('cross-channel suppression', () => {
  test('a recent push suppresses its email counterpart', () => {
    expect(isSuppressedByPush('reassessment', 2)).toBe(true);
    expect(isSuppressedByPush('reassessment', 30)).toBe(false);
    expect(isSuppressedByPush('reassessment', null)).toBe(false);
  });

  test('a campaign with no push counterpart is never suppressed', () => {
    expect(isSuppressedByPush('reading', 1)).toBe(false);
    expect(isSuppressedByPush('walk_report', 1)).toBe(false);
  });

  test('every paired campaign is a real email campaign', () => {
    for (const key of Object.keys(CROSS_CHANNEL_PAIRS)) {
      expect(ALL_EMAIL_CAMPAIGNS).toContain(key as EmailCampaignKey);
    }
  });

  // The exclusions are a decision, so a future campaign cannot quietly become
  // an email by being added to the catalogue.
  test('the never-email list stays out of the catalogue', () => {
    for (const key of NEVER_EMAIL) {
      expect(ALL_EMAIL_CAMPAIGNS).not.toContain(key as EmailCampaignKey);
    }
  });
});

// Root cause D of the August 2026 audit, applied to the second channel before
// it can happen twice.
describe('Deno mirror', () => {
  const groups = MIRROR_GROUPS as {
    name: string;
    appDir: string;
    edgeDir: string;
    files: string[];
  }[];

  const cases = groups.flatMap((g) => g.files.map((f) => [`${g.name}/${f}`, g, f] as const));

  test.each(cases)('_shared/%s is in sync', (_label, group, file) => {
    const expected = toDenoSource(readFileSync(join(group.appDir, file), 'utf8'));
    const actual = readFileSync(join(group.edgeDir, file), 'utf8');
    expect(actual).toBe(expected);
  });

  test('the email group is actually covered', () => {
    expect(groups.map((g) => g.name)).toContain('email');
  });
});
