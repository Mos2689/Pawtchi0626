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

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { color, radius, space, type as typeTokens } from '../../constants/design';
import type { GeoPoint } from '../../lib/walk/geo';
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

export default function WalkMap({ path, currentPosition, mode, style, interactive = true }: WalkMapProps) {
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

  const startPointGeoJson = useMemo(() => {
    if (path.length === 0) return null;
    const start = path[0];
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'Point' as const, coordinates: [start.lng, start.lat] },
    };
  }, [path]);

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
    if (mode === 'summary') {
      const b = boundsOf(path);
      if (!b) return null;
      return {
        bounds: {
          ne: b.ne,
          sw: b.sw,
          paddingLeft: SUMMARY_PADDING,
          paddingRight: SUMMARY_PADDING,
          paddingTop: SUMMARY_PADDING,
          paddingBottom: SUMMARY_PADDING,
        },
        animationDuration: 0,
      };
    }
    const target = currentPosition ?? path[path.length - 1] ?? null;
    if (!target) return null;
    return {
      centerCoordinate: [target.lng, target.lat] as [number, number],
      zoomLevel: LIVE_ZOOM,
      animationDuration: 600,
    };
  }, [mode, path, currentPosition]);

  if (!MapLibre) {
    return <MapFallback style={style} />;
  }

  const { MapView, Camera, ShapeSource, LineLayer, CircleLayer } = MapLibre;

  return (
    <View style={[styles.container, style]}>
      <MapView
        style={StyleSheet.absoluteFill}
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

        {path.length >= 2 && (
          <ShapeSource id="walk-line" shape={lineGeoJson as any}>
            <LineLayer
              id="walk-line-layer"
              style={{
                lineColor: color.navy,
                lineWidth: 5,
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
