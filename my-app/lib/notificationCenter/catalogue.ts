/**
 * Presentation lookup: how each kind of item looks and where it goes.
 *
 * These tables are the surviving half of `components/NudgeCard.tsx`, which owned
 * an `actionType → route` map and an `actionType → icon` map before the card was
 * removed. They are lifted here unchanged rather than rewritten, because those
 * routes are the ones owners have been landing on for months.
 *
 * The push side deliberately routes through `CAMPAIGN_ROUTE` in
 * `lib/notifications/deepLink.ts` rather than restating destinations. That table
 * is already the shared contract between the dispatcher, the website and the
 * app; a second copy here is exactly how the August 2026 audit's "every tap fell
 * through every branch" bug happened in the first place.
 */

import type { CampaignKey } from '../notifications/copy';
import { CAMPAIGN_ROUTE } from '../notifications/deepLink';
import type { NudgeActionType } from '../nudgeEngine';
import type { InboxTone } from './types';

/** Icon per nudge action. Verbatim from the retired NudgeCard `iconMap`. */
export const ACTION_ICON: Record<NudgeActionType, string> = {
  suggest_walk: 'directions-walk',
  remind_log: 'restaurant',
  remind_water: 'water-drop',
  remind_weight: 'monitor-weight',
  remind_activity: 'sports-tennis',
  treat_ok: 'check-circle',
  reduce_dinner: 'restaurant-menu',
  start_trial: 'info-outline',
};

/** Route per nudge action. Verbatim from the retired NudgeCard `routeMap`. */
export const ACTION_ROUTE: Record<NudgeActionType, string> = {
  suggest_walk: '/(tabs)/activity',
  remind_log: '/(tabs)/meal',
  remind_water: '/(tabs)/activity',
  remind_weight: '/(tabs)/health',
  remind_activity: '/(tabs)/activity',
  treat_ok: '/(tabs)/meal',
  reduce_dinner: '/(tabs)/meal',
  start_trial: '/paywall',
};

/** Fallback glyph for a nudge with no action — the old NudgeCard default. */
export const DEFAULT_NUDGE_ICON = 'info-outline';

/** Icon per push campaign. */
export const CAMPAIGN_ICON: Record<CampaignKey, string> = {
  onboarding_incomplete: 'assignment',
  first_log_prompt: 'restaurant',
  meal_window: 'restaurant',
  weigh_in_due: 'monitor-weight',
  plan_drift: 'trending-up',
  milestone: 'emoji-events',
  walksign_confirmed: 'verified',
  vet_checkin: 'favorite-border',
  weekly_recap: 'insights',
  streak_risk: 'local-fire-department',
  winback_7d: 'pets',
  winback_30d: 'pets',
  founder_reply: 'mail-outline',
  support_reply: 'support-agent',
  walk_insight: 'directions-walk',
};

/**
 * Tone per push campaign.
 *
 * Nothing here is `clinical`. A push is a message we chose to send at a time we
 * chose — by the time an owner opens the app it is history, not an alert. The
 * clinical tier stays reserved for conditions the app can still see right now.
 */
export const CAMPAIGN_TONE: Record<CampaignKey, InboxTone> = {
  onboarding_incomplete: 'action',
  first_log_prompt: 'action',
  meal_window: 'action',
  weigh_in_due: 'action',
  plan_drift: 'action',
  milestone: 'celebration',
  walksign_confirmed: 'celebration',
  vet_checkin: 'action',
  weekly_recap: 'info',
  streak_risk: 'info',
  winback_7d: 'info',
  winback_30d: 'info',
  founder_reply: 'action',
  support_reply: 'action',
  walk_insight: 'info',
};

export function iconForCampaign(key: string | null | undefined): string {
  if (key && key in CAMPAIGN_ICON) return CAMPAIGN_ICON[key as CampaignKey];
  return 'notifications-none';
}

export function toneForCampaign(key: string | null | undefined): InboxTone {
  if (key && key in CAMPAIGN_TONE) return CAMPAIGN_TONE[key as CampaignKey];
  return 'info';
}

/**
 * Where a stored push should open.
 *
 * Prefers the explicit route the dispatcher stamped on the row — same precedence
 * `routeFor()` applies to a live payload, so a campaign that deep-links without
 * an app release keeps doing so when the owner opens it from the center instead
 * of the tray.
 */
export function routeForCampaign(
  key: string | null | undefined,
  explicitRoute?: string | null,
): string | null {
  if (explicitRoute && explicitRoute.startsWith('/')) return explicitRoute;
  if (key && key in CAMPAIGN_ROUTE) return CAMPAIGN_ROUTE[key as CampaignKey];
  return null;
}
