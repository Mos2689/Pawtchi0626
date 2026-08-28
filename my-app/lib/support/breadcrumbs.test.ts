// The breadcrumb buffer's job is to be useful without being a data leak.
//
// The redaction rule — event names and a two-field taxonomy allowlist, never
// analytics props — is a privacy boundary, not a style preference. Analytics
// events in this app deliberately carry pet attributes (breed, allergies, body
// condition score; see app/privacy.tsx §2), so a regression that passed props
// through would silently start shipping an animal's medical history into a
// support inbox.
//
// These tests exist so that regression fails loudly instead.

import {
  BREADCRUMB_LIMIT,
  __recordForTest,
  __resetBreadcrumbs,
  getBreadcrumbs,
  installBreadcrumbs,
} from './breadcrumbs';
import { track } from '../analytics';

beforeEach(() => {
  __resetBreadcrumbs();
});

describe('redaction', () => {
  test('records the event name and nothing else', () => {
    __recordForTest('walk_completed', { distance_km: 3.2, pet_name: 'Milo' });

    const [crumb] = getBreadcrumbs();
    expect(crumb.e).toBe('walk_completed');
    expect(Object.keys(crumb).sort()).toEqual(['e', 't']);
  });

  test('an event carrying pet attributes yields a name-only crumb', () => {
    // Shaped after a real `bcs_photo_suggestion_shown` payload — exactly the
    // kind of event whose props must never reach a support ticket.
    __recordForTest('bcs_photo_suggestion_shown', {
      breed: 'Golden Retriever',
      species: 'dog',
      weight_kg: 31.4,
      body_condition_score: 7,
      allergens: 'chicken,beef',
      pet_name: 'Milo',
    });

    const serialised = JSON.stringify(getBreadcrumbs());
    for (const leak of ['Golden', 'Milo', 'chicken', 'beef', '31.4', '"7"']) {
      expect(serialised).not.toContain(leak);
    }
    expect(getBreadcrumbs()[0].e).toBe('bcs_photo_suggestion_shown');
  });

  test('app_error keeps kind and context — both closed taxonomies', () => {
    __recordForTest('app_error', {
      kind: 'timeout',
      context: 'food_scan',
      retryable: true,
      technical: 'Timed out after 45000ms',
    });

    const [crumb] = getBreadcrumbs();
    expect(crumb.e).toBe('app_error:timeout');
    expect(crumb.ctx).toBe('food_scan');
    // `technical` is safe by construction but adds noise, so it is not carried.
    expect(JSON.stringify(crumb)).not.toContain('45000');
  });

  test('app_error with no kind degrades rather than throwing', () => {
    __recordForTest('app_error', {});
    expect(getBreadcrumbs()[0].e).toBe('app_error:unknown');
  });

  test('caps absurdly long taxonomy values', () => {
    __recordForTest('app_error', { kind: 'x'.repeat(500), context: 'y'.repeat(500) });

    const [crumb] = getBreadcrumbs();
    expect(crumb.e.length).toBeLessThanOrEqual('app_error:'.length + 32);
    expect(crumb.ctx!.length).toBeLessThanOrEqual(32);
  });
});

describe('the ring buffer', () => {
  test('keeps only the most recent BREADCRUMB_LIMIT entries', () => {
    for (let i = 0; i < BREADCRUMB_LIMIT + 15; i++) {
      __recordForTest(i % 2 === 0 ? 'walk_completed' : 'moment_card_viewed');
    }

    expect(getBreadcrumbs()).toHaveLength(BREADCRUMB_LIMIT);
  });

  test('keeps the newest, not the oldest — the run-up to a failure is the point', () => {
    for (let i = 0; i < BREADCRUMB_LIMIT; i++) __recordForTest('walk_completed');
    __recordForTest('app_error', { kind: 'server' });

    const crumbs = getBreadcrumbs();
    expect(crumbs).toHaveLength(BREADCRUMB_LIMIT);
    expect(crumbs[crumbs.length - 1].e).toBe('app_error:server');
  });

  test('getBreadcrumbs returns a copy the caller cannot corrupt', () => {
    __recordForTest('walk_completed');
    getBreadcrumbs().push({ t: 0, e: 'injected' });

    expect(getBreadcrumbs()).toHaveLength(1);
  });
});

describe('installation', () => {
  test('captures events sent through track()', () => {
    installBreadcrumbs();
    track('support_home_viewed', { entry_source: 'profile' });

    expect(getBreadcrumbs().map((c) => c.e)).toContain('support_home_viewed');
  });

  test('is idempotent — a double install must not double-record', () => {
    installBreadcrumbs();
    installBreadcrumbs();
    installBreadcrumbs();

    track('support_thread_opened');

    const hits = getBreadcrumbs().filter((c) => c.e === 'support_thread_opened');
    expect(hits).toHaveLength(1);
  });
});
