/**
 * liveActivity — the pure derivation behind the iOS walk Live Activity.
 *
 * This module knows nothing about ActivityKit, React, or the store. It turns a
 * walk's live state into a small, serializable payload and answers one other
 * question: "is this worth waking the widget for?" Both are pure, so both are
 * unit-tested from synthetic sessions rather than from a phone.
 *
 * ── Why it is shaped this way ──
 *
 * The Live Activity is a READ-ONLY MIRROR of a walk. It has no vote in whether
 * a walk is happening — the durable `walk:active` record in walkTracker is the
 * sole authority, exactly as before — and nothing here can start, stop, or
 * influence location tracking. The bridge that calls into this module observes
 * the walk store; it never touches walkTracker's single `liveListener` slot.
 *
 * ── Copy lives in TypeScript ──
 *
 * Every string the card renders is resolved here from `liveCopy.ts` and shipped
 * finished. The widget target authors no words of its own, so the locked brand
 * voice is enforced in one place and a Swift edit is never needed to change a
 * sentence.
 *
 * ── The route ──
 *
 * The trace is projected with `routeTransform` from routeSvg — the SAME
 * transform the post-walk summary, the share card and the Walk Story use. That
 * is the whole point: a walk drawn on the Lock Screen and the same walk drawn
 * in its keepsake are the same shape, not two things that merely resemble each
 * other. `routeTransform` rounds to one decimal, so the projection runs on a
 * 1000×1000 canvas and is divided down to 0…1 afterwards — normalizing to a
 * 1×1 canvas directly would round every coordinate to 0 or 1.
 */

import { GeoPoint, simplifyRoute } from './geo';
import { routeTransform } from './routeSvg';
import type { WalkSessionState } from './walkSession';
import {
  ENDS_AT_HOME,
  LIVE_EYEBROW,
  SEE_THE_MAP,
  WALK_STATUS_COPY,
  WAITING_FOR_SIGNAL,
  finishedEyebrow,
  finishedSummary,
  finishedTitle,
  startingTitle,
} from './liveCopy';

/**
 * Points kept for the widget's trace. The route well is 104×88pt; past a few
 * dozen points the extra vertices are invisible and only cost payload. The
 * handoff caps this at ~40; 40 it is. ActivityKit's ContentState budget is 4KB,
 * which this keeps us an order of magnitude under.
 */
export const ROUTE_POINT_BUDGET = 40;

/** Projection canvas — see the header note on routeTransform's rounding. */
const CANVAS = 1000;
/** 6% inset, so the trace never touches the well's edge. */
const CANVAS_PAD = 60;

/** Coordinates finer than this are meaningless once normalized. */
const COORD_PRECISION = 1e4;

/** How long after an update iOS should treat the card as stale and dim it —
 *  the last line of defence against a Live Activity outliving its walk. */
export const STALE_AFTER_MS = 5 * 60_000;

/**
 * Minimum gap between pushes.
 *
 * The handoff asks for ≤1 update per 30s while walking. The timer costs nothing
 * (SwiftUI ticks it from `startedAt`) and the route redraws smoothly across a
 * 30s step, so this is comfortable — and it is the difference between a widget
 * that sips battery on a two-hour walk and one that does not.
 */
export const MIN_PUSH_INTERVAL_MS = 30_000;

/** Push at least this often while tracking, purely to move `staleDate` forward
 *  when GPS has gone quiet (a tunnel, a dog nose-down under a hedge). */
export const HEARTBEAT_MS = 60_000;

/** After this long with no accepted fix, the card admits it has lost signal
 *  rather than showing a frozen distance as though it were current. */
export const SIGNAL_LOST_MS = 3 * 60_000;

/** Distance change worth a push — one tenth of a kilometre is what the finished
 *  card shows, one hundredth is what the live shelf shows. */
const DISTANCE_EPSILON_KM = 0.01;

/** Head movement worth a push, in normalized canvas units (~2% of the trace). */
const HEAD_EPSILON = 0.02;

/**
 * The card's three states, from the design handoff, plus one.
 *
 * `sniffing` renders the walking layout with a different pulse label. It is not
 * in the handoff, but a dog nose-down is the observation this whole product is
 * named for, and the state already exists in the session machine.
 *
 * Note it mirrors the walk screen's `auto_paused`, NOT the 15-second sniff
 * episode detector. The episode detector is more sensitive, but the Lock Screen
 * and the walk screen must never disagree about what the dog is doing.
 */
export type LiveWalkState = 'starting' | 'walking' | 'sniffing' | 'finished';

