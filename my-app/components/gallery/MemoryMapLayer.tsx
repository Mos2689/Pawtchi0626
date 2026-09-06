/**
 * MemoryMapLayer — the walk archive as a place rather than as a list.
 *
 * The gallery's grid asks someone to recognise their dog's life as a wall of
 * abstract line drawings. This asks nothing: the memories sit where they
 * happened, and the streets underneath do the remembering.
 *
 * ── Three layers, and the order is the argument ──
 *
 *   1. THE TRAIL WEB, drawn by the basemap. Every route at once, in one muted
 *      stroke. It is the reason this screen exists and not merely a background:
 *      a photo map is a thing several apps do, but only Pawtchi holds the line
 *      the dog actually walked. A route walked once is a whisper; a favourite
 *      route walked fifty times stacks into something solid, so the map draws
 *      frequency for free. The one walk currently selected is lifted out of the
 *      web into the cased navy-and-yellow — which keeps yellow marking exactly
 *      one thing, the way it does everywhere else in the app.
 *
 *   2. TILE PINS — walks with no photograph on them, drawn as the same navy
 *      tile the grid uses, so a walk looks like ITSELF in both views. Without
 *      them the map would be emptier than the list it is offered instead of.
 *
 *   3. PHOTO PINS — `KeepsakeMapOverlay`, unchanged, fed the whole archive
 *      rather than one walk's worth.
 *
 * ── Why the markers are our views and not the SDK's ──
 * Same reason as HomeMapLayer, whose pattern this deliberately follows: Apple
 * draws a marker as a balloon pin and takes an SF Symbol, not a photograph. So
 * the layer owns the camera and projects every coordinate itself against what
 * the map REPORTS — see `useLiveMapCamera`, which both screens share so the
 * subtle parts (commanding by value, hiding pins mid-drag on iOS) cannot drift.
 *
 * ── The opening move ──
 * Pins bloom in from the middle of the screen outward. It is a small thing and
 * it is the whole feeling: the eye starts where it already is and gets pulled
 * to the edges, which is the "how far does this go?" reaction the screen is for.
 * Honoured only when the device has not asked for reduced motion.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import Reanimated, { FadeIn, useReducedMotion } from 'react-native-reanimated';

import { color, motion } from '../../constants/design';
import { haptic } from '../../lib/haptics';
import type { GeoPoint } from '../../lib/walk/geo';
import {
  fitCamera,
  isOnScreen,
  projectPoint,
} from '../../lib/walk/mapCamera';
import { useLiveMapCamera } from '../../hooks/useLiveMapCamera';
import { thumbnailUrls } from '../../lib/walk/keepsakeThumbnail';
import WalkMap, { NATIVE_MAP_AVAILABLE } from '../walk/WalkMap';
import {
  KeepsakeMapOverlay,
  keepsakeFitPadding,
  type KeepsakeMapPin,
} from '../walk/KeepsakeMapOverlay';
import { KeepsakeViewer, type KeepsakeWalkContext } from '../walk/KeepsakeViewer';
import { WalkTile } from '../pawprints/WalkTile';
import {
  photoPinsForWalk,
  type MemoryMap,
  type MemoryPhotoPin,
} from '../../lib/memoryMap';

/** Edge of a tile pin, in dp. Smaller than a grid tile — this is a marker. */
const TILE = 40;

/** Stable identity for "no walk selected", so the map's props don't churn. */
const EMPTY_PATH: GeoPoint[] = [];

/** Height of the little stem under a tile, matching the photo cards'. */
const TIP = 6;

/**
 * How far outside the view a tile may sit and still be drawn.
 *
 * Positive, like the photo overlay's and unlike Home's dot layer: these markers
 * are far larger than a dot and hang above their coordinate, so a shrinking
 * margin would discard a walk whose tile would have been perfectly visible.
 */
const EDGE_MARGIN = 28;

/** Breathing room around the framed archive, before the card allowance. */
const FRAME_BASE_PADDING = 26;

/**
 * Zoom ceiling for the opening frame.
 *
 * An archive that happens to sit in one street would otherwise open slammed
 * against the buildings. The subject here is a neighbourhood, so the frame stops
 * at neighbourhood scale and lets the owner pinch in if they want the doorway.
 */
const MAX_FRAME_ZOOM = 16;

/** Per-pin delay for the bloom, and the ceiling it is capped to. */
const BLOOM_STEP_MS = 24;
const BLOOM_MAX_MS = 500;

