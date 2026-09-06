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
  | 'profile_membership_viewed'
  | 'profile_membership_tapped'
  // The conditional $6.99 win-back. Note what did NOT happen here: the events
  // above were not renamed to `primary_*` and forked into a parallel funnel.
  // They carry a `variant` property ('standard' | 'winback') instead, so every
  // dashboard already built on paywall_viewed keeps working and the two
  // presentations stay comparable inside one funnel.
  //
  // The number this experiment lives or dies by is NOT the conversion rate of
  // the discounted paywall — it is revenue per *eligible* user, control against
  // variant. At $6.99 versus $9.99 the discount arm needs a +43% relative lift
  // just to break even, so a variant that converts better and still loses money
  // is the expected failure mode, and only the control arm can reveal it. That
  // is why `pro_offer_granted` fires for control users too: without it the two
  // arms have different denominators and the primary metric cannot be computed.
  //
  // `pro_offer_unavailable` is the honest coverage signal, in the same spirit as
  // spots_results_failed: it fires when StoreKit returns no offering and the
  // user silently got the standard paywall instead. If that rate is non-trivial
  // the experiment is quietly under-powered rather than negative.
  | 'pro_offer_granted'
  | 'pro_offer_paywall_viewed'
  | 'pro_offer_paywall_dismissed'
  | 'pro_offer_purchase_started'
  | 'pro_offer_purchase_succeeded'
  | 'pro_offer_purchase_failed'
  | 'pro_offer_expired'
  | 'pro_offer_revoked'
  | 'pro_offer_inbox_shown'
  | 'pro_offer_inbox_tapped'
  | 'pro_offer_unavailable'
  // A completed purchase whose entitlement did NOT come back verified, so the
  // Firebase/Google Ads conversion was withheld. RevenueCat runs in
  // INFORMATIONAL mode: access is granted either way, which is why this is
  // invisible in the product and only shows up as revenue missing from Ads.
  // Not in the Firebase allowlist, so it never reaches Google Ads. Meta
  // receives the bare name with no properties, as it does for every event that
  // has no entry in its own map.
  | 'purchase_conversion_unverified'
  // ── Creator codes ──
  //
  // A separate funnel from the paywall's, and deliberately so: `variant` was
  // the right call for the win-back because both arms are the same act at two
  // prices, and both belong in one conversion rate. This is not that act. Nobody
  // is buying anything, nothing is priced, and folding a redemption into
  // `paywall_purchase_succeeded` would inflate the number the business is
  // actually run on with people who paid nothing.
  //
  // `creator_code_rejected` carries a `reason` — the same set the edge function
  // returns. It is the only honest read on whether a creator's audience is
  // failing to redeem because the code is wrong, exhausted, or because they
  // already subscribed, and those three point at three different conversations.
  | 'creator_code_screen_viewed'
  | 'creator_code_submitted'
  | 'creator_code_redeemed'
  | 'creator_code_rejected'
  | 'creator_code_failed'
  | 'creator_dashboard_viewed'
  | 'creator_code_shared'
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
  // Walk-first onboarding: a dog owner leaving after step two with a
  // walk-ready profile. Deliberately NOT `onboarding_completed` — that event
  // still means "a full health profile was built", so the existing funnel
  // keeps its meaning and this measures the new one alongside it.
  | 'onboarding_lightweight_completed'
  // The contextual health gate. `shown` fires when a feature is blocked,
  // `started` when the owner begins completing, `completed` when the profile
  // becomes ready — together they measure whether deferring the questions
  // actually converts better than asking up front.
  | 'health_gate_shown'
  | 'health_gate_started'
  | 'health_gate_completed'
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
  // The gallery's map view — the archive laid out where it happened rather than
  // as a grid of route drawings. `viewed` carries the shape of what was drawn
  // (walks, photo pins, tile pins) so we can tell an owner who has a rich map
  // from one looking at three lines; `view_toggled` measures whether anyone
  // goes back to the grid, which is the question that decides if map-default
  // was right; `pin_opened` separates the two ways in, because a photo pin and
  // a route tile are answering different impulses.
  | 'memory_map_viewed'
  | 'memory_map_view_toggled'
  | 'memory_map_pin_opened'
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
  // Walk-first Home (the map canopy). `record_tapped` is the screen's one
  // action; `canopy_map_shown` reports which surface the hero actually resolved
  // to (the real basemap, or the SVG trace fallback on Expo Go / a routeless
  // walk) so we can see how often anyone gets the designed experience;
  // `walksign_chip_shown` measures how many owners have an identity to show.
  | 'home_record_tapped'
  | 'home_canopy_map_shown'
  | 'home_walksign_chip_shown'
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
  // The notification center. Every nudge and banner in the app now routes
  // through it, so these four are the only remaining measurement of whether the
  // things it carries are seen and acted on — the inline surfaces that used to
  // report that are gone. `severe_obesity_vet_confirmed` and
  // `mer_recalibration_accepted` in particular are the clinical-resolution
  // signals that tell us whether burying those prompts behind a bell cost us
  // anything.
  | 'notification_center_opened'
  | 'notification_center_item_tapped'
  | 'notification_center_mark_all_read'
  | 'severe_obesity_vet_confirmed'
  | 'mer_recalibration_accepted'
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
  | 'support_reply_push_opened'
  // Pawtchi Spots — nearby dog-relevant places from OpenStreetMap.
  //
  // Two families of question, and they are answered by different events:
  //
  //  1. **Does anyone want this?** tab_opened → marker_viewed → details_opened
  //     is the funnel. The number that actually decides the feature's fate is
  //     not in this list, though — it is walk_tracking_started following a spot
  //     view. Spots exists to feed the walking loop; if people browse parks and
  //     never walk to one, it is a directory, not a feature.
  //
  //     `spot_walk_started` measures the tap that actually matters — a tracked
  //     walk begun with a place in mind — and is the closest thing to a single
  //     number for whether Spots is earning its position on Home.
  //
  //     A directions event was removed once, on the grounds that handing the
  //     owner to Apple or Google Maps was the exact behaviour the metric above
  //     says we do not want to encourage. `spot_directions_opened` reinstates
  //     it, because that reasoning turned out to be measuring the wrong thing:
  //     an owner who drives the dog to a beach an hour away and walks it there
  //     is the BEST outcome Spots can produce, and it was invisible.
  //
  //     It is only legible as a pair. On its own the directions tap is still
  //     ambiguous — it could be someone leaving. `spot_arrival_walk_started` is
  //     the other half: a walk begun from the arrival prompt, which can only
  //     happen if the owner drove somewhere and walked the dog when they got
  //     there. Read as a ratio against `spot_directions_opened`, it answers the
  //     question the deleted event could not: did the handoff come back?
  //
  //     Neither carries a coordinate, and the arrival event carries nothing at
  //     all — the place is already described by the directions tap that armed
  //     it, and repeating the category on arrival would say where a specific
  //     person was standing at a specific minute.
  //
  //  2. **Is the data any good, and are we being a good OSM citizen?**
  //     `results_loaded` carries `cache_status` and `results_count`;
  //     `empty_state_viewed` is the honest coverage signal. A high empty rate
  //     in a target market is the trigger to supplement OSM with another
  //     provider — not a bug to fix in the query.
  //
  // `cache_status` (local_hit | server_hit | stale_hit | upstream_fetch) is the
  // operational metric that matters most: upstream_fetch per active user is our
  // load on volunteer infrastructure, and it must stay small as usage grows.
  //
  // NO EVENT CARRIES A COORDINATE. Distance is bucketed via
  // lib/spots/copy.ts#distanceBucket, and the geographic cell is never sent —
  // a precise distance plus a timestamp is a location fix.
  | 'spots_tab_opened'
  | 'spots_results_loaded'
  | 'spots_results_failed'
  | 'spots_filter_selected'
  | 'spots_search_area_requested'
  | 'spots_radius_expanded'
  | 'spots_empty_state_viewed'
  | 'spot_marker_viewed'
  | 'spot_details_opened'
  | 'spot_walk_started'
  | 'spot_directions_opened'
  | 'spot_arrival_walk_started'
  // First-walk intro video — the silent map demo shown once on Home after a
  // fresh dog owner completes onboarding. The funnel is viewed → (skipped |
  // completed → cta_clicked); `failed` is the honest coverage signal for
  // asset/player errors and only fires when the overlay dismisses itself.
  | 'walk_intro_video_viewed'
  | 'walk_intro_video_skipped'
  | 'walk_intro_video_completed'
  | 'walk_intro_video_cta_clicked'
  | 'walk_intro_video_failed';

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

