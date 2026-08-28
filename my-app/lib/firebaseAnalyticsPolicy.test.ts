import {
  asInternalFirebaseUserId,
  createSessionTransactionDeduper,
  firebaseEventsForProductEvent,
  sanitizeFirebaseEvent,
} from './firebaseAnalyticsPolicy';

describe('Firebase Analytics privacy policy', () => {
  test('rejects arbitrary event names', () => {
    expect(sanitizeFirebaseEvent('screen_view', { screen_name: 'health' })).toBeNull();
    expect(sanitizeFirebaseEvent('posthog_event', { email: 'owner@example.com' })).toBeNull();
  });

  test('parameterless milestones drop every supplied property', () => {
    expect(sanitizeFirebaseEvent('pet_profile_completed', {
      email: 'owner@example.com',
      pet_name: 'Milo',
      breed: 'Beagle',
      weight: 12,
      daily_kcal: 500,
      notes: 'medical note',
    })).toEqual({});
  });

  test('sign_up permits only a short authentication method', () => {
    expect(sanitizeFirebaseEvent('sign_up', {
      method: 'password',
      email: 'owner@example.com',
      user_id: 'not-allowed-here',
    })).toEqual({ method: 'password' });
  });

  test('purchase rebuilds only the approved value contract', () => {
    expect(sanitizeFirebaseEvent('purchase', {
      transaction_id: 'txn_123',
      currency: 'aud',
      value: 9.99,
      product_id: 'pawtchi_monthly',
      email: 'owner@example.com',
      pet_name: 'Milo',
      food_name: 'Private food',
    })).toEqual({
      transaction_id: 'txn_123',
      currency: 'AUD',
      value: 9.99,
      items: [{ item_id: 'pawtchi_monthly' }],
    });
  });

  test('purchase requires a transaction ID for session deduplication', () => {
    expect(sanitizeFirebaseEvent('purchase', { currency: 'AUD', value: 9.99 })).toBeNull();
  });

  test('existing Pawtchi success events map without forwarding product props', () => {
    expect(firebaseEventsForProductEvent('auth_signup_succeeded')).toEqual([
      { event: 'sign_up', params: { method: 'password' } },
    ]);
    expect(firebaseEventsForProductEvent('onboarding_completed')).toEqual([
      { event: 'pet_profile_completed', params: {} },
      { event: 'calorie_goal_created', params: {} },
    ]);
    expect(firebaseEventsForProductEvent('onboarding_step_viewed')).toEqual([]);
  });

  test('walk-first onboarding reports a completed profile, but never a calorie goal', () => {
    // The default route for dogs since the walk-first pivot. It writes the
    // `pets` row — the documented boundary for pet_profile_completed — but sets
    // no target_daily_calories, so claiming a calorie goal would be false.
    expect(firebaseEventsForProductEvent('onboarding_lightweight_completed')).toEqual([
      { event: 'pet_profile_completed', params: {} },
    ]);
  });

  test('first_walk_completed carries no walk measurements', () => {
    // Distance, duration, pace and anything derived from a route are location
    // data about a household. The activation count needs none of it.
    expect(
      sanitizeFirebaseEvent('first_walk_completed', {
        distance_m: 2400,
        duration_s: 1800,
        avg_speed_kmh: 4.8,
        start_label: 'Elm Row',
        lat: 51.5,
        lng: -0.12,
      }),
    ).toEqual({});
  });

  test('Firebase identity accepts only an internal UUID', () => {
    const uuid = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
    expect(asInternalFirebaseUserId(uuid)).toBe(uuid);
    expect(asInternalFirebaseUserId('owner@example.com')).toBeNull();
    expect(asInternalFirebaseUserId('pet-name')).toBeNull();
  });

  test('deduplicates purchase transaction IDs for the app session', () => {
    const deduper = createSessionTransactionDeduper();
    expect(deduper.claim('txn_123')).toBe(true);
    expect(deduper.claim('txn_123')).toBe(false);
    expect(deduper.claim('txn_456')).toBe(true);
    deduper.release('txn_123');
    expect(deduper.claim('txn_123')).toBe(true);
  });
});
