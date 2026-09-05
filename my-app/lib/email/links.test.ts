import {
  APP_SCHEME,
  CTA_DEFAULT_TARGET,
  CTA_TARGETS,
  clickUrl,
  ctaTargetForPath,
  deepLinkFor,
  isCtaTarget,
  routeForTarget,
  type CtaTarget,
} from './links';
import { WEB_PATH_TO_ROUTE } from './copy';
import { routeForUrl } from '../notifications/deepLink';

const FUNCTIONS_BASE = 'https://mbvpjbwukhypvmgeuyyw.supabase.co/functions/v1';
const SEND_ID = '3f1c2b6e-9a4d-4c1f-8b2a-7e5d0c9a1b34';
const RESOURCE_ID = 'a1b2c3d4-e5f6-4718-9a0b-1c2d3e4f5061';

describe('the destination allowlist', () => {
  // The allowlist and the route table are the same thing. If they can drift,
  // a target can exist with no route (dead link) or a route can exist that no
  // email can name (dead code) — and both look fine in review.
  test('is exactly the route table', () => {
    expect([...CTA_TARGETS].sort()).toEqual(Object.keys(WEB_PATH_TO_ROUTE).sort());
  });

  test('accepts only its own members', () => {
    for (const target of CTA_TARGETS) expect(isCtaTarget(target)).toBe(true);
    for (const value of ['', 'HOME', 'admin', '../home', null, undefined, 7, {}]) {
      expect(isCtaTarget(value)).toBe(false);
    }
  });

  test('the default target is itself allowlisted', () => {
    expect(isCtaTarget(CTA_DEFAULT_TARGET)).toBe(true);
  });
});

describe('deepLinkFor', () => {
  // The triple slash is the whole point. `pawtchi://(tabs)/health` parses with
  // "(tabs)" as the HOSTNAME and "/health" as the path, which is a different
  // and wrong destination.
  test('every target produces a triple-slash URL with an empty host', () => {
    for (const target of CTA_TARGETS) {
      const link = deepLinkFor(target);
      expect(link.startsWith(`${APP_SCHEME}:///`)).toBe(true);

      const parsed = new URL(link);
      expect(parsed.protocol).toBe(`${APP_SCHEME}:`);
      expect(parsed.hostname).toBe('');
      expect(parsed.pathname).toBe(WEB_PATH_TO_ROUTE[target]);
    }
  });

  test('lands on the same route a push would', () => {
    expect(deepLinkFor('health')).toBe('pawtchi:///(tabs)/health');
    expect(deepLinkFor('home')).toBe('pawtchi:///(tabs)');
    expect(deepLinkFor('walks')).toBe('pawtchi:///walk-gallery');
  });

  test('carries the send id as engagement_send', () => {
    const link = deepLinkFor('health', null, SEND_ID);
    expect(link).toBe(`pawtchi:///(tabs)/health?engagement_send=${SEND_ID}`);
    expect(new URL(link).searchParams.get('engagement_send')).toBe(SEND_ID);
  });

  test('appends the id only where a route takes one', () => {
    expect(deepLinkFor('letters', RESOURCE_ID)).toBe(`pawtchi:///letter/${RESOURCE_ID}`);
    expect(deepLinkFor('support', RESOURCE_ID)).toBe(`pawtchi:///support/${RESOURCE_ID}`);
    // `/(tabs)/health/<uuid>` is not a route; appending it would strand the tap.
    expect(deepLinkFor('health', RESOURCE_ID)).toBe('pawtchi:///(tabs)/health');
    expect(deepLinkFor('walks', RESOURCE_ID)).toBe('pawtchi:///walk-gallery');
  });

  test('falls back to the list route when the id is absent', () => {
    expect(deepLinkFor('letters', null)).toBe('pawtchi:///letter');
    expect(deepLinkFor('support', null)).toBe('pawtchi:///support');
  });

  // The app is the other half of this contract. A deep link the redirect emits
  // and the app cannot invert is a link that opens the app on the wrong screen.
  test('round-trips through the app router for every target', () => {
    for (const target of CTA_TARGETS) {
      expect(routeForUrl(deepLinkFor(target, null, SEND_ID))).toBe(routeForTarget(target));
    }
    expect(routeForUrl(deepLinkFor('letters', RESOURCE_ID, SEND_ID))).toBe(
      `/letter/${RESOURCE_ID}`,
    );
  });
});