/**
 * How much to nudge the framing so a recentre is seen as a new instruction.
 *
 * One unit in the last place `useLiveMapCamera` compares — it rounds zoom to
 * four decimals, so anything finer is deduplicated and the button silently does
 * nothing. At this size the map moves by roughly 0.007% of a zoom step, which is
 * to say not at all.
 */
const RECENTRE_JITTER = 1e-4;

interface Props {
  map: MemoryMap;
  /** Walk facts used to caption an opened photo, keyed by walk session id. */
  contextForWalk: (walkSessionId: string) => KeepsakeWalkContext;
  /** The walk drawn in cased yellow, lifted out of the web. */
  selectedWalkId: string | null;
  /** Its route, supplied by the screen so this layer holds no walk rows. */
  selectedRoute: GeoPoint[] | null;
  /** A tile pin was tapped — the screen opens its editor. */
  onWalkPress: (walkSessionId: string) => void;
  /** Room to leave at the top for the floating header and headline chip. */
  frameTopInset?: number;
  /** True once the owner has moved the map off its opening frame. */
  onPannedChange?: (panned: boolean) => void;
  /** Bumped by the screen to re-frame on the whole archive. */
  recentreNonce?: number;
}

export function MemoryMapLayer({
  map,
  contextForWalk,
  selectedWalkId,
  selectedRoute,
  onWalkPress,
  frameTopInset = 0,
  onPannedChange,
  recentreNonce = 0,
}: Props) {
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();

  /**
   * The opening frame: everything the map is about to draw.
   *
   * `keepsakeFitPadding` supplies the top allowance rather than a hand-guessed
   * number — it is exported for exactly this, because a photo card hangs its
   * full height ABOVE its coordinate and nothing below it. Guessing here is how
   * a moment at the top of the archive ends up sliced by the status bar, and it
   * looks like a rendering bug rather than a framing one.
   */
  const framing = useMemo(() => {
    const pad = keepsakeFitPadding(undefined, FRAME_BASE_PADDING);
    return fitCamera(map.framing, {
      width,
      height,
      padding: { ...pad, top: pad.top + frameTopInset },
      maxZoom: MAX_FRAME_ZOOM,
      // A single-place archive still wants its surroundings, not its doorstep.
      pointZoom: 15,
    });
  }, [map.framing, width, height, frameTopInset]);

  /**
   * The same frame, made unmistakably new when the owner asks to go back to it.
   *
   * `useLiveMapCamera` holds the framing stable BY VALUE, which is what stops an
   * unrelated re-render yanking the map mid-drag — and which also means
   * re-commanding the identical centre and zoom does nothing at all. Recentring
   * has to be a genuinely different value, so the nonce rides in as a jitter.
   *
   * It has to clear the hook's own resolution: that comparison rounds zoom to
   * four decimals, so anything finer is deduplicated and the button does
   * nothing. See RECENTRE_JITTER.
   */
  const framingWithNonce = useMemo(
    () =>
      framing && recentreNonce > 0
        ? { ...framing, zoom: framing.zoom + recentreNonce * RECENTRE_JITTER }
        : framing,
    [framing, recentreNonce],
  );

  const { camera, viewCamera, pinsHidden, handleCameraChange, touchHandlers } =
    useLiveMapCamera(framingWithNonce);

  /**
   * Whether the OWNER has moved the map — which is not the same question as
   * whether the map has moved.
   *
   * The obvious test, "is the reported camera different from the commanded
   * one", is wrong on Android: MapLibre reports its region after a programmatic
   * move too, so the recentre control would appear on load having nothing to
   * undo. A finger on the glass is the only honest signal, so that is what is
   * counted. Reset whenever we re-frame, otherwise the control survives doing
   * its own job.
   */
  const [panned, setPanned] = useState(false);
  useEffect(() => {
    setPanned(false);
  }, [recentreNonce]);
  useEffect(() => {
    onPannedChange?.(panned);
  }, [panned, onPannedChange]);

  const overlayTouchHandlers = {
    onTouchMove: () => {
      touchHandlers.onTouchMove();
      setPanned(true);
    },
    onTouchEnd: touchHandlers.onTouchEnd,
    onTouchCancel: touchHandlers.onTouchCancel,
  };

  /**
   * Signed thumbnail URLs for the whole archive, fetched once.
   *
   * `useKeepsakeImage` resolves one photo per pin, which is right for a viewer
   * and wrong for a map: thirty pins is thirty signing round-trips, and every
   * pan re-clusters and remounts them. So the layer signs the batch itself and
   * hands each pin a `uri`, a field `KeepsakeMapPin` already prefers over the
   * hook.
   *
   * This skips the local-original rung on purpose. A 320px thumbnail is more
   * than a 46dp card can show, and resolving originals means one SYNCHRONOUS
   * filesystem stat per keepsake on the JS thread. The viewer still runs the
   * full ladder when a memory is actually opened, which is the only place the
   * difference could ever be seen.
   */
  const [signed, setSigned] = useState<Record<string, string>>({});
  /**
   * Whether the batch has been answered.
   *
   * The photo pins are held back until it has, and that gate is the entire
   * point of batching. Rendering them one render earlier means every visible
   * pin mounts with no `uri`, runs its own resolution hook, and fires its own
   * signing request — the exact stampede the batch exists to prevent, just one
   * frame sooner. The pins bloom in anyway, so the wait is invisible.
   */
  const [thumbsReady, setThumbsReady] = useState(false);
  useEffect(() => {
    const paths = map.photoPins.flatMap((pin) =>
      pin.keepsake.thumbPath ? [pin.keepsake.thumbPath] : [],
    );
    if (paths.length === 0) {
      setThumbsReady(true);
      return;
    }

    let cancelled = false;
    void thumbnailUrls(paths).then((urls) => {
      if (cancelled) return;
      setSigned(urls);
      // Ready even when the batch came back empty: a failed signing pass means
      // the pins fall to their local copies, which is the ladder working, not a
      // reason to leave the map without its photographs forever.
      setThumbsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [map.photoPins]);

  const keepsakePins: KeepsakeMapPin[] = useMemo(
    () =>
      map.photoPins.map((pin) => ({
        id: pin.id,
        lat: pin.lat,
        lng: pin.lng,
        // Undefined, not null, when the batch has no answer: a capture whose
        // thumbnail has not uploaded yet falls through to the pin's own hook,
        // which finds the local file. Those are always recent and always few.
        uri: pin.keepsake.thumbPath ? signed[pin.keepsake.thumbPath] : undefined,
        keepsake: pin.keepsake,
      })),
    [map.photoPins, signed],
  );

  /**
   * True once the opening bloom has played out.
   *
   * Clocked from the moment the photographs are ready, because that is when
   * every marker goes on screen together — see the render, where the tiles wait
   * on the same gate. An archive with no photographs opens that gate instantly,
   * so nobody waits for something they do not have.
   */
  const [bloomDone, setBloomDone] = useState(false);
  useEffect(() => {
    if (!thumbsReady || bloomDone) return;
    const t = setTimeout(
      () => setBloomDone(true),
      BLOOM_MAX_MS + motion.duration.base,
    );
    return () => clearTimeout(t);
  }, [thumbsReady, bloomDone]);

  /** Tile pins that are actually on screen, in bloom order. */
  const placedTiles = useMemo(() => {
    if (!viewCamera) return [];
    return map.tilePins
      .map((pin) => ({
        pin,
        at: projectPoint({ lat: pin.lat, lng: pin.lng }, viewCamera, width, height),
      }))
      // Dropped rather than clamped to an edge — an edge-clamped pin claims a
      // place it isn't, which on a map of somewhere real is a lie.
      .filter((p) => isOnScreen(p.at, width, height, EDGE_MARGIN));
  }, [map.tilePins, viewCamera, width, height]);

  /**
   * Bloom delay for a marker, by how far it sits from the middle of the screen.
   *
   * Ranked rather than measured in pixels: what should feel even is the RHYTHM
   * of pins appearing, and a distance-proportional delay clumps everything in
   * the dense middle into a single beat and then leaves a long silence for the
   * one pin out at the edge.
   *
   * It is the ARRIVAL that is being staged, so it happens once. Afterwards this
   * goes empty and every marker appears immediately — a pin panned into view
   * half a minute later has not just arrived, and holding it back for up to half
   * a second would read as the map lagging rather than as anything designed.
   */
  const bloomOrder = useMemo(() => {
    if (!viewCamera || bloomDone) return new Map<string, number>();
    const cx = width / 2;
    const cy = height / 2;

    const all = [
      ...placedTiles.map((t) => ({ id: t.pin.id, at: t.at })),
      ...map.photoPins.map((pin) => ({
        id: pin.id,
        at: projectPoint({ lat: pin.lat, lng: pin.lng }, viewCamera, width, height),
      })),
    ];

    all.sort(
      (a, b) =>
        Math.hypot(a.at.x - cx, a.at.y - cy) - Math.hypot(b.at.x - cx, b.at.y - cy),
    );

    const delays = new Map<string, number>();
    all.forEach((item, i) => {
      delays.set(item.id, Math.min(i * BLOOM_STEP_MS, BLOOM_MAX_MS));
    });
    return delays;
  }, [placedTiles, map.photoPins, viewCamera, width, height, bloomDone]);

  /** The moment the owner tapped open, if any. */
  const [openPins, setOpenPins] = useState<KeepsakeMapPin[] | null>(null);
  const [openIndex, setOpenIndex] = useState(0);
  const [openWalkId, setOpenWalkId] = useState<string | null>(null);

  const openPhoto = (tapped: KeepsakeMapPin[]) => {
    const lead = tapped[0];
    const source = map.photoPins.find((p) => p.id === lead?.id);
    if (!source) return;

    // Enter at the tapped moment but page THAT WALK's moments, so the
    // neighbours are the rest of the outing rather than whatever happened to be
    // pinned nearby six months later. Home's map behaves the same way.
    const walkPins: MemoryPhotoPin[] = photoPinsForWalk(
      map.photoPins,
      source.walkSessionId,
    );
    const byId = new Map(keepsakePins.map((p) => [p.id, p]));
    const pins = walkPins.flatMap((p) => {
      const found = byId.get(p.id);
      return found ? [found] : [];
    });
    if (pins.length === 0) return;

    haptic.select();
    setOpenWalkId(source.walkSessionId);
    setOpenIndex(Math.max(0, pins.findIndex((p) => p.id === lead.id)));
    setOpenPins(pins);
  };

  const canMap = NATIVE_MAP_AVAILABLE && camera !== null;

  return (
    // `box-none` so every gap falls through to the real, pannable map beneath.
    // Only the markers take touches.
    <View style={styles.layer} pointerEvents="box-none" {...overlayTouchHandlers}>
      {canMap ? (
        <WalkMap
          mode="summary"
          // The selected walk, and only it, in the cased navy-and-yellow. The
          // rest of the archive is the muted web below.
          path={selectedRoute ?? EMPTY_PATH}
          trails={map.trails}
          center={null}
          camera={camera}
          onCameraChange={handleCameraChange}
          quiet
        />
      ) : (
        <View style={styles.ground} />
      )}

      {/* Tiles wait on the same gate the photographs do, so the map arrives as
          one composed thing rather than as drawings first and pictures a beat
          later. With no photographs to sign, the gate is already open. */}
      {canMap && !pinsHidden && thumbsReady &&
        placedTiles.map(({ pin, at }) => (
          <Reanimated.View
            key={pin.id}
            entering={
              reduceMotion
                ? undefined
                : FadeIn.duration(motion.duration.base).delay(bloomOrder.get(pin.id) ?? 0)
            }
            style={[
              styles.marker,
              {
                // Centred horizontally and sitting ABOVE the coordinate: the
                // point being marked is the bottom tip, the way a pin behaves
                // and the way the photo cards beside it already do.
                left: at.x - TILE / 2,
                top: at.y - TILE - TIP,
              },
            ]}
          >
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => {
                haptic.select();
                onWalkPress(pin.id);
              }}
              accessibilityRole="button"
              accessibilityLabel="A walk from here"
            >
              <View
                style={[
                  styles.tileFrame,
                  pin.id === selectedWalkId && styles.tileFrameSelected,
                ]}
              >
                <WalkTile route={pin.route} size={TILE} />
              </View>
            </TouchableOpacity>
            <View style={styles.tip} />
          </Reanimated.View>
        ))}

      {/* Photographs, over the tiles: where both exist for one place, the
          picture is the better thing to look at. */}
      {canMap && !pinsHidden && thumbsReady && (
        <KeepsakeMapOverlay
          pins={keepsakePins}
          camera={viewCamera}
          width={width}
          height={height}
          onPress={openPhoto}
          entering={
            reduceMotion
              ? undefined
              : (id) =>
                  FadeIn.duration(motion.duration.base).delay(bloomOrder.get(id) ?? 0)
          }
        />
      )}

      <KeepsakeViewer
        pins={openPins}
        initialIndex={openIndex}
        context={openWalkId ? contextForWalk(openWalkId) : undefined}
        onClose={() => setOpenPins(null)}
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
    alignItems: 'center',
  },
  // The white edge is what lifts a navy tile off dark parkland and pale roads
  // alike — the same trick the photo cards use, and the reason both read as one
  // family of marker rather than two.
  tileFrame: {
    borderRadius: 13,
    borderWidth: 3,
    borderColor: color.surface,
    overflow: 'hidden',
  },
  // The selected walk's tile takes the brand edge, matching the yellow its
  // route has just been promoted to on the map below.
  tileFrameSelected: {
    borderColor: color.yellow,
  },
  tip: {
    width: 3,
    height: TIP,
    backgroundColor: color.surface,
  },
});
