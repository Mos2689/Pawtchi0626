import {
  OFFER_EYEBROW,
  OFFER_INBOX_TITLE,
  OFFER_PRICE_FOOTNOTE,
  OFFER_STANDARD_LABEL,
  offerCtaLabel,
  offerExpiryLine,
  offerInboxBody,
  offerLegalLine,
  offerSubcopy,
  offerTermLine,
} from './copy';

// Copy Spec v1 § 6.04, the same list lib/referral.test.ts asserts.
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

/**
 * The extra list this screen needs. A discount paywall is exactly where
 * e-commerce vocabulary creeps in, and every one of these would break the
 * premium positioning the brand book exists to protect.
 */
const BANNED_SALES_WORDS = [
  'flash sale',
  'sale',
  '% off',
  'discount',
  'buy now',
  'last chance',
  'hurry',
  'limited time',
  'act now',
  'deal',
  'save big',
  'exclusive',
];

/**
 * The rule specific to this feature: the copy must never reference the fact
 * that the user dismissed the paywall. Naming it teaches the contingency the
 * five-day cooldown was built to hide.
 */
const BANNED_DISMISSAL_REFERENCES = [
  'still thinking',
  'passed on',
  "didn't subscribe",
  'did not subscribe',
  'changed your mind',
  'not ready',
  'we noticed',
  'came back',
];

function sentenceCount(text: string): number {
  const matches = text.match(/[.?]+/g);
  return matches ? matches.length : 0;
}

function assertBrandVoice(text: string) {
  expect(text).not.toContain('!');
  expect(text.toLowerCase()).not.toContain('your pet');
  for (const word of BANNED_WORDS) {
    expect(text.toLowerCase()).not.toContain(word);
  }
  for (const word of BANNED_SALES_WORDS) {
    expect(text.toLowerCase()).not.toContain(word);
  }
  for (const phrase of BANNED_DISMISSAL_REFERENCES) {
    expect(text.toLowerCase()).not.toContain(phrase);
  }
}

/** Every plain string and every rendered variant, in one place. */
const ALL_STRINGS = [
  OFFER_EYEBROW,
  OFFER_STANDARD_LABEL,
  OFFER_PRICE_FOOTNOTE,
  OFFER_INBOX_TITLE,
  offerSubcopy({ name: 'Bruno', gender: 'male' }),
  offerSubcopy({ name: 'Luna', gender: 'female' }),
  offerSubcopy({ name: 'Pip' }),
  offerSubcopy(),
  offerInboxBody({ name: 'Bruno', gender: 'male' }),
  offerInboxBody(),
  offerCtaLabel('A$6.99'),
  offerLegalLine('A$6.99'),
  offerLegalLine('A$6.99', { cycles: 12, unit: 'month', basePriceString: 'A$9.99' }),
  offerTermLine(12, 'month', 'A$9.99'),
  offerExpiryLine(new Date('2026-09-12T00:00:00.000Z')),
];

describe('brand voice', () => {
  test.each(ALL_STRINGS)('%s satisfies the locked copy spec', text => {
    assertBrandVoice(text);
  });

  test('nothing runs past three sentences', () => {
    for (const text of ALL_STRINGS) {
      expect(sentenceCount(text)).toBeLessThanOrEqual(3);
    }
  });
});

describe('offerSubcopy', () => {
  test('uses the animal name and the sexed pronoun', () => {
    const male = offerSubcopy({ name: 'Bruno', gender: 'male' });
    expect(male).toContain('Bruno');
    expect(male).toContain('his');
    expect(male).not.toContain('their');

    const female = offerSubcopy({ name: 'Luna', gender: 'female' });
    expect(female).toContain('Luna');
    expect(female).toContain('her');
  });

  test('unknown sex falls back to "their"', () => {
    expect(offerSubcopy({ name: 'Pip' })).toContain('their');
  });

  test('a missing or blank name drops to the name-free line, never "your pet"', () => {
    for (const pet of [undefined, { name: '' }, { name: '   ' }]) {
      const text = offerSubcopy(pet);
      expect(text.toLowerCase()).not.toContain('your pet');
      expect(text).toContain('Pawtchi Plus');
    }
  });
});

describe('price strings', () => {
  test('the CTA carries whatever the store returned, not a constant', () => {
    expect(offerCtaLabel('A$6.99')).toBe('Continue at A$6.99');
    // A different storefront, a different SKU, a price experiment — all of it
    // has to flow through unchanged, which is only true if nothing is baked in.
    expect(offerCtaLabel('US$4.99')).toBe('Continue at US$4.99');
    expect(offerCtaLabel('€5,99')).toContain('€5,99');
  });

  test('no price literal is hardcoded anywhere in the module', () => {
    for (const text of [
      OFFER_EYEBROW,
      OFFER_STANDARD_LABEL,
      OFFER_PRICE_FOOTNOTE,
      OFFER_INBOX_TITLE,
      offerSubcopy({ name: 'Bruno' }),
      offerInboxBody({ name: 'Bruno' }),
    ]) {
      expect(text).not.toMatch(/\d+[.,]\d{2}/);
      expect(text).not.toContain('$');
    }
  });

  test('the legal line states the recurrence and the exit', () => {
    const line = offerLegalLine('A$6.99');
    expect(line).toContain('A$6.99/month');
    expect(line).toContain('Cancel anytime');
  });
});

// PPM02Winback is $9.99/month base with a $6.99 introductory offer for 12
// months, so the discount ENDS. Copy that implies otherwise is a
// misrepresentation, and both stores require the term and the reverted price
// on the purchase screen.
describe('introductory-offer disclosure', () => {
  test('the term line names the length and the price it reverts to', () => {
    expect(offerTermLine(12, 'month', 'A$9.99')).toBe(
      'For your first 12 months, then A$9.99/month',
    );
  });

  test('a single cycle is not pluralised', () => {
    expect(offerTermLine(1, 'month', 'A$9.99')).toBe(
      'For your first month, then A$9.99/month',
    );
  });

  test('the legal line discloses both prices and the term', () => {
    const line = offerLegalLine('A$6.99', {
      cycles: 12,
      unit: 'month',
      basePriceString: 'A$9.99',
    });
    expect(line).toBe('A$6.99/month for 12 months, then A$9.99/month · Cancel anytime');
  });

  test('no string claims the discount is permanent when it is not', () => {
    // The flat-shape footnote says "for as long as you stay subscribed". It is
    // true for a plainly cheaper SKU and false for an introductory offer, so it
    // must never appear in the intro path's strings.
    const introStrings = [
      offerTermLine(12, 'month', 'A$9.99'),
      offerLegalLine('A$6.99', { cycles: 12, unit: 'month', basePriceString: 'A$9.99' }),
      offerSubcopy({ name: 'Bruno', gender: 'male' }),
      offerSubcopy(),
    ];
    for (const text of introStrings) {
      expect(text.toLowerCase()).not.toContain('as long as you stay');
      expect(text.toLowerCase()).not.toContain('forever');
      expect(text.toLowerCase()).not.toContain('always');
    }
  });
});

describe('offerExpiryLine', () => {
  test('reads as a date, never as a countdown', () => {
    const line = offerExpiryLine(new Date(2026, 8, 12));
    expect(line).toBe('Available until 12 September');
    expect(line.toLowerCase()).not.toContain('hours');
    expect(line.toLowerCase()).not.toContain('expires in');
  });
});
