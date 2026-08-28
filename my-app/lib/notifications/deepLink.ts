/**
 * Notification routing — the one place that turns a push payload into a route.
 *
 * The August 2026 audit found `routeFromNotification` branched on `data.type`,
 * a key that only the two functions which had *never delivered anything* set.
 * The one function actually sending pushes used `data.event`, and the other
 * used `data.action`. So every notification a user has ever tapped fell through
 * every branch and dropped them wherever the app happened to be.
 *
 * This module fixes that in both directions:
 *   - New sends carry a canonical `{ type, route, entityId, campaignKey }`.
 *   - Legacy `event` / `action` payloads still route, because notifications
 *     already sitting in a user's tray will be tapped after they update.
 *
 * Pure and dependency-free so it can be tested without a navigator.
 */

import type { CampaignKey } from './copy';
// Not a layering violation despite the direction: the slug table is part of the
// link contract, not of the email engine, and it has to be identical in the
// sender, the website and here. deepLink.ts is not mirrored to the edge
// runtime, so this import costs nothing there.
import { WEB_PATH_TO_ROUTE } from '../email/copy';

export interface NotificationPayload {
  /** Canonical key set by notify-dispatch. */
  type?: unknown;
  /** Explicit override; wins over the campaign table when present. */
  route?: unknown;
  entityId?: unknown;
  campaignKey?: unknown;
  /** Ledger row key, echoed back so a tap can be recorded as an open. */
  dedupeKey?: unknown;

  /** Legacy: pet-reminders (retired Aug 2026). */
  event?: unknown;
  /** Legacy: check-reminders (retired Aug 2026). */
  action?: unknown;
  /** Legacy: vet-checkins. */
  questionId?: unknown;
  petId?: unknown;
  activityId?: unknown;
}

/** Where each campaign lands. Every campaign must have an entry. */
export const CAMPAIGN_ROUTE: Record<CampaignKey, string> = {
  onboarding_incomplete: '/onboarding/identity',
  first_log_prompt: '/(tabs)/meal',
  meal_window: '/(tabs)/meal',
  weigh_in_due: '/(tabs)/health',
  plan_drift: '/(tabs)/health',
  milestone: '/(tabs)/health',
  walksign_confirmed: '/(tabs)/profile',
  vet_checkin: '/ask',
  weekly_recap: '/(tabs)',
  streak_risk: '/(tabs)/meal',
  winback_7d: '/(tabs)',
  winback_30d: '/(tabs)',
  // Only ever a fallback — the send always carries an explicit `route` with the
  // letter id, because a reply notification that lands on a list is a miss.
  founder_reply: '/letter',
  // Same: the send carries `/support/<id>`. Landing on the hub would make the
  // owner hunt for the answer they were just told had arrived.
  support_reply: '/support',
  // The gallery does not take a walk id yet, so this is the honest landing spot
  // for now. When it does, the dispatcher should carry an explicit `route` with
  // the id — the copy promises "open the walk", and dropping the owner on a list
  // to find it themselves breaks that promise. The explicit-route branch below
  // means that upgrade needs no app release.
  walk_insight: '/walk-gallery',
};

/** Legacy `data.event` values emitted by the retired pet-reminders function. */
const LEGACY_EVENT_ROUTE: Record<string, string> = {
  meal: '/(tabs)/meal',
  nudge_log_meal: '/(tabs)/meal',
  nudge_over_calorie: '/(tabs)/meal',
  nudge_treat_budget: '/(tabs)/meal',
  calorie_over: '/(tabs)/meal',
  walk: '/(tabs)/activity',
  nudge_walk: '/(tabs)/activity',
  nudge_treat_earned: '/(tabs)/activity',
  nudge_great_day: '/(tabs)',
  morning_brief: '/(tabs)',
  streak: '/(tabs)',
  hydration: '/(tabs)/health',
  nudge_water: '/(tabs)/health',
  trial_5days: '/paywall',
  trial_2days: '/paywall',
  trial_1day: '/paywall',
};

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Resolves a tapped notification to a route, or null when there is nothing
 * sensible to open. Returning null is deliberate — dropping the user somewhere
 * arbitrary is what the old code did.
 */