describe('clickUrl', () => {
  test('is an https URL on the functions origin', () => {
    const url = clickUrl({ functionsBase: FUNCTIONS_BASE, sendId: SEND_ID }, 'health');
    expect(url).toBe(
      `${FUNCTIONS_BASE}/engagement-click?s=${SEND_ID}&t=health`,
    );
    expect(new URL(url).protocol).toBe('https:');
  });

  test('never puts the custom scheme in the link', () => {
    for (const target of CTA_TARGETS) {
      const url = clickUrl({ functionsBase: FUNCTIONS_BASE, sendId: SEND_ID }, target);
      expect(url).not.toContain(`${APP_SCHEME}:`);
    }
  });

  test('tolerates a trailing slash on the base', () => {
    expect(
      clickUrl({ functionsBase: `${FUNCTIONS_BASE}/`, sendId: SEND_ID }, 'home'),
    ).toBe(`${FUNCTIONS_BASE}/engagement-click?s=${SEND_ID}&t=home`);
  });

  test('carries a resource id as r', () => {
    const url = clickUrl(
      { functionsBase: FUNCTIONS_BASE, sendId: SEND_ID },
      'letters',
      RESOURCE_ID,
    );
    expect(new URL(url).searchParams.get('r')).toBe(RESOURCE_ID);
  });
});

describe('ctaTargetForPath', () => {
  test('reads every composition CTA path', () => {
    for (const target of CTA_TARGETS) {
      expect(ctaTargetForPath(`/app/${target}`)).toEqual({ target, resourceId: null });
    }
  });

  test('keeps the identifier', () => {
    expect(ctaTargetForPath(`/app/letters/${RESOURCE_ID}`)).toEqual({
      target: 'letters',
      resourceId: RESOURCE_ID,
    });
  });

  test('ignores query and fragment', () => {
    expect(ctaTargetForPath('/app/health?utm=email#top')).toEqual({
      target: 'health',
      resourceId: null,
    });
  });

  // Anything unrecognised must fall through to the plain website URL rather
  // than quietly become a click link to somewhere else.
  test('refuses anything not an allowlisted /app path', () => {
    for (const path of [
      '/app/nonsense',
      '/app',
      '/health',
      '/unsubscribe.html',
      'https://evil.example.com/app/health',
      '/app/../home',
      '',
    ]) {
      expect(ctaTargetForPath(path)).toBeNull();
    }
  });
});

describe('there is no open redirect', () => {
  // The click URL names a KEY, never a destination. These are the parameter
  // names an attacker would try; none of them exists, so all of them land on
  // the safe default.
  test('a URL-shaped target is rejected and the default is used', () => {
    for (const hostile of [
      'https://evil.example.com',
      '//evil.example.com',
      'javascript:alert(1)',
      'pawtchi:///paywall',
      '/app/../../etc',
    ] as unknown as CtaTarget[]) {
      expect(isCtaTarget(hostile)).toBe(false);
      const link = deepLinkFor(isCtaTarget(hostile) ? hostile : CTA_DEFAULT_TARGET);
      expect(link).toBe('pawtchi:///(tabs)');
    }
  });
});

// Some URL normalisers rewrite `scheme:///path` to `scheme://path/` — curl does
// it to `pawtchi:///walk-gallery`, hoisting the first segment into the hostname.
// The wire format is the triple slash (verified against the deployed function),
// but the app must not be brittle if something in the chain normalises it.
describe('normalised two-slash arrivals', () => {
  test('resolve to the same route as the triple-slash form', () => {
    expect(routeForUrl('pawtchi://walk-gallery/')).toBe('/walk-gallery');
    expect(routeForUrl('pawtchi://walk-gallery')).toBe('/walk-gallery');
    expect(routeForUrl('pawtchi://support/abc-1')).toBe('/support/abc-1');
    expect(routeForUrl(`pawtchi://walk-gallery/?engagement_send=${SEND_ID}`)).toBe(
      '/walk-gallery',
    );
  });
});
