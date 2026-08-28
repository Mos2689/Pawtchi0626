/**
 * KeepsakeMapOverlay — the moments, pinned where they happened.
 *
 * ── Why this is an overlay and not a native marker ──
 * On iOS the basemap is Apple Maps via expo-maps, whose markers are SF Symbols
 * with a tint colour: you can name a glyph, not supply a photograph. So a photo
 * pin cannot be a native marker on that backend at all.
 *
 * The codebase already solved this for Home: draw the markers as views over the
 * basemap, and project their coordinates with the SAME camera the map reports
 * (`projectPoint` + `onCameraChange`). Map and markers then read the same
 * numbers, so they agree by construction rather than by coincidence — see
 * HomeMapLayer, whose pattern this follows deliberately.
 *
 * ── Why it matters ──
 * A route is where you went; the photos are what happened. Putting them on the
 * line at the point they were taken is what turns a GPS trace into something
 * with events in it — the difference between "2.3 km around Arpora" and a walk
 * you can actually re-read.
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { color, font, radius, shadow } from '../../constants/design';
import {
  isOnScreen,
  projectPoint,
  type MapCamera,
} from '../../lib/walk/mapCamera';
import { clusterByScreen } from '../../lib/spots/cluster';
import { useKeepsakeImage } from '../../hooks/useKeepsakeImage';
import type { Keepsake } from '../../lib/walk/keepsake';

/**
 * One moment to pin.
 *
 * Two ways to supply the image, because the two callers genuinely differ. The
 * walk summary already holds the file it just captured, so it passes `uri` and
 * skips the library round-trip entirely. Home is looking at a walk from the
 * archive and has only the row, so it passes `keepsake` and the pin resolves
 * itself down the ladder (original → thumbnail → nothing).
 */
export interface KeepsakeMapPin {
  id: string;
  lat: number;
  lng: number;
  /** Local original the caller already has. Wins over `keepsake` when set. */
  uri?: string | null;
  /** Resolved by the pin when no `uri` was supplied. */
  keepsake?: Keepsake | null;
}

/**
 * The photo itself.
 *
 * Its own component so each pin can run the resolution hook — hooks cannot be
 * called from inside a `.map()` body, and every pin needs an independent one.
 */
function KeepsakePinPhoto({ pin, size }: { pin: KeepsakeMapPin; size: number }) {
  // Always called, never conditionally: the hook tolerates null and returns
  // nothing, which is exactly what a caller-supplied `uri` wants anyway.
  const resolved = useKeepsakeImage(pin.uri ? null : pin.keepsake ?? null);
  const uri = pin.uri ?? resolved.uri;

  return (
    <View style={[styles.frame, { width: size, height: keepsakeCardHeight(size) }]}>
      {uri ? (
        <Image source={{ uri }} style={styles.photo} contentFit="cover" transition={160} />
      ) : (
        <View style={styles.empty} />
      )}
    </View>
  );
}

interface Props {
  pins: readonly KeepsakeMapPin[];
  /** The camera the map REPORTED, never the one we asked for. */
  camera: MapCamera | null;
  width: number;
  height: number;
  /** Edge of the square photo pin, in dp. */
  size?: number;
  /** Receives every moment in the tapped cluster, lead first. */
  onPress?: (pins: KeepsakeMapPin[]) => void;
}

const DEFAULT_SIZE = 46;

/** How far outside the view a coordinate may sit and still be drawn. */
const EDGE_MARGIN = 32;

/** Height of the little stem under the photo. */
const TIP = 6;

/** Portrait, not square — a square reads as an avatar, this is a photograph. */
const ASPECT = 1.24;

export const keepsakeCardHeight = (size: number = DEFAULT_SIZE) => Math.round(size * ASPECT);

/**
 * The framing inset a map needs so these cards are never clipped.
 *
 * Exported because card geometry belongs in ONE place. A caller that
 * hand-guessed the padding would drift the moment the card size changed, and
 * the symptom — a photo sliced off by the top edge — looks like a rendering
 * bug rather than a framing one, which is exactly how it went unnoticed here.
 *
 * Asymmetric on purpose: a card hangs entirely ABOVE its coordinate and
 * nothing below it, so the top needs the card's full height and the bottom
 * needs only breathing room. `fitCamera` accepts this shape directly.
 */
