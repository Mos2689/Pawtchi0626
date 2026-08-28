// Copy Spec v1 compliance for the support surface.
//
// Mirrors lib/notifications/copy.test.ts. Support copy is written under
// deadline pressure more often than most strings in this app — someone is
// always mid-incident when they touch it — so the voice rules are enforced
// mechanically rather than by review.
//
// The ALL-CAPS strings are exempt where they are set in Bebas Neue, which is an
// all-caps display face by construction (constants/design.ts), or where they
// are `type.caption` eyebrows. Everything an owner reads as prose is checked.

import {
  AREA_OPTIONS,
  COMPOSER_COPY,
  CONFIRMATION_COPY,
  DOOR_COPY,
  HUB_COPY,
  RESPONSE_WINDOW,
  SUPPORT_TEAM_NAME,
  TICKETS_PER_DAY,
  THREAD_COPY,
  TOPIC_COPY,
  areaFromContext,
  ticketReference,
  visibleAreas,
} from './copy';
import { ALL_ERROR_CONTEXTS, type ErrorContext } from '../appError';

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

const EMOJI =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u;

/** Every string an owner reads as prose on a support surface. */
const PROSE: Record<string, string> = {
  'hub.intro': HUB_COPY.intro,
  'hub.requestsFooter': HUB_COPY.requestsFooter,
  'door.bug.title': DOOR_COPY.bug.title,
  'door.bug.subtitle': DOOR_COPY.bug.subtitle,
  'door.question.title': DOOR_COPY.question.title,
  'door.question.subtitle': DOOR_COPY.question.subtitle,
  'door.idea.title': DOOR_COPY.idea.title,
  'door.idea.subtitle': DOOR_COPY.idea.subtitle,
  'topic.bug.subtitle': TOPIC_COPY.bug.subtitle,
  'topic.bug.placeholder': TOPIC_COPY.bug.placeholder,
  'topic.question.subtitle': TOPIC_COPY.question.subtitle,
  'topic.question.placeholder': TOPIC_COPY.question.placeholder,
  'composer.areaLabel': COMPOSER_COPY.areaLabel,
  'composer.attachLabel': COMPOSER_COPY.attachLabel,
  'composer.attachHint': COMPOSER_COPY.attachHint,
  'composer.diagnosticsLabel': COMPOSER_COPY.diagnosticsLabel,
  'composer.diagnosticsHint': COMPOSER_COPY.diagnosticsHint,
  'composer.capTitle': COMPOSER_COPY.capTitle,
  'composer.capBody': COMPOSER_COPY.capBody,
  'confirmation.title': CONFIRMATION_COPY.title,
  'confirmation.bodyLine': CONFIRMATION_COPY.bodyLine,
  'confirmation.replyLine': CONFIRMATION_COPY.replyLine,
  'thread.pending': THREAD_COPY.pending,
  'thread.missingTitle': THREAD_COPY.missingTitle,
  'thread.missingBody': THREAD_COPY.missingBody,
};

