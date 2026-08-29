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
import { WALK_STATUS_COPY } from './liveCopy';

/**
 * Points kept for the widget's trace. The Lock Screen canvas is ~112pt wide;
 * past a few dozen points the extra vertices are invisible and only cost
 * payload. ActivityKit's ContentState budget is 4KB — this keeps us an order
 * of magnitude under it.
 */
export const ROUTE_POINT_BUDGET = 48;

/** Projection canvas — see the header note on routeTransform's rounding. */
const CANVAS = 1000;
/** 6% inset, so the trace never touches the canvas edge. */
const CANVAS_PAD = 60;

/** Coordinates below this are meaningless noise once normalized. */
const COORD_PRECISION = 1e4;

/** How long after an update iOS should treat the card as stale and dim it —
 *  the last line of defence against a Live Activity outliving its walk. */
export const STALE_AFTER_MS = 5 * 60_000;

/** Minimum gap between pushes, so a dense GPS burst can't spam the widget. */
export const MIN_PUSH_INTERVAL_MS = 5_000;

/** Push at least this often while tracking, purely to move `staleDate`
 *  forward when GPS has gone quiet (a tunnel, a dog nose-down under a hedge). */
export const HEARTBEAT_MS = 60_000;

/** Distance change worth a push — one hundredth of a kilometre is the
 *  smallest change the card can actually show. */
const DISTANCE_EPSILON_KM = 0.01;

/** Head movement worth a push, in normalized canvas units (~2% of the trace). */
const HEAD_EPSILON = 0.02;

/**
 * What the walk looks like right now, mirroring the live walk screen.
 *
 * `sniffing` is the session machine's `auto_paused`, NOT the 15-second sniff
 * episode detector. The episode detector is more sensitive, but the Lock Screen
 * and the walk screen must never disagree about what the dog is doing, and the
 * walk screen's sniff-break strip is driven by `auto_paused`.
 */
export type LiveWalkState = 'acquiring' | 'walking' | 'sniffing' | 'finished';

/** The payload handed to Swift. Every field is directly rendered. */
export interface LiveWalkContent {
  petName: string;
  /** Epoch ms. Swift turns this into a Date for `Text(timerInterval:)`, so the
   *  elapsed clock ticks on the Lock Screen with zero updates from us. */
  startedAt: number;
  /** Frozen end time for a finished walk; null while the timer should run. */
  endedAt: number | null;
  distanceKm: number;
  /** CLOSED sniff episodes only, so the number never revises downward when an
   *  open investigation turns out to be the dog simply moving on. */
  sniffCount: number;
  /** Already resolved from WALK_STATUS_COPY — Swift renders it verbatim. */
  statusLine: string;
  state: LiveWalkState;
  /** Flat [x, y, x, y, …] normalized to 0…1, y down (SVG/SwiftUI convention). */
  route: number[];
  /** Current position in the same space; null before the first accepted fix. */
  head: [number, number] | null;
  /** Flat [x, y, …] of closed sniff stops, same projection. */
  sniffs: number[];
  staleAfterMs: number;
}

function round(value: number): number {
  return Math.round(value * COORD_PRECISION) / COORD_PRECISION;
}

/**
 * Project a walk's path and its sniff stops into one shared 0…1 space.
 *
 * Everything drawn on the card goes through this single transform, so a sniff
 * ring always sits ON the line rather than floating beside it — the same
 * reasoning that made `routeTransform` a shared export in the first place.
 */
function project(
  path: GeoPoint[],
  sniffPoints: readonly GeoPoint[],
  head: GeoPoint | null,
): Pick<LiveWalkContent, 'route' | 'head' | 'sniffs'> {
  const simplified = simplifyRoute(path, ROUTE_POINT_BUDGET);
  const transform = routeTransform(simplified, CANVAS, CANVAS, CANVAS_PAD);

  // Fewer than two points has no extent to fit — the card shows an empty
  // canvas rather than a fabricated dot in the middle of nowhere.
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
}

/** Derive the card's content from live walk state. Pure. */
export function buildLiveWalkContent({
  petName,
  startedAt,
  session,
}: BuildInput): LiveWalkContent {
  // Same bar the walk screen uses for its "Finding GPS" state.
  const acquiring = !session || session.acceptedCount === 0;
  const state: Exclude<LiveWalkState, 'finished'> = acquiring
    ? 'acquiring'
    : session.status === 'auto_paused'
      ? 'sniffing'
      : 'walking';

  const geometry =
    session && !acquiring
      ? project(
          session.path,
          session.sniffPoints,
          session.lastAccepted
            ? { lat: session.lastAccepted.lat, lng: session.lastAccepted.lng }
            : null,
        )
      : { route: [], head: null, sniffs: [] };

  return {
    petName,
    startedAt,
    endedAt: null,
    distanceKm: round((session?.distanceM ?? 0) / 1000),
    sniffCount: session?.sniffPoints.length ?? 0,
    statusLine: WALK_STATUS_COPY[state],
    state,
    ...geometry,
    staleAfterMs: STALE_AFTER_MS,
  };
}

/**
 * The card's last frame.
 *
 * Shown for a minute after the walk ends, because a walk that auto-stopped
 * while the phone was in a pocket would otherwise just blink out — the owner
 * deserves to see where it landed. It states only what happened, never that
 * the walk was saved: the sync may still be sitting in the offline queue.
 */
export function finalContent(
  previous: LiveWalkContent,
  endedAt: number,
  distanceKm?: number,
): LiveWalkContent {
  return {
    ...previous,
    endedAt,
    distanceKm: distanceKm !== undefined ? round(distanceKm) : previous.distanceKm,
    statusLine: WALK_STATUS_COPY.finished,
    state: 'finished',
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
 * the heartbeat that keeps `staleDate` ahead of the clock. A state change
 * jumps the interval floor: "the dog stopped to sniff" is the moment the whole
 * feature exists for, and a five-second lag would flatten it.
 */
export function shouldPushUpdate(
  previous: LiveWalkContent | null,
  next: LiveWalkContent,
  lastSentAt: number,
  now: number,
): boolean {
  if (!previous) return true;
  if (previous.state !== next.state) return true;

  const since = now - lastSentAt;
  if (since < MIN_PUSH_INTERVAL_MS) return false;

  if (previous.sniffCount !== next.sniffCount) return true;
  if (Math.abs(previous.distanceKm - next.distanceKm) >= DISTANCE_EPSILON_KM) return true;
  if (headMoved(previous, next)) return true;

  return since >= HEARTBEAT_MS;
}
