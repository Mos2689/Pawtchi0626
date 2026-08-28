export const FIREBASE_EVENT_NAMES = [
  'sign_up',
  'pet_profile_completed',
  'calorie_goal_created',
  'first_food_logged',
  'first_walk_completed',
  'activity_plan_created',
  'trial_started',
  'purchase',
] as const;

export type FirebaseEventName = (typeof FIREBASE_EVENT_NAMES)[number];

export type FirebaseEventParams = {
  method?: unknown;
  transaction_id?: unknown;
  currency?: unknown;
  value?: unknown;
  product_id?: unknown;
  [key: string]: unknown;
};

export type SanitizedFirebaseParams = Record<
  string,
  string | number | { item_id: string }[]
>;

const FIREBASE_EVENT_SET = new Set<string>(FIREBASE_EVENT_NAMES);
const PARAMETERLESS_EVENTS = new Set<FirebaseEventName>([
  'pet_profile_completed',
  'calorie_goal_created',
  'first_food_logged',
  // Deliberately parameterless. A walk's own measurements — distance, duration,
  // pace, and anything derived from its route — are location data about a
  // household, and none of it is needed to count an activation.
  'first_walk_completed',
  'activity_plan_created',
  'trial_started',
]);

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

export function isFirebaseEventName(value: unknown): value is FirebaseEventName {
  return typeof value === 'string' && FIREBASE_EVENT_SET.has(value);
}

/**
 * Runtime privacy firewall for Firebase. Unknown events are rejected and every
 * allowed event is rebuilt from its own tiny parameter contract. Raw product
 * analytics properties are never spread or copied into the result.
 */
export function sanitizeFirebaseEvent(
  event: unknown,
  raw: FirebaseEventParams = {},
): SanitizedFirebaseParams | null {
  if (!isFirebaseEventName(event)) return null;

  if (PARAMETERLESS_EVENTS.has(event)) return {};

  if (event === 'sign_up') {
    const method = cleanString(raw.method, 36);
    return method ? { method } : {};
  }

  // A store transaction ID is required so purchase delivery can be deduped.
  const transactionId = cleanString(raw.transaction_id, 100);
  if (!transactionId) return null;

  const clean: SanitizedFirebaseParams = { transaction_id: transactionId };
  const currency = cleanString(raw.currency, 3)?.toUpperCase();
  if (currency && /^[A-Z]{3}$/.test(currency)) clean.currency = currency;

  if (typeof raw.value === 'number' && Number.isFinite(raw.value) && raw.value >= 0) {
    clean.value = raw.value;
  }

  const productId = cleanString(raw.product_id, 100);
  if (productId) clean.items = [{ item_id: productId }];

  return clean;
}

export type ProductAnalyticsEvent =
  | 'auth_signup_succeeded'
  | 'onboarding_completed'
  | 'onboarding_lightweight_completed';

export type FirebaseDispatch = {
  event: FirebaseEventName;
  params: SanitizedFirebaseParams;
};

/** Reuse existing Pawtchi success semantics without forwarding their props. */
export function firebaseEventsForProductEvent(event: string): FirebaseDispatch[] {
  switch (event as ProductAnalyticsEvent) {
    case 'auth_signup_succeeded':
      return [{ event: 'sign_up', params: { method: 'password' } }];
    case 'onboarding_completed':
      return [
        { event: 'pet_profile_completed', params: {} },
        { event: 'calorie_goal_created', params: {} },
      ];
    /**
     * Walk-first onboarding — a dog owner leaving after step two.
     *
     * Emits `pet_profile_completed` because the documented boundary for that
     * event is "the onboarding `pets` insert succeeds", and this path satisfies
     * it: `createLightweightPet` writes the row. Since the walk-first pivot made
     * this the default route for dogs, leaving it unmapped meant the moment most
     * new owners actually activate reached Google Ads as nothing at all.
     *
     * `calorie_goal_created` is deliberately NOT emitted here. This path sets no
     * `target_daily_calories` — the health profile is deferred behind
     * per-feature gates — so claiming a calorie goal was created would be false.
     */
    case 'onboarding_lightweight_completed':
      return [{ event: 'pet_profile_completed', params: {} }];
    default:
      return [];
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function asInternalFirebaseUserId(value: unknown): string | null {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null;
}

export function createSessionTransactionDeduper(): {
  claim: (transactionId: string) => boolean;
  release: (transactionId: string) => void;
} {
  const seen = new Set<string>();
  return {
    claim(transactionId) {
      if (seen.has(transactionId)) return false;
      seen.add(transactionId);
      return true;
    },
    release(transactionId) {
      seen.delete(transactionId);
    },
  };
}
