/**
 * Resolves what a win-back offering actually costs, across two store shapes.
 *
 * PURE — takes a plain product-shaped object, returns plain data. Kept out of
 * the component so the arithmetic that decides what price a person is shown is
 * testable without mounting anything.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * `PPM02Winback` is configured in App Store Connect as **AUD $9.99/month base
 * with a $6.99 introductory offer for the first 12 months** — not as a $6.99
 * base price. RevenueCat's `product.priceString` returns the BASE price, so
 * rendering it directly would have shown "A$9.99/month" as the discounted
 * offer. The real number lives on `product.introPrice`.
 *
 * Two shapes are supported, and which one applies is read from the product
 * rather than assumed:
 *
 *   'intro' — a discounted introductory period, then the base price. What is
 *             live today. Must disclose the term and the reversion.
 *   'flat'  — a plainly cheaper SKU with no intro. What the plan originally
 *             called for, and what a future `offering_id` swap might point at.
 *
 * Supporting both is what makes the `offering_id` config lever real: pointing
 * it at a different SKU changes the price with no app build only if the screen
 * can render whatever that SKU turns out to be.
 *
 * The store shapes differ, and the split mirrors the convention already used by
 * `getTrialPhrase` in StandardPaywall: iOS surfaces an introductory offer as
 * `introPrice`; Android surfaces it as a discounted pricing phase on a
 * subscription option.
 */

/** Structural, so tests can build fixtures without importing the RN SDK. */
export interface ProductLike {
  priceString?: string | null;
  introPrice?: {
    priceString?: string | null;
    price?: number | null;
    cycles?: number | null;
    periodUnit?: string | null;
    periodNumberOfUnits?: number | null;
  } | null;
  defaultOption?: OptionLike | null;
  subscriptionOptions?: OptionLike[] | null;
}

interface OptionLike {
  pricingPhases?: PhaseLike[] | null;
}

interface PhaseLike {
  offerPaymentMode?: string | null;
  recurrenceMode?: number | null;
  billingCycleCount?: number | null;
  billingPeriod?: { unit?: string | null; value?: number | null } | null;
  price?: { formatted?: string | null; amountMicros?: number | null } | null;
}

export interface OfferPricing {
  shape: 'intro' | 'flat';
  /** What the user pays now. The intro price when there is one, else the base. */
  offerPriceString: string;
  /** The recurring price. Equals offerPriceString for the flat shape. */
  basePriceString: string;
  /** How many billing cycles the intro price lasts. Null for the flat shape. */
  introCycles: number | null;
  /** 'month' | 'year' | 'week' | 'day', lowercased. Null for the flat shape. */
  introUnit: string | null;
}

function unitNoun(unit?: string | null): string | null {
  const u = (unit ?? '').toUpperCase();
  if (u.startsWith('DAY')) return 'day';
  if (u.startsWith('WEEK')) return 'week';
  if (u.startsWith('MONTH')) return 'month';
  if (u.startsWith('YEAR')) return 'year';
  return null;
}

/**
 * The Android counterpart of `introPrice`: a phase that recurs a fixed number
 * of times at a reduced, non-zero price.
 *
 * A FREE_TRIAL phase is deliberately not accepted. The win-back SKU carries no
 * trial by design — the target has usually already consumed the subscription
 * group's one intro offer — and mistaking a trial for a discount would render
 * "A$0.00/month" as the offer price.
 */
function findDiscountPhase(product: ProductLike): PhaseLike | null {
  const options: OptionLike[] = [];
  if (product.defaultOption) options.push(product.defaultOption);
  if (Array.isArray(product.subscriptionOptions)) options.push(...product.subscriptionOptions);

  for (const option of options) {
    const phases = Array.isArray(option?.pricingPhases) ? option.pricingPhases : [];
    for (const phase of phases) {
      if (phase?.offerPaymentMode === 'FREE_TRIAL') continue;
      const micros = Number(phase?.price?.amountMicros ?? 0);
      if (micros <= 0) continue;
      // FINITE_RECURRING (2) or an explicit cycle count — a phase that ends.
      const finite = phase?.recurrenceMode === 2 || (phase?.billingCycleCount ?? 0) > 0;
      if (!finite) continue;
      if (!phase?.price?.formatted) continue;
      return phase;
    }
  }
  return null;
}

/**
 * Returns null when the product cannot be priced at all — no base price
 * string. Callers treat that as "fall back to the standard paywall": a
 * subscription screen with a missing price is worse than no offer.
 */
export function resolveOfferPricing(product: ProductLike | null | undefined): OfferPricing | null {
  const basePriceString = product?.priceString?.trim();
  if (!product || !basePriceString) return null;

  // iOS shape first — it is the one live today, and it is unambiguous.
  const intro = product.introPrice;
  const introPriceString = intro?.priceString?.trim();
  if (intro && introPriceString && Number(intro.price ?? 0) > 0) {
    const unit = unitNoun(intro.periodUnit);
    const cycles = Number(intro.cycles ?? 0);
    if (unit && cycles > 0) {
      return {
        shape: 'intro',
        offerPriceString: introPriceString,
        basePriceString,
        // `cycles` counts billing periods; `periodNumberOfUnits` is how long
        // one period is. A 12-cycle offer of 1-month periods is 12 months.
        introCycles: cycles * Math.max(1, Number(intro.periodNumberOfUnits ?? 1)),
        introUnit: unit,
      };
    }
  }

  // Android shape.
  const phase = findDiscountPhase(product);
  if (phase) {
    const unit = unitNoun(phase.billingPeriod?.unit);
    const cycles = Number(phase.billingCycleCount ?? 0);
    if (unit && cycles > 0) {
      return {
        shape: 'intro',
        offerPriceString: phase.price!.formatted!,
        basePriceString,
        introCycles: cycles * Math.max(1, Number(phase.billingPeriod?.value ?? 1)),
        introUnit: unit,
      };
    }
  }

  // A plainly cheaper SKU. The base price IS the offer.
  return {
    shape: 'flat',
    offerPriceString: basePriceString,
    basePriceString,
    introCycles: null,
    introUnit: null,
  };
}
