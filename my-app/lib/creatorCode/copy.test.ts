import {
  CREATOR_EARNINGS_LABEL,
  CREATOR_EARNINGS_RATE,
  CREATOR_EYEBROW,
  CREATOR_HEADLINE,
  CREATOR_HOLD_TO_COPY,
  CREATOR_EARNINGS_NOTE,
  CREATOR_INACTIVE_NOTE,
  CREATOR_PAYOUT_NOTE,
  CREATOR_PAYOUT_THRESHOLD_AUD,
  CREATOR_RATE_AUD,
  CREATOR_SHARE_ACTION,
  CREATOR_SUBCOPY,
  PROMO_PLAN_LABEL,
  PROMO_STATUS_LABEL,
  REDEEM_CTA,
  REDEEM_CTA_WORKING,
  REDEEM_EYEBROW,
  REDEEM_FIELD_LABEL,
  REDEEM_FIELD_PLACEHOLDER,
  REDEEM_HEADLINE,
  REDEEM_REASSURANCE,
  REDEEM_SUBCOPY,
  REDEEM_SUCCESS_BENEFITS,
  REDEEM_SUCCESS_CTA,
  REDEEM_SUCCESS_EYEBROW,
  REDEEM_SUCCESS_NOTE,
  REDEEM_SUCCESS_TITLE,
  REDEEM_WORKING_BODY,
  REDEEM_WORKING_TITLE,
  creatorCompLine,
  creatorEarningsAud,
  creatorRedemptionLine,
  creatorShareMessage,
  formatAud,
  formatUntilDate,
  promoAccessDetail,
  promoPaywallBody,
  redeemFailureCopy,
  redeemSuccessBody,
} from './copy';
import type { RedeemOutcome } from './copy';

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

/** The e-commerce vocabulary a giveaway screen attracts. Same list as proOffer. */
const BANNED_SALES_WORDS = [
  'flash sale',
  '% off',
  'discount',
  'buy now',
  'last chance',
  'hurry',
  'limited time',
  'act now',
  'save big',
  'exclusive',
];

/**
 * The rule specific to this feature, and the one with a store rejection behind
 * it rather than a matter of taste.
 *
 * "Promo code" and "offer code" are the names of App Store and Play Console
 * features. A screen of ours that uses them invites a reviewer to read it as
 * the store's own redemption sheet, which is a rejection rather than a
 * misunderstanding.
 *
 * "Trial" is here for a different reason: a trial implies a card and a charge
 * at the end. A promotional entitlement grants neither — it simply stops. The
 * word would be a small lie that turns into a billing dispute.
 */
const BANNED_MECHANISM_WORDS = [
  'promo code',
  'promo-code',
  'offer code',
  'voucher',
  'coupon',
  'gift card',
  'redeem code',
  'trial',
];

/** No prices on any of these screens — see the header note in copy.ts. */
const PRICE_SHAPED = /[$£€]\s?\d|\d+\.\d{2}\s?(?:usd|aud|gbp|eur)/i;

/**
 * The creator's earnings strings are the one place money is allowed, and they
 * are checked by `creator earnings` below instead of here.
 *
 * The no-prices rule protects the paywall: a hardcoded price of Pawtchi Plus
 * shown to a prospective buyer contradicts the RevenueCat-driven paywall. These
 * strings are neither — they are what we owe a creator, shown only to that
 * creator. Carved out by name so the pattern keeps its teeth everywhere else;
 * if someone adds a price to a redeem string, this list will not save them.
 */
const EARNINGS_STRINGS = [
  CREATOR_EARNINGS_LABEL,
  CREATOR_EARNINGS_RATE,
  CREATOR_PAYOUT_NOTE,
  CREATOR_EARNINGS_NOTE,
];

function sentenceCount(text: string): number {
  const matches = text.match(/[.?]+/g);
  return matches ? matches.length : 0;
}

function assertBrandVoice(text: string) {
  expect(text).not.toContain('!');
  expect(text.toLowerCase()).not.toContain('your pet');
  for (const word of [...BANNED_WORDS, ...BANNED_SALES_WORDS, ...BANNED_MECHANISM_WORDS]) {
    expect(text.toLowerCase()).not.toContain(word);
  }
  expect(text).not.toMatch(PRICE_SHAPED);
}

const UNTIL = new Date(2026, 11, 6); // 6 December 2026, local — no TZ ambiguity

const ALL_OUTCOMES: RedeemOutcome[] = [
  'not_found',
  'inactive',
  'code_expired',
  'code_exhausted',
  'already_redeemed',
  'ever_subscribed',
  'own_code',
  'failed',
];

