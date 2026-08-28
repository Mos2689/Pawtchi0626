// Meta (Facebook) App Events integration.
//
// Maps Pawtchi analytics events → Meta standard events where a mapping exists,
// and forwards all others as custom events. Plugs into the composable sink in
// analytics.ts so every existing `track()` call automatically fires a Meta event
// with zero call-site changes.
//
// ── Privacy guardrail ──
// A per-event allowlist controls exactly which properties reach Meta. Anything
// not listed is silently dropped. A global PII blocklist provides a second
// safety net so that even if a developer accidentally passes an email or userId
// to track(), it never leaves the device via Meta.

// Lazy-loaded inside initMetaAnalytics() so this file can be safely required
// in Expo Go without triggering a missing-native-module crash.
// eslint-disable-next-line @typescript-eslint/no-var-requires
let AppEventsLogger: typeof import('react-native-fbsdk-next').AppEventsLogger;
import { addAnalyticsSink, type AnalyticsEvent, type AnalyticsProps } from './analytics';

// ── Standard-event mapping ──
// Meta's ad optimisation and audience-building works best with standard events.
// We map the Pawtchi events that correspond to recognised Meta funnels; the rest
// are forwarded verbatim as custom events (which still appear in Events Manager).
const META_STANDARD_MAP: Partial<Record<AnalyticsEvent, string>> = {
  // Subscription funnel → purchase / checkout
  paywall_purchase_succeeded: 'fb_mobile_purchase',
  paywall_purchase_started:   'fb_mobile_initiated_checkout',
  paywall_viewed:             'fb_mobile_content_view',

  // Auth → registration
  auth_signup_succeeded:      'fb_mobile_complete_registration',

  // Onboarding → tutorial completion
  onboarding_completed:       'fb_mobile_tutorial_completion',
};

// ── Property allowlist (per event) ──
// Only these fields are forwarded to Meta for each event. Anything unlisted is
// stripped. If an event has no entry here, ZERO props are forwarded (event name
// only). This is the primary privacy firewall.
const ALLOWED_PROPS: Partial<Record<AnalyticsEvent, readonly string[]>> = {
  // Paywall funnel
  paywall_viewed:             ['mode'],
  paywall_plan_selected:      ['plan'],
  paywall_purchase_started:   ['plan', 'price'],
  paywall_purchase_succeeded: ['plan', 'price'],
  paywall_purchase_cancelled: ['plan'],
  paywall_purchase_failed:    ['reason'],
  paywall_offerings_error:    ['reason'],
  paywall_dismissed:          ['mode'],

  // Auth — only the event name matters, no props needed
  auth_signup_started:        [],
  auth_signup_succeeded:      [],
  auth_signup_failed:         ['reason'],
  auth_signin_started:        [],
  auth_signin_succeeded:      [],
  auth_signin_failed:         ['reason'],
  auth_forgot_password:       [],

  // Onboarding funnel — step-level analytics, no PII
  onboarding_step_viewed:     ['step', 'step_index', 'total'],
  onboarding_step_completed:  ['step', 'step_index', 'target_weight_kg', 'daily_kcal', 'goal'],
  onboarding_back_pressed:    ['step', 'step_index'],
  onboarding_field_skipped:   ['step', 'step_index', 'field'],
  onboarding_vet_scan_started:   ['source'],
  onboarding_vet_scan_succeeded: ['filled'],
  onboarding_vet_scan_failed:    ['reason'],
  onboarding_completed:       ['daily_kcal', 'target_weight_kg'],
  onboarding_pet_create_failed:  ['reason'],

  // Post-onboarding
  plan_reveal_viewed:         ['daily_kcal', 'target_weight_kg'],
  plan_reveal_continued:      [],
  profile_completion_chip_tapped: [],

  // Paywall utility events
  paywall_offerings_retried:  [],
  paywall_restore_tapped:     [],
};

// ── Global PII blocklist ──
// Second safety net. Even if a prop name somehow passes the allowlist check
// (e.g. via a future code path that spreads extra fields), these field names
// are ALWAYS stripped before delivery to Meta.
const PII_BLOCKLIST = new Set([
  'email', 'userId', 'user_id', 'uid', 'name', 'pet', 'petName', 'pet_name',
  'phone', 'address', 'password', 'token', 'session', 'ip', 'breed', 'allergies',
]);

/**
 * Sanitise props for Meta delivery.
 * 1. Keep only fields in the per-event allowlist.
 * 2. Drop any field that matches the global PII blocklist.
 */
function sanitise(event: AnalyticsEvent, raw: AnalyticsProps): Record<string, string | number> {
  const allowed = ALLOWED_PROPS[event];
  const clean: Record<string, string | number> = {};

  // If the event isn't in the allowlist at all → send event name only, no props.
  if (!allowed) return clean;

  for (const key of allowed) {
    if (PII_BLOCKLIST.has(key)) continue; // double-check
    const val = raw[key];
    if (val === undefined || val === null) continue;
    // Meta only accepts string | number params
    if (typeof val === 'string' || typeof val === 'number') {
      clean[key] = val;
    } else if (typeof val === 'boolean') {
      clean[key] = val ? 1 : 0;
    }
  }

  return clean;
}

/**
 * Register a Meta App Events sink.
 * Call once after `Settings.initializeSDK()` in the root layout.
 */
export function initMetaAnalytics(): void {
  // Resolve the native module at call time (not import time) so Expo Go is safe.
  AppEventsLogger = require('react-native-fbsdk-next').AppEventsLogger;

  addAnalyticsSink((event: AnalyticsEvent, props: AnalyticsProps) => {
    try {
      const metaEvent = META_STANDARD_MAP[event] ?? event;
      const safeProps = sanitise(event, props);

      // `valueToSum` is Meta's numeric aggregation field — pass the price when
      // present so purchase-value optimisation works out of the box.
      const valueToSum =
        typeof safeProps.price === 'number'
          ? safeProps.price
          : typeof safeProps.valueToSum === 'number'
            ? safeProps.valueToSum
            : undefined;

      // AppEventsLogger.logEvent accepts (eventName, valueToSum?, params?)
      if (valueToSum !== undefined) {
        AppEventsLogger.logEvent(metaEvent, valueToSum, safeProps);
      } else {
        AppEventsLogger.logEvent(metaEvent, safeProps);
      }
    } catch {
      // Analytics must never break the app.
    }
  });
}

