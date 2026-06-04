import {
  PAWTCHI_INVITE_URL,
  possessivePronoun,
  buildInviteHeadline,
  buildInviteSubcopy,
  buildInviteMessage,
  buildInviteBody,
} from './referral';

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
  // Count terminal punctuation, ignoring the trailing URL.
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

describe('possessivePronoun', () => {
  test('uses his/her for a known sex, their otherwise', () => {
    expect(possessivePronoun('male')).toBe('his');
    expect(possessivePronoun('female')).toBe('her');
    expect(possessivePronoun(undefined)).toBe('their');
    expect(possessivePronoun(null)).toBe('their');
    expect(possessivePronoun('')).toBe('their');
  });
});

describe('buildInviteMessage', () => {
  test('male pet uses "his" and is brand-voice compliant', () => {
    const msg = buildInviteMessage({ name: 'Bruno', gender: 'male' });
    expect(msg).toContain('Bruno');
    expect(msg).toContain('his meals');
    expect(msg).not.toContain('their');
    expect(msg).toContain(PAWTCHI_INVITE_URL);
    assertBrandVoice(msg);
    expect(sentenceCount(msg)).toBeLessThanOrEqual(3);
  });

  test('female pet uses "her"', () => {
    const msg = buildInviteMessage({ name: 'Luna', gender: 'female' });
    expect(msg).toContain('Luna');
    expect(msg).toContain('her meals');
    assertBrandVoice(msg);
    expect(sentenceCount(msg)).toBeLessThanOrEqual(3);
  });

  test('unknown sex falls back to "their"', () => {
    const msg = buildInviteMessage({ name: 'Pip' });
    expect(msg).toContain('their meals');
    assertBrandVoice(msg);
  });

  test('missing name reads cleanly and never leaks a template token', () => {
    const msg = buildInviteMessage({});
    expect(msg).not.toContain('{');
    expect(msg).not.toContain('undefined');
    expect(msg).not.toContain('null');
    expect(msg).toContain(PAWTCHI_INVITE_URL);
    assertBrandVoice(msg);
    expect(sentenceCount(msg)).toBeLessThanOrEqual(3);
  });

  test('whitespace-only name is treated as missing', () => {
    const msg = buildInviteMessage({ name: '   ', gender: 'male' });
    expect(msg).not.toContain('his meals'); // no name → no known-animal pronoun claim
    assertBrandVoice(msg);
  });
});

describe('buildInviteBody (iOS — link passed separately as url)', () => {
  test('carries the same copy but never the URL', () => {
    const body = buildInviteBody({ name: 'Bruno', gender: 'male' });
    expect(body).toContain('Bruno');
    expect(body).toContain('his meals');
    expect(body).not.toContain(PAWTCHI_INVITE_URL);
    expect(body).not.toContain('http');
    assertBrandVoice(body);
    expect(sentenceCount(body)).toBeLessThanOrEqual(3);
  });

  test('full message is exactly the body plus the link', () => {
    const pet = { name: 'Luna', gender: 'female' };
    expect(buildInviteMessage(pet)).toBe(`${buildInviteBody(pet)} ${PAWTCHI_INVITE_URL}`);
  });
});

describe('buildInviteHeadline / buildInviteSubcopy', () => {
  test('headline uses the name when present', () => {
    expect(buildInviteHeadline('Bruno')).toBe('A friend for Bruno');
    assertBrandVoice(buildInviteHeadline('Bruno'));
  });

  test('headline has a name-free fallback', () => {
    const headline = buildInviteHeadline('');
    expect(headline).not.toContain('{');
    assertBrandVoice(headline);
  });

  test('subcopy is calm and compliant', () => {
    const sub = buildInviteSubcopy('Bruno');
    expect(sub).toContain('Bruno');
    assertBrandVoice(sub);
    expect(sentenceCount(sub)).toBeLessThanOrEqual(3);
  });
});
