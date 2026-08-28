import { resolveOfferPricing } from './pricing';
import type { ProductLike } from './pricing';

/**
 * The live App Store Connect configuration as of 22 Aug 2026:
 * PPM02Winback, AUD $9.99/month base, with a $6.99 introductory offer running
 * every month for the first 12 months.
 */
const IOS_INTRO: ProductLike = {
  priceString: 'A$9.99',
  introPrice: {
    priceString: 'A$6.99',
    price: 6.99,
    cycles: 12,
    periodUnit: 'MONTH',
    periodNumberOfUnits: 1,
  },
};

/** The Play counterpart: a finite discounted phase, then the base phase. */
const ANDROID_INTRO: ProductLike = {
  priceString: 'A$9.99',
  introPrice: null,
  defaultOption: {
    pricingPhases: [
      {
        offerPaymentMode: 'DISCOUNTED_RECURRING_PAYMENT',
        recurrenceMode: 2,
        billingCycleCount: 12,
        billingPeriod: { unit: 'MONTH', value: 1 },
        price: { formatted: 'A$6.99', amountMicros: 6990000 },
      },
      {
        offerPaymentMode: null,
        recurrenceMode: 1,
        billingCycleCount: null,
        billingPeriod: { unit: 'MONTH', value: 1 },
        price: { formatted: 'A$9.99', amountMicros: 9990000 },
      },
    ],
  },
};

/** What the plan originally called for: a plainly cheaper SKU, no intro. */
const FLAT: ProductLike = {
  priceString: 'A$6.99',
  introPrice: null,
};

describe('resolveOfferPricing — the live iOS configuration', () => {
  test('reads the INTRO price as the offer price, not the base price', () => {
    const p = resolveOfferPricing(IOS_INTRO)!;
    // The bug this whole module exists to prevent: product.priceString is
    // A$9.99, and rendering it would show the full price as the discount.
    expect(p.offerPriceString).toBe('A$6.99');
    expect(p.basePriceString).toBe('A$9.99');
    expect(p.shape).toBe('intro');
  });

  test('resolves the term to 12 months', () => {
    const p = resolveOfferPricing(IOS_INTRO)!;
    expect(p.introCycles).toBe(12);
    expect(p.introUnit).toBe('month');
  });

  test('multi-unit periods multiply out — 4 cycles of 3 months is 12 months', () => {
    const p = resolveOfferPricing({
      priceString: 'A$9.99',
      introPrice: {
        priceString: 'A$6.99',
        price: 6.99,
        cycles: 4,
        periodUnit: 'MONTH',
        periodNumberOfUnits: 3,
      },
    })!;
    expect(p.introCycles).toBe(12);
  });
});

describe('resolveOfferPricing — Android', () => {
  test('reads the discounted pricing phase', () => {
    const p = resolveOfferPricing(ANDROID_INTRO)!;
    expect(p.shape).toBe('intro');
    expect(p.offerPriceString).toBe('A$6.99');
    expect(p.basePriceString).toBe('A$9.99');
    expect(p.introCycles).toBe(12);
    expect(p.introUnit).toBe('month');
  });

  test('an infinite base phase is not mistaken for a discount', () => {
    const baseOnly: ProductLike = {
      priceString: 'A$6.99',
      defaultOption: {
        pricingPhases: [
          {
            recurrenceMode: 1,
            billingCycleCount: null,
            billingPeriod: { unit: 'MONTH', value: 1 },
            price: { formatted: 'A$6.99', amountMicros: 6990000 },
          },
        ],
      },
    };
    expect(resolveOfferPricing(baseOnly)!.shape).toBe('flat');
  });

  test('a FREE_TRIAL phase is never read as the offer price', () => {
    // Without this guard the screen would advertise "A$0.00/month" as the
    // win-back price, and the store would then charge the real one.
    const withTrial: ProductLike = {
      priceString: 'A$9.99',
      defaultOption: {
        pricingPhases: [
          {
            offerPaymentMode: 'FREE_TRIAL',
            recurrenceMode: 2,
            billingCycleCount: 1,
            billingPeriod: { unit: 'MONTH', value: 1 },
            price: { formatted: 'A$0.00', amountMicros: 0 },
          },
        ],
      },
    };
    const p = resolveOfferPricing(withTrial)!;
    expect(p.shape).toBe('flat');
    expect(p.offerPriceString).toBe('A$9.99');
  });

  test('falls back to subscriptionOptions when defaultOption is the base plan', () => {
    const p = resolveOfferPricing({
      priceString: 'A$9.99',
      defaultOption: { pricingPhases: [] },
      subscriptionOptions: [ANDROID_INTRO.defaultOption!],
    })!;
    expect(p.offerPriceString).toBe('A$6.99');
  });
});

describe('resolveOfferPricing — the flat shape', () => {
  test('a plainly cheaper SKU prices itself', () => {
    const p = resolveOfferPricing(FLAT)!;
    expect(p.shape).toBe('flat');
    expect(p.offerPriceString).toBe('A$6.99');
    expect(p.basePriceString).toBe('A$6.99');
    expect(p.introCycles).toBeNull();
    expect(p.introUnit).toBeNull();
  });

  test('supporting both shapes is what makes the offering_id lever real', () => {
    // The config can be pointed at either kind of SKU with no app build, which
    // is only true because the screen renders whatever it is handed.
    expect(resolveOfferPricing(IOS_INTRO)!.shape).toBe('intro');
    expect(resolveOfferPricing(FLAT)!.shape).toBe('flat');
  });
});

describe('resolveOfferPricing — refuses to guess', () => {
  test.each([
    ['null product', null],
    ['undefined product', undefined],
    ['no price string', { priceString: null } as ProductLike],
    ['blank price string', { priceString: '   ' } as ProductLike],
  ])('%s returns null so the caller shows the standard paywall', (_label, product) => {
    expect(resolveOfferPricing(product)).toBeNull();
  });

  test('a zero-priced intro is ignored rather than advertised as free', () => {
    const p = resolveOfferPricing({
      priceString: 'A$9.99',
      introPrice: { priceString: 'Free', price: 0, cycles: 1, periodUnit: 'MONTH', periodNumberOfUnits: 1 },
    })!;
    expect(p.shape).toBe('flat');
    expect(p.offerPriceString).toBe('A$9.99');
  });

  test('an intro with no cycle count degrades to flat rather than inventing a term', () => {
    const p = resolveOfferPricing({
      priceString: 'A$9.99',
      introPrice: { priceString: 'A$6.99', price: 6.99, cycles: 0, periodUnit: 'MONTH', periodNumberOfUnits: 1 },
    })!;
    // Better to show the base price than to promise a term nobody stated.
    expect(p.shape).toBe('flat');
  });

  test('an unrecognised period unit degrades to flat', () => {
    const p = resolveOfferPricing({
      priceString: 'A$9.99',
      introPrice: { priceString: 'A$6.99', price: 6.99, cycles: 12, periodUnit: 'FORTNIGHT', periodNumberOfUnits: 1 },
    })!;
    expect(p.shape).toBe('flat');
  });
});
