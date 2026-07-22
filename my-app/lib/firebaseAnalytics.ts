import { NativeModules, Platform } from 'react-native';
import { addAnalyticsSink, type AnalyticsEvent } from './analytics';
import {
  asInternalFirebaseUserId,
  createSessionTransactionDeduper,
  firebaseEventsForProductEvent,
  sanitizeFirebaseEvent,
  type FirebaseEventName,
  type FirebaseEventParams,
  type SanitizedFirebaseParams,
} from './firebaseAnalyticsPolicy';

type NativeAnalyticsApi = typeof import('@react-native-firebase/analytics');

let registered = false;
const purchaseDeduper = createSessionTransactionDeduper();

function getNativeAnalytics(): { api: NativeAnalyticsApi; instance: ReturnType<NativeAnalyticsApi['getAnalytics']> } | null {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
  if (!NativeModules.RNFBAppModule || !NativeModules.RNFBAnalyticsModule) return null;

  try {
    // Lazy load keeps Expo Go, Jest, and web fail-closed when native Firebase
    // is not compiled into the current binary.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const api = require('@react-native-firebase/analytics') as NativeAnalyticsApi;
    return { api, instance: api.getAnalytics() };
  } catch {
    return null;
  }
}

async function deliverFirebaseEvent(
  event: FirebaseEventName,
  params: SanitizedFirebaseParams,
): Promise<void> {
  const native = getNativeAnalytics();
  if (!native) return;

  const transactionId =
    event === 'purchase' && typeof params.transaction_id === 'string'
      ? params.transaction_id
      : null;

  if (transactionId) {
    if (!purchaseDeduper.claim(transactionId)) return;
  }

  try {
    if (event === 'sign_up') {
      if (typeof params.method !== 'string') return;
      await native.api.logSignUp(native.instance, { method: params.method });
    } else if (event === 'purchase') {
      await native.api.logPurchase(
        native.instance,
        params as Parameters<NativeAnalyticsApi['logPurchase']>[1],
      );
    } else {
      await native.api.logEvent(native.instance, event, params);
    }
  } catch {
    if (transactionId) purchaseDeduper.release(transactionId);
  }
}

/** Firebase-only event entry point. The runtime allowlist cannot be bypassed. */
export function trackFirebaseEvent(
  event: FirebaseEventName,
  params: FirebaseEventParams = {},
): void {
  const safeParams = sanitizeFirebaseEvent(event, params);
  if (!safeParams) return;
  void deliverFirebaseEvent(event, safeParams);
}

/**
 * Attach Firebase beside PostHog. Only two existing product events map here;
 * their arbitrary PostHog payloads are deliberately ignored.
 */
export function initFirebaseAnalytics(): void {
  if (registered) return;
  registered = true;

  addAnalyticsSink((event: AnalyticsEvent) => {
    for (const dispatch of firebaseEventsForProductEvent(event)) {
      void deliverFirebaseEvent(dispatch.event, dispatch.params);
    }
  });
}

/** Set only a Supabase UUID; invalid values (including email) clear identity. */
export function setFirebaseUserId(userId: string | null | undefined): void {
  const native = getNativeAnalytics();
  if (!native) return;
  const safeUserId = asInternalFirebaseUserId(userId);
  void native.api.setUserId(native.instance, safeUserId).catch(() => {});
}