/**
 * The payload handed to Swift. Every field is rendered directly — the widget
 * makes no decisions and formats no copy.
 */
export interface LiveWalkContent {
  /** Uppercase label beside the live pulse: WALKING / SNIFFING / STARTING, or
   *  the finished card's "HOME · WALK SAVED". */
  eyebrow: string;
  /** The serif line: the dog's name while walking, "Momo's walk" at the start,
   *  "18 min together" once it is over. */
  title: string;
  /** Sub-copy under the title on the starting and finished cards; empty while
   *  walking, where the timer owns that space. */
  subtitle: string;
  /** Epoch ms. Swift turns this into a Date for `Text(timerInterval:)`, so the
   *  elapsed clock ticks on the Lock Screen with zero updates from us. */
  startedAt: number;
  /** Frozen end time for a finished walk; null while the timer should run. */
  endedAt: number | null;
  distanceKm: number;
  /** CLOSED sniff episodes only, so the number never revises downward when an
   *  open investigation turns out to be the dog simply moving on. */
  sniffCount: number;
  /** The geofence pill's label, or empty when the pill should be dropped. */
  endsAtHomeLabel: string;
  /** Non-empty when GPS has gone quiet: replaces the stats shelf and freezes
   *  the head dot's breathing, per the handoff's no-error-state rule. */
  signalLostLabel: string;
  state: LiveWalkState;
  /** Flat [x, y, x, y, …] normalized to 0…1, y down (SVG/SwiftUI convention). */
  route: number[];
  /** Current position in the same space; null before the first accepted fix. */
  head: [number, number] | null;
  /** Flat [x, y, …] of closed sniff stops, same projection. */
  sniffs: number[];
  /** The finished card's CTA label; empty on every other state. */
  ctaLabel: string;
  /** Where the CTA goes. Empty until there is a saved walk to open. */
  ctaUrl: string;
  staleAfterMs: number;
}

function round(value: number): number {
  return Math.round(value * COORD_PRECISION) / COORD_PRECISION;
}

/**
 * Project a walk's path and its sniff stops into one shared 0…1 space.
 *
 * Everything drawn in the well goes through this single transform, so a sniff
 * mark always sits ON the line rather than floating beside it — the same
 * reasoning that made `routeTransform` a shared export in the first place.
 */
function project(
  path: GeoPoint[],
  sniffPoints: readonly GeoPoint[],
  head: GeoPoint | null,
): Pick<LiveWalkContent, 'route' | 'head' | 'sniffs'> {
  const simplified = simplifyRoute(path, ROUTE_POINT_BUDGET);
  const transform = routeTransform(simplified, CANVAS, CANVAS, CANVAS_PAD);

  // Fewer than two points has no extent to fit — the well stays empty rather
  // than showing a fabricated dot in the middle of nowhere.
  if (!transform) return { route: [], head: null, sniffs: [] };

  const toUnit = (point: GeoPoint): [number, number] => {
    const { x, y } = transform(point);
    return [round(x / CANVAS), round(y / CANVAS)];
  };

  const route: number[] = [];
  for (const point of simplified) route.push(...toUnit(point));

  const sniffs: number[] = [];
  for (const point of sniffPoints) sniffs.push(...toUnit(point));

  return { route, head: head ? toUnit(head) : null, sniffs };
}

export interface BuildInput {
  petName: string;
  startedAt: number;
  session: WalkSessionState | null;
  /** For the lost-signal check. Defaults to now. */
  now?: number;
}

/** Derive the live card's content from walk state. Pure. */
export function buildLiveWalkContent({
  petName,
  startedAt,
  session,
  now = Date.now(),
}: BuildInput): LiveWalkContent {
  // Same bar the walk screen uses for its "Finding GPS" state.
  const starting = !session || session.acceptedCount === 0;
  const state: Exclude<LiveWalkState, 'finished'> = starting
    ? 'starting'
    : session.status === 'auto_paused'
      ? 'sniffing'
      : 'walking';

  // A walk whose last accepted fix is minutes old is not a walk with a frozen
  // distance — it is a walk we have lost sight of, and saying so is kinder than
  // showing a stale number as though it were current.
  const lastFixAt = session?.lastAccepted?.timestamp ?? null;
  const signalLost =
    state !== 'starting' && lastFixAt !== null && now - lastFixAt >= SIGNAL_LOST_MS;

  const geometry =
    session && !starting
      ? project(
          session.path,
          session.sniffPoints,
          session.lastAccepted
            ? { lat: session.lastAccepted.lat, lng: session.lastAccepted.lng }
            : null,
        )
      : { route: [], head: null, sniffs: [] };

  return {
    eyebrow: LIVE_EYEBROW[state],
    title: state === 'starting' ? startingTitle(petName) : petName,
    subtitle: state === 'starting' ? WALK_STATUS_COPY.acquiring : '',
    startedAt,
    endedAt: null,
    distanceKm: round((session?.distanceM ?? 0) / 1000),
    sniffCount: session?.sniffPoints.length ?? 0,
    endsAtHomeLabel: state === 'starting' ? '' : ENDS_AT_HOME,
    signalLostLabel: signalLost ? WAITING_FOR_SIGNAL : '',
    state,
    ...geometry,
    ctaLabel: '',
    ctaUrl: '',
    staleAfterMs: STALE_AFTER_MS,
  };
}

