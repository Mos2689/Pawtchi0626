import { buildProfileMembershipPresentation } from './profileMembership';

describe('buildProfileMembershipPresentation', () => {
  test('does not mislabel the user while subscription state is loading', () => {
    expect(buildProfileMembershipPresentation({
      status: 'loading',
      daysLeft: null,
      isPro: false,
      hasFullAccess: true,
    })).toMatchObject({
      tone: 'loading',
      planLabel: 'Membership',
      actionLabel: null,
    });
  });

  test('shows active Plus membership and useful period information', () => {
    expect(buildProfileMembershipPresentation({
      status: 'active',
      daysLeft: 18,
      isPro: true,
      hasFullAccess: true,
    })).toEqual({
      tone: 'plus',
      planLabel: 'Pawtchi Plus',
      statusLabel: 'ACTIVE',
      detail: '18 days in this billing period · Full access',
      actionLabel: 'Manage',
      daysLeft: null,
    });
  });

  test('handles trial day grammar', () => {
    expect(buildProfileMembershipPresentation({
      status: 'trial',
      daysLeft: 1,
      isPro: true,
      hasFullAccess: true,
    }).detail).toBe('1 day left in your trial · Full access');
  });

  test('gives a running trial its own tone and a countdown to render', () => {
    // Trial used to collapse into `plus`, which made the one state with a
    // deadline the one state that never showed it.
    expect(buildProfileMembershipPresentation({
      status: 'trial',
      daysLeft: 5,
      isPro: true,
      hasFullAccess: true,
    })).toMatchObject({ tone: 'trial', statusLabel: 'TRIAL', daysLeft: 5 });
  });

  test('does not count down a paid renewal', () => {
    // A renewal is not a deadline. Putting a countdown on one invites a
    // cancellation nobody was considering.
    expect(buildProfileMembershipPresentation({
      status: 'active',
      daysLeft: 3,
      isPro: true,
      hasFullAccess: true,
    }).daysLeft).toBeNull();
  });

  test('offers no countdown for a trial whose remaining days are unknown', () => {
    expect(buildProfileMembershipPresentation({
      status: 'trial',
      daysLeft: null,
      isPro: true,
      hasFullAccess: true,
    })).toMatchObject({ tone: 'trial', daysLeft: null });
    expect(buildProfileMembershipPresentation({
      status: 'trial',
      daysLeft: 0,
      isPro: true,
      hasFullAccess: true,
    }).daysLeft).toBeNull();
  });

  test('identifies a free user who still has welcome access honestly', () => {
    expect(buildProfileMembershipPresentation({
      status: 'none',
      daysLeft: 0,
      isPro: false,
      hasFullAccess: true,
    })).toMatchObject({
      planLabel: 'Free plan',
      statusLabel: 'CURRENT',
      detail: 'Full access is included during your welcome period',
      actionLabel: 'Explore Plus',
    });
  });

  test('tells a lapsed subscriber their membership ended', () => {
    expect(buildProfileMembershipPresentation({
      status: 'expired',
      daysLeft: 0,
      isPro: false,
      hasFullAccess: false,
    })).toEqual({
      tone: 'locked',
      planLabel: 'Pawtchi Plus',
      statusLabel: 'ENDED',
      detail: 'Your Plus membership has ended — personalised guidance is paused',
      actionLabel: 'Renew Plus',
      daysLeft: null,
    });
  });

  test('tells a gated user whose welcome period ran out, and does not call it CURRENT', () => {
    // The reported bug: a 146-day-old account with gating active read
    // "Free plan · CURRENT" — the same words shown to someone who currently
    // has everything.
    const presentation = buildProfileMembershipPresentation({
      status: 'none',
      daysLeft: 0,
      isPro: false,
      hasFullAccess: false,
    });
    expect(presentation.tone).toBe('locked');
    expect(presentation.statusLabel).toBe('LIMITED');
    expect(presentation.statusLabel).not.toBe('CURRENT');
    expect(presentation.detail).toMatch(/welcome period has ended/);
  });

  test('never says CURRENT to someone who cannot use the app fully', () => {
    // The property behind both cases above: "CURRENT" is a reassurance, and a
    // reassurance shown to a gated user is the card taking the wrong side.
    for (const status of ['none', 'expired'] as const) {
      const presentation = buildProfileMembershipPresentation({
        status,
        daysLeft: 0,
        isPro: false,
        hasFullAccess: false,
      });
      expect(presentation.statusLabel).not.toBe('CURRENT');
      expect(presentation.tone).toBe('locked');
    }
  });

  test('every non-subscriber gets a button, gated or not', () => {
    for (const status of ['none', 'expired'] as const) {
      for (const hasFullAccess of [true, false]) {
        const presentation = buildProfileMembershipPresentation({
          status,
          daysLeft: 0,
          isPro: false,
          hasFullAccess,
        });
        expect(['free', 'locked']).toContain(presentation.tone);
        expect(presentation.actionLabel).toBeTruthy();
      }
    }
  });

  test('never states a price, a discount or a trial length', () => {
    // Those come from RevenueCat at the point of purchase. A profile card that
    // hardcodes them is how a store listing and an app end up disagreeing about
    // money — which is a rejection, and a lie to somebody.
    const inputs = [
      { status: 'none', daysLeft: 0, isPro: false, hasFullAccess: true },
      { status: 'expired', daysLeft: 0, isPro: false, hasFullAccess: false },
      { status: 'trial', daysLeft: 7, isPro: true, hasFullAccess: true },
      { status: 'active', daysLeft: 30, isPro: true, hasFullAccess: true },
    ] as const;

    for (const input of inputs) {
      const { planLabel, statusLabel, detail, actionLabel } =
        buildProfileMembershipPresentation(input);
      const text = [planLabel, statusLabel, detail, actionLabel].join(' ');
      expect(text).not.toMatch(/[$€£₹]|\d+\s*%|free trial|per month|\/mo|year/i);
    }
  });

  // ── Granted access: a creator code, or a comped creator ──────────────────
  //
  // `isPro` used to mean exactly one thing. These tests pin the two places
  // where treating granted access as a purchase told somebody something untrue
  // about their money.

  describe('granted access', () => {
    const GRANTED = {
      status: 'active',
      daysLeft: 88,
      isPro: true,
      hasFullAccess: true,
      isPromoAccess: true,
      expiresAt: new Date(2026, 11, 6),
    } as const;

    test('gets its own tone rather than reading as a paid plan', () => {
      expect(buildProfileMembershipPresentation(GRANTED).tone).toBe('granted');
    });

    test('offers no action, because there is no subscription to manage', () => {
      // The failure this prevents: "Manage" opening an empty App Store
      // subscriptions page, which reads as our billing being broken.
      expect(buildProfileMembershipPresentation(GRANTED).actionLabel).toBeNull();
    });

    test('says when access ends, not that it renews', () => {
      const { detail } = buildProfileMembershipPresentation(GRANTED);
      expect(detail).toContain('6 December');
      expect(detail.toLowerCase()).not.toContain('billing');
      expect(detail.toLowerCase()).not.toContain('renew');
    });

    test('counts down, unlike a paid plan', () => {
      expect(buildProfileMembershipPresentation(GRANTED).daysLeft).toBe(88);
    });

    test('without an end date it falls back to the paid copy rather than a blank', () => {
      // A promo flag with no expiry means we do not actually know when this
      // stops. Printing "open until " with nothing after it is worse than
      // showing the ordinary Plus card.
      const presentation = buildProfileMembershipPresentation({
        ...GRANTED,
        expiresAt: null,
      });
      expect(presentation.tone).toBe('plus');
      expect(presentation.detail).not.toContain('until');
    });

    test('a real subscriber is never given the granted tone', () => {
      for (const status of ['trial', 'active'] as const) {
        const presentation = buildProfileMembershipPresentation({
          status,
          daysLeft: 7,
          isPro: true,
          hasFullAccess: true,
          isPromoAccess: false,
          expiresAt: new Date(2026, 11, 6),
        });
        expect(presentation.tone).not.toBe('granted');
        expect(presentation.actionLabel).toBe('Manage');
      }
    });

    test('states no price either', () => {
      const { planLabel, statusLabel, detail, actionLabel } =
        buildProfileMembershipPresentation(GRANTED);
      const text = [planLabel, statusLabel, detail, actionLabel].join(' ');
      expect(text).not.toMatch(/[$€£₹]|\d+\s*%|free trial|per month|\/mo/i);
    });
  });
});
