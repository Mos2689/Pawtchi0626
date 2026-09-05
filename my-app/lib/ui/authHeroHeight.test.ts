import {
  authHeroOverlay,
  AUTH_HERO_COMPACT,
  AUTH_HERO_GAP,
  AUTH_HERO_MAX,
  AUTH_HERO_MIN,
  authHeroHeight,
} from './authHeroHeight';

/**
 * Content heights measured from the real screen, so the cases below are the
 * ones that actually occur rather than round numbers.
 *
 * Sign-up is the tall mode: it carries the three-line collection notice that
 * APP 5 requires before an account exists. Sign-in drops that and adds the
 * shorter forgot-password button.
 */
const SIGNUP_CONTENT = 505; // incl. 24 padding + a 48dp three-button nav bar
const SIGNIN_CONTENT = 452;

describe('authHeroHeight', () => {
  // The whole point: on a mid-size Android phone the hero gives up enough
  // height that the screen stops scrolling on arrival.
  test('fits the content on a typical Android viewport', () => {
    const windowHeight = 780;
    const hero = authHeroHeight({
      windowHeight,
      contentHeight: SIGNUP_CONTENT,
      keyboardOpen: false,
    });

    expect(hero).toBeLessThan(AUTH_HERO_MAX);
    expect(hero + AUTH_HERO_GAP + SIGNUP_CONTENT).toBeLessThanOrEqual(windowHeight);
  });

  test('fits sign-in too, and gives the extra room back to the photo', () => {
    const windowHeight = 780;
    const signUp = authHeroHeight({
      windowHeight,
      contentHeight: SIGNUP_CONTENT,
      keyboardOpen: false,
    });
    const signIn = authHeroHeight({
      windowHeight,
      contentHeight: SIGNIN_CONTENT,
      keyboardOpen: false,
    });

    expect(signIn).toBeGreaterThan(signUp);
    expect(signIn + AUTH_HERO_GAP + SIGNIN_CONTENT).toBeLessThanOrEqual(windowHeight);
  });

  // A tall device must not enlarge the photograph past the size it was drawn
  // at — the slack goes to the content block's flex instead.
  test('never exceeds the design height on a tall device', () => {
    expect(
      authHeroHeight({ windowHeight: 1180, contentHeight: SIGNIN_CONTENT, keyboardOpen: false }),
    ).toBe(AUTH_HERO_MAX);
  });

  // Below the floor the crop stops reading as a scene, so we stop shrinking
  // and let the screen scroll. Scrolling is the honest answer here.
  test('stops at the floor rather than squashing the crop', () => {
    expect(
      authHeroHeight({ windowHeight: 560, contentHeight: 620, keyboardOpen: false }),
    ).toBe(AUTH_HERO_MIN);
  });

  test('holds the floor for a large accessibility font scale', () => {
    // Same viewport, content grown by a 1.3x font scale.
    expect(
      authHeroHeight({ windowHeight: 780, contentHeight: 700, keyboardOpen: false }),
    ).toBe(AUTH_HERO_MIN);
  });

  // The keyboard case is what frees the password field. It wins over every
  // other consideration, including a tall device.
  test('collapses to the brand band whenever the keyboard is open', () => {
    for (const windowHeight of [560, 780, 1180]) {
      for (const contentHeight of [null, SIGNIN_CONTENT, SIGNUP_CONTENT, 700]) {
        expect(authHeroHeight({ windowHeight, contentHeight, keyboardOpen: true })).toBe(
          AUTH_HERO_COMPACT,
        );
      }
    }
  });

  test('the collapsed band clears a typical keyboard on a typical phone', () => {
    // 780dp viewport, ~300dp keyboard leaves 480dp; the compact hero plus the
    // gap must leave the form the bulk of that.
    const visible = 780 - 300;
    expect(AUTH_HERO_COMPACT + AUTH_HERO_GAP).toBeLessThan(visible / 2);
  });

  // First frame, before onLayout has reported anything.
  test('estimates from the viewport before the content is measured', () => {
    expect(authHeroHeight({ windowHeight: 780, contentHeight: null, keyboardOpen: false })).toBe(
      265,
    );
    // And the estimate is still clamped at both ends.
    expect(authHeroHeight({ windowHeight: 400, contentHeight: null, keyboardOpen: false })).toBe(
      AUTH_HERO_MIN,
    );
    expect(authHeroHeight({ windowHeight: 2000, contentHeight: null, keyboardOpen: false })).toBe(
      AUTH_HERO_MAX,
    );
  });

  // A zero or NaN measurement must not produce a zero-height hero.
  test('degrades to the design height on a nonsense measurement', () => {
    expect(
      authHeroHeight({ windowHeight: NaN, contentHeight: null, keyboardOpen: false }),
    ).toBe(AUTH_HERO_MAX);
    expect(
      authHeroHeight({ windowHeight: 0, contentHeight: 0, keyboardOpen: false }),
    ).toBe(AUTH_HERO_MIN);
  });

  test('always returns a whole number of points', () => {
    const hero = authHeroHeight({
      windowHeight: 781.7,
      contentHeight: 504.3,
      keyboardOpen: false,
    });
    expect(Number.isInteger(hero)).toBe(true);
  });
});

