/**
 * The network-politeness and never-during-a-walk rules.
 *
 * These are the tests that stand in for the interaction matrix the brief asks
 * for. The UI half of that matrix (switching segments mid-walk, opening
 * directions and returning) is navigation behaviour this test setup cannot
 * exercise — but the DECISION each of those moments turns on is here, and that
 * is the part that can silently regress.
 */

import { LOCAL_TTL_MS, decideFetch, resolveCacheStatus, resolveStatus } from './fetchPolicy';
import type { PawtchiSpot } from './types';

const NOW = Date.parse('2026-08-16T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

const BASE = {
  enabled: true,
  hasCenter: true,
  walkActive: false,
  inFlight: false,
  cachedAt: null as string | null,
  userRequested: false,
  now: NOW,
};

describe('decideFetch', () => {
  it('fetches on a cold cache', () => {
    expect(decideFetch(BASE)).toEqual({ fetch: true, reason: 'cold' });
  });

  it('does NOT fetch when the local cache is fresh', () => {
    // Reopening the tab must never cost an upstream request — this is the rule
    // that keeps us inside the Overpass usage policy as usage grows.
    expect(decideFetch({ ...BASE, cachedAt: iso(2 * HOUR) })).toEqual({
      fetch: false,
      reason: 'fresh',
    });
  });

  it('revalidates once the local cache goes stale', () => {
    expect(decideFetch({ ...BASE, cachedAt: iso(LOCAL_TTL_MS + HOUR) })).toEqual({
      fetch: true,
      reason: 'stale',
    });
  });

  it('never fetches during a tracked walk', () => {
    expect(decideFetch({ ...BASE, walkActive: true })).toEqual({
      fetch: false,
      reason: 'walk_active',
    });
  });

  it('will not let even an explicit refresh hit the network mid-walk', () => {
    // The walk guard sits ABOVE userRequested on purpose. A walk is when the
    // phone is pocketed and the radio should be left alone.
    expect(decideFetch({ ...BASE, walkActive: true, userRequested: true })).toEqual({
      fetch: false,
      reason: 'walk_active',
    });
  });

  it('lets an explicit refresh override freshness, and only freshness', () => {
    expect(decideFetch({ ...BASE, cachedAt: iso(HOUR), userRequested: true })).toEqual({
      fetch: true,
      reason: 'user',
    });
  });

  it('coalesces concurrent requests for the same key', () => {
    expect(decideFetch({ ...BASE, inFlight: true })).toEqual({
      fetch: false,
      reason: 'in_flight',
    });
    // Even a user tap must not duplicate an in-flight request.
    expect(decideFetch({ ...BASE, inFlight: true, userRequested: true })).toEqual({
      fetch: false,
      reason: 'in_flight',
    });
  });

  it('does nothing when disabled or with no coordinate', () => {
    expect(decideFetch({ ...BASE, enabled: false })).toEqual({
      fetch: false,
      reason: 'disabled',
    });
    expect(decideFetch({ ...BASE, hasCenter: false })).toEqual({
      fetch: false,
      reason: 'no_center',
    });
  });

  it('keeps the flag as the outermost gate', () => {
    // With the flag off, nothing else may re-open the network path.
    expect(
      decideFetch({ ...BASE, enabled: false, userRequested: true, cachedAt: null }).fetch,
    ).toBe(false);
  });
});

function spot(id: string): PawtchiSpot {
  return {
    id,
    provider: 'osm',
    providerPlaceId: id,
    category: 'dog_friendly_park',
    name: null,
    latitude: 51.5,
    longitude: -0.12,
    dogAccess: 'unknown',
    accessDescription: null,
    address: null,
    openingHours: null,
    website: null,
    phone: null,
    surface: null,
    fenced: null,
    lit: null,
    dogWaterConfirmed: false,
    emergencyCareConfirmed: false,
    sourceUpdatedAt: null,
    fetchedAt: iso(0),
  };
}

const STATUS_BASE = {
  spots: null as PawtchiSpot[] | null,
  loading: false,
  failed: false,
  enabled: true,
  hasCenter: true,
  canAskLocation: false,
  shownAt: null as string | null,
  now: NOW,
};

describe('resolveStatus', () => {
  it('shows results even while a revalidation is in flight', () => {
    // Swapping good data for a spinner on focus makes a cached screen feel
    // slower than an uncached one.
    expect(
      resolveStatus({
        ...STATUS_BASE,
        spots: [spot('a')],
        loading: true,
        shownAt: iso(HOUR),
      }),
    ).toBe('ready');
  });

  it('shows results with a stale note when a refresh failed', () => {
    expect(
      resolveStatus({ ...STATUS_BASE, spots: [spot('a')], failed: true, shownAt: iso(HOUR) }),
    ).toBe('stale');
  });

  it('marks aged data stale even when nothing failed', () => {
    expect(
      resolveStatus({
        ...STATUS_BASE,
        spots: [spot('a')],
        shownAt: iso(LOCAL_TTL_MS + HOUR),
      }),
    ).toBe('stale');
  });

  it('only errors when a failure has nothing behind it', () => {
    expect(resolveStatus({ ...STATUS_BASE, failed: true })).toBe('error');
    expect(resolveStatus({ ...STATUS_BASE, spots: [spot('a')], failed: true })).not.toBe(
      'error',
    );
  });

  it('distinguishes a genuine empty answer from never having asked', () => {
    // Telling someone there are no parks nearby when we never knew where they
    // were is the wrong claim, and the one this ordering prevents.
    expect(resolveStatus({ ...STATUS_BASE, spots: [] })).toBe('empty');
    expect(
      resolveStatus({ ...STATUS_BASE, spots: [], hasCenter: false, canAskLocation: true }),
    ).toBe('needs_location');
  });

  it('stays idle rather than prompting when location cannot be asked for', () => {
    expect(
      resolveStatus({ ...STATUS_BASE, hasCenter: false, canAskLocation: false }),
    ).toBe('idle');
  });

  it('is idle whenever the feature is off', () => {
    expect(
      resolveStatus({ ...STATUS_BASE, enabled: false, spots: [spot('a')], failed: true }),
    ).toBe('idle');
  });

  it('loads only when there is nothing to show yet', () => {
    expect(resolveStatus({ ...STATUS_BASE, loading: true })).toBe('loading');
  });
});

describe('resolveCacheStatus', () => {
  it('does not launder a local hit into a server hit', () => {
    // Conflating them would make the device cache look useless in the very
    // dashboard we need to read to know whether it earns its place.
    expect(resolveCacheStatus('local', null, true)).toBe('local_hit');
    expect(resolveCacheStatus('local', null, false)).toBe('stale_hit');
  });

  it('passes through what the server said about its own cache', () => {
    expect(resolveCacheStatus('network', 'server_hit', false)).toBe('server_hit');
    expect(resolveCacheStatus('network', 'upstream_fetch', false)).toBe('upstream_fetch');
    expect(resolveCacheStatus('network', 'stale_hit', false)).toBe('stale_hit');
  });

  it('assumes an upstream fetch when the server did not say', () => {
    expect(resolveCacheStatus('network', null, false)).toBe('upstream_fetch');
  });
});
