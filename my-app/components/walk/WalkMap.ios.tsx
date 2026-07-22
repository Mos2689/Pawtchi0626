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

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { color, radius, space, type as typeTokens } from '../../constants/design';
import type { GeoPoint } from '../../lib/walk/geo';
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

export default function WalkMap({ path, currentPosition, mode, style, interactive = true }: WalkMapProps) {
  const polylines = useMemo(() => {
    if (path.length < 2) return [];
    return [
      {
        coordinates: path.map(p => ({ latitude: p.lat, longitude: p.lng })),
        color: color.navy,
        width: 5,
      },
    ];
  }, [path]);

  // Yellow start dot — reads as the "you began here" spark against the navy trace.
  const markers = useMemo(() => {
    if (path.length === 0) return [];
    const start = path[0];
    return [
      {
        coordinates: { latitude: start.lat, longitude: start.lng },
        systemImage: 'circle.fill',
        tintColor: color.yellow,
      },
    ];
  }, [path]);

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
    if (mode === 'summary') {
      const center = midpoint(path);
      if (!center) return undefined;
      return {
        coordinates: { latitude: center.lat, longitude: center.lng },
        zoom: summaryZoom(path),
      };
    }
    const target = currentPosition ?? path[path.length - 1] ?? null;
    if (!target) return undefined;
    return {
      coordinates: { latitude: target.lat, longitude: target.lng },
      zoom: LIVE_ZOOM,
    };
  }, [mode, path, currentPosition]);

  if (!AppleMaps) {
    return <MapFallback style={style} />;
  }

  return (
    <View style={[styles.container, style]}>
      <AppleMaps.View
        style={StyleSheet.absoluteFill}
        cameraPosition={cameraPosition}
        polylines={polylines}
        markers={markers}
        circles={circles}
        properties={{ isMyLocationEnabled: false, selectionEnabled: false }}
        uiSettings={{
          compassEnabled: false,
          myLocationButtonEnabled: false,
          scaleBarEnabled: false,
          togglePitchEnabled: false,
          // Static preview inside a feed card — lock every touch gesture so the
          // map can't hijack the parent ScrollView's vertical drag.
          scrollEnabled: interactive,
          zoomEnabled: interactive,
          rotationEnabled: interactive,
        }}
      />
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
