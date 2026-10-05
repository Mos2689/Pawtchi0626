/**
 * Encoded polylines (Google's format, 1e5 precision) for live-walk messages.
 *
 * A Broadcast `pos` carries up to 20 new route points and a `snap` up to 200;
 * as JSON objects those cost ~35 bytes a point, encoded ~6–8. The format
 * stores each coordinate as a delta from the previous one, so it is only
 * meaningful as a whole string: decoding validates everything and gives back
 * `null` rather than throwing on anything malformed, because these strings
 * arrive from other phones.
 */

import type { GeoPoint } from '../walk/geo';

const PRECISION = 1e5;

function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = '';
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

export function encodePolyline(points: readonly GeoPoint[]): string {
  let out = '';
  let lastLat = 0;
  let lastLng = 0;
  for (const point of points) {
    const lat = Math.round(point.lat * PRECISION);
    const lng = Math.round(point.lng * PRECISION);
    out += encodeValue(lat - lastLat) + encodeValue(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }
  return out;
}

/**
 * Points from an encoded string, or `null` if the string is not a complete,
 * in-range polyline of at most `maxPoints` points.
 */
export function decodePolyline(encoded: unknown, maxPoints: number): GeoPoint[] | null {
  if (typeof encoded !== 'string') return null;
  const points: GeoPoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  const next = (): number | null => {
    let result = 0;
    let shift = 0;
    for (;;) {
      // Six 5-bit chunks hold any in-range delta (±360° at 1e5 is 27 bits).
      if (index >= encoded.length || shift >= 30) return null;
      const byte = encoded.charCodeAt(index) - 63;
      index += 1;
      if (byte < 0 || byte > 63) return null;
      result |= (byte & 0x1f) << shift;
      shift += 5;
      if (byte < 0x20) break;
    }
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    if (points.length >= maxPoints) return null;
    const dLat = next();
    const dLng = dLat === null ? null : next();
    if (dLat === null || dLng === null) return null;
    lat += dLat;
    lng += dLng;
    const point = { lat: lat / PRECISION, lng: lng / PRECISION };
    if (Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) return null;
    points.push(point);
  }
  return points;
}
