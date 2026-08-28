/**
 * WalkMap — one prop surface, two native backends.
 *
 *   iOS      → Apple Maps via `expo-maps` (no key, native MapKit)
 *   Android  → MapLibre + public OSM raster tiles (no key)
 *
 * Metro resolves this file only on the web build. iOS/Android import the
 * matching `WalkMap.ios.tsx` / `WalkMap.android.tsx` via platform extension.
 * The `WalkMapProps` type is the single source of truth for both impls.
 */

import React from 'react';
import { View } from 'react-native';
import type { GeoPoint } from '../../lib/walk/geo';
import type { WalkMapSpot } from '../../lib/walk/mapSpot';
import type { MapCamera } from '../../lib/walk/mapCamera';

export type WalkMapProps = {
  path: GeoPoint[];
  currentPosition?: GeoPoint | null;
  /**
   * Where to point the camera when `path` is too short to frame — a walk with
   * one accepted GPS fix, or none at all.
   *
   * A patchy walk still happened somewhere, and "somewhere" is enough to draw
   * the streets it happened on. Without this the map had a binary failure mode:
   * a two-point route rendered, a one-point route rendered nothing, and the
   * difference was invisible to the person who took the walk.
   */
  center?: GeoPoint | null;
  paused?: boolean;
  mode: 'live' | 'summary';
  /**
   * When false, all touch gestures (scroll/pan/zoom/rotate/pitch) are disabled
   * so the map reads as a static preview — used inside scrolling feeds where the
   * map must not steal the parent's vertical scroll. Defaults to true.
   */
  interactive?: boolean;
  /**
   * Render the basemap as a calm backdrop rather than a document: no points of
   * interest, muted imagery.
   *
   * Home's canopy needs this. A stock Apple/OSM map is dense with dark POI
   * labels and coloured category pins, and laying a header over it forced a
   * choice between unreadable type and a white scrim heavy enough to erase the
   * map — which defeats the point of having a map hero at all. Quietening the
   * map at the source means a light scrim is enough and the streets stay
   * visible. Walk cards leave this off: there the map IS the content.
   */
  quiet?: boolean;
  /**
   * Pins dropped on the basemap — the sniff spots and walk starts Home scatters
   * across its map.
   *
   * Rendered by the map itself rather than as absolutely-positioned views over
   * it, because only the map knows where a coordinate lands on screen. Faking
   * it with our own projection would drift from the real camera the moment the
   * framing changed, putting pins on the wrong streets.
   */
  spots?: WalkMapSpot[];
  /**
   * Take the camera over instead of letting the map frame itself.
   *
   * Home does this because it draws its own markers as views over the basemap,
   * and a view can only be placed correctly if the exact centre and zoom are
   * known. Passing the same camera to the map and to the projector makes the
   * two agree by construction rather than by coincidence.
   */
  camera?: MapCamera | null;
  /**
   * Where the map ended up, in the projector's own convention.
   *
   * A caller drawing its own overlay needs this or it is drawing against a
   * camera the map may no longer be at — because the user panned, or because
   * the SDK adjusted our framing to its aspect ratio. Each platform file
   * converts from whatever units its SDK reports, so what arrives here is
   * always directly usable by `projectPoint`.
   */
  onCameraChange?: (camera: MapCamera) => void;
  style?: import('react-native').ViewStyle;
};

/**
 * Whether this platform reports camera movement CONTINUOUSLY during a gesture,
 * or only once it settles.
 *
 * An overlay that repositions itself from `onCameraChange` looks correct either
 * way at rest, but only a streaming platform looks correct mid-drag. Where it
 * is false, the caller's honest option is to hide its overlay while a finger is
 * down rather than leave pins sitting over the wrong streets — see
 * HomeMapLayer. Exported rather than sniffed from `Platform.OS` because it is a
 * fact about the map SDK, not about the operating system.
 */
export const MAP_CAMERA_STREAMS = false;

export type { WalkMapSpot, WalkMapSpotTone } from '../../lib/walk/mapSpot';

/** No basemap on web. The platform files override this with the real answer. */
export const NATIVE_MAP_AVAILABLE = false;

// Web fallback — never rendered on device. Keeps TS happy for `import WalkMap`.
export default function WalkMap(_: WalkMapProps): React.ReactElement {
  return <View />;
}