describe('authHeroOverlay', () => {
  const ANDROID_STATUS_BAR = 28;

  // The stack is 30 + 174*scale tall. This is the assertion that stops it
  // being clipped by the hero it sits inside.
  const stackHeight = (scale: number) => 30 + 174 * scale;

  // At the design height the helper must change nothing — otherwise it would
  // be quietly redesigning a hero that was already correct.
  test('is a no-op at the design hero height', () => {
    expect(authHeroOverlay({ heroHeight: AUTH_HERO_MAX, topInset: ANDROID_STATUS_BAR }).scale).toBe(1);
  });

  test('keeps the stack clear of the wordmark', () => {
    for (const heroHeight of [AUTH_HERO_MIN, 265, 300, AUTH_HERO_MAX]) {
      const { top } = authHeroOverlay({ heroHeight, topInset: ANDROID_STATUS_BAR });
      // 20 below the inset, ~34 of wordmark, then a breath.
      expect(top).toBeGreaterThanOrEqual(ANDROID_STATUS_BAR + 54);
    }
  });

  // The failure this whole helper exists to prevent: the WALK row falling off
  // the bottom of a shortened hero.
  test('the stack fits inside the hero at every fitted height', () => {
    for (const heroHeight of [265, 280, 300, 340, AUTH_HERO_MAX]) {
      const { top, scale } = authHeroOverlay({ heroHeight, topInset: ANDROID_STATUS_BAR });
      expect(top + stackHeight(scale)).toBeLessThanOrEqual(heroHeight);
    }
  });

  test('shrinks the numerals in proportion to the hero', () => {
    const full = authHeroOverlay({ heroHeight: AUTH_HERO_MAX, topInset: ANDROID_STATUS_BAR });
    const short = authHeroOverlay({ heroHeight: 265, topInset: ANDROID_STATUS_BAR });

    expect(short.scale).toBeLessThan(full.scale);
    // A 34pt numeral is 8.9% of a 380 hero; the scaled one should stay in the
    // same neighbourhood rather than becoming a different design.
    const fullRatio = (34 * full.scale) / AUTH_HERO_MAX;
    const shortRatio = (34 * short.scale) / 265;
    expect(Math.abs(fullRatio - shortRatio)).toBeLessThan(0.02);
  });

  test('never scales below the legibility floor', () => {
    const { scale } = authHeroOverlay({ heroHeight: AUTH_HERO_MIN, topInset: 60 });
    expect(scale).toBeGreaterThanOrEqual(0.55);
  });

  test('never scales above the design values', () => {
    expect(authHeroOverlay({ heroHeight: 900, topInset: 0 }).scale).toBe(1);
  });

  test('degrades to the design values on a nonsense inset', () => {
    expect(authHeroOverlay({ heroHeight: NaN, topInset: NaN }).scale).toBe(1);
  });

  // A tall status bar (or a punch-hole device reporting a big inset) must push
  // the stack down, not let it slide under the wordmark.
  test('respects a larger top inset', () => {
    const small = authHeroOverlay({ heroHeight: 300, topInset: 24 });
    const large = authHeroOverlay({ heroHeight: 300, topInset: 48 });
    expect(large.top).toBeGreaterThan(small.top);
    expect(large.scale).toBeLessThan(small.scale);
    expect(large.top + stackHeight(large.scale)).toBeLessThanOrEqual(300);
  });
});
