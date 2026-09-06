/**
 * WalkMap (iOS) — Apple Maps via expo-maps.
 *
 * Native MapKit basemap (no API key). The walk polyline is yellow. The
 * user-location puck is drawn by US from the walk's own GPS stream
 * (`currentPosition`), NOT via MapKit's `isMyLocationEnabled` — that flag
 * spins up a second CLLocationManager the app doesn't own and can't stop,
 * which kept the iOS location indicator lit after walks ended. The location
 * engine must remain the app's only location consumer. In live mode we follow
 * the last accepted GPS point at a walking zoom; in summary mode we frame the
 * whole path once by centering on its midpoint at a wider zoom.
 *
 * expo-maps is a native module — it doesn't exist in Expo Go. We require it
 * lazily so this file still loads in Expo Go (otherwise expo-router silently
 * drops the /walk route). In Expo Go we render a friendly placeholder.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Constants from 'expo-constants';
import { color, radius, space, type as typeTokens } from '../../constants/design';
import type { GeoPoint } from '../../lib/walk/geo';
import { fitCamera, fromViewportZoom, toRegionZoom } from '../../lib/walk/mapCamera';
import type { WalkMapProps } from './WalkMap';

const LIVE_ZOOM = 17;
const SUMMARY_MIN_ZOOM = 14;

// Try to load the native module. Fails in Expo Go — that's fine, we fall back.
let AppleMaps: any = null;
if (Constants.appOwnership !== 'expo') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AppleMaps = require('expo-maps').AppleMaps;
  } catch {
    AppleMaps = null;
  }
}

/**
 * Whether a real basemap can be drawn at all — ground truth, not an environment
 * guess. Callers that want to render their own surface instead of this file's
 * "not in Expo Go" placeholder (the Home canopy, which has an SVG trace to fall
 * back to) check this rather than re-sniffing appOwnership, which is deprecated
 * and already known to be unreliable on its own.
 */
export const NATIVE_MAP_AVAILABLE = AppleMaps !== null;

/**
 * MapKit tells us where it is only once the gesture ENDS.
 *
 * expo-maps hard-codes `.onMapCameraChange(frequency: .onEnd)` in its SwiftUI
 * view, so there is no continuous stream to subscribe to — mid-drag we are
 * genuinely blind. Callers that float their own views over the map use this to
 * hide them while a finger is down instead of leaving them somewhere wrong.
 */
export const MAP_CAMERA_STREAMS = false;

function midpoint(path: GeoPoint[]): GeoPoint | null {
  if (path.length === 0) return null;
  let latSum = 0;
  let lngSum = 0;
  for (const p of path) {
    latSum += p.lat;
    lngSum += p.lng;
  }
  return { lat: latSum / path.length, lng: lngSum / path.length };
}

/** Rough zoom that fits a bounding box on a phone-sized viewport. */
function summaryZoom(path: GeoPoint[]): number {
  if (path.length < 2) return LIVE_ZOOM;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of path) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  const span = Math.max(maxLat - minLat, maxLng - minLng);
  if (span <= 0) return LIVE_ZOOM;
  const z = Math.log2(360 / span) - 1;
  return Math.max(SUMMARY_MIN_ZOOM, Math.min(LIVE_ZOOM, z));
}

/** Framing for a place we can only point at, not trace: a block or two across. */
const PLACE_ZOOM = 16;

/**
 * Backdrop framing — wider than a walk card's, on purpose.
 *
 * A summary card is about ONE walk, so it frames that walk tightly. Home's
 * canopy is about where this dog lives: at card zoom it filled the hero with
 * two streets and a car park, which reads as a stretched close-up rather than a
 * place. Pulling back roughly two zoom steps puts the surrounding neighbourhood
 * in frame, which is what makes the map worth looking at every morning.
 */
const BACKDROP_PLACE_ZOOM = 14;
/** How far to pull back from a route's own framing when used as a backdrop. */
const BACKDROP_ZOOM_OUT = 1.4;

