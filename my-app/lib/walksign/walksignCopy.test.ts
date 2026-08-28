import { PAWTCHI_INVITE_URL } from '../referral';
import { ALL_WALKSIGNS } from './types';
import {
  buildConfirmationBody,
  buildConfirmationHeadline,
  buildProvisionalNote,
  buildRevealTitle,
  buildStatusLine,
  buildTransitionHeadline,
  buildWalksignLockup,
  buildWalksignShareMessage,
  WALKSIGN_COPY,
} from './copy';

// Words banned by the Pawtchi Copy Spec v1 (brand book § 6.04).
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

function sentenceCount(text: string): number {
  const withoutUrl = text.replace(PAWTCHI_INVITE_URL, '').trim();
  const matches = withoutUrl.match(/[.?]+/g);
  return matches ? matches.length : 0;
}

/** Every user-facing string must satisfy the locked brand voice. */
function assertBrandVoice(text: string) {
  expect(text).not.toContain('!');
  expect(text.toLowerCase()).not.toContain('your pet');
  for (const word of BANNED_WORDS) {
    expect(text.toLowerCase()).not.toContain(word);
  }
}

describe('WALKSIGN_COPY', () => {
  test('every sign has a compliant name, tagline, and manifesto', () => {
    for (const sign of ALL_WALKSIGNS) {
      const copy = WALKSIGN_COPY[sign];
      expect(copy.displayName.length).toBeGreaterThan(0);
      assertBrandVoice(copy.tagline);
      assertBrandVoice(copy.manifesto);
      expect(sentenceCount(copy.manifesto)).toBeLessThanOrEqual(3);
    }
  });
});

describe('reveal and status copy', () => {
  test('reveal title and provisional note carry the name', () => {
    expect(buildRevealTitle('Ziggy')).toBe("Ziggy's first Walksign");
    expect(buildProvisionalNote('Ziggy')).toBe(
      "A first reading. Ziggy's walks will tell the rest.",
    );
    assertBrandVoice(buildRevealTitle('Ziggy'));
    assertBrandVoice(buildProvisionalNote('Ziggy'));
  });

  test('nameless fallbacks never say "your pet"', () => {
    assertBrandVoice(buildRevealTitle(null));
    assertBrandVoice(buildProvisionalNote(undefined));
    expect(buildRevealTitle('  ')).toBe('A first Walksign');
  });

  test('status lines', () => {
    expect(buildStatusLine('provisional')).toBe('Provisional · a first reading');
    expect(buildStatusLine('confirmed', 12)).toBe('Confirmed by 12 walks');
    expect(buildStatusLine('confirmed', null)).toBe('Confirmed by walks');
  });
});

describe('moment copy', () => {
  test('confirmation uses the right possessive pronoun', () => {
    expect(buildConfirmationHeadline('Ranger', 'male')).toBe('Written in his walks. Confirmed.');
    expect(buildConfirmationHeadline('Luna', 'female')).toBe('Written in her walks. Confirmed.');
    expect(buildConfirmationHeadline('Alex', null)).toBe('Written in their walks. Confirmed.');
    assertBrandVoice(buildConfirmationBody('loopkeeper', 'Ranger'));
    expect(buildConfirmationBody('loopkeeper', 'Ranger')).toContain('Loopkeeper');
    expect(buildConfirmationBody('loopkeeper', 'Ranger', 8)).toContain(
      '8 real walks',
    );
  });

  test('transition headlines name the new sign, calmly', () => {
    const grad = buildTransitionHeadline('wonderbound_graduation', 'loopkeeper', 'Ziggy');
    expect(grad).toContain('Ziggy');
    expect(grad).toContain('Loopkeeper');
    assertBrandVoice(grad);
    expect(sentenceCount(grad)).toBeLessThanOrEqual(3);

    const senior = buildTransitionHeadline('storywalker_arrival', 'storywalker', 'Duke');
    expect(senior).toContain('Storywalker');
    assertBrandVoice(senior);

    const evolved = buildTransitionHeadline(
      'behavioral_evolution',
      'blockscout',
      'Ranger',
    );
    expect(evolved).toContain('Ranger');
    expect(evolved).toContain('Blockscout');
    assertBrandVoice(evolved);
  });

  test('share message carries name, sign, and the invite link', () => {
    const msg = buildWalksignShareMessage('wonderbound', 'Ziggy', 'male');
    expect(msg).toContain('Ziggy');
    expect(msg).toContain('Wonderbound');
    expect(msg).toContain('his walks');
    expect(msg).toContain(PAWTCHI_INVITE_URL);
    assertBrandVoice(msg);
    expect(sentenceCount(msg)).toBeLessThanOrEqual(3);

    const anon = buildWalksignShareMessage('softstep', null);
    expect(anon).toContain(PAWTCHI_INVITE_URL);
    assertBrandVoice(anon);
  });
});

describe('buildWalksignLockup', () => {
  test('uppercase title over the fixed caption', () => {
    expect(buildWalksignLockup('wonderbound')).toEqual({
      title: 'WONDERBOUND',
      caption: 'A Pawtchi Walksign',
    });
  });
});
