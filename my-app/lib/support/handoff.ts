// Where a failure hands off to a human.
//
// The generic failure copy has always offered "Contact support", and for most
// of the app that button went nowhere. ErrorState routed it, but every failure
// that renders through PawtchiModal mapped the action onto a screen-owned
// `handleRecovery` that only ever knew 'retry' — so on the meal, health,
// activity, profile, vet-report and paywall sheets, tapping "Contact support"
// closed the sheet and did nothing else.
//
// The destination therefore lives here, in one pure function, and every
// presenter calls it. A recovery action that silently does nothing is worse
// than no button at all: the owner has just been told "we want to know", tapped
// the thing that says so, and been shown the failure again.
//
// Kept free of React Native / Expo imports so it runs under jest.

import type { AppErrorKind, ErrorContext, RecoveryActionId } from '../appError';
import type { SupportEntrySource } from './copy';

/** The composer route. One door, so it can never drift between presenters. */
export const SUPPORT_COMPOSER_ROUTE = '/support/new';

/**
 * What a presenter knows about the failure it is showing.
 *
 * All optional: enrichment, never a precondition. A screen that passes none of
 * it still gets a working button — the owner just picks the area chip
 * themselves instead of finding it already selected.
 */
export interface FailureMeta {
  kind?: AppErrorKind | null;
  context?: ErrorContext | null;
  /** Route the failure happened on, e.g. '/(tabs)/activity'. */
  screen?: string | null;
}

export interface SupportRoute {
  pathname: typeof SUPPORT_COMPOSER_ROUTE;
  params: Record<string, string>;
}

/**
 * The support composer, opened from a failure.
 *
 * Always `topic: 'bug'` — someone arriving from a failure is here because
 * something did not work, not because they want to know how it works. The area
 * chip is derived from `context` inside the composer (see areaFromContext), and
 * `kind` / `screen` ride along into diagnostics so the owner types one sentence
 * instead of describing their phone.
 *
 * Empty values are dropped rather than sent as "null" strings: expo-router
 * serialises params into the URL, and the composer reads a missing param as
 * "nothing to prefill", but the literal string "null" as a value.
 */
export function supportRouteForFailure(
  meta?: FailureMeta | null,
  source: SupportEntrySource = 'error_state',
): SupportRoute {
  const params: Record<string, string> = { topic: 'bug', source };
  if (meta?.kind) params.errorKind = meta.kind;
  if (meta?.context) params.errorContext = meta.context;
  if (meta?.screen) params.screen = meta.screen;
  return { pathname: SUPPORT_COMPOSER_ROUTE, params };
}

/**
 * Recovery actions no screen has to implement, because none of them depend on
 * the flow that failed. Presenters handle these centrally; everything else is
 * handed to the screen's own `onAction`.
 *
 * 'go_back' is in here for the same reason 'contact_support' is: the
 * `not_found` copy offers "Go back", and before this existed no call site
 * handled it either.
 */
export const FLOW_INDEPENDENT_RECOVERY: readonly RecoveryActionId[] = [
  'open_settings',
  'contact_support',
  'go_back',
];

export function isFlowIndependent(action: RecoveryActionId): boolean {
  return FLOW_INDEPENDENT_RECOVERY.includes(action);
}
