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
import { cameraBounds, cameraFromBounds } from '../../lib/walk/mapCamera';
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
  currentPosition,
  center,
  mode,
  style,
  interactive = true,
  quiet = false,
  spots = [],
  suggestedRoute = null,
  liveBottomInset = 0,
  camera,
  onCameraChange,
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
    // Framed by BOUNDS rather than by a zoom number, deliberately. "Zoom level"
    // is not one thing: Web Mercator counts against a 256px world tile and
    // MapLibre against a 512px one, so the same number means two different
    // scales and picking wrong misplaces every pin by a factor of two. The
    // corners of the viewport are unambiguous — `cameraBounds` derives exactly
    // the rectangle `projectPoint` is about to draw against, so the map and the
    // overlay agree without either side naming a convention.
    if (camera && size) {
      const { ne, sw } = cameraBounds(camera, size.width, size.height);
      return {
        bounds: {
          ne: [ne.lng, ne.lat] as [number, number],
          sw: [sw.lng, sw.lat] as [number, number],
          paddingLeft: 0,
          paddingRight: 0,
          paddingTop: 0,
          paddingBottom: 0,
        },
        animationDuration: 0,
      };
    }
    // Before the first layout there is no viewport to derive corners from.
    if (camera) {
      return {
        centerCoordinate: [camera.center.lng, camera.center.lat] as [number, number],
        zoomLevel: camera.zoom,
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
    size,
    suggestedRoute,
    liveBottomInset,
  ]);

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
      properties?: { visibleBounds?: [number[], number[]] };
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
      if (next) onCameraChange(next);
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
        {cameraStop && <Camera {...cameraStop} />}

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
