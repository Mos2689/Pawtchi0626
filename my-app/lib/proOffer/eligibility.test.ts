import {
  assignCohort,
  bucketFor,
  evaluateEligibility,
  hasWindowElapsed,
  shouldShowOffer,
} from './eligibility';
import { PRO_OFFER_CONFIG_FALLBACK } from './types';
import type { ProOfferConfig, ProOfferGrant, ProOfferSignals } from './types';

// Launch thresholds, with the offer switched on. The shipped fallback is
// deliberately disabled, so tests that exercise display have to opt in.
const CONFIG: ProOfferConfig = {
  ...PRO_OFFER_CONFIG_FALLBACK,
  enabled: true,
  variantAllocationPct: 100,
  inboxEnabled: true,
  configVersion: 1,
};

/** A user who passes every rule. Each test breaks exactly one thing. */
const QUALIFIED: ProOfferSignals = {
  ownerId: '11111111-1111-4111-8111-111111111111',
  accountAgeDays: 60,
  viewsTotal: 9,
  dismissalsTotal: 4,
  dismissalsPostFreemium: 3,
  daysSinceLastDismissal: 8,
  purchaseStartedCount: 0,
  daysSincePurchaseStarted: null,
  activeDays14: 6,
  walks30d: 12,
  isReviewBypass: false,
};

const NOW = new Date('2026-08-22T09:00:00.000Z');

function grant(over: Partial<ProOfferGrant> = {}): ProOfferGrant {
  return {
    cohort: 'variant',
    status: 'granted',
    eligibleAt: '2026-08-20T09:00:00.000Z',
    expiresAt: '2026-09-03T09:00:00.000Z', // 12 days out from NOW
    lastShownAt: null,
    shownCount: 0,
    configVersion: 1,
    ...over,
  };
}

describe('evaluateEligibility', () => {
  test('a fully qualified user is eligible with no reasons', () => {
    expect(evaluateEligibility(QUALIFIED, CONFIG)).toEqual({ eligible: true, reasons: [] });
  });

  // ── Rule B ──
  test('B: account younger than 45 days is not eligible', () => {
    const d = evaluateEligibility({ ...QUALIFIED, accountAgeDays: 44 }, CONFIG);
    expect(d.eligible).toBe(false);
    expect(d.reasons).toContain('account_too_young');
  });

  test('B: day 45 exactly is eligible — the boundary is inclusive', () => {
    expect(evaluateEligibility({ ...QUALIFIED, accountAgeDays: 45 }, CONFIG).eligible).toBe(true);
  });

  // ── Rule C ──
  test('C: dismissals during freemium do not count toward the refusal signal', () => {
    // Ten dismissals, but every one of them while nothing was being withheld.
    const d = evaluateEligibility(
      { ...QUALIFIED, dismissalsTotal: 10, dismissalsPostFreemium: 1 },
      CONFIG,
    );
    expect(d.eligible).toBe(false);
    expect(d.reasons).toContain('too_few_post_freemium_dismissals');
  });

  test('C: too few total dismissals is its own reason', () => {
    const d = evaluateEligibility(
      { ...QUALIFIED, dismissalsTotal: 2, dismissalsPostFreemium: 2 },
      CONFIG,
    );
    expect(d.eligible).toBe(false);
    expect(d.reasons).toContain('too_few_total_dismissals');
  });

  // ── Rule D — the anti-cannibalisation rule ──
  test('D: a dismissal 4 days ago blocks the offer', () => {
    const d = evaluateEligibility({ ...QUALIFIED, daysSinceLastDismissal: 4 }, CONFIG);
    expect(d.eligible).toBe(false);
    expect(d.reasons).toContain('dismissal_too_recent');
  });

  test('D: same-day dismissal can never produce an offer', () => {
    const d = evaluateEligibility({ ...QUALIFIED, daysSinceLastDismissal: 0 }, CONFIG);
    expect(d.reasons).toContain('dismissal_too_recent');
  });

  // ── Rule E ──
  test('E: a dormant user is not a discount target', () => {
    const d = evaluateEligibility({ ...QUALIFIED, activeDays14: 2 }, CONFIG);
    expect(d.eligible).toBe(false);
    expect(d.reasons).toContain('not_engaged_enough');
  });

  // ── Rule F ──
  test('F: a recent checkout abandoner cools longer at full price', () => {
    const d = evaluateEligibility(
      { ...QUALIFIED, purchaseStartedCount: 1, daysSincePurchaseStarted: 3 },
      CONFIG,
    );
    expect(d.eligible).toBe(false);
    expect(d.reasons).toContain('checkout_too_recent');
  });

  test('F: an abandoner past the cooldown becomes eligible again', () => {
    const d = evaluateEligibility(
      { ...QUALIFIED, purchaseStartedCount: 1, daysSincePurchaseStarted: 14 },
      CONFIG,
    );
    expect(d.eligible).toBe(true);
  });

  test('never reached checkout → rule F passes trivially', () => {
    expect(
      evaluateEligibility({ ...QUALIFIED, daysSincePurchaseStarted: null }, CONFIG).eligible,
    ).toBe(true);
  });

  test('all failing reasons are reported, not just the first', () => {
    const d = evaluateEligibility(
      {
        ...QUALIFIED,
        accountAgeDays: 10,
        dismissalsTotal: 0,
        dismissalsPostFreemium: 0,
        activeDays14: 0,
      },
      CONFIG,
    );
    expect(d.reasons).toEqual(
      expect.arrayContaining([
        'account_too_young',
        'too_few_post_freemium_dismissals',
        'too_few_total_dismissals',
        'not_engaged_enough',
      ]),
    );
  });

  test('review bypass short-circuits every rule', () => {
    const brandNew: ProOfferSignals = {
      ...QUALIFIED,
      accountAgeDays: 0,
      dismissalsTotal: 0,
      dismissalsPostFreemium: 0,
      daysSinceLastDismissal: null,
      activeDays14: 0,
      isReviewBypass: true,
    };
    expect(evaluateEligibility(brandNew, CONFIG)).toEqual({ eligible: true, reasons: [] });
  });

  test('thresholds come from config, so tuning needs no code change', () => {
    const loose = { ...CONFIG, minAccountAgeDays: 7, minDismissalsPostFreemium: 1 };
    const user = { ...QUALIFIED, accountAgeDays: 10, dismissalsPostFreemium: 1 };
    expect(evaluateEligibility(user, CONFIG).eligible).toBe(false);
    expect(evaluateEligibility(user, loose).eligible).toBe(true);
  });
});

