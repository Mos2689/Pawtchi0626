// Lightweight, dependency-free analytics.
//
// This is the single chokepoint for product events. Today it just logs in dev;
// to wire a real provider later (PostHog, Amplitude, RevenueCat, Segment…),
// implement `deliver()` once and every call site keeps working unchanged.

export type AnalyticsEvent =
  // Paywall / subscription funnel
  | 'paywall_viewed'
  | 'paywall_plan_selected'
  | 'paywall_purchase_started'
  | 'paywall_purchase_succeeded'
  | 'paywall_purchase_cancelled'
  | 'paywall_purchase_failed'
  | 'paywall_offerings_error'
  | 'paywall_offerings_retried'
  | 'paywall_restore_tapped'
  | 'paywall_dismissed'
  // Onboarding / activation
  | 'preview_home_viewed'
  | 'preview_home_cta'
  | 'profile_completion_chip_tapped';

export type AnalyticsProps = Record<string, string | number | boolean | null | undefined>;

type Sink = (event: AnalyticsEvent, props: AnalyticsProps) => void;

// Swap this for a real provider call when one is added. Keeping it as a single
// function means call sites never change.
let sink: Sink = (event, props) => {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    // eslint-disable-next-line no-console
    console.log(`[analytics] ${event}`, props);
  }
};

/** Register a real analytics delivery function (e.g. on app init). */
export function setAnalyticsSink(next: Sink): void {
  sink = next;
}

/** Record a product event. Never throws — analytics must not break the app. */
export function track(event: AnalyticsEvent, props: AnalyticsProps = {}): void {
  try {
    sink(event, props);
  } catch {
    // Swallow — instrumentation must never affect the user experience.
  }
}
