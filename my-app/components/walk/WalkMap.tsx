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

export type WalkMapProps = {
  path: GeoPoint[];
  currentPosition?: GeoPoint | null;
  paused?: boolean;
  mode: 'live' | 'summary';
  /**
   * When false, all touch gestures (scroll/pan/zoom/rotate/pitch) are disabled
   * so the map reads as a static preview — used inside scrolling feeds where the
   * map must not steal the parent's vertical scroll. Defaults to true.
   */
  interactive?: boolean;
  style?: import('react-native').ViewStyle;
};

// Web fallback — never rendered on device. Keeps TS happy for `import WalkMap`.
export default function WalkMap(_: WalkMapProps): React.ReactElement {
  return <View />;
}