describe('assignCohort', () => {
  test('is deterministic — a re-run cannot move anyone between arms', () => {
    const id = 'abc12345-1111-4111-8111-111111111111';
    const first = assignCohort(id, 50);
    for (let i = 0; i < 20; i++) expect(assignCohort(id, 50)).toBe(first);
  });

  test('0% allocation puts everyone in control', () => {
    for (let i = 0; i < 50; i++) {
      expect(assignCohort(`user-${i}`, 0)).toBe('control');
    }
  });

  test('100% allocation puts everyone in variant', () => {
    for (let i = 0; i < 50; i++) {
      expect(assignCohort(`user-${i}`, 100)).toBe('variant');
    }
  });

  test('buckets spread across the range rather than clustering', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) seen.add(bucketFor(`11111111-1111-4111-8111-${i}`));
    // A hash that collapsed everything into a few buckets would silently make
    // the allocation percentage meaningless.
    expect(seen.size).toBeGreaterThan(40);
  });

  test('roughly honours the allocation percentage over many users', () => {
    let variant = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      if (assignCohort(`00000000-0000-4000-8000-${i}`, 20) === 'variant') variant++;
    }
    expect(variant / n).toBeGreaterThan(0.14);
    expect(variant / n).toBeLessThan(0.27);
  });

  test('out-of-range percentages are clamped rather than throwing', () => {
    expect(assignCohort('x', -10)).toBe('control');
    expect(assignCohort('x', 999)).toBe('variant');
  });
});

