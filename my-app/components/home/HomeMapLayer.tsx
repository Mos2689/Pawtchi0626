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
 * The camera below is where we ASK the map to point. Where it actually ends up
 * is a different question the moment the owner drags it, so the map reports
 * back and the projection follows that instead. Without this the pins stayed
 * welded to the screen while the streets slid underneath — a park could end up
 * drawn in the sea.
 *
 * On a platform that only reports its camera once the gesture settles (iOS —
 * see MAP_CAMERA_STREAMS), the pins are hidden for the duration of the drag
 * rather than left somewhere untrue and snapped back at the end. A pin that is
 * briefly absent is honest; a pin in the wrong place is not.
 */

import React, {
  useCallback,
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
import WalkMap, { MAP_CAMERA_STREAMS, NATIVE_MAP_AVAILABLE } from '../walk/WalkMap';
import {
  KeepsakeMapOverlay,
  type KeepsakeMapPin,
} from '../walk/KeepsakeMapOverlay';
import { KeepsakeViewer, type KeepsakeWalkContext } from '../walk/KeepsakeViewer';
import { MapSkeleton } from './MapSkeleton';
import type { MapPin } from '../../lib/home/homeRail';

/** Keeps a framed route clear of the floating chrome above and below it. */
const FRAME_PADDING = 96;

/** Stable identity for "no route", so the map's props don't churn every render. */
const NO_PATH: GeoPoint[] = [];

/**
 * How long to keep the pins hidden after the finger lifts, waiting for the
 * settle event that carries the map's final position.
 *
 * Long enough for MapKit to report, short enough that a tap which moved nothing
 * doesn't leave a visible gap.
 */
const SETTLE_GRACE_MS = 450;

/** Belt and braces: never leave the pins hidden because an event never came. */
const DRAG_GIVE_UP_MS = 2500;
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
      padding: FRAME_PADDING,
      // Pulled back from a walk card's framing: this is a backdrop about where
      // a dog lives, not a close-up of one outing.
      maxZoom: 15.5,
      pointZoom: 14,
    });
  }, [route, markers, center, width, height]);

  /**
   * The framing, held stable by VALUE rather than by identity.
   *
   * `framing` is a fresh object whenever anything it derives from re-renders —
   * a new marker array with the same coordinates, a re-render from an unrelated
   * bit of Home. Handing that straight to the map would re-send the camera prop
   * constantly and yank the view back out from under a drag. Only a genuinely
   * different centre or zoom should command the map.
   */
  const framingKey = framing
    ? `${framing.center.lat.toFixed(6)}|${framing.center.lng.toFixed(6)}|${framing.zoom.toFixed(4)}`
    : '';
  const committed = useRef<MapCamera | null>(null);
  const committedKey = useRef<string>('');
  if (committedKey.current !== framingKey) {
    committedKey.current = framingKey;
    committed.current = framing;
  }
  const camera = committed.current;

  /**
   * Where the map says it actually is. Null until it has been moved, so the
   * commanded framing is what everything reads from on a fresh screen.
   */
  const [live, setLive] = useState<MapCamera | null>(null);

  // A new framing is an instruction to the map, so whatever it last reported is
  // now out of date. Dropping it here stops one stale pan from surviving a
  // recentre and quietly re-applying itself.
  useEffect(() => {
    setLive(null);
  }, [framingKey]);

  /**
   * True while a finger is dragging a map that cannot tell us where it is.
   *
   * Only ever set on a non-streaming platform: where the map reports
   * continuously the pins simply follow, and hiding them would be a flicker for
   * no reason.
   */
  const [dragging, setDragging] = useState(false);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleRelease = useCallback((ms: number) => {
    if (releaseTimer.current) clearTimeout(releaseTimer.current);
    releaseTimer.current = setTimeout(() => setDragging(false), ms);
  }, []);

  useEffect(
    () => () => {
      if (releaseTimer.current) clearTimeout(releaseTimer.current);
    },
    [],
  );

  const handleCameraChange = useCallback(
    (next: MapCamera) => {
      setLive(next);
      // The map has spoken, so the pins can be trusted again — no need to wait
      // out the grace period.
      if (releaseTimer.current) clearTimeout(releaseTimer.current);
      setDragging(false);
      onViewCameraChange?.(next);
    },
    [onViewCameraChange],
  );

  const onTouchMove = useCallback(() => {
    if (MAP_CAMERA_STREAMS) return;
    setDragging(true);
    scheduleRelease(DRAG_GIVE_UP_MS);
  }, [scheduleRelease]);

  const onTouchEnd = useCallback(() => {
    if (MAP_CAMERA_STREAMS) return;
    scheduleRelease(SETTLE_GRACE_MS);
  }, [scheduleRelease]);

  /** What the pins are drawn against: reality if we know it, our request if not. */
  const viewCamera = live ?? camera;

  const path = useMemo(() => route ?? NO_PATH, [route]);

  const canMap = NATIVE_MAP_AVAILABLE && camera !== null;

  // Deferred a tick so map init never blocks the first paint of the chrome over
  // it — the rail and CTA should be interactive before tiles finish loading.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!canMap) return;
    const handle = InteractionManager.runAfterInteractions(() => setReady(true));
    return () => handle.cancel();
  }, [canMap]);

  // A map is genuinely on its way when the device can draw one AND we either
  // have a camera already or are still looking for one. Expo Go, which can
  // never draw a map, gets the plain ground rather than a skeleton that would
  // breathe forever.
  const showSkeleton = NATIVE_MAP_AVAILABLE && (resolving || (canMap && !ready));

  const reported = useRef(false);
  useEffect(() => {
    if (reported.current || !onSurfaceResolved) return;
    reported.current = true;
    onSurfaceResolved(canMap && ready ? 'map' : 'ground');
  }, [canMap, ready, onSurfaceResolved]);

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

  /** Pins are untrustworthy mid-drag on a map that won't say where it is. */
  const pinsHidden = dragging;

  return (
    // `box-none`, always: the map underneath is now a real, pannable map, so
    // every gap in this layer has to fall through to it. Only the pins
    // themselves take touches, and only when there is something to do with one.
    <View
      style={styles.layer}
      pointerEvents="box-none"
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
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