describe('Copy Spec v1 compliance', () => {
  test.each(Object.entries(PROSE))('%s satisfies the brand voice', (label, text) => {
    // Immutable rule: no exclamation marks, anywhere.
    expect(`${label}: ${text}`).not.toContain('!');
    expect(EMOJI.test(text)).toBe(false);

    const lower = text.toLowerCase();
    expect(lower).not.toContain('your pet');
    expect(lower).not.toContain('your dog');
    expect(lower).not.toContain('your cat');
    for (const word of BANNED_WORDS) {
      expect(lower).not.toContain(word);
    }

    // No ALL CAPS words in prose — that is the display face's job, not copy's.
    for (const word of text.split(/\s+/)) {
      const bare = word.replace(/[^A-Za-z']/g, '');
      if (bare.length > 1) expect(bare).not.toBe(bare.toUpperCase());
    }
  });

  test('every prose string is non-empty', () => {
    for (const [label, text] of Object.entries(PROSE)) {
      expect({ label, length: text.trim().length > 0 }).toMatchObject({ length: true });
    }
  });

  test('the display headlines are caps — they are set in Bebas', () => {
    expect(TOPIC_COPY.bug.headline).toBe(TOPIC_COPY.bug.headline.toUpperCase());
    expect(TOPIC_COPY.question.headline).toBe(TOPIC_COPY.question.headline.toUpperCase());
    expect(HUB_COPY.headlineTop).toBe(HUB_COPY.headlineTop.toUpperCase());
    expect(HUB_COPY.headlineHighlighted).toBe(HUB_COPY.headlineHighlighted.toUpperCase());
  });
});

describe('the promise', () => {
  /**
   * The response window and the daily cap are one mechanism, not two settings.
   * The cap is what keeps the promise true at volume, exactly as the founder
   * letter's 3-per-24h cap backs "we read every letter". Loosening one without
   * the other is how a support promise quietly becomes a lie.
   */
  test('the cap that backs the response window is still in place', () => {
    expect(TICKETS_PER_DAY).toBeGreaterThan(0);
    expect(TICKETS_PER_DAY).toBeLessThanOrEqual(10);
  });

  test('the confirmation states the response window', () => {
    expect(CONFIRMATION_COPY.bodyLine).toContain(RESPONSE_WINDOW);
  });

  test('the confirmation names the team, not a person', () => {
    expect(CONFIRMATION_COPY.bodyLine).toContain(SUPPORT_TEAM_NAME);
    // Support is institutional; the letter is personal but unsigned. Neither
    // prints a founder's name — a name here would blur the two voices back
    // together.
    for (const name of ['Pra', 'Mos']) {
      expect(CONFIRMATION_COPY.bodyLine).not.toContain(name);
      expect(THREAD_COPY.pending).not.toContain(name);
    }
  });

  test('the pending state does not restate the window as a countdown', () => {
    // A promise repeated back with a clock attached becomes a deadline.
    expect(THREAD_COPY.pending).not.toContain(RESPONSE_WINDOW);
  });
});

describe('area mapping', () => {
  test('every ErrorContext maps to an area — no failure is unroutable', () => {
    for (const context of ALL_ERROR_CONTEXTS) {
      expect({ context, area: areaFromContext(context) }).toMatchObject({
        area: expect.any(String),
      });
    }
  });

  test('every mapped area is a real chip', () => {
    const ids = new Set(AREA_OPTIONS.map((a) => a.id));
    for (const context of ALL_ERROR_CONTEXTS) {
      expect(ids.has(areaFromContext(context)!)).toBe(true);
    }
  });

  test('the mappings that matter most land where an owner would expect', () => {
    const cases: [ErrorContext, string][] = [
      ['food_scan', 'meals'],
      ['purchase', 'subscription'],
      ['vet_scan', 'health'],
      ['ask_vet', 'health'],
    ];
    for (const [context, area] of cases) {
      expect({ context, area: areaFromContext(context) }).toMatchObject({ area });
    }
  });

  test('no context to guess from yields no guess', () => {
    expect(areaFromContext(null)).toBeNull();
    expect(areaFromContext(undefined)).toBeNull();
  });

  test('a cat owner is never offered the walks chip', () => {
    expect(visibleAreas(false).map((a) => a.id)).not.toContain('walks');
    expect(visibleAreas(true).map((a) => a.id)).toContain('walks');
  });

  test('"other" is always offered so nobody is forced to mis-file', () => {
    expect(visibleAreas(false).map((a) => a.id)).toContain('other');
    expect(visibleAreas(true).map((a) => a.id)).toContain('other');
  });
});

describe('ticketReference', () => {
  test('derives a short, sayable reference from the id', () => {
    expect(ticketReference('4k2r9f10-0000-4000-8000-000000000000')).toBe('PAW-4K2R');
  });

  test('is a pure projection of the id, so it can never drift', () => {
    const id = 'abcd1234-0000-4000-8000-000000000000';
    expect(ticketReference(id)).toBe(ticketReference(id));
  });

  test('degrades rather than throwing on a missing id', () => {
    expect(ticketReference('')).toBe('PAW');
  });
});