describe('shouldShowOffer', () => {
  test('shows for a variant user inside an open window', () => {
    const d = shouldShowOffer(grant(), CONFIG, { now: NOW, isPro: false });
    expect(d.show).toBe(true);
    expect(d.impressionIndex).toBe(1);
    expect(d.daysLeftInWindow).toBe(12);
  });

  test('a subscriber never sees it, even with a live grant', () => {
    const d = shouldShowOffer(grant(), CONFIG, { now: NOW, isPro: true });
    expect(d.show).toBe(false);
    expect(d.reason).toBe('already_subscribed');
  });

  test('isPro outranks the kill switch and the grant alike', () => {
    // Ordering matters: a paying subscriber must be excluded by the first
    // check, so no later branch can ever leak a discount screen to them.
    const d = shouldShowOffer(null, { ...CONFIG, enabled: false }, { now: NOW, isPro: true });
    expect(d.reason).toBe('already_subscribed');
  });

  test('kill switch off → standard paywall for everyone', () => {
    const d = shouldShowOffer(grant(), { ...CONFIG, enabled: false }, { now: NOW, isPro: false });
    expect(d.show).toBe(false);
    expect(d.reason).toBe('config_disabled');
  });

  test('no grant → standard paywall', () => {
    expect(shouldShowOffer(null, CONFIG, { now: NOW, isPro: false }).reason).toBe('no_grant');
  });

  test('control cohort holds at $9.99 but still has a grant row', () => {
    const d = shouldShowOffer(grant({ cohort: 'control' }), CONFIG, { now: NOW, isPro: false });
    expect(d.show).toBe(false);
    expect(d.reason).toBe('control_cohort');
  });

  test.each(['converted', 'expired', 'revoked'] as const)('%s grants do not render', status => {
    const d = shouldShowOffer(grant({ status }), CONFIG, { now: NOW, isPro: false });
    expect(d.show).toBe(false);
    expect(d.reason).toBe('window_closed');
  });

  test('an elapsed window closes even if the sweep has not run yet', () => {
    const d = shouldShowOffer(
      grant({ expiresAt: '2026-08-21T09:00:00.000Z' }),
      CONFIG,
      { now: NOW, isPro: false },
    );
    expect(d.reason).toBe('window_closed');
  });

  test('an unparseable expiry fails closed rather than showing forever', () => {
    const d = shouldShowOffer(grant({ expiresAt: 'not-a-date' }), CONFIG, {
      now: NOW,
      isPro: false,
    });
    expect(d.show).toBe(false);
    expect(d.reason).toBe('window_closed');
  });

  test('impression budget is enforced', () => {
    const spent = grant({ status: 'shown', shownCount: 3, lastShownAt: '2026-08-10T09:00:00.000Z' });
    expect(shouldShowOffer(spent, CONFIG, { now: NOW, isPro: false }).reason).toBe(
      'impressions_exhausted',
    );
  });

  test('72h spacing holds a second impression back', () => {
    const recent = grant({
      status: 'shown',
      shownCount: 1,
      lastShownAt: '2026-08-21T09:00:00.000Z', // 24h before NOW
    });
    expect(shouldShowOffer(recent, CONFIG, { now: NOW, isPro: false }).reason).toBe(
      'too_soon_since_last_impression',
    );
  });

  test('past the spacing window the next impression is allowed and indexed', () => {
    const older = grant({
      status: 'shown',
      shownCount: 1,
      lastShownAt: '2026-08-18T09:00:00.000Z', // 96h before NOW
    });
    const d = shouldShowOffer(older, CONFIG, { now: NOW, isPro: false });
    expect(d.show).toBe(true);
    expect(d.impressionIndex).toBe(2);
  });

  test('the shipped fallback config shows nothing to anyone', () => {
    const d = shouldShowOffer(grant(), PRO_OFFER_CONFIG_FALLBACK, { now: NOW, isPro: false });
    expect(d.show).toBe(false);
    expect(d.reason).toBe('config_disabled');
  });
});

describe('hasWindowElapsed', () => {
  test('true once the window has run out', () => {
    expect(hasWindowElapsed(grant({ expiresAt: '2026-08-21T09:00:00.000Z' }), NOW)).toBe(true);
  });

  test('false while the window is open', () => {
    expect(hasWindowElapsed(grant(), NOW)).toBe(false);
  });

  test('terminal grants are left alone — converted must not become expired', () => {
    const converted = grant({ status: 'converted', expiresAt: '2026-08-01T09:00:00.000Z' });
    expect(hasWindowElapsed(converted, NOW)).toBe(false);
  });
});