export function keepsakeFitPadding(size: number = DEFAULT_SIZE, base = 14) {
  return {
    top: keepsakeCardHeight(size) + TIP + base,
    bottom: base,
    left: Math.round(size / 2) + base,
    right: Math.round(size / 2) + base,
  };
}

export function KeepsakeMapOverlay({
  pins,
  camera,
  width,
  height,
  size = DEFAULT_SIZE,
  onPress,
}: Props) {
  const placed = useMemo(() => {
    if (!camera || width <= 0 || height <= 0) return [];
    const onScreen = pins
      .map((pin) => ({
        id: pin.id,
        pin,
        at: projectPoint({ lat: pin.lat, lng: pin.lng }, camera, width, height),
      }))
      // A pin whose coordinate falls outside the framed area is dropped rather
      // than clamped to an edge — an edge-clamped pin claims a place it isn't.
      //
      // The margin is POSITIVE, unlike Home's dot layer. These cards sit above
      // their coordinate and are far larger than a dot, so a moment taken near
      // the edge of the route would be discarded by a shrinking margin even
      // though its card would have been perfectly visible. The parent clips
      // overhang cleanly, so erring toward showing is the right trade.
      .filter((p) => isOnScreen(p.at, width, height, EDGE_MARGIN));

    // Collapse cards that would sit on top of each other. Photos taken minutes
    // apart on the same street are metres apart on the ground and completely
    // overlapping on screen, which reads as one torn image rather than two
    // moments. The cell is the card's own width so a cluster only ever forms
    // when the cards genuinely would have collided.
    return clusterByScreen(onScreen, Math.round(size * 1.1)).map((cluster) => ({
      pin: cluster.members[0].pin,
      at: cluster.at,
      members: cluster.members.map((m) => m.pin),
    }));
  }, [pins, camera, width, height, size]);

  if (placed.length === 0) return null;

  return (
    // `box-none` so every gap falls through to the map underneath; only the
    // pins themselves take touches, and only when there is something to do.
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {placed.map(({ pin, at, members }) => {
        const cardH = keepsakeCardHeight(size);
        const extra = members.length - 1;
        const body = (
          <View>
            <KeepsakePinPhoto pin={pin} size={size} />
            {extra > 0 && (
              // The count sits ON the card rather than replacing it: a cluster
              // of photographs should still show a photograph.
              <View style={styles.count}>
                <Text style={styles.countText}>+{extra}</Text>
              </View>
            )}
          </View>
        );

        return (
          <View
            key={pin.id}
            style={[
              styles.anchor,
              {
                // Centred horizontally, sitting ABOVE the coordinate: the point
                // being marked is the bottom tip, the way a pin behaves.
                left: at.x - size / 2,
                top: at.y - cardH - TIP,
                width: size,
              },
            ]}
            pointerEvents={onPress ? 'auto' : 'none'}
          >
            {onPress ? (
              <TouchableOpacity activeOpacity={0.85} onPress={() => onPress(members)}>
                {body}
              </TouchableOpacity>
            ) : (
              body
            )}
            <View style={styles.tip} />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: {
    position: 'absolute',
    alignItems: 'center',
  },
  frame: {
    overflow: 'hidden',
    borderRadius: radius.md,
    backgroundColor: color.navy,
    borderWidth: 3,
    borderColor: color.surface,
    ...shadow.raised,
  },
  photo: { width: '100%', height: '100%' },
  count: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: radius.pill,
    backgroundColor: color.navy,
    borderWidth: 2,
    borderColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: {
    fontFamily: font.bold,
    fontSize: 10,
    color: color.cream,
  },
  empty: { width: '100%', height: '100%', backgroundColor: color.navyRaised },
  tip: {
    width: 3,
    height: TIP,
    backgroundColor: color.surface,
  },
});
