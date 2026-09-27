/**
 * WalkMap (Android) — MapLibre + public OSM raster tiles.
 *
 * No API key. Style JSON lives in lib/walk/osmStyle.ts. Walk polyline is
 * yellow. The user puck is drawn by US from the walk's own GPS stream
 * (`currentPosition`), NOT via MapLibre's <UserLocation> — that component
 * starts its own location engine the app doesn't own and can't stop when the
 * walk ends. The location engine must remain the app's only location consumer.
 *
 * MapLibre is a native module — not in Expo Go. We require it lazily so this
 * file still loads there (otherwise expo-router silently drops /walk). In
 * Expo Go we render a friendly placeholder.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Constants from 'expo-constants';
import { color, radius, space, type as typeTokens } from '../../constants/design';
import type { GeoPoint } from '../../lib/walk/geo';
import { cameraFromBounds, toMapLibreZoom } from '../../lib/walk/mapCamera';
import { OSM_ATTRIBUTION, OSM_STYLE } from '../../lib/walk/osmStyle';
import type { WalkMapProps } from './WalkMap';

const LIVE_ZOOM = 17;
const SUMMARY_PADDING = 60;

// Lazy-load the native module. Fails in Expo Go — we fall back to a stub.
let MapLibre: {
  MapView: any;
  Camera: any;
  ShapeSource: any;
  LineLayer: any;
  CircleLayer: any;
} | null = null;

if (Constants.appOwnership !== 'expo') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@maplibre/maplibre-react-native');
    MapLibre = {
      MapView: mod.MapView,
      Camera: mod.Camera,
      ShapeSource: mod.ShapeSource,
      LineLayer: mod.LineLayer,
      CircleLayer: mod.CircleLayer,
    };
  } catch {
    MapLibre = null;
  }
}

/**
 * Whether a real basemap can be drawn at all — ground truth, not an environment
 * guess. Callers that want to render their own surface instead of this file's
 * "not in Expo Go" placeholder (the Home canopy, which has an SVG trace to fall
 * back to) check this rather than re-sniffing appOwnership, which is deprecated
 * and already known to be unreliable on its own.
 */
export const NATIVE_MAP_AVAILABLE = MapLibre !== null;

/**
 * MapLibre reports the region continuously while it is being dragged
 * (`onRegionIsChanging`), not only when it settles.
 *
 * So an overlay drawn from `onCameraChange` tracks the map through the whole
 * gesture here, and callers do not need to hide it mid-drag the way the iOS
 * path does.
 */
export const MAP_CAMERA_STREAMS = true;

function boundsOf(path: GeoPoint[]): { ne: [number, number]; sw: [number, number] } | null {
  if (path.length === 0) return null;
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
  return { ne: [maxLng, maxLat], sw: [minLng, minLat] };
}

/** Framing for a place we can only point at, not trace: a block or two across. */
const PLACE_ZOOM = 16;

/**
 * Backdrop framing — wider than a walk card's, on purpose.
 *
 * A summary card is about ONE walk, so it frames that walk tightly. Home's
 * canopy is about where this dog lives, and at card zoom it filled the hero
 * with two streets, which reads as a stretched close-up rather than a place.
 *
 * MapLibre frames by bounds rather than a zoom number, so the way to pull back
 * from a route here is to inflate the padding around it — same intent as the
 * iOS side's zoom subtraction, expressed in the units this SDK gives us.
 */
const BACKDROP_PLACE_ZOOM = 14;
const BACKDROP_PADDING = 190;

