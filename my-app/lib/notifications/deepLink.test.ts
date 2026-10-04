import { ALL_CAMPAIGNS } from './copy';
import { CAMPAIGN_ROUTE, campaignKeyFor, routeFor, routeForUrl, systemPathFor } from './deepLink';
import {
  ALL_EMAIL_CAMPAIGNS,
  EMAIL_CAMPAIGN_ROUTE,
  EMAIL_CAMPAIGN_WEB_PATH,
} from '../email/copy';

// Universal links are the only way an emailed CTA can open the app: Gmail does
// not follow a custom `pawtchi://` scheme. These tests guard the contract
// between the sender, the website and the app — a slug that drifts in one place
// produces a link that quietly opens the home tab and looks like it worked.
describe('routeForUrl', () => {
  test('every email campaign slug resolves to its in-app route', () => {
    for (const campaign of ALL_EMAIL_CAMPAIGNS) {
      const slug = EMAIL_CAMPAIGN_WEB_PATH[campaign];
      expect(slug).toBeTruthy();
      expect(routeForUrl(`https://pawtchi.com/app/${slug}`)).toBe(
        EMAIL_CAMPAIGN_ROUTE[campaign],
      );
    }
  });

  test('the www host resolves identically', () => {
    expect(routeForUrl('https://www.pawtchi.com/app/health')).toBe('/(tabs)/health');
  });

  test('an entity id is carried through', () => {
    expect(routeForUrl('https://pawtchi.com/app/letters/abc-123')).toBe('/letter/abc-123');
  });

  test('query strings and fragments do not affect the route', () => {
    expect(routeForUrl('https://pawtchi.com/app/health?utm=email#top')).toBe('/(tabs)/health');
  });

  // Anything unrecognised must fall through to normal cold-start behaviour
  // rather than dropping the owner somewhere arbitrary — the exact bug the
  // August audit found in routeFromNotification.
  test('a foreign host is refused', () => {
    expect(routeForUrl('https://evil.example.com/app/health')).toBeNull();
    expect(routeForUrl('https://pawtchi.com.evil.example.com/app/health')).toBeNull();
  });

  test('a non-app path is refused', () => {
    expect(routeForUrl('https://pawtchi.com/pricing')).toBeNull();
    expect(routeForUrl('https://pawtchi.com/')).toBeNull();
  });

  test('an unknown slug is refused rather than guessed', () => {
    expect(routeForUrl('https://pawtchi.com/app/nonsense')).toBeNull();
  });

  describe('a shared trail invitation', () => {
    it('routes to the invite screen and keeps its code', () => {
      // The whole link: without the code the screen opens asking the invitee to
      // type in the thing they just tapped.
      expect(routeForUrl('https://pawtchi.com/app/community-invite?code=abc-123'))
        .toBe('/community-invite?code=abc-123');
    });

    it('drops tracking parameters while keeping the code', () => {
      expect(routeForUrl('https://pawtchi.com/app/community-invite?utm_source=wa&code=abc-123'))
        .toBe('/community-invite?code=abc-123');
    });

    it('still routes when the link has lost its code', () => {
      // A truncated paste. The screen can still ask for the code by hand, which
      // is strictly better than landing on the home tab.
      expect(routeForUrl('https://pawtchi.com/app/community-invite'))
        .toBe('/community-invite');
    });

    it('escapes a code that would otherwise break the query', () => {
      expect(routeForUrl('https://pawtchi.com/app/community-invite?code=a%26b'))
        .toBe('/community-invite?code=a%26b');
    });

    it('carries no query for routes that do not ask for one', () => {
      expect(routeForUrl('https://pawtchi.com/app/health?code=abc')).toBe('/(tabs)/health');
    });
  });

  // There is no expo-updates in this project, so every JS change is a store
  // release. Without this escape hatch, adding one email destination would mean
  // shipping to two stores purely to teach the app a new string.
  describe('explicit route parameter', () => {
    test('an explicit route wins over the slug map', () => {
      expect(routeForUrl('https://pawtchi.com/app/home?r=%2Fwalk-story%2Fabc-1')).toBe(
        '/walk-story/abc-1',
      );
    });

    test('it works on a slug the app has never heard of', () => {
      expect(routeForUrl('https://pawtchi.com/app/nonsense?r=%2Fvet-report')).toBe('/vet-report');
    });

    // The OS only hands us the URL after verifying the domain against our own
    // AASA, but the value is still validated rather than trusted.
    test('it refuses anything that is not a relative in-app path', () => {
      expect(routeForUrl('https://pawtchi.com/app/home?r=https://evil.example.com')).toBe(
        '/(tabs)',
      );
      expect(routeForUrl('https://pawtchi.com/app/home?r=//evil.example.com')).toBe('/(tabs)');
      expect(routeForUrl('https://pawtchi.com/app/home?r=javascript:alert(1)')).toBe('/(tabs)');
      expect(routeForUrl('https://pawtchi.com/app/home?r=relative')).toBe('/(tabs)');
    });
  });

  test('malformed input is refused', () => {
    expect(routeForUrl('not a url')).toBeNull();
    expect(routeForUrl(null)).toBeNull();
    expect(routeForUrl(undefined)).toBeNull();
    expect(routeForUrl('')).toBeNull();
  });
});