/**
 * Backdrop styling for `quiet` mode.
 *
 * String literals rather than the AppleMaps enums on purpose: expo-maps is
 * require()d lazily so this file still loads in Expo Go, and reaching for the
 * enum objects at module scope would reintroduce the import we are avoiding.
 * They are string enums, so `'MUTED'` is exactly the value `AppleMapsMapStyle
 * Emphasis.MUTED` carries. An empty `including` list hides every POI category.
 */
const QUIET_PROPERTIES = {
  emphasis: 'MUTED',
  pointsOfInterest: { including: [] as string[] },
};

export default function WalkMap({
  path,
  currentPosition,
  center,
  mode,
  style,
  interactive = true,
  quiet = false,
  spots = [],
  suggestedRoute = null,
  trails,
  liveBottomInset = 0,
  camera,
  onCameraChange,
}: WalkMapProps) {
  /**
   * The map's own pixel size, measured rather than assumed.
   *
   * Both zoom conversions below need it, and it is genuinely different per call
   * site: full-screen on Home's canopy, a short wide rectangle inside a walk
   * card. Guessing with `useWindowDimensions` would silently misplace every pin
   * on the card path.
   */
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize(prev =>
      prev && Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1
        ? prev
        : { width, height },
    );
  }, []);
  // Two strokes, not one: a navy casing with the brand yellow riding on top.
  //
  // The route is yellow everywhere in Pawtchi, but the brand book is explicit
  // that yellow does not hold as ink on a light ground — a bare yellow line on
  // pale map tiles is close to invisible. The casing is the standard
  // cartographic answer: it gives the yellow an edge to read against without
  // changing what colour the route is.
  // The suggested route rides the same array, FIRST so MapKit draws it beneath
  // the walk. Apple's polyline API exposes no dash pattern, so the two are told
  // apart by colour and weight: electric blue is Pawtchi's discovery/wayfinding
  // colour, while the cased yellow remains exclusively "where we went".
  const polylines = useMemo(() => {
    const lines: {
      coordinates: { latitude: number; longitude: number }[];
      color: string;
      width: number;
    }[] = [];

    // The archive web goes down FIRST, so everything else draws over it. One
    // thin stroke each, no casing: the cased two-stroke is what marks the walk
    // being looked at, and it only means that while it stays exclusive to it.
    //
    // This is the one place the polyline count is unbounded by the screen rather
    // than by the walk, because MapKit takes an array and each entry is a
    // separate native overlay. The caller caps it — see TRAIL_MAX_WALKS.
    if (trails) {
      for (const trail of trails) {
        if (trail.length < 2) continue;
        lines.push({
          coordinates: trail.map(p => ({ latitude: p.lat, longitude: p.lng })),
          color: color.trail,
          width: 2.5,
        });
      }
    }

    if (suggestedRoute && suggestedRoute.length >= 2) {
      const coordinates = suggestedRoute.map(p => ({ latitude: p.lat, longitude: p.lng }));
      // MapKit exposes no dash pattern. A pale casing keeps the blue route
      // unmistakable over roads, parks and satellite-tinted tiles.
      lines.push(
        { coordinates, color: color.cream, width: 7 },
        { coordinates, color: color.electric, width: 4 },
      );
    }

    if (path.length >= 2) {
      const coordinates = path.map(p => ({ latitude: p.lat, longitude: p.lng }));
      lines.push(
        { coordinates, color: color.navy, width: 7.5 },
        { coordinates, color: color.yellow, width: 4.5 },
      );
    }

    return lines;
  }, [path, suggestedRoute, trails]);

  // Yellow start dot — reads as the "you began here" spark against the navy
  // trace — plus any spots the caller dropped.
  //
  // Spots ride the markers array rather than `circles` because a circle's
  // radius is in METRES: at Home's pulled-back backdrop zoom a 9m dot is
  // sub-pixel, and it would swell as the map zoomed in. Markers are screen-space
  // and hold their size, which is what a pin has to do.
  const markers = useMemo(() => {
    const pins: {
      coordinates: { latitude: number; longitude: number };
      systemImage: string;
      tintColor: string;
    }[] = [];

    // Suppressed as a backdrop: MapKit draws a marker as a balloon pin, and on
    // Home — which places its own flat pastel dots over the map — that balloon
    // was the loudest object on the screen and belonged to no design.
    if (path.length > 0 && !quiet) {
      const start = path[0];
      pins.push({
        coordinates: { latitude: start.lat, longitude: start.lng },
        systemImage: 'circle.fill',
        tintColor: color.yellow,
      });
    }

    for (const spot of spots) {
      pins.push({
        coordinates: { latitude: spot.lat, longitude: spot.lng },
        systemImage: 'circle.fill',
        tintColor: color.marker[spot.tone],
      });
    }

    return pins;
  }, [path, spots, quiet]);

  // Our own puck — a filled circle at the last accepted GPS point. Meters
  // scale with zoom, but live mode pins zoom to LIVE_ZOOM so it reads as a
  // steady dot.
  const circles = useMemo(() => {
    if (mode !== 'live' || !currentPosition) return [];
    return [
      {
        center: { latitude: currentPosition.lat, longitude: currentPosition.lng },
        radius: 9,
        color: color.navy,
        lineColor: color.surface,
        lineWidth: 2.5,
      },
    ];
  }, [mode, currentPosition]);

  const cameraPosition = useMemo(() => {
    // An explicit camera wins outright — the caller is drawing its own overlay
    // against these exact numbers, so the map must not second-guess them.
    if (camera) {
      return {
        coordinates: { latitude: camera.center.lat, longitude: camera.center.lng },
        // Converted, NOT passed through. expo-maps builds its region as
        // `longitudeDelta = 360 / 2^zoom`, which means something different by
        // "zoom" than Web Mercator does on any view that isn't 256px wide —
        // see lib/walk/mapCamera.ts#toRegionZoom. Handing it the raw number
        // rendered the map about 1.5x closer than the projector believed and
        // dragged every overlay pin toward the middle of the screen.
        //
        // Before the first layout we have no width to convert with. Passing the
        // raw zoom for that one frame is the honest fallback: it is the old
        // behaviour, and the measured value arrives immediately after.
        zoom: size ? toRegionZoom(camera, size.width, size.height) : camera.zoom,
      };
    }
    if (mode === 'summary') {
      // A traceable route frames itself; anything shorter falls back to the
      // caller's place, so the map still shows the right streets.
      const mid = path.length >= 2 ? midpoint(path) : null;
      if (mid) {
        const framed = summaryZoom(path);
        return {
          coordinates: { latitude: mid.lat, longitude: mid.lng },
          zoom: quiet ? Math.max(SUMMARY_MIN_ZOOM, framed - BACKDROP_ZOOM_OUT) : framed,
        };
      }
      const place = path[0] ?? center ?? null;
      if (!place) return undefined;
      return {
        coordinates: { latitude: place.lat, longitude: place.lng },
        zoom: quiet ? BACKDROP_PLACE_ZOOM : PLACE_ZOOM,
      };
    }
    // A destination walk opens in route-overview mode: current position,
    // every turn, and the destination must all be visible together. Following
    // only the current puck at LIVE_ZOOM hid a 1–2 km route outside the
    // viewport and made a successfully fetched route look absent.
    if (suggestedRoute && suggestedRoute.length >= 2) {
      const mid = midpoint(suggestedRoute);
      if (mid) {
        if (liveBottomInset > 0 && size) {
          const fitted = fitCamera(suggestedRoute, {
            width: size.width,
            height: size.height,
            padding: {
              top: 60,
              right: 60,
              bottom: 60 + liveBottomInset,
              left: 60,
            },
            minZoom: SUMMARY_MIN_ZOOM,
            maxZoom: LIVE_ZOOM,
          });
          if (fitted) {
            return {
              coordinates: {
                latitude: fitted.center.lat,
                longitude: fitted.center.lng,
              },
              zoom: toRegionZoom(fitted, size.width, size.height),
            };
          }
        }
        return {
          coordinates: { latitude: mid.lat, longitude: mid.lng },
          zoom: summaryZoom(suggestedRoute),
        };
      }
    }
    const target = currentPosition ?? path[path.length - 1] ?? center ?? null;
    if (!target) return undefined;
    if (liveBottomInset > 0 && size) {
      const webZoom = fromViewportZoom(LIVE_ZOOM, size.width);
      const fitted = fitCamera([target], {
        width: size.width,
        height: size.height,
        padding: { bottom: liveBottomInset },
        minZoom: webZoom,
        maxZoom: webZoom,
        pointZoom: webZoom,
      });
      if (fitted) {
        return {
          coordinates: {
            latitude: fitted.center.lat,
            longitude: fitted.center.lng,
          },
          zoom: LIVE_ZOOM,
        };
      }
    }
    return {
      coordinates: { latitude: target.lat, longitude: target.lng },
      zoom: LIVE_ZOOM,
    };
  }, [
    mode,
    path,
    currentPosition,
    center,
    quiet,
    camera,
    size,
    suggestedRoute,
    liveBottomInset,
  ]);

  /**
   * MapKit's settled camera, translated back into the projector's units.
   *
   * What it reports is the true visible longitude span — a horizontal fact with
   * no aspect fitting in it — so the inverse here is simpler than the forward
   * conversion, and deliberately not the same function.
   */
  const handleCameraMove = useCallback(
    (event: {
      coordinates?: { latitude?: number; longitude?: number };
      zoom?: number;
    }) => {
      if (!onCameraChange || !size) return;
      const lat = event?.coordinates?.latitude;
      const lng = event?.coordinates?.longitude;
      const zoom = event?.zoom;
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(zoom)) {
        return;
      }
      onCameraChange({
        center: { lat: lat as number, lng: lng as number },
        zoom: fromViewportZoom(zoom as number, size.width),
      });
    },
    [onCameraChange, size],
  );

  if (!AppleMaps) {
    return <MapFallback style={style} />;
  }

  return (
    <View style={[styles.container, style]} onLayout={onLayout}>
      <AppleMaps.View
        style={StyleSheet.absoluteFill}
        onCameraMove={onCameraChange ? handleCameraMove : undefined}
        cameraPosition={cameraPosition}
        polylines={polylines}
        markers={markers}
        circles={circles}
        properties={{
          isMyLocationEnabled: false,
          selectionEnabled: false,
          ...(quiet ? QUIET_PROPERTIES : null),
        }}
        uiSettings={{
          compassEnabled: false,
          myLocationButtonEnabled: false,
          scaleBarEnabled: false,
          togglePitchEnabled: false,
        }}
      />

      {/*
        The gesture lock, done in React rather than in the SDK.

        `AppleMapsUISettings` has exactly four fields — compass, my-location
        button, scale bar, pitch toggle. There is no scrollEnabled, no
        zoomEnabled, no rotationEnabled; we were passing all three and expo-maps
        was silently dropping them, so `interactive={false}` did nothing on iOS
        at all. Nothing caught it because `AppleMaps` is require()d lazily and
        therefore typed `any`.

        Two things depended on that promise: walk cards inside a scrolling feed,
        where a live map steals the parent's vertical drag, and any caller
        floating its own views over the basemap. A transparent sheet over the
        map swallows the touches before MapKit's own recognisers ever see them,
        which is the same guarantee by a different route.
      */}
      {!interactive && <View style={StyleSheet.absoluteFill} />}
    </View>
  );
}

function MapFallback({ style }: { style?: WalkMapProps['style'] }) {
  return (
    <View style={[styles.container, styles.fallback, style]}>
      <Text style={styles.fallbackTitle}>Map preview</Text>
      <Text style={styles.fallbackBody}>
        The live map renders on the native dev build, not in Expo Go.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: color.surfaceSubtle,
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
    gap: space.sm,
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.lg,
  },
  fallbackTitle: {
    ...typeTokens.heading,
    color: color.navy,
  },
  fallbackBody: {
    ...typeTokens.body,
    color: color.slateMuted,
    textAlign: 'center',
  },
});
