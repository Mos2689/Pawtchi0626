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
  // Auth
  | 'auth_signup_started'
  | 'auth_signup_succeeded'
  | 'auth_signup_failed'
  | 'auth_signin_started'
  | 'auth_signin_succeeded'
  | 'auth_signin_failed'
  | 'auth_forgot_password'
  // Onboarding funnel — fired on every step view/exit so we can chart drop-off
  | 'onboarding_step_viewed'
  | 'onboarding_step_completed'
  | 'onboarding_back_pressed'
  | 'onboarding_field_skipped'
  | 'onboarding_vet_scan_started'
  | 'onboarding_vet_scan_succeeded'
  | 'onboarding_vet_scan_failed'
  | 'onboarding_completed'
  | 'onboarding_pet_create_failed'
  // The reveal moment + post-onboarding activation
  | 'plan_reveal_viewed'
  | 'plan_reveal_scrolled'
  | 'plan_reveal_insight_viewed'
  | 'plan_reveal_continued'
  | 'preview_home_viewed'
  | 'preview_home_cta'
  | 'profile_completion_chip_tapped'
  // Vet report export (owner-prepared PDF shared with a vet)
  | 'vet_report_opened'
  | 'vet_report_generated'
  | 'vet_report_shared'
  // Ask Pawtchi (capped vet-style Q&A)
  | 'vet_ask_opened'
  | 'vet_ask_submitted'
  | 'vet_ask_answered'
  | 'vet_ask_clarify_shown'
  | 'vet_ask_clarify_submitted'
  | 'vet_ask_clarify_skipped'
  | 'vet_ask_limit_reached'
  | 'vet_ask_blocked_paywall'
  // Second Opinion follow-ups + proactive check-ins
  | 'vet_followup_submitted'
  | 'vet_followup_limit'
  | 'vet_checkin_shown'
  | 'vet_checkin_opened'
  | 'vet_checkin_replied'
  | 'vet_history_case_opened'
  | 'vet_report_scanned';

export type AnalyticsProps = Record<string, string | number | boolean | null | undefined>;

export type Sink = (event: AnalyticsEvent, props: AnalyticsProps) => void;

// Default dev-logger — always present in __DEV__, stripped from production.
const devSink: Sink = (event, props) => {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    // eslint-disable-next-line no-console
    console.log(`[analytics] ${event}`, props);
  }
};

// Composable sink array — multiple providers (Meta, PostHog, Amplitude…) can
// register without replacing each other. The dev logger is always first.
let sinks: Sink[] = [devSink];

/** Replace all sinks with a single function (backwards compatibility). */
export function setAnalyticsSink(next: Sink): void {
  sinks = [next];
}

/** Append an additional analytics delivery target (e.g. Meta, Amplitude). */
export function addAnalyticsSink(next: Sink): void {
  sinks.push(next);
}

/** Record a product event. Never throws — analytics must not break the app. */
export function track(event: AnalyticsEvent, props: AnalyticsProps = {}): void {
  for (const s of sinks) {
    try {
      s(event, props);
    } catch {
      // Swallow — instrumentation must never affect the user experience.
    }
  }
}