describe('routeFor', () => {
  test('every campaign has a route', () => {
    for (const campaign of ALL_CAMPAIGNS) {
      expect(CAMPAIGN_ROUTE[campaign]).toBeTruthy();
      expect(routeFor({ type: campaign })).toBe(CAMPAIGN_ROUTE[campaign]);
    }
  });

  test('an explicit route wins, so new campaigns need no app release', () => {
    expect(routeFor({ type: 'meal_window', route: '/walk-story' })).toBe('/walk-story');
  });

  test('a vet check-in carries its case id', () => {
    expect(routeFor({ type: 'vet_checkin', entityId: 'abc-123' })).toBe(
      '/ask?case=abc-123&mode=checkin',
    );
  });

  test('a vet check-in without an id still opens Ask', () => {
    expect(routeFor({ type: 'vet_checkin' })).toBe('/ask');
  });

  // Regression guard for the audit finding: 100% of live traffic used payload
  // keys that the router did not understand, so every tap went nowhere.
  describe('legacy payloads still route', () => {
    test('pet-reminders sent data.event', () => {
      expect(routeFor({ event: 'meal' })).toBe('/(tabs)/meal');
      expect(routeFor({ event: 'nudge_water' })).toBe('/(tabs)/health');
      expect(routeFor({ event: 'nudge_walk' })).toBe('/(tabs)/activity');
      expect(routeFor({ event: 'trial_2days' })).toBe('/paywall');
    });

    test('the hydration test-message payload lands somewhere sensible', () => {
      expect(routeFor({ event: 'hydration' })).toBe('/(tabs)/health');
    });

    test('check-reminders sent data.action', () => {
      expect(routeFor({ action: 'meal', petId: 'p1' })).toBe('/(tabs)/meal');
    });

    test('the old vet_checkin shape used questionId', () => {
      expect(routeFor({ type: 'vet_checkin', questionId: 'q-9' })).toBe(
        '/ask?case=q-9&mode=checkin',
      );
    });

    test('activity_reminder opens the activity tab', () => {
      expect(routeFor({ type: 'activity_reminder', activityId: 'a1' })).toBe('/(tabs)/activity');
    });
  });

  describe('returns null rather than guessing', () => {
    test.each([
      ['no data', null],
      ['undefined', undefined],
      ['empty payload', {}],
      ['unknown type', { type: 'something_new' }],
      ['non-string type', { type: 42 }],
      ['empty string route', { route: '' }],
    ])('%s', (_label, payload) => {
      expect(routeFor(payload as never)).toBeNull();
    });
  });
});

describe('campaignKeyFor', () => {
  test('prefers the canonical key', () => {
    expect(campaignKeyFor({ campaignKey: 'meal_window', type: 'x', event: 'y' })).toBe(
      'meal_window',
    );
  });

  test('falls back through type, event, then action', () => {
    expect(campaignKeyFor({ type: 'milestone' })).toBe('milestone');
    expect(campaignKeyFor({ event: 'nudge_water' })).toBe('nudge_water');
    expect(campaignKeyFor({ action: 'meal' })).toBe('meal');
    expect(campaignKeyFor({})).toBeNull();
    expect(campaignKeyFor(null)).toBeNull();
  });
});

describe('systemPathFor (app/+native-intent.tsx)', () => {
  it('turns a shared invite link into the invite screen, keeping the code', () => {
    expect(systemPathFor('https://pawtchi.com/app/community-invite?code=10deaa9c-0840-4b22-9291-141e326431cc'))
      .toBe('/community-invite?code=10deaa9c-0840-4b22-9291-141e326431cc');
  });

  it('does the same for the scheme form Expo Router showed as "Unmatched Route"', () => {
    expect(systemPathFor('pawtchi://app/community-invite?code=abc-123')).toBe('/community-invite?code=abc-123');
    expect(systemPathFor('pawtchi:///app/community-invite?code=abc-123')).toBe('/community-invite?code=abc-123');
  });

  it('maps emailed links, and sends an unknown pawtchi.com link Home rather than to a dead end', () => {
    expect(systemPathFor('https://www.pawtchi.com/app/health')).toBe('/(tabs)/health');
    expect(systemPathFor('https://pawtchi.com/app/nonsense')).toBe('/');
    expect(systemPathFor('pawtchi://app/nonsense')).toBe('/');
  });

  it('leaves every route-shaped scheme link to Expo Router, query and all', () => {
    expect(systemPathFor('pawtchi:///community-invite?code=abc-123')).toBeNull();
    expect(systemPathFor('pawtchi:///(tabs)/health?engagement_send=x')).toBeNull();
    expect(systemPathFor('pawtchi:///')).toBeNull();
  });

  it('leaves other hosts and rubbish alone', () => {
    expect(systemPathFor('https://evil.example.com/app/community-invite?code=x')).toBeNull();
    expect(systemPathFor('not a url')).toBeNull();
    expect(systemPathFor(null)).toBeNull();
  });
});
