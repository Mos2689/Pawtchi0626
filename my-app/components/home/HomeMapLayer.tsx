/**
 * HomeMapLayer — the map, edge to edge, behind everything.
 *
 * It is the screen's ground rather than a component on it: full bleed, no
 * corners, no border, never covered. Everything else on Home floats over it.
 *
 * Markers are OUR views, not the map SDK's. Apple renders a marker as a balloon
 * pin and Android as a flat circle, neither of which is the pastel dot-and-label
 * this screen is built around, and neither can carry a place name. So the layer
 * owns the camera (`fitCamera`) and projects each coordinate itself
 * (`projectPoint`) — the map and the markers read the same numbers, so they
 * agree by construction rather than by coincidence.
 *
 * Falls back to a plain warm ground rather than the walk card's "Map preview"
 * placeholder — at full-screen size an explanatory grey box would be the
 * loudest thing here, saying the same thing every launch.
 *
 * ── The map moves, so the markers have to move with it ──
 * The camera we compute is where we ASK the map to point; where it actually
 * ends up is a different question the moment the owner drags it. That whole
 * negotiation — commanding by value, projecting against what the map reports,
 * and hiding the pins on a platform that only reports on settle — lives in
 * `useLiveMapCamera`, shared with the walk gallery's map so the two can never
 * drift apart. The reasoning is written down there.
 */

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from 'react';
import {
  InteractionManager,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { color, font, makeShadow, radius } from '../../constants/design';
import { haptic } from '../../lib/haptics';
import type { GeoPoint } from '../../lib/walk/geo';
import {
  fitCamera,
  isOnScreen,
  projectPoint,
  type MapCamera,
} from '../../lib/walk/mapCamera';
import { clusterByScreen } from '../../lib/spots/cluster';
import { useLiveMapCamera } from '../../hooks/useLiveMapCamera';
import WalkMap, { NATIVE_MAP_AVAILABLE } from '../walk/WalkMap';
import {
  KeepsakeMapOverlay,
  type KeepsakeMapPin,
} from '../walk/KeepsakeMapOverlay';
import { KeepsakeViewer, type KeepsakeWalkContext } from '../walk/KeepsakeViewer';
import { MapSkeleton } from './MapSkeleton';
import type { MapPin } from '../../lib/home/homeRail';
import { homeMark } from '../../lib/perf/homeTrace';

/** Keeps a framed route clear of the floating chrome above and below it. */
const FRAME_PADDING = 96;

/** Stable identity for "no route", so the map's props don't churn every render. */
const NO_PATH: GeoPoint[] = [];

const DOT = 18;
const SELECTED_DOT = 22;
/** Bigger than either, so a group reads as "more here" before the number does. */
const CLUSTER_DOT = 26;

export interface HomeMapMarker extends MapPin {
  /** Shown as a pill beside the dot. Only the selected marker carries one. */
  label?: string | null;
  /**
   * Category glyph, for spot pins only.
   *
   * Walk and sniff pins stay plain dots: their colour is assigned round-robin
   * and carries no meaning, so an icon on them would imply a taxonomy the data
   * does not have. A spot genuinely IS a vet or a beach, so it gets a symbol.
   */
  icon?: ComponentProps<typeof MaterialCommunityIcons>['name'] | null;
}

interface HomeMapLayerProps {
  /** The selected walk's route — framed, and drawn as a line by the map. */
  route: GeoPoint[] | null;
  /**
   * Extra bottom padding for the camera's framing, in pixels.
   *
   * For a sheet that covers the lower screen while the route above it is the
   * thing being looked at. Without it `fitCamera` centres the line in the whole
   * viewport and the sheet then covers half of what it framed — the map is
   * technically correct and practically useless.
   */
  frameBottomInset?: number;
  /**
   * Extra top padding for the camera's framing, in pixels.
   *
   * Home's chrome floats ON the map: the pet header, the segment toggle and the
   * Spots filter chips all sit over live tiles. `fitCamera` knows nothing about
   * them, so a route framed to the full viewport puts its far end underneath
   * the filter rail — which is exactly where the destination is, because the
   * camera centres the line and the line ends at the place you are going.
   */
  frameTopInset?: number;
  /** Where to point when the route is too short to frame. */
  center: GeoPoint | null;
  markers: HomeMapMarker[];
  /**
   * Photographs taken on the drawn walk, pinned where they happened.
   *
   * Kept separate from `markers` rather than folded into them: those are flat
   * pastel dots the layer draws itself, these are images that resolve
   * asynchronously down their own fallback ladder. One list cannot describe
   * both without the dot renderer growing a photo branch it has no business
   * carrying.
   */
  keepsakePins?: KeepsakeMapPin[];
  /** Walk facts used to caption an opened photo. */
  keepsakeContext?: KeepsakeWalkContext;
  /**
   * True while Home is still working out whether a coordinate exists.
   *
   * Separates "a map is coming" from "there will never be one" — a skeleton is
   * a promise, so showing it to a pet with no geography would be a promise we
   * cannot keep.
   */
  resolving?: boolean;
  /**
   * Collapse pins that would visually overlap into a count bubble.
   *
   * Only Spots asks for this. A city block can hold four vets and three pet
   * shops inside 40 px at backdrop zoom, which renders as an unreadable smudge;
   * walks and sniffs are naturally sparse and clustering them would hide
   * geography rather than reveal it.
   */
  clustered?: boolean;
  /** Makes pins tappable. Absent means the layer stays purely decorative. */
  onMarkerPress?: (id: string) => void;
  onSurfaceResolved?: (surface: 'map' | 'ground') => void;
  /**
   * Where the owner has dragged the map to.
   *
   * Only Spots listens: it is what makes "Search this area" possible, and it is
   * the difference between a map you can look around and a map that only ever
   * answers about where you are standing.
   */
  onViewCameraChange?: (camera: MapCamera) => void;
}

/** Stable identity so the default never re-triggers the projection memo. */
const EMPTY_KEEPSAKE_PINS: KeepsakeMapPin[] = [];

export function HomeMapLayer({
  route,
  frameBottomInset = 0,
  frameTopInset = 0,
  center,
  markers,
  keepsakePins = EMPTY_KEEPSAKE_PINS,
  keepsakeContext,
  resolving = false,
  clustered = false,
  onMarkerPress,
  onSurfaceResolved,
  onViewCameraChange,
}: HomeMapLayerProps) {
  const { width, height } = useWindowDimensions();

  // What the camera frames: the route when there is one, otherwise every pin we
  // have, otherwise the fallback place. Framing the pins rather than a single
  // point is what stops markers landing off-screen.
  const framing = useMemo(() => {
    const framed: GeoPoint[] =
      route && route.length > 0
        ? route
        : markers.length > 0
          ? markers.map(m => ({ lat: m.lat, lng: m.lng }))
          : center
            ? [center]
            : [];
    return fitCamera(framed, {
      width,
      height,
      padding:
        frameBottomInset || frameTopInset
          ? {
              top: FRAME_PADDING + frameTopInset,
              bottom: FRAME_PADDING + frameBottomInset,
              left: FRAME_PADDING,
              right: FRAME_PADDING,
            }
          : FRAME_PADDING,
      // Pulled back from a walk card's framing: this is a backdrop about where
      // a dog lives, not a close-up of one outing.
      maxZoom: 15.5,
      pointZoom: 14,
    });
  }, [route, markers, center, width, height, frameBottomInset, frameTopInset]);

  const { camera, viewCamera, pinsHidden, handleCameraChange, touchHandlers } =
    useLiveMapCamera(framing, onViewCameraChange);

  const path = useMemo(() => route ?? NO_PATH, [route]);

  const canMap = NATIVE_MAP_AVAILABLE && camera !== null;

  // Deferred a tick so map init never blocks the first paint of the chrome over
  // it — the rail and CTA should be interactive before tiles finish loading.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!canMap) return;
    const handle = InteractionManager.runAfterInteractions(() => {
      setReady(true);
      homeMark('map_ready');
    });
    return () => handle.cancel();
  }, [canMap]);

  // A map is genuinely on its way when the device can draw one AND we either
  // have a camera already or are still looking for one. Expo Go, which can
  // never draw a map, gets the plain ground rather than a skeleton that would
  // breathe forever.
  const showSkeleton = NATIVE_MAP_AVAILABLE && (resolving || (canMap && !ready));

  /**
   * Which surface the owner actually got — reported once the answer is settled.
   *
   * It used to fire on the first effect pass, which is always before `ready`
   * can be true and usually before a camera exists at all: the coordinate is
   * read from disk asynchronously. So every session reported `ground`, and the
   * metric said the map almost never drew when in fact it almost always does.
   *
   * `map` the moment tiles are up. `ground` only once we know none are coming —
   * a device that cannot draw one (Expo Go), or a resolve pass that finished
   * without a coordinate.
   */
  const reported = useRef(false);
  useEffect(() => {
    if (reported.current || !onSurfaceResolved) return;
    if (canMap && ready) {
      reported.current = true;
      onSurfaceResolved('map');
      return;
    }
    if (!NATIVE_MAP_AVAILABLE || (!resolving && !canMap)) {
      reported.current = true;
      onSurfaceResolved('ground');
    }
  }, [canMap, ready, resolving, onSurfaceResolved]);

  const placed = useMemo(() => {
    if (!viewCamera) return [];
    const onScreen = markers
      .map(m => ({
        id: m.id,
        marker: m,
        at: projectPoint({ lat: m.lat, lng: m.lng }, viewCamera, width, height),
      }))
      // A marker whose coordinate sits off the framed area is dropped rather
      // than pinned to an edge — an edge-clamped pin claims a place it isn't.
      .filter(p => isOnScreen(p.at, width, height, -8));

    if (!clustered) {
      return onScreen.map(p => ({ ...p, count: 1 }));
    }

    // Clustering happens HERE, after projection, because what makes two pins
    // unreadable is how far apart they are in pixels — not in metres. This
    // layer already owns the camera, so it is the only place that knows.
    return clusterByScreen(onScreen).map(cluster => ({
      id: cluster.id,
      // The lead member is the highest-ranked one (nearest, or confirmed), so
      // a cluster is labelled and selected by its most useful place.
      marker: cluster.members[0].marker,
      at: cluster.at,
      count: cluster.members.length,
    }));
  }, [markers, viewCamera, width, height, clustered]);

  /**
   * The moment the owner tapped open, if any.
   *
   * Owned here rather than by Home: the pins live in this layer, so the state
   * that a tap on one produces belongs beside them.
   */
  const [openKeepsakes, setOpenKeepsakes] = useState<KeepsakeMapPin[] | null>(null);
  const [openIndex, setOpenIndex] = useState(0);

  return (
    // `box-none`, always: the map underneath is now a real, pannable map, so
    // every gap in this layer has to fall through to it. Only the pins
    // themselves take touches, and only when there is something to do with one.
    <View style={styles.layer} pointerEvents="box-none" {...touchHandlers}>
      {canMap && ready ? (
        <WalkMap
          mode="summary"
          path={path}
          center={center}
          camera={camera}
          onCameraChange={handleCameraChange}
          quiet
        />
      ) : showSkeleton ? (
        <MapSkeleton />
      ) : (
        <View style={styles.ground} />
      )}

      {/* Photographs from the drawn walk. Projected against the same
          `viewCamera` the dots use, and hidden during a drag for the same
          reason: a photo pinned to a street it was not taken on is worse than
          one that is briefly absent. */}
      {canMap && ready && !pinsHidden && (
        <KeepsakeMapOverlay
          pins={keepsakePins}
          camera={viewCamera}
          width={width}
          height={height}
          // Enter at the tapped pin but page the whole walk, so the carousel's
          // neighbours are the moments either side of it on the route.
          onPress={(tapped) => {
            setOpenKeepsakes(keepsakePins);
            setOpenIndex(Math.max(0, keepsakePins.indexOf(tapped[0])));
          }}
        />
      )}

      {canMap && ready && !pinsHidden &&
        placed.map(({ id, marker, at, count }) => {
          const selected = marker.tone === 'ink';
          const grouped = count > 1;
          const size = grouped ? CLUSTER_DOT : selected ? SELECTED_DOT : DOT;

          const pin = (
            <View style={styles.markerRow}>
              <View
                style={[
                  styles.dot,
                  {
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                    backgroundColor: color.marker[marker.tone],
                  },
                ]}
              >
                {grouped ? (
                  <Text style={styles.clusterCount}>{count}</Text>
                ) : marker.icon ? (
                  <MaterialCommunityIcons
                    name={marker.icon}
                    size={11}
                    // On the ink (selected) pin the glyph has to invert or it
                    // disappears into the fill.
                    color={selected ? color.surface : color.ink}
                  />
                ) : null}
              </View>
              {/* Only the selected pin is labelled. A map where every pin
                  shouts its name is a legend, not a picture — and the rail
                  already says what the others are. A cluster is never
                  labelled: it stands for several places, so naming it after
                  one of them would be a lie. */}
              {selected && !grouped && !!marker.label && (
                <View style={styles.labelPill}>
                  <Text style={styles.labelText} numberOfLines={1}>
                    {marker.label}
                  </Text>
                </View>
              )}
            </View>
          );

          const position = { left: at.x - size / 2, top: at.y - size / 2 };

          if (!onMarkerPress) {
            return (
              <View key={id} style={[styles.marker, position]}>
                {pin}
              </View>
            );
          }

          return (
            <TouchableOpacity
              key={id}
              style={[styles.marker, position]}
              activeOpacity={0.8}
              // The dot is 18-22px, below the 44px minimum, so the touch target
              // is grown outward rather than the pin being drawn oversized.
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              onPress={() => {
                haptic.select();
                onMarkerPress(id);
              }}
              accessibilityRole="button"
              accessibilityLabel={
                grouped ? `${count} places here` : marker.label ?? 'Map marker'
              }
            >
              {pin}
            </TouchableOpacity>
          );
        })}

      <KeepsakeViewer
        pins={openKeepsakes}
        initialIndex={openIndex}
        context={{ ...keepsakeContext, route: route ?? [] }}
        onClose={() => setOpenKeepsakes(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
  },
  ground: {
    flex: 1,
    backgroundColor: color.surfaceSubtle,
  },
  marker: {
    position: 'absolute',
  },
  markerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    borderWidth: 3,
    borderColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...makeShadow(2, 8, 0.18),
  },
  clusterCount: {
    fontFamily: font.extrabold,
    fontSize: 11,
    color: color.ink,
  },
  labelPill: {
    backgroundColor: color.surface,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    maxWidth: 170,
    ...makeShadow(3, 10, 0.16),
  },
  labelText: {
    fontFamily: font.bold,
    fontSize: 11.5,
    color: color.ink,
  },
});
