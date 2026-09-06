/**
 * useLiveMapCamera — the contract between a pannable basemap and the views
 * floating over it.
 *
 * Both of Pawtchi's map screens draw their own markers rather than the SDK's:
 * Apple renders a marker as a balloon pin and Android as a flat circle, and
 * neither can be a pastel dot with a label pill or a photograph. So the screen
 * owns the camera, projects each coordinate itself, and the map and the markers
 * read the same numbers — agreeing by construction rather than by coincidence.
 *
 * That arrangement has three failure modes, and this hook exists because all
 * three are subtle enough that a second copy of the logic would get one wrong.
 *
 * ── 1. The map moves, so the markers have to move with it ──
 * The camera a screen computes is where it ASKS the map to point. Where the map
 * actually ends up is a different question the moment a finger drags it, so the
 * markers are projected against what the map REPORTS, falling back to the
 * request only until it has spoken.
 *
 * ── 2. A platform that only reports on settle ──
 * expo-maps hard-codes MapKit's `.onMapCameraChange(frequency: .onEnd)`, so on
 * iOS we are genuinely blind mid-drag (MAP_CAMERA_STREAMS is the fact, not a
 * guess about the OS). There, pins hide for the duration of the gesture instead
 * of being left somewhere untrue and snapped back afterwards. A pin that is
 * briefly absent is honest; a pin in the wrong place is not — a coastal park
 * would be drawn in the sea. Where the map streams, pins simply follow and
 * hiding them would be a flicker for no reason.
 *
 * ── 3. A re-render is not an instruction to move ──
 * The framing a screen computes is a fresh object on every render — a new marker
 * array holding identical coordinates, an unrelated bit of state settling.
 * Handing that straight to the map re-sends the camera prop constantly and yanks
 * the view out from under a drag. So the framing is held stable BY VALUE: only a
 * genuinely different centre or zoom commands the map.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MapCamera } from '../lib/walk/mapCamera';
import { MAP_CAMERA_STREAMS } from '../components/walk/WalkMap';

/**
 * How long to keep the pins hidden after the finger lifts, waiting for the
 * settle event that carries the map's final position.
 *
 * Long enough for MapKit to report, short enough that a tap which moved nothing
 * doesn't leave a visible gap.
 */
const SETTLE_GRACE_MS = 450;

/** Belt and braces: never leave the pins hidden because an event never came. */
const DRAG_GIVE_UP_MS = 2500;

export interface LiveMapCamera {
  /** What to COMMAND the map with. Stable by value across re-renders. */
  camera: MapCamera | null;
  /** What to PROJECT against: reality if the map has told us, our request if not. */
  viewCamera: MapCamera | null;
  /** True while overlay markers would be untrustworthy. */
  pinsHidden: boolean;
  /** Hand to the map's `onCameraChange`. */
  handleCameraChange: (next: MapCamera) => void;
  /** Spread onto the overlay container that sits above the map. */
  touchHandlers: {
    onTouchMove: () => void;
    onTouchEnd: () => void;
    onTouchCancel: () => void;
  };
}

export function useLiveMapCamera(
  /** Where the screen wants to point. Recomputed freely; only value changes act. */
  framing: MapCamera | null,
  /** Told where the map has been dragged to, for callers that have a use for it. */
  onViewCameraChange?: (camera: MapCamera) => void,
): LiveMapCamera {
  const framingKey = framing
    ? `${framing.center.lat.toFixed(6)}|${framing.center.lng.toFixed(6)}|${framing.zoom.toFixed(4)}`
    : '';
  const committed = useRef<MapCamera | null>(null);
  const committedKey = useRef<string>('');
  if (committedKey.current !== framingKey) {
    committedKey.current = framingKey;
    committed.current = framing;
  }
  const camera = committed.current;

  /**
   * Where the map says it actually is. Null until it has been moved, so the
   * commanded framing is what everything reads from on a fresh screen.
   */
  const [live, setLive] = useState<MapCamera | null>(null);

  // A new framing is an instruction to the map, so whatever it last reported is
  // now out of date. Dropping it here stops one stale pan from surviving a
  // recentre and quietly re-applying itself.
  useEffect(() => {
    setLive(null);
  }, [framingKey]);

  /**
   * True while a finger is dragging a map that cannot tell us where it is.
   *
   * Only ever set on a non-streaming platform — see the header.
   */
  const [dragging, setDragging] = useState(false);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleRelease = useCallback((ms: number) => {
    if (releaseTimer.current) clearTimeout(releaseTimer.current);
    releaseTimer.current = setTimeout(() => setDragging(false), ms);
  }, []);

  useEffect(
    () => () => {
      if (releaseTimer.current) clearTimeout(releaseTimer.current);
    },
    [],
  );

  const handleCameraChange = useCallback(
    (next: MapCamera) => {
      setLive(next);
      // The map has spoken, so the pins can be trusted again — no need to wait
      // out the grace period.
      if (releaseTimer.current) clearTimeout(releaseTimer.current);
      setDragging(false);
      onViewCameraChange?.(next);
    },
    [onViewCameraChange],
  );

  const onTouchMove = useCallback(() => {
    if (MAP_CAMERA_STREAMS) return;
    setDragging(true);
    scheduleRelease(DRAG_GIVE_UP_MS);
  }, [scheduleRelease]);

  const onTouchEnd = useCallback(() => {
    if (MAP_CAMERA_STREAMS) return;
    scheduleRelease(SETTLE_GRACE_MS);
  }, [scheduleRelease]);

  const touchHandlers = useRef({ onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd });
  touchHandlers.current = { onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd };

  return {
    camera,
    viewCamera: live ?? camera,
    pinsHidden: dragging,
    handleCameraChange,
    touchHandlers: touchHandlers.current,
  };
}