export interface FinalInput {
  /** The live content this walk last showed — the route is carried over. */
  previous: LiveWalkContent;
  endedAt: number;
  /** From the finalized summary, which replays the whole point buffer. */
  distanceKm?: number;
  sniffCount?: number;
  /**
   * The summary's own duration, when there is one.
   *
   * Not the same as `endedAt - startedAt`: a walk that ended by stillness
   * really ended when movement stopped, and finalizeSession rewinds past the
   * ten-minute confirmation wait. "18 min together" must be the time they
   * actually spent walking, not the time the phone took to notice.
   */
  durationMs?: number;
  /** True only when the walk actually reached the server. */
  saved: boolean;
  /** Walk session id, for the "See the map" deep link. */
  walkSessionId: string;
}

/**
 * The card's last frame: the wrap-up.
 *
 * It goes white rather than paper, so a finished walk reads as a memory instead
 * of a live alert. It stays up for a minute, because a walk that auto-stopped
 * while the phone was in a pocket would otherwise just blink out — the owner
 * deserves to see where it landed.
 */
export function finalContent({
  previous,
  endedAt,
  distanceKm,
  sniffCount,
  durationMs,
  saved,
  walkSessionId,
}: FinalInput): LiveWalkContent {
  const km = distanceKm !== undefined ? round(distanceKm) : previous.distanceKm;
  const sniffs = sniffCount !== undefined ? sniffCount : previous.sniffCount;

  return {
    ...previous,
    eyebrow: finishedEyebrow(saved),
    title: finishedTitle(durationMs ?? endedAt - previous.startedAt),
    subtitle: finishedSummary(km, sniffs),
    endedAt,
    distanceKm: km,
    sniffCount: sniffs,
    endsAtHomeLabel: '',
    signalLostLabel: '',
    state: 'finished',
    ctaLabel: SEE_THE_MAP,
    // The saved walk's own map. Only offered once the row exists — a CTA that
    // opens an empty screen is worse than no CTA.
    ctaUrl: saved ? `pawtchi://walk-story?id=${walkSessionId}` : '',
    staleAfterMs: STALE_AFTER_MS,
  };
}

function headMoved(a: LiveWalkContent, b: LiveWalkContent): boolean {
  if (!a.head || !b.head) return a.head !== b.head;
  return (
    Math.abs(a.head[0] - b.head[0]) >= HEAD_EPSILON ||
    Math.abs(a.head[1] - b.head[1]) >= HEAD_EPSILON
  );
}

/**
 * Is `next` worth waking the widget for?
 *
 * The elapsed timer costs nothing — SwiftUI ticks it from `startedAt` — so the
 * only reasons to push are a value the card actually shows having changed, or
 * the heartbeat that keeps `staleDate` ahead of the clock. A state change jumps
 * the interval floor: "the dog stopped to sniff" is the moment the whole
 * feature exists for, and a thirty-second lag would flatten it.
 */
export function shouldPushUpdate(
  previous: LiveWalkContent | null,
  next: LiveWalkContent,
  lastSentAt: number,
  now: number,
): boolean {
  if (!previous) return true;
  if (previous.state !== next.state) return true;
  // Losing and regaining signal changes what the shelf says, and it is the one
  // thing an owner might act on. It does not wait for the floor either.
  if (previous.signalLostLabel !== next.signalLostLabel) return true;

  const since = now - lastSentAt;
  if (since < MIN_PUSH_INTERVAL_MS) return false;

  if (previous.sniffCount !== next.sniffCount) return true;
  if (Math.abs(previous.distanceKm - next.distanceKm) >= DISTANCE_EPSILON_KM) return true;
  if (headMoved(previous, next)) return true;

  return since >= HEARTBEAT_MS;
}