/** Every plain string and every rendered variant, in one place. */
const ALL_STRINGS = [
  REDEEM_EYEBROW,
  REDEEM_HEADLINE,
  REDEEM_SUBCOPY,
  REDEEM_FIELD_LABEL,
  REDEEM_FIELD_PLACEHOLDER,
  REDEEM_CTA,
  REDEEM_CTA_WORKING,
  REDEEM_REASSURANCE,
  REDEEM_WORKING_TITLE,
  REDEEM_WORKING_BODY,
  REDEEM_SUCCESS_EYEBROW,
  REDEEM_SUCCESS_TITLE,
  REDEEM_SUCCESS_NOTE,
  ...REDEEM_SUCCESS_BENEFITS,
  REDEEM_SUCCESS_CTA,
  PROMO_PLAN_LABEL,
  PROMO_STATUS_LABEL,
  CREATOR_EYEBROW,
  CREATOR_HEADLINE,
  CREATOR_SUBCOPY,
  CREATOR_HOLD_TO_COPY,
  CREATOR_SHARE_ACTION,
  CREATOR_INACTIVE_NOTE,
  ...ALL_OUTCOMES.map(o => redeemFailureCopy(o)),
  ...ALL_OUTCOMES.map(o => redeemFailureCopy(o, 'Sarah')),
  redeemSuccessBody('Sarah', UNTIL),
  redeemSuccessBody(null, UNTIL),
  promoAccessDetail(UNTIL),
  promoPaywallBody(UNTIL),
  creatorRedemptionLine(0),
  creatorRedemptionLine(1),
  creatorRedemptionLine(42),
  creatorCompLine(UNTIL),
  creatorShareMessage('SARAHK'),
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

describe('formatUntilDate', () => {
  test('day and month, no year and no weekday', () => {
    expect(formatUntilDate(new Date(2026, 11, 6))).toBe('6 December');
    expect(formatUntilDate(new Date(2027, 0, 1))).toBe('1 January');
  });
});

describe('redeemFailureCopy', () => {
  test('every outcome has its own sentence', () => {
    // The point of the switch is that these are genuinely different next
    // actions for the reader; collapsing any two of them back into a shared
    // apology is the regression this guards.
    const rendered = ALL_OUTCOMES.map(o => redeemFailureCopy(o, 'Sarah'));
    expect(new Set(rendered).size).toBe(ALL_OUTCOMES.length);
  });

  test('an exhausted code names the creator when we know it', () => {
    expect(redeemFailureCopy('code_exhausted', 'Sarah')).toContain('Sarah');
  });

  test('and stays sensible when we do not', () => {
    const line = redeemFailureCopy('code_exhausted');
    expect(line).not.toContain('undefined');
    expect(line).not.toContain('null');
    expect(line.length).toBeGreaterThan(0);
  });

  test('already-redeemed names the one-per-account rule', () => {
    // Without it, the obvious next move is to try another code, which fails
    // identically and produces a support ticket.
    expect(redeemFailureCopy('already_redeemed').toLowerCase()).toContain('one per account');
  });

  test('an unknown outcome still returns a usable sentence', () => {
    const line = redeemFailureCopy('something_new' as RedeemOutcome);
    expect(line.length).toBeGreaterThan(0);
    assertBrandVoice(line);
  });
});

describe('redeemSuccessBody', () => {
  test('names the creator and the end date', () => {
    const line = redeemSuccessBody('Sarah', UNTIL);
    expect(line).toContain('Sarah');
    expect(line).toContain('6 December');
  });

  test('a missing name drops the attribution rather than inventing one', () => {
    for (const name of [null, undefined, '', '   ']) {
      const line = redeemSuccessBody(name, UNTIL);
      expect(line).toContain('6 December');
      expect(line).not.toContain('undefined');
      expect(line).not.toContain('null');
    }
  });
});

describe('creatorRedemptionLine', () => {
  test('reads naturally at zero, one and many', () => {
    expect(creatorRedemptionLine(0)).toBe('Nobody has used it yet.');
    expect(creatorRedemptionLine(1)).toBe('One person has used it.');
    expect(creatorRedemptionLine(42)).toBe('42 people have used it.');
  });
});

describe('creator earnings', () => {
  test('the strings keep the brand voice, prices aside', () => {
    for (const text of EARNINGS_STRINGS) {
      expect(text).not.toContain('!');
      for (const word of [...BANNED_WORDS, ...BANNED_SALES_WORDS, ...BANNED_MECHANISM_WORDS]) {
        expect(text.toLowerCase()).not.toContain(word);
      }
      expect(sentenceCount(text)).toBeLessThanOrEqual(3);
    }
  });

  test('the currency is named, not assumed', () => {
    // "$1" to a creator in Toronto is a different promise than the one we are
    // making. The A is the whole point of the string.
    expect(formatAud(1)).toBe('A$1');
    expect(CREATOR_EARNINGS_RATE).toContain('A$');
  });

  test('one redemption is one dollar', () => {
    expect(CREATOR_RATE_AUD).toBe(1);
    expect(creatorEarningsAud(0)).toBe(0);
    expect(creatorEarningsAud(1)).toBe(1);
    expect(creatorEarningsAud(42)).toBe(42);
  });

  test('a nonsense count cannot produce a balance we would owe', () => {
    // redemptions_granted comes off an RPC and is only as trustworthy as the
    // row behind it. A negative or fractional balance on a payout screen is
    // worse than a wrong one — it reads as broken accounting.
    expect(creatorEarningsAud(-3)).toBe(0);
    expect(creatorEarningsAud(2.7)).toBe(2);
    expect(formatAud(-5)).toBe('A$0');
  });

  test('the note carries both the rate and the threshold', () => {
    // The regression this guards is a creator who shares for months, asks to be
    // paid, and only then learns about the floor. The rule is the same either
    // way; meeting it and discovering it are not.
    expect(CREATOR_PAYOUT_THRESHOLD_AUD).toBe(100);
    expect(CREATOR_EARNINGS_NOTE).toBe('A$1 for every person who uses your code. Paid once you reach A$100.');
  });
});

describe('creatorShareMessage', () => {
  test('carries the code and is written in the creator’s voice, not ours', () => {
    const message = creatorShareMessage('SARAHK');
    expect(message).toContain('SARAHK');
    // "on them" — the creator is talking about us to their audience. "on us"
    // would be our voice in their caption.
    expect(message).toContain('on them');
  });
});