export function routeFor(data: NotificationPayload | null | undefined): string | null {
  if (!data) return null;

  // An explicit route always wins, so a future campaign can deep-link without
  // shipping an app release.
  const explicit = asString(data.route);
  if (explicit) return explicit;

  const type = asString(data.type);

  // Vet check-ins address a specific case; the route is only useful with the id.
  if (type === 'vet_checkin') {
    const caseId = asString(data.entityId) ?? asString(data.questionId);
    return caseId ? `/ask?case=${caseId}&mode=checkin` : '/ask';
  }

  if (type && type in CAMPAIGN_ROUTE) {
    return CAMPAIGN_ROUTE[type as CampaignKey];
  }

  // Legacy shapes, still arriving from trays populated before the rebuild.
  if (type === 'activity_reminder') return '/(tabs)/activity';

  const event = asString(data.event);
  if (event && event in LEGACY_EVENT_ROUTE) return LEGACY_EVENT_ROUTE[event];

  const action = asString(data.action);
  if (action && action in LEGACY_EVENT_ROUTE) return LEGACY_EVENT_ROUTE[action];

  return null;
}

/**
 * Resolves a universal link to a route.
 *
 * Email cannot use the `pawtchi://` scheme — Gmail strips custom schemes, so an
 * emailed CTA has to be an https URL that the OS hands to the app through the
 * associated-domain association. This is the other half of that: given
 * `https://pawtchi.com/app/health`, produce the same route a push would.
 *
 * The slug table lives in `lib/email/copy.ts` (WEB_PATH_TO_ROUTE) beside the
 * campaign definitions, because the same slugs are also what the website serves
 * and what the sender builds its URLs from. Importing it here rather than
 * restating it is what stops the three drifting into a link that opens the home
 * tab and looks like it worked.
 *
 * Returns null for anything unrecognised, so an unknown link falls through to
 * the app's normal cold-start behaviour rather than landing somewhere arbitrary.
 */
export function routeForUrl(url: string | null | undefined): string | null {
  if (!url) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./, '');
  if (host !== 'pawtchi.com') return null;

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments[0] !== 'app') return null;

  // ── Escape hatch: an explicit route, exactly like push ────────────────────
  //
  // `routeFor` already honours a `route` set on the push payload so a new
  // campaign can deep-link without an app release. This is the URL equivalent,
  // and it matters more here: there is no expo-updates in this project, so
  // every JavaScript change costs a full store review. Without this, adding one
  // new email destination would mean shipping a build to two stores and waiting
  // days, purely to teach the app one string.
  //
  // The sender controls this parameter and the OS only hands us the URL after
  // the domain has been verified against our own apple-app-site-association, so
  // it cannot be forged by a third-party site. It is still validated: a
  // relative in-app path only, never a scheme or a protocol-relative `//host`
  // that could be read as an external destination.
  const explicit = parsed.searchParams.get('r');
  if (explicit && explicit.startsWith('/') && !explicit.startsWith('//') && !explicit.includes(':')) {
    return explicit;
  }

  const slug = segments[1] ?? '';
  const route = WEB_PATH_TO_ROUTE[slug];
  if (!route) return null;

  // `/app/letters/<id>` and friends: keep the identifier so the tap lands on
  // the specific letter rather than the list, which is the whole point of the
  // notification that sent them here.
  const entityId = segments[2];
  return entityId ? `${route}/${entityId}` : route;
}

/** Campaign key for analytics, falling back to the legacy payload keys. */
export function campaignKeyFor(data: NotificationPayload | null | undefined): string | null {
  if (!data) return null;
  return (
    asString(data.campaignKey) ??
    asString(data.type) ??
    asString(data.event) ??
    asString(data.action)
  );
}