export default function WalkMap({
  path,
  communityRoutes = [],
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
  cameraIsFraming = !onCameraChange,
}: WalkMapProps) {
  /**
   * The map's own pixel size, measured rather than assumed — the bounds handed
   * to MapLibre and the camera read back out of it are both defined against it.
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
  const lineGeoJson = useMemo(
    () => ({
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: path.map(p => [p.lng, p.lat]),
      },
    }),
    [path],
  );

  /**
   * The whole archive as ONE feature.
   *
   * A MultiLineString rather than a source per walk: MapLibre draws this in a
   * single layer whatever the count, so the trail web costs the same as one
   * route. (iOS has no equivalent — MapKit takes an array of overlays — which is
   * the entire reason the caller caps the list at all. See TRAIL_MAX_WALKS.)
   */
  const trailsGeoJson = useMemo(() => {
    const coordinates = (trails ?? [])
      .filter(t => t.length >= 2)
      .map(t => t.map(p => [p.lng, p.lat]));
    if (coordinates.length === 0) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'MultiLineString' as const, coordinates },
    };
  }, [trails]);

  // Null rather than an empty Feature when there is nothing to suggest, so the
  // layer is unmounted entirely instead of drawing a zero-length line.
  const suggestedRouteGeoJson = useMemo(() => {
    if (!suggestedRoute || suggestedRoute.length < 2) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: suggestedRoute.map(p => [p.lng, p.lat]),
      },
    };
  }, [suggestedRoute]);

  // Suppressed as a backdrop — Home draws its own flat pastel dots over the map
  // and a second start marker underneath them is just clutter.
  const startPointGeoJson = useMemo(() => {
    if (path.length === 0 || quiet) return null;
    const start = path[0];
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'Point' as const, coordinates: [start.lng, start.lat] },
    };
  }, [path, quiet]);

  // Spot pins. One source with the colour baked onto each feature, read back by
  // the layer via ['get', 'color'] — a layer per tone would mean a new
  // ShapeSource every time the palette grew. Radius is in PIXELS here (unlike
  // the iOS circle API's metres), so pins hold their size at any zoom.
  const spotsGeoJson = useMemo(() => {
    if (spots.length === 0) return null;
    return {
      type: 'FeatureCollection' as const,
      features: spots.map(s => ({
        type: 'Feature' as const,
        id: s.id,
        properties: { color: color.marker[s.tone] },
        geometry: { type: 'Point' as const, coordinates: [s.lng, s.lat] },
      })),
    };
  }, [spots]);

  // Our own puck — drawn from the walk's GPS stream, no second location engine.
  const puckGeoJson = useMemo(() => {
    if (mode !== 'live' || !currentPosition) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'Point' as const,
        coordinates: [currentPosition.lng, currentPosition.lat],
      },
    };
  }, [mode, currentPosition]);

  const cameraStop = useMemo(() => {
    // An explicit camera wins outright — the caller is drawing its own overlay
    // against these exact numbers, so the map must not second-guess them.
    //
    // Sent as a centre and a zoom, converted to MapLibre's 512 px convention.
    // It used to be sent as corner BOUNDS to sidestep the zoom-unit question,
    // but MapLibre's native camera turns bounds into a zoom using the view's
    // current pixel size — and before the native surface is sized that is zero,
    // which frames the whole world. The shared walk memory, whose camera is set
    // once and never changes, sat on the globe on Android because of it. A
    // centre and a zoom need no view size, so they are right on the first try.
    // The unit difference is exact and lives in `toMapLibreZoom`.
    //
    // (The old pre-layout fallback also sent `camera.zoom` UNCONVERTED, one
    // level too close. That branch is gone with this.)
    if (camera) {
      return {
        centerCoordinate: [camera.center.lng, camera.center.lat] as [number, number],
        zoomLevel: toMapLibreZoom(camera.zoom),
        animationDuration: 0,
      };
    }
    if (mode === 'summary') {
      // A traceable route frames itself; anything shorter falls back to the
      // caller's place, so the map still shows the right streets.
      const b = path.length >= 2 ? boundsOf(path) : null;
      if (b) {
        const pad = quiet ? BACKDROP_PADDING : SUMMARY_PADDING;
        return {
          bounds: {
            ne: b.ne,
            sw: b.sw,
            paddingLeft: pad,
            paddingRight: pad,
            paddingTop: pad,
            paddingBottom: pad,
          },
          animationDuration: 0,
        };
      }
      const place = path[0] ?? center ?? null;
      if (!place) return null;
      return {
        centerCoordinate: [place.lng, place.lat] as [number, number],
        zoomLevel: quiet ? BACKDROP_PLACE_ZOOM : PLACE_ZOOM,
        animationDuration: 0,
      };
    }
    // Match the familiar directions overview: frame the complete suggested
    // path instead of following only the current puck at a close zoom.
    const suggestedBounds = suggestedRoute && suggestedRoute.length >= 2
      ? boundsOf(suggestedRoute)
      : null;
    if (suggestedBounds) {
      return {
        bounds: {
          ne: suggestedBounds.ne,
          sw: suggestedBounds.sw,
          paddingLeft: SUMMARY_PADDING,
          paddingRight: SUMMARY_PADDING,
          paddingTop: SUMMARY_PADDING,
          paddingBottom: SUMMARY_PADDING + liveBottomInset,
        },
        animationDuration: 600,
      };
    }
    const target = currentPosition ?? path[path.length - 1] ?? center ?? null;
    if (!target) return null;
    return {
      centerCoordinate: [target.lng, target.lat] as [number, number],
      zoomLevel: LIVE_ZOOM,
      padding: liveBottomInset > 0 ? { paddingBottom: liveBottomInset } : undefined,
      animationDuration: 600,
    };
  }, [
    mode,
    path,
    currentPosition,
    center,
    quiet,
    camera,
    suggestedRoute,
    liveBottomInset,
  ]);

  /**
   * Remount key for a caller-authored camera — see the <Camera> below.
   *
   * Only for authored framing (`cameraIsFraming`). A caller may hand the map's
   * own reported position straight back as `camera` at gesture rate (the live
   * walk does), and remounting on every one of those would fight the finger.
   * Authored framing — the shared memory's, changed only when someone picks a
   * walker — changes rarely, so a remount per change costs nothing. Rounded so a re-render carrying the
   * same framing (the memory's photo URLs arriving, say) keeps the same key.
   */
  const framingKey = camera && cameraIsFraming
    ? `${camera.center.lat.toFixed(6)},${camera.center.lng.toFixed(6)},${camera.zoom.toFixed(3)}`
    : null;

  /**
   * The region MapLibre is showing, translated back into projector units.
   *
   * Read from `visibleBounds` rather than from the payload's `zoomLevel` for
   * the same reason we write bounds: the corners are a measurement, the zoom
   * number is a convention. Longitude alone fixes the scale — it is linear in
   * Mercator — so this needs no latitude term and no aspect-ratio assumption.
   */
  const handleRegion = useCallback(
    (payload: {
      properties?: { visibleBounds?: [number[], number[]]; isUserInteraction?: boolean };
    }) => {
      if (!onCameraChange || !size) return;
      const bounds = payload?.properties?.visibleBounds;
      if (!bounds || bounds.length !== 2) return;
      const [ne, sw] = bounds;
      if (!Number.isFinite(ne?.[0]) || !Number.isFinite(sw?.[0])) return;
      const next = cameraFromBounds(
        { lat: ne[1], lng: ne[0] },
        { lat: sw[1], lng: sw[0] },
        size.width,
      );
      // Passed through so a caller can tell a person panning from the map
      // settling where WE put it. MapLibre reports both; MapKit only the first.
      // See CameraChangeInfo in ./WalkMap for the loop this prevents.
      if (next) onCameraChange(next, { user: !!payload?.properties?.isUserInteraction });
    },
    [onCameraChange, size],
  );


  if (!MapLibre) {
    return <MapFallback style={style} />;
  }

  const { MapView, Camera, ShapeSource, LineLayer, CircleLayer } = MapLibre;

  return (
    <View style={[styles.container, style]} onLayout={onLayout}>
      <MapView
        style={StyleSheet.absoluteFill}
        // Both, on purpose. `isChanging` is what keeps an overlay glued to the
        // map through a drag; `didChange` is the one that fires after a
        // programmatic move or a fling settles, which `isChanging` can miss.
        onRegionIsChanging={onCameraChange ? handleRegion : undefined}
        onRegionDidChange={onCameraChange ? handleRegion : undefined}
        mapStyle={OSM_STYLE as unknown as object}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        pitchEnabled={false}
        rotateEnabled={false}
        // Static preview inside a feed card — lock scroll/zoom so the map can't
        // hijack the parent ScrollView's vertical drag.
        scrollEnabled={interactive}
        zoomEnabled={interactive}
      >
        {/* MapLibre's <Camera> delivers its stop through `setNativeProps` from
            an effect. Under the new architecture that is a side commit React
            does not know about: the next React commit touching the map puts
            the camera's shadow node back to React's own props, which carry no
            stop, and if that lands before the UI thread mounts the side commit
            the stop is never applied. Screens that keep re-sending (live, Home,
            the walk summary) get a later stop through; the shared memory sets
            its framing once, lost it, and sat on the whole world.

            So authored framing also goes in as `defaultSettings` — an ordinary
            React prop, which no commit can revert — and is keyed, so a new
            framing mounts a new camera and MapLibre applies it on attach. */}
        {cameraStop && (
          <Camera
            key={framingKey ?? 'camera'}
            defaultSettings={framingKey ? cameraStop : undefined}
            {...cameraStop}
          />
        )}

        {/* The archive web, first of all so everything draws over it. A single
            muted stroke, never the cased yellow: that pairing marks the walk
            being looked at, and it only carries that meaning while it stays
            exclusive to it. Low opacity is doing real work here — one walk is a
            whisper, and a route walked fifty times stacks into something solid,
            so the map draws frequency without a heatmap. */}
        {trailsGeoJson && (
          <ShapeSource id="walk-trails" shape={trailsGeoJson as any}>
            <LineLayer
              id="walk-trails-layer"
              style={{
                lineColor: color.trail,
                lineWidth: 2.5,
                lineJoin: 'round',
                lineCap: 'round',
              }}
            />
          </ShapeSource>
        )}

        {/* A shared outing keeps each phone's measured route visually
            independent. White casing preserves the line over roads and park
            fills; alternating dash patterns make the parties distinguishable
            without relying on colour alone. */}
        {communityRoutes.map((route, index) => {
          if (route.path.length < 2) return null;
          const shape = {
            type: 'Feature' as const,
            properties: {},
            geometry: {
              type: 'LineString' as const,
              coordinates: route.path.map(point => [point.lng, point.lat]),
            },
          };
          return (
            <ShapeSource key={route.id} id={`community-route-${index}`} shape={shape as any}>
              <LineLayer
                id={`community-route-casing-${index}`}
                style={{
                  lineColor: color.surface,
                  lineWidth: 9,
                  lineOpacity: 0.96,
                  lineJoin: 'round',
                  lineCap: 'round',
                }}
              />
              <LineLayer
                id={`community-route-line-${index}`}
                style={{
                  lineColor: route.color,
                  lineWidth: 5,
                  lineOpacity: 1,
                  // OMITTED when not dashed — never set to `undefined`. MapLibre
                  // turns every key in a layer style into a native BridgeValue,
                  // and a present-but-undefined key crashes the render on
                  // Android ("BridgeValue must be a primitive/array/object").
                  // Walker one is never dashed and the memory draws every route
                  // solid, so this took down every shared map on Android.
                  ...(route.dashed ? { lineDasharray: [2.2, 1.5] } : {}),
                  lineJoin: 'round',
                  lineCap: 'round',
                }}
              />
            </ShapeSource>
          );
        })}

        {/* The suggested way, drawn BEFORE the walk so it sits underneath.
            Dashed electric blue so it cannot be mistaken for the yellow trace:
            that trace is the record of where the dog actually went, and a
            suggestion that looked like it would quietly corrupt the one thing
            this map is for. */}
        {suggestedRouteGeoJson && (
          <ShapeSource id="suggested-route" shape={suggestedRouteGeoJson as any}>
            <LineLayer
              id="suggested-route-casing"
              style={{
                lineColor: color.cream,
                lineWidth: 7,
                lineOpacity: 0.95,
                lineJoin: 'round',
                lineCap: 'round',
              }}
            />
            <LineLayer
              id="suggested-route-layer"
              style={{
                lineColor: color.electric,
                lineWidth: 4,
                lineOpacity: 1,
                lineDasharray: [2, 2],
                lineJoin: 'round',
                lineCap: 'round',
              }}
            />
          </ShapeSource>
        )}

        {/* Two strokes on one source: a navy casing with the brand yellow on
            top. The route is yellow everywhere in Pawtchi, but yellow does not
            hold as ink on a light ground — on pale OSM tiles a bare yellow line
            is close to invisible. The casing gives it an edge to read against
            without changing what colour the route is. */}
        {path.length >= 2 && (
          <ShapeSource id="walk-line" shape={lineGeoJson as any}>
            <LineLayer
              id="walk-line-casing"
              style={{
                lineColor: color.navy,
                lineWidth: 7.5,
                lineJoin: 'round',
                lineCap: 'round',
              }}
            />
            <LineLayer
              id="walk-line-layer"
              style={{
                lineColor: color.yellow,
                lineWidth: 4.5,
                lineJoin: 'round',
                lineCap: 'round',
              }}
            />
          </ShapeSource>
        )}

        {startPointGeoJson && (
          <ShapeSource id="walk-start" shape={startPointGeoJson as any}>
            <CircleLayer
              id="walk-start-layer"
              style={{
                circleRadius: 6,
                circleColor: color.yellow,
                circleStrokeColor: color.navy,
                circleStrokeWidth: 1.5,
              }}
            />
          </ShapeSource>
        )}

        {spotsGeoJson && (
          <ShapeSource id="walk-spots" shape={spotsGeoJson as any}>
            <CircleLayer
              id="walk-spots-layer"
              style={{
                circleRadius: 7,
                circleColor: ['get', 'color'],
                circleStrokeColor: color.surface,
                circleStrokeWidth: 2.5,
              }}
            />
          </ShapeSource>
        )}

        {puckGeoJson && (
          <ShapeSource id="walk-puck" shape={puckGeoJson as any}>
            <CircleLayer
              id="walk-puck-layer"
              style={{
                circleRadius: 8,
                circleColor: color.navy,
                circleStrokeColor: color.surface,
                circleStrokeWidth: 2.5,
              }}
            />
          </ShapeSource>
        )}
      </MapView>

      {/* OSM tiles are raster images, so there is no POI layer to switch off the
          way Apple Maps has. A light wash is the equivalent move: it lifts the
          whole basemap towards paper so app chrome reads over it, without
          hiding the streets. */}
      {quiet && <View style={styles.quietWash} pointerEvents="none" />}

      <View style={styles.attributionPill} pointerEvents="none">
        <Text style={styles.attributionText}>{OSM_ATTRIBUTION}</Text>
      </View>
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
  quietWash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: color.basemapWash,
  },
  attributionPill: {
    position: 'absolute',
    left: space.sm,
    bottom: space.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255,255,255,0.82)',
  },
  attributionText: {
    ...typeTokens.caption,
    color: color.slateMuted,
    letterSpacing: 0.2,
  },
});
