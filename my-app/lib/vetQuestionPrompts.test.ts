import { getSuggestedQuestions } from './vetQuestionPrompts';

// Words banned by the Pawtchi Copy Spec v1 (brand book § 6.04).
const BANNED_WORDS = [
  'immediately', 'urgent', 'ensure', 'incredible', 'amazing',
  'superstar', 'alert', "don't forget", 'ai-powered',
];

function assertBrandVoice(text: string) {
  expect(text).not.toContain('!');
  expect(text.toLowerCase()).not.toContain('your pet');
  expect(text.toLowerCase()).not.toContain('your dog');
  expect(text.toLowerCase()).not.toContain('your cat');
  for (const word of BANNED_WORDS) {
    expect(text.toLowerCase()).not.toContain(word);
  }
}

describe('getSuggestedQuestions', () => {
  test('returns a non-empty set personalised with the pet name', () => {
    const qs = getSuggestedQuestions('Bruno', 'male');
    expect(qs.length).toBeGreaterThan(0);
    qs.forEach((q) => {
      expect(q.label).toBeTruthy();
      expect(q.text).toContain('Bruno');
    });
  });

  test('every suggestion satisfies the locked brand voice', () => {
    for (const gender of ['male', 'female', undefined]) {
      for (const q of getSuggestedQuestions('Luna', gender)) {
        assertBrandVoice(q.label);
        assertBrandVoice(q.text);
      }
    }
  });

  test('male pet uses "his", female uses "her"', () => {
    const male = getSuggestedQuestions('Bruno', 'male').map((q) => q.text).join(' ');
    expect(male).toContain('his');
    expect(male).not.toContain('her needs');

    const female = getSuggestedQuestions('Luna', 'female').map((q) => q.text).join(' ');
    expect(female).toContain('her');
  });

  test('missing name never leaks a template token or undefined', () => {
    for (const q of getSuggestedQuestions(undefined, undefined)) {
      expect(q.text).not.toContain('{');
      expect(q.text.toLowerCase()).not.toContain('undefined');
      expect(q.text.toLowerCase()).not.toContain('null');
    }
  });
});
