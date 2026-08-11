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
  | 'auth_screen_viewed'
  | 'auth_mode_switched'
  | 'auth_signup_started'
  | 'auth_signup_succeeded'
  | 'auth_signup_failed'
  | 'auth_signin_started'
  | 'auth_signin_succeeded'
  | 'auth_signin_failed'
  | 'auth_forgot_password'
  | 'auth_signup_code_resent'
  | 'auth_password_reset_code_sent'
  | 'auth_password_reset_succeeded'
  | 'auth_password_reset_failed'
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
  | 'plan_receipt_row_expanded'
  | 'plan_receipt_mismatch'
  | 'plan_reveal_shared'
  | 'plan_reveal_continued'
  // Walksigns — the identity discovered from how a dog moves through the
  // world. `assigned` covers provisional readings (incl. quiet re-readings),
  // `confirmed` a confidence-gated confirmation, `transition` a celebrated
  // life-stage or sustained behavioral evolution.
  | 'walksign_assigned'
  | 'walksign_reveal_viewed'
  | 'walksign_confirmed'
  | 'walksign_transition'
  | 'walksign_shared'
  | 'welcome_screen_viewed'
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
  | 'vet_report_scanned'
  | 'weight_loss_rate_dangerous'
  // Diagnostic: refreshToday saw daily_logs say "X kcal consumed" but
  // food_scans returned 0 rows. Indicates the two queries disagree on what
  // "today" means — usually a timezone-filter mismatch on a timestamptz column.
  | 'today_data_inconsistent'
  // Granular UI events
  | 'ui_button_tapped'
  | 'onboarding_option_selected'
  // Fires when the owner-reported BCS produces a target weight that diverges
  // sharply from the AI/breed-chart reference — surfaces likely BCS mis-taps
  // or small-frame dogs the breed chart mis-estimates. Non-blocking.
  | 'target_weight_bcs_breed_divergence'
  // Fires once per completed local ideal-weight estimation on the goal screen.
  // Props include mode/reason/classification/severity so we can see how often
  // the advisory shows and which breed/BCS combos land out of band.
  | 'ideal_weight_estimated'
  // Fires from the NON-BLOCKING "Re-check weight or breed" link inside the
  // weight advisory — the user chose to go back and fix an input rather than
  // proceed with the band-anchored plan.
  | 'ideal_weight_conflict_go_back'
  // A weight log crossed a stage target (or the final ideal). Props carry
  // event type, progress_pct, and whether the owner re-scored or dismissed.
  | 'milestone_reached'
  // The owner recorded a fresh BCS (milestone sheet or stale-BCS prompt).
  // predicted_used=true means they dismissed and the drift-predicted score
  // advanced the plan instead.
  | 'bcs_rescored'
  // Canonical, versioned weight-plan pipeline.
  | 'weight_measurement_recorded'
  | 'weight_measurement_rejected'
  | 'weight_assessment_recorded'
  | 'weight_plan_transition'
  // Photo BCS read — the background Gemini estimate of body condition from
  // the avatar photo, and what happened to its suggestion on the goal screen.
  // requested/returned/failed track the pipeline; shown/suppressed track the
  // display gate (suppressed carries the reason: no_pet, not_full_body,
  // band_too_wide, low_confidence, scale_conflict); accepted/overridden are
  // the calibration signal — whether owners agree with the photo read.
  | 'bcs_photo_estimate_requested'
  | 'bcs_photo_estimate_returned'
  | 'bcs_photo_estimate_failed'
  | 'bcs_photo_suggestion_shown'
  | 'bcs_photo_suggestion_suppressed'
  | 'bcs_photo_suggestion_accepted'
  | 'bcs_photo_suggestion_overridden'
  // Hands-on check — the guided BCS questionnaire (onboarding body_check
  // step). answered fires per question; conflict when the three core reads
  // contradict; completed carries the fused score, band, confidence tier and
  // photo agreement; fallback_used when the owner takes the quick-pick path.
  | 'bcs_check_started'
  | 'bcs_check_answered'
  | 'bcs_check_conflict'
  | 'bcs_check_completed'
  | 'bcs_check_fallback_used'
  // Central failure telemetry (lib/appError.ts reportError). Fires once per
  // user-visible failure with context (which flow), kind (offline/server/
  // ai_unavailable/...), and a technical detail string for debugging. The
  // detail contains no user data by construction — it's error taxonomy only.
  | 'app_error'
  // Tracked walks — GPS session → validation → auto-completion engine.
  | 'walk_tracking_started'
  | 'walk_tracking_denied'
  | 'walk_auto_paused'
  | 'walk_completed'
  | 'walk_validated'
  | 'walk_matched_activity'
  | 'walk_logged_unmatched'
  | 'walk_discarded'
  | 'walk_recovered'
  | 'walk_sync_dropped'
  // Background-tracker lifecycle (walkTracker). `bg_self_stopped` fires when the
  // OS delivers location with no active-walk record and the task unregisters
  // itself — a stale registration being killed (should fire at most once right
  // after a stale reopen, then never). `recover_reconnect`/`recover_finalize`
  // record which launch path an orphaned record took.
  | 'walk_bg_self_stopped'
  | 'walk_recover_reconnect'
  | 'walk_recover_finalize'
  | 'walk_shared'
  // Paw Moment share card — the walk→Instagram loop. `viewed` fires when the
  // card preview opens, `shared` when the native sheet completes (the OS
  // never reports an actual post, so a dismissed sheet counts as shared),
  // `dismissed` when the user backs out of the preview without sharing.
  | 'moment_card_viewed'
  | 'moment_card_shared'
  | 'moment_card_share_failed'
  | 'moment_card_dismissed'
  // Paw Prints — walk gallery, milestone ladder, monthly recap. Shares ride
  // the moment_card_shared event with source milestone/monthly_recap/
  // walk_gallery; these cover the in-app loop.
  | 'pawprint_gallery_viewed'
  | 'pawprint_tile_opened'
  | 'pawprint_milestone_reached'
  | 'pawprint_milestone_celebrated'
  | 'pawprint_recap_viewed'
  | 'pawprint_teaser_tapped'
  // Earned share-card templates — the walk-count-gated library. `unlocked`
  // fires when a gate is first crossed (persisted to pet_milestones),
  // `locked_preview_viewed` when the picker pages onto a template the user
  // hasn't earned yet, `unlock_celebrated` when the unlock moment is closed.
  // Shares ride moment_card_shared with the `template` property.
  | 'template_unlocked'
  | 'template_locked_preview_viewed'
  | 'template_unlock_celebrated'
  // Walk Story — the auto-generated, in-app story played from the Home avatar.
  // `generated` fires when a finished walk stashes a fresh story, `ring_shown`
  // when the Home avatar lights its story ring, `opened` when the viewer
  // launches, `beat_viewed` per slide, `completed` when the last slide is
  // reached, and `shared` when the closer hands off to the moment share sheet.
  | 'walk_story_generated'
  | 'walk_story_ring_shown'
  | 'walk_story_opened'
  | 'walk_story_beat_viewed'
  | 'walk_story_completed'
  | 'walk_story_shared'
  // Duplicate-activity guardrail — fires when the Activity tab's read-side
  // de-dupe drops stacked schedule rows. A non-zero rate in the wild means the
  // generator/DB guardrails regressed; ideally this stays silent forever.
  | 'activity_duplicates_detected'
  // Notifications. Before August 2026 this catalogue had no notification
  // events at all, which meant opt-in, delivery, open rate and session
  // recovery were unmeasurable in principle — the pipeline could (and did)
  // fail completely for months without a single metric moving.
  //
  // The funnel reads: primer_shown → primer_accepted → permission_result
  // → push_token_registered → notification_received → notification_opened.
  // Every send-side event carries `campaign_key` so open rate and CTR slice
  // per campaign and variant.
  | 'notification_primer_shown'
  | 'notification_primer_accepted'
  | 'notification_primer_declined'
  | 'notification_permission_result'
  | 'push_token_registered'
  | 'push_token_failed'
  | 'notification_received'
  | 'notification_opened'
  | 'notification_settings_opened'
  | 'notification_settings_changed'
  // Email. The counterpart to notification_opened, and the only click signal
  // this channel has that a machine cannot fake: Apple Mail Privacy Protection
  // pre-fetches images for a large share of recipients, so a Resend "opened"
  // webhook means the message arrived, not that a person read it. A tap that
  // reaches the app did involve a person.
  //
  // `routed` distinguishes "the link worked" from "the app opened and dumped
  // them somewhere" — the failure mode where routeForUrl exists but nothing
  // calls it, which is exactly how this shipped the first time.
  | 'email_link_opened'
  // Write to the Founder. `entry_tapped` carries `entry_source` so we can tell
  // whether the Home Screen quick action earns the native rebuild it costs.
  //
  // The number this feature lives or dies by is reply → return visit, which
  // reads as letter_reply_push_opened / letter_sent. Sending is a one-off act;
  // a reply that pulls someone back into the app is the whole point.
  | 'letter_entry_tapped'
  | 'letter_compose_started'
  | 'letter_sent'
  | 'letter_send_failed'
  | 'letter_thread_opened'
  | 'letter_reply_push_opened'
  // Pawtchi Support — the structured channel beside the founder letter.
  //
  // Two numbers decide whether this feature works:
  //
  //  1. Deflection. `support_faq_expanded` with no `support_ticket_submitted`
  //     after it means the FAQ answered the question. If that ratio is near
  //     zero the FAQ is answering questions nobody has.
  //  2. Reply → return visit, read as support_reply_push_opened over replies
  //     sent. Same reasoning as the founder letter above: submitting is a
  //     one-off act, and a reply that pulls someone back is the whole point.
  //
  // `prefilled` on support_compose_started is the one that validates the
  // premise of the design — if the area chip is usually already correct when
  // someone arrives from a failure, the context-aware routing is earning its
  // keep. If it is usually wrong, tune the map in lib/support/copy.ts rather
  // than adding a step to the form.
  | 'support_home_viewed'
  | 'support_faq_expanded'
  | 'support_door_tapped'
  | 'support_compose_started'
  | 'support_ticket_submitted'
  | 'support_ticket_failed'
  | 'support_ticket_capped'
  | 'support_diagnostics_expanded'
  | 'support_thread_opened'
  | 'support_reply_push_opened';

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

// ── PostHog Integration ──
import PostHog from 'posthog-react-native';

const posthogApiKey = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
const posthogHost = process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

export let posthog: PostHog | null = null;

if (posthogApiKey) {
  posthog = new PostHog(posthogApiKey, {
    host: posthogHost,
    // Note: session replay is disabled by default unless explicitly configured
  });

  const postHogSink: Sink = (event, props) => {
    if (posthog) {
      // Strip undefined values to satisfy PostHogEventProperties type
      const cleanProps = Object.fromEntries(
        Object.entries(props).filter(([_, v]) => v !== undefined)
      );
      posthog.capture(event, cleanProps as Record<string, any>);
      // In development, flush immediately so you don't have to wait 30 seconds
      // to see your events in the dashboard.
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        posthog.flush();
      }
    }
  };

  addAnalyticsSink(postHogSink);
}

