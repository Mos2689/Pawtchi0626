/**
 * /walk — the tracked-walk experience, one route across three phases:
 *
 *   tracking → full-bleed live map (Apple Maps on iOS, MapLibre + OSM on
 *              Android) with a yellow polyline growing behind the user, a
 *              floating header, and a Strava-style navy card at the bottom
 *              with timer, distance, kcal so far, and the Finish button.
 *   saving   → the Tail Whip: a giant yellow tail sweeps the screen and the
 *              summary swap hides inside the motion blur. Slow saves hold at
 *              full cover with a breathing paw; reduce-motion and recovered
 *              finalizes keep the quiet saving beat instead.
 *   summary  → revealed by the tail exit: ONE heartbeat, fur dust, staggered
 *              stats, the completed route framed on the same map, and what
 *              happened to the plan.
 *
 * Leaving this screen mid-walk is safe: tracking lives in the foreground
 * service + store, not here. Re-entering just re-attaches the UI.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  BackHandler,
  type LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Redirect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import Reanimated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { color, font, motion, radius, shadow, space, type } from '../constants/design';
import { BreathingPaw } from '../components/BreathingPaw';
import { AnimatedPressable } from '../components/AnimatedPressable';
import { TailWhipSuccessTransition } from '../components/transitions/TailWhipSuccessTransition';
import { MomentShareModal } from '../components/MomentShareModal';
import { haptic } from '../lib/haptics';
import { easeOutQuart } from '../lib/tailWhipTimeline';
import WalkMap from '../components/walk/WalkMap';
import {
  ROUTE_PROGRESS_MAP_INSET,
  RouteProgressCard,
} from '../components/walk/RouteProgressCard';
import { useWalkStore } from '../store/useWalkStore';
import { useActivePetStore } from '../store/useActivePetStore';
import { usePawPrintStore } from '../store/usePawPrintStore';
import { useStreakStore } from '../store/useStreakStore';
import { useWalkStoryStore } from '../store/useWalkStoryStore';
import { nextTemplateChipLine } from '../lib/momentTemplates';
import { resolveSniffStops } from '../lib/momentCard';
import { useAuth } from '../providers/AuthProvider';
import { estimateActivityBurn } from '../lib/activityBurn';
import { deriveDogWalkProfile, intensityForPace } from '../lib/walk/dogCalibration';
import { estimateDogSteps, formatStepsProse } from '../lib/walk/stepEstimate';
// The trail's words about time — reused from the moment viewer so a walk is
// described the same way wherever it is read back.
import { elapsedPhrase, partOfDay } from '../lib/walk/keepsakeCaption';
import * as ImagePicker from 'expo-image-picker';
import { persistCapture } from '../lib/walk/keepsakeFile';
import { exifCapturedAt, exifCoordinate } from '../lib/walk/keepsakeExif';
import {
  elapsedSecondsInto,
  estimateRouteIndexByTime,
  isWithinWalkWindow,
  snapToRoute,
} from '../lib/walk/keepsake';
import { placeKeyOrNull } from '../lib/walk/placeKey';
import { enqueueOutbox, newOutboxId, drainOutbox } from '../lib/walk/keepsakeOutbox';
import { outboxPorts } from '../lib/walk/keepsakeOutboxPorts';
import { dogPaceKmh, formatEta, walkEtaMinutes } from '../lib/walk/wayfinding';
import { useWalkRoute } from '../hooks/useWalkRoute';
import {
  disarmWalkStart,
  isWalkStartArmed,
  takeWalkDestination,
  type WalkDestination,
} from '../lib/walk/walkStartIntent';
import { haversineMeters } from '../lib/walk/geo';
import {
  clearActiveDestination,
  readActiveDestination,
  rememberActiveDestination,
} from '../lib/walk/activeDestination';
// Shared with the iOS Live Activity, which renders the same line on the Lock
// Screen — the two surfaces must never describe the walk differently.
import { WALK_STATUS_COPY } from '../lib/walk/liveCopy';
import { formatDistance } from '../lib/spots/copy';
import {
  acknowledgeLocationDisclosure,
  hasAcknowledgedLocationDisclosure,
} from '../lib/walk/locationDisclosure';
import { useWalkEnabled } from '../hooks/useWalkEnabled';
import { useWalkKeepsakes, type PendingCapture } from '../hooks/useWalkKeepsakes';
import { WalkCamera } from '../components/walk/WalkCamera';
import { KeepsakePrompt } from '../components/walk/KeepsakePrompt';
import {
  KeepsakeMapOverlay,
  keepsakeFitPadding,
  type KeepsakeMapPin,
} from '../components/walk/KeepsakeMapOverlay';
import { KeepsakeViewer } from '../components/walk/KeepsakeViewer';
import { fitCamera, type MapCamera } from '../lib/walk/mapCamera';
import {
  WALK_CAMERA_ENABLED,
  WALK_PHOTO_IMPORT_ENABLED,
  WALK_STORY_ENABLED,
} from '../constants/features';
import { createWalkStorySnapshot } from '../lib/walkStorySnapshot';
import { discardWalk } from '../lib/walk/discardWalk';
import { getLocalYMD } from '../lib/dateUtils';
import { reportError, toAppError } from '../lib/appError';

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Gate wrapper, not an in-body early return: the inner screen auto-starts a
// walk from a mount effect, so when walks are unavailable it must never mount.
// This also closes the pawtchi://walk deep link for both the release flag being
// off AND a cat profile (walks are dogs-only) — the route redirects to Activity.
export default function WalkScreen() {
  const walkEnabled = useWalkEnabled();
  if (!walkEnabled) return <Redirect href="/(tabs)/activity" />;
  return <WalkScreenInner />;
}

function WalkScreenInner() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const activePet = useActivePetStore(s => s.activePet);

  const phase = useWalkStore(s => s.phase);
  const marker = useWalkStore(s => s.marker);
  const session = useWalkStore(s => s.session);
  const capReached = useWalkStore(s => s.capReached);
  const lastResult = useWalkStore(s => s.lastResult);
  const startWalk = useWalkStore(s => s.startWalk);
  const endWalk = useWalkStore(s => s.endWalk);
  const tick = useWalkStore(s => s.tick);
  const dismissSummary = useWalkStore(s => s.dismissSummary);

  const [now, setNow] = useState(Date.now());
  const [denied, setDenied] = useState<string | null>(null);
  // Shown before the OS location prompt on first use — see lib/walk/locationDisclosure.
  const [needsDisclosure, setNeedsDisclosure] = useState(false);
  const [milestoneKm, setMilestoneKm] = useState(0);
  /**
   * Somewhere the owner said they were heading, from a Spots card.
   *
   * A note on the map, not a route: it draws a pin and counts down the
   * remaining distance, and it changes nothing about how the walk is measured,
   * validated or saved. A walk that never reaches it is still a walk.
   */
  const [destination, setDestination] = useState<WalkDestination | null>(() =>
    readActiveDestination(marker?.id),
  );

  /**
   * Moments captured on this walk.
   *
   * Drafts are held in the hook until the walk saves and hands over a session
   * id, so a discarded walk simply never writes them — no orphan rows to sweep.
   * WalkScreenInner only renders behind the walk gate, so the flag is the only
   * condition left to check here.
   */
  const keepsakes = useWalkKeepsakes({
    enabled: WALK_CAMERA_ENABLED,
    ownerId: user?.id ?? null,
    petId: activePet?.id ?? null,
    session,
    startedAt: marker?.startedAt ?? null,
    now,
    walkSessionId: lastResult?.walkSessionId ?? null,
  });

  /** The most recent moment, for the capture button's face. */
  const lastCaptureUri = keepsakes.captures.at(-1)?.uri ?? null;

  /**
   * The destination as a map pin. Ink, because it is the one place that matters.
   *
   * Memoised, and up here with the other hooks rather than beside the JSX that
   * uses it, because this screen returns early on several paths — a hook below
   * one of them would not run in the same order every render. Stability is the
   * point anyway: a fresh array each render re-sends the pin to the native map.
   */
  const destinationPins = useMemo(
    () =>
      destination
        ? [{ id: destination.id, lat: destination.lat, lng: destination.lng, tone: 'ink' as const }]
        : [],
    [destination],
  );

  const startedRef = useRef(false);
  const celebratedKmRef = useRef(0);

  // ── The Tail Whip — walk completion is a wipe, not a cover ──
  // 'running' = the tail wipes the frozen live screen away, revealing the
  // summary behind it; 'done' = revealed, overlay gone. No flat colour cover
  // at any point. Reduce-motion never enters the machine.
  type WhipState = 'idle' | 'running' | 'done';
  const [whip, setWhip] = useState<WhipState>('idle');
  const [peaked, setPeaked] = useState(false);
  const [revealSignal, setRevealSignal] = useState<number | null>(null);
  const whipModeRef = useRef<'tap' | 'auto'>('tap');
  const sawTrackingRef = useRef(false);
  // endWalk nulls marker/session in its final set — snapshot them at whip
  // start so the frozen live screen the tail wipes away never degrades to the
  // "acquiring" variant mid-sweep.
  type StoreState = ReturnType<typeof useWalkStore.getState>;
  const frozenRef = useRef<{
    marker: StoreState['marker'];
    session: StoreState['session'];
    now: number;
  } | null>(null);

  const beginWhip = useCallback((mode: 'tap' | 'auto') => {
    const s = useWalkStore.getState();
    frozenRef.current = { marker: s.marker, session: s.session, now: Date.now() };
    whipModeRef.current = mode;
    setRevealSignal(null);
    setPeaked(false);
    setWhip('running');
  }, []);

  // A walk begins ONLY from an explicit user tap (the Walk / Track buttons arm
  // the intent right before navigating here). A bare mount with no armed intent
  // — route restoration on relaunch, a remount after finishing — must NEVER
  // auto-start a walk; that was the real cause of "tracking auto-starts on
  // reopen / after finish". Unarmed and idle ⇒ leave the screen.
  // Kicks off the OS permission request + tracking. Only ever called once the
  // location disclosure has been acknowledged.
  const beginTracking = useCallback(() => {
    if (!activePet || !user?.id) return;
    startWalk(activePet, user.id).then(result => {
      if (result === 'denied') {
        setDenied('Location access is off, so this walk can’t be measured.');
      } else if (result === 'services_off') {
        setDenied('Location services are turned off on this phone.');
      }
    });
  }, [activePet, user?.id, startWalk]);

  useEffect(() => {
    if (startedRef.current) return;
    if (phase !== 'idle' || lastResult) return; // live walk or summary — render as-is
    if (isWalkStartArmed()) {
      if (activePet && user?.id) {
        startedRef.current = true;
        // Taken in the same breath as the disarm: the destination belongs to
        // THIS start, and leaving it behind would let the next walk inherit it.
        setDestination(takeWalkDestination());
        disarmWalkStart();
        // Google Play requires a prominent in-app disclosure BEFORE the runtime
        // location request whenever location is collected in the background,
        // which a tracked walk does on both platforms. Gate the request on it.
        hasAcknowledgedLocationDisclosure(user.id).then(acked => {
          if (acked) beginTracking();
          else setNeedsDisclosure(true);
        });
      }
      // Armed but pet/user not loaded yet → wait for the deps to update.
    } else {
      // No explicit start intent — an unintended mount. Never auto-start.
      startedRef.current = true;
      router.replace('/(tabs)/activity');
    }
  }, [phase, lastResult, activePet, user?.id, startWalk, router, beginTracking]);

  // 1s clock for the timer; the store's auto-stop poll rides every 5th beat.
  useEffect(() => {
    if (phase !== 'tracking') return;
    let beats = 0;
    const id = setInterval(() => {
      setNow(Date.now());
      beats += 1;
      if (beats % 5 === 0) tick();
    }, 1000);
    return () => clearInterval(id);
  }, [phase, tick]);

  // Kilometre milestones — a light haptic and a chip, never an interruption.
  const kmDone = Math.floor((session?.distanceM ?? 0) / 1000);
  useEffect(() => {
    if (phase !== 'tracking') return;
    if (kmDone > 0 && kmDone > celebratedKmRef.current) {
      celebratedKmRef.current = kmDone;
      setMilestoneKm(kmDone);
      haptic.tap();
    }
  }, [kmDone, phase]);

  // Summary arrival haptic — only when no whip ran (whip paths fire success
  // as the content reveals, see the reveal-signal effect below).
  useEffect(() => {
    if (phase === 'summary' && lastResult && whip === 'idle') {
      haptic.success();
    }
  }, [phase, lastResult, whip]);

  // The whip reveals the summary content once the tail has passed its peak
  // (`peaked`) AND the save is done. On a fast save this lands as the tail
  // exits; on a slow save it lands when the save finishes, over the quiet
  // saving screen the whip already revealed. Fires the content stagger + the
  // single success heartbeat.
  useEffect(() => {
    if (peaked && phase === 'summary' && lastResult && revealSignal == null) {
      setRevealSignal(Date.now());
      haptic.success();
    }
  }, [peaked, phase, lastResult, revealSignal]);

  // Auto-stop walks (stationary / home / time cap) get the whip too — the
  // moment is just as much a success, only the press-freeze is dropped. The
  // sawTracking guard keeps the launch-time `recovered` finalize (phase ===
  // 'saving' observed from a cold mount) on the quiet path.
  useEffect(() => {
    if (phase === 'tracking') sawTrackingRef.current = true;
  }, [phase]);
  useEffect(() => {
    if (phase === 'saving' && whip === 'idle' && sawTrackingRef.current) {
      beginWhip('auto');
    }
  }, [phase, whip, beginWhip]);

  // While the tail owns the screen, Android back must not tear the wipe.
  useEffect(() => {
    if (whip !== 'running') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [whip]);

  const petName =
    frozenRef.current?.marker?.petName ??
    marker?.petName ??
    lastResult?.petName ??
    activePet?.name ??
    'your dog';

  const handleDone = () => {
    dismissSummary();
    router.back();
  };

  // While the tail is wiping, the store has already moved on (endWalk nulls
  // marker/session) — render the frozen live screen from the snapshot instead.
  // This entire route-presentation block deliberately lives before every
  // disclosure/error return so its hooks keep one stable order on every render.
  const fz = whip === 'running' ? frozenRef.current : null;
  const liveMarker = fz?.marker ?? marker;
  const liveSession = fz?.session ?? session;
  const liveNow = fz?.now ?? now;

  // ── Live display values (also the frozen anticipation beat) ──
  const acquiring = phase === 'starting' || !liveSession || liveSession.acceptedCount === 0;
  const paused = liveSession?.status === 'auto_paused';
  const elapsed = liveMarker ? liveNow - liveMarker.startedAt : 0;
  const km = (liveSession?.distanceM ?? 0) / 1000;

  // Live kcal — same dog-calibrated math the summary and Home card use, so
  // the number never jumps when the walk ends. Based on MOVING time: standing
  // still, sniff breaks, and speed-gated car segments must not tick the burn.
  const movingMin = Math.round((liveSession?.movingTimeMs ?? 0) / 60_000);
  const movingH = (liveSession?.movingTimeMs ?? 0) / 3_600_000;
  const avgSpeed = movingH > 0 ? km / movingH : 0;
  const liveKcal =
    liveMarker && activePet?.current_weight_kg
      ? Math.round(
          estimateActivityBurn(
            'walk',
            intensityForPace(avgSpeed, liveMarker.profile),
            movingMin,
            activePet.current_weight_kg,
          ),
        )
      : 0;

  const currentPosition = liveSession?.lastAccepted
    ? { lat: liveSession.lastAccepted.lat, lng: liveSession.lastAccepted.lng }
    : null;

  // A spot coordinate often marks a park's middle rather than its gate.
  const ARRIVED_M = 120;
  const toDestination =
    destination && currentPosition
      ? haversineMeters(currentPosition, { lat: destination.lat, lng: destination.lng })
      : null;
  const arrived = toDestination !== null && toDestination <= ARRIVED_M;
  const toDestinationLabel = formatDistance(toDestination);

  /**
   * The suggested way there, from OSM's routing service. Presentation only:
   * never counted, persisted, or exposed to the walk engine.
   */
  const { route: suggestedRoute, status: routeStatus } = useWalkRoute({
    walkId: liveMarker?.id ?? null,
    destination: destination ? { lat: destination.lat, lng: destination.lng } : null,
    currentPosition,
    initialPosition: destination?.origin ?? null,
    enabled: phase === 'tracking' && !arrived,
  });

  // Navigation to Home unmounts this screen while the walk itself continues.
  // Keep only the destination handoff in module memory, keyed to this exact
  // walk. This is UI continuity—not persistence and never tracking authority.
  useEffect(() => {
    if (liveMarker?.id && destination && phase === 'tracking') {
      rememberActiveDestination(liveMarker.id, destination);
    }
  }, [destination, liveMarker?.id, phase]);

  useEffect(() => {
    if (phase !== 'starting' && phase !== 'tracking') {
      clearActiveDestination(liveMarker?.id ?? marker?.id);
    }
  }, [liveMarker?.id, marker?.id, phase]);

  // One quiet acknowledgement when the async enhancement becomes tangible.
  const previousRouteStatus = useRef(routeStatus);
  const [routeJustReady, setRouteJustReady] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (routeStatus === 'ready' && previousRouteStatus.current !== 'ready') {
      haptic.soft();
      setRouteJustReady(true);
      timer = setTimeout(() => setRouteJustReady(false), motion.route.readyHold);
    } else if (routeStatus === 'loading') {
      setRouteJustReady(false);
    }
    previousRouteStatus.current = routeStatus;
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [routeStatus]);

  const toDestinationEta =
    !arrived && liveMarker && toDestination !== null
      ? formatEta(walkEtaMinutes(toDestination, dogPaceKmh(liveMarker.profile.paceBandKmh)))
      : '';

  const showRouteProgress =
    !!destination && !arrived && (routeStatus === 'loading' || routeJustReady);
  /** The strips below the header stack only move when the compact chip exists. */
  const destOffset = destination && !showRouteProgress ? 38 : 0;
  const [bottomCardHeight, setBottomCardHeight] = useState<number | null>(null);
  const onBottomCardLayout = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.height;
    setBottomCardHeight(previous =>
      previous !== null && Math.abs(previous - next) < 1 ? previous : next,
    );
  }, []);

  // ── Prominent location disclosure (Google Play Location Permissions policy) ──
  // Must render BEFORE the OS prompt. Says what is collected, that it continues
  // in the background, and what it is used for — in plain words, not the OS
  // permission string. Declining leaves the walk unstarted and nothing is
  // requested.
  if (needsDisclosure) {
    return (
      <View style={[styles.deniedScreen, { paddingTop: insets.top + space.xl }]}>
        <Text style={styles.eyebrow}>TRACKED WALK</Text>
        <View style={styles.centerFill}>
          <MaterialIcons name="my-location" size={40} color={color.navy} />
          <Text style={styles.deniedTitle}>Before we start tracking</Text>
          <Text style={styles.disclosureBody}>
            Pawtchi collects your device’s precise location while a walk is running, to
            measure the route, distance, pace and rest stops.
            {'\n\n'}
            Tracking keeps going in the background so the walk isn’t lost when your screen
            locks — you’ll see an ongoing notification on Android, or the location
            indicator on iOS — and stops when the walk ends.
            {'\n\n'}
            Your route is saved to your pet’s history so you can see it later. Because
            walks usually start at home, it can show roughly where you live. Only you can
            see it, and it is never used for advertising.
            {'\n\n'}
            Outside a walk, Pawtchi reads your location in one other place: to centre the
            map on your home screen, and only until your first walk draws itself. It is
            never collected continuously when a walk isn’t running.
          </Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => {
              acknowledgeLocationDisclosure(user?.id);
              setNeedsDisclosure(false);
              beginTracking();
            }}
          >
            <Text style={styles.primaryBtnText}>Continue</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.back()}>
            <Text style={styles.secondaryBtnText}>Not now</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Permission fallback — the manual flow is always there ──
  if (denied) {
    return (
      <View style={[styles.deniedScreen, { paddingTop: insets.top + space.xl }]}>
        <Text style={styles.eyebrow}>TRACKED WALK</Text>
        <View style={styles.centerFill}>
          <MaterialIcons name="location-off" size={40} color={color.slateFaint} />
          <Text style={styles.deniedTitle}>{denied}</Text>
          <Text style={styles.deniedBody}>
            You can allow location in Settings, or mark the walk done from the
            Activity tab like before.
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => router.back()}>
            <Text style={styles.primaryBtnText}>Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── The live tracking screen ──
  // Also the frozen `over` the tail wipes away: during the whip liveMarker /
  // liveSession come from the snapshot (frozenRef), so this renders unchanged
  // while the store has already moved on.
  const liveNode = (
    <View style={styles.liveRoot}>
      {/* Full-bleed basemap */}
      <WalkMap
        mode="live"
        path={liveSession?.path ?? []}
        currentPosition={currentPosition}
        paused={!!paused}
        spots={destinationPins}
        suggestedRoute={suggestedRoute}
        liveBottomInset={showRouteProgress ? ROUTE_PROGRESS_MAP_INSET : 0}
        style={StyleSheet.absoluteFillObject as any}
      />

      {/* Floating top header */}
      <View style={[styles.headerOverlay, { top: insets.top + space.sm }]} pointerEvents="box-none">
        <View style={styles.headerChip}>
          <Text style={styles.eyebrow}>TRACKED WALK</Text>
          <Text style={styles.petName} numberOfLines={1}>{petName}</Text>
        </View>
      </View>

      {/* Where they said they were heading.
          Sits directly under the header and above every other strip, because
          it is the reason this particular walk started. It never nags: once
          you are there it congratulates and then just stays put — there is no
          "continue to" and nothing is scored on reaching it. */}
      {destination && !showRouteProgress && (
        <View style={[styles.destinationChip, { top: insets.top + space.sm + 64 }]}>
          <MaterialIcons
            name={arrived ? 'check-circle' : 'flag'}
            size={14}
            color={color.navy}
          />
          <Reanimated.Text
            key={arrived ? 'arrived' : 'steady'}
            entering={FadeInDown.duration(motion.duration.instant)}
            style={styles.destinationChipText}
            numberOfLines={1}
          >
            {arrived
              ? `You made it to ${destination.name}`
              : routeStatus === 'unavailable'
                  ? `${destination.name} · route unavailable · destination pinned`
              : toDestinationLabel
                ? `${destination.name} · ${toDestinationLabel}${
                    toDestinationEta ? ` · ${toDestinationEta}` : ' away'
                  }`
                : `Heading to ${destination.name}`}
          </Reanimated.Text>
        </View>
      )}

      {showRouteProgress && bottomCardHeight !== null && destination && (
        <RouteProgressCard
          destinationName={destination.name}
          distanceLabel={toDestinationLabel}
          etaLabel={toDestinationEta}
          ready={routeJustReady}
          bottom={bottomCardHeight + space.md}
        />
      )}

      {/* Sniff-break strip — glanceable pause state */}
      {paused && (
        <View style={[styles.pausedStrip, { top: insets.top + space.sm + 64 + destOffset }]}>
          <Text style={styles.pausedStripText}>Sniff break — timer keeps going</Text>
        </View>
      )}

      {/* Milestone chip */}
      {milestoneKm > 0 && (
        <Reanimated.View
          entering={FadeInDown.duration(motion.duration.base)}
          style={[
            styles.milestoneChip,
            { top: insets.top + space.sm + 64 + destOffset + (paused ? 38 : 0) },
          ]}
        >
          <Text style={styles.milestoneChipText}>
            {milestoneKm} km with {petName}
          </Text>
        </Reanimated.View>
      )}

      {/* Cap notice (uncommon) */}
      {capReached && (
        <View
          style={[
            styles.capChip,
            {
              top:
                insets.top + space.sm + 64 + destOffset + (paused ? 38 : 0) +
                (milestoneKm > 0 ? 38 : 0),
            },
          ]}
        >
          <Text style={styles.capChipText}>
            Gentle daily limit reached — heading home is a good idea.
          </Text>
        </View>
      )}

      {/* The mid-walk offer — a long sniff, or a place that already holds a
          moment. Sits above the stats card so it never covers the timer, and
          auto-dismisses: a dog does not wait for a dialog. */}
      {WALK_CAMERA_ENABLED && keepsakes.prompt && (
        <View style={styles.keepsakePromptWrap} pointerEvents="box-none">
          <KeepsakePrompt
            kind={keepsakes.prompt.kind}
            anchorUri={keepsakes.prompt.anchorUri}
            anchorAgeDays={keepsakes.prompt.anchorAgeDays}
            onCapture={keepsakes.openCamera}
            onDismiss={keepsakes.dismissPrompt}
          />
        </View>
      )}

      {/* Bottom stats + Finish card */}
      <View
        // `space.sm`, not `lg`: the minimize button below already carries its
        // own vertical padding, so the larger inset was paying for the same
        // gap twice and leaving a band of white under the last tappable thing.
        style={[styles.bottomCard, { paddingBottom: insets.bottom + space.sm }]}
        onLayout={onBottomCardLayout}
      >
        <View style={styles.statusLine}>
          <BreathingPaw size={14} workingColor={color.navy} />
          <Text style={styles.statusLineText}>
            {acquiring
              ? WALK_STATUS_COPY.acquiring
              : paused
                ? WALK_STATUS_COPY.sniffing
                : WALK_STATUS_COPY.walking}
          </Text>
        </View>

        {/* No "TIME" caption under this. `00:14` has never needed one — the
            format is the label, and the line under a 68pt numeral is the most
            expensive place in the card to say something obvious. */}
        <Text style={styles.timer}>{formatElapsed(elapsed)}</Text>

        {/* The supporting pair, in one grouped card rather than two floating
            columns of value-over-caption.

            Units live in the value now: "0.00 km" is read in one movement where
            "0.00" above "DISTANCE (KM)" is read in two, and the second of them
            was set in shouting caps for a number nobody has trouble
            identifying. The group also matches SpotDetailsSheet, so the walk
            you started from a place is described by the same shape that
            offered it. */}
        <View style={styles.statGroup}>
          <View style={styles.liveStat}>
            <Text style={styles.statValue}>
              {km.toFixed(2)}
              <Text style={styles.statUnit}> km</Text>
            </Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.liveStat}>
            <Text style={styles.statValue}>
              {liveKcal > 0 ? liveKcal : '—'}
              <Text style={styles.statUnit}> kcal</Text>
            </Text>
          </View>
        </View>

        {/* The tap starts the whip: AnimatedPressable compresses + light
            haptic; the 80ms anticipation runs inside the overlay. */}
        <AnimatedPressable
          style={styles.finishBtn}
          disabled={whip !== 'idle'}
          onPress={() => {
            beginWhip('tap');
            endWalk('manual');
          }}
        >
          <MaterialIcons name="flag" size={18} color={color.navy} />
          <Text style={styles.finishBtnText}>Finish walk</Text>
        </AnimatedPressable>
        <TouchableOpacity style={styles.minimizeBtn} onPress={() => router.back()}>
          <Text style={styles.minimizeBtnText}>Keep tracking in the background</Text>
        </TouchableOpacity>
      </View>

      {/* Always reachable, never shouting. The prompt is what makes the camera
          land at the right moment; this is for the times the walker sees
          something first. Quiet by design — yellow belongs to Finish.

          Once a walk holds a moment, the button BECOMES that moment: the last
          photo fills it, with the count on top. A 10pt digit on an empty navy
          circle was technically an indicator and practically invisible, which
          left a walker who had just taken a photo with nothing anywhere on this
          screen to confirm it. The uri is Pawtchi's own container copy, so this
          costs no permission, no network and no resolution pass.

          Positioned on the card's REAL top edge. This was
          `insets.bottom + 260` — a guess at the card's height that was only
          ever right for the layout it was written against, and that drifts
          silently every time a line is added to or removed from the card below.
          `bottomCardHeight` is already measured for the route progress card;
          reusing it means the button cannot come adrift again. The literal
          survives only as the first-frame fallback, before onLayout reports. */}
      {WALK_CAMERA_ENABLED && !acquiring && (
        <TouchableOpacity
          style={[
            styles.captureBtn,
            { bottom: (bottomCardHeight ?? 260 + insets.bottom) + space.md },
          ]}
          onPress={keepsakes.openCamera}
          accessibilityRole="button"
          accessibilityLabel={
            keepsakes.capturedCount > 0
              ? `Capture a moment. ${keepsakes.capturedCount} kept so far.`
              : 'Capture a moment'
          }
        >
          {lastCaptureUri ? (
            <Image
              source={{ uri: lastCaptureUri }}
              style={styles.captureThumb}
              contentFit="cover"
              transition={180}
            />
          ) : (
            <MaterialIcons name="photo-camera" size={20} color={color.cream} />
          )}
          {keepsakes.capturedCount > 0 && (
            <View style={styles.captureCount}>
              <Text style={styles.captureCountText}>{keepsakes.capturedCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      )}

      {WALK_CAMERA_ENABLED && (
        <WalkCamera
          visible={keepsakes.cameraOpen}
          onClose={keepsakes.closeCamera}
          onCaptured={keepsakes.onCaptured}
          context={{
            distanceLabel: km > 0 ? `${km.toFixed(2)} km` : null,
            elapsedLabel: elapsed > 0 ? formatElapsed(elapsed) : null,
            placeLabel: destination?.name ?? null,
          }}
        />
      )}
    </View>
  );

  // The quiet pending state the ribbon reveals while a slow save finishes (and
  // the reduce-motion / recovered fallback). Deliberately NOT a "Saving…"
  // loader event — just a small, calm paw on the success ground; the real
  // stats pop in when the save lands.
  const savingNode = (
    <View style={[styles.summaryScreen, styles.centerFill]}>
      <BreathingPaw size={26} workingColor={color.navy} />
    </View>
  );

  // The new screen. Rendered as the transition's children (and the base once
  // the whip is done). Shows the quiet pending state until the save lands.
  const summaryNode =
    phase === 'summary' && lastResult ? (
      <WalkSummaryView
        key="summary"
        petName={petName}
        choreographed={whip === 'running'}
        revealSignal={revealSignal}
        onDone={handleDone}
        keepsakes={keepsakes.captures}
      />
    ) : (
      savingNode
    );

  // ── Compose ──
  // whip running → the frozen live screen is the base; the transition plays on
  // top and reveals the summary (passed as its children) with the tail whip.
  // whip done → the summary, already revealed. idle → live / saving / summary
  // per phase (reduce-motion, recovered, or a plain direct visit).
  if (whip === 'running') {
    return (
      <View style={styles.screenRoot}>
        {liveNode}
        {/* Inline overlay, never a Modal (app/welcome.tsx documents the Android
            bug). Plays the full ~650ms tail whip and reveals the summary. */}
        <TailWhipSuccessTransition
          visible
          skipAnticipation={whipModeRef.current === 'auto'}
          onReveal={() => setPeaked(true)}
          onComplete={() => setWhip('done')}
        >
          {summaryNode}
        </TailWhipSuccessTransition>
      </View>
    );
  }

  let base: React.ReactNode;
  if (whip === 'done') base = summaryNode;
  else if (phase === 'summary' && lastResult) base = summaryNode;
  else if (phase === 'saving') base = savingNode;
  else base = liveNode;

  return <View style={styles.screenRoot}>{base}</View>;
}

// Phase-5 stagger geometry — footer trails the last stat by half a beat.
const REVEAL_LAST_DELAY = 260;
const REVEAL_TOTAL = REVEAL_LAST_DELAY + motion.tailWhip.reveal;

function WalkSummaryView({
  petName,
  onDone,
  choreographed = false,
  revealSignal = null,
  keepsakes = [],
}: {
  petName: string;
  onDone: () => void;
  /** True when the tail whip is revealing this summary (start hidden). */
  choreographed?: boolean;
  /** Timestamp set once the save is done and the wipe is underway — starts
   *  the entrance stagger. Null on plain visits (everything settled). */
  revealSignal?: number | null;
  /** Moments captured on this walk, straight from the camera. */
  keepsakes?: PendingCapture[];
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const lastResult = useWalkStore(s => s.lastResult);
  const activePet = useActivePetStore(s => s.activePet);
  const lastEarnEvent = useStreakStore(s => s.lastEarnEvent);

  // ── Phase 5 — the reveal stagger ──
  // Shared values, not `entering` presets: under the whip this view mounts
  // beneath the opaque cover, where mount-time animations would fire
  // invisibly. One linear clock; each block reads its own window from it on
  // the UI thread (the Living Paw pure-progress house pattern). Direct
  // visits (choreographed=false) initialise everything settled — identical
  // to the pre-whip summary.
  const reveal = useSharedValue(choreographed ? 0 : 1);
  const nudge = useSharedValue(0);
  const ctaScale = useSharedValue(choreographed ? 0.98 : 1);
  const revealed = !choreographed || revealSignal != null;

  useEffect(() => {
    if (revealSignal == null) return;
    reveal.value = withTiming(1, { duration: REVEAL_TOTAL, easing: Easing.linear });
    // Secondary motion: the whole screen sits 2px along the tail's exit
    // direction and springs home — depth, barely felt.
    nudge.value = motion.tailWhip.uiShift;
    nudge.value = withSpring(0, motion.spring.gentle);
    ctaScale.value = withDelay(REVEAL_LAST_DELAY, withSpring(1, motion.spring.bouncy));
    const id = setTimeout(() => haptic.select(), REVEAL_LAST_DELAY + motion.duration.instant);
    return () => clearTimeout(id);
  }, [revealSignal, reveal, nudge, ctaScale]);

  const S = motion.tailWhip.revealStagger;
  const useBlock = (delay: number, rise: number, scaleFrom = 1) =>
    useAnimatedStyle(() => {
      const p = easeOutQuart(
        Math.min(1, Math.max(0, (reveal.value * REVEAL_TOTAL - delay) / motion.tailWhip.reveal)),
      );
      return {
        opacity: p,
        transform: [{ translateY: rise * (1 - p) }, { scale: scaleFrom + (1 - scaleFrom) * p }],
      };
    });

  const pawStyle = useBlock(0, 0, 0.94);
  const titleStyle = useBlock(S, 8);
  const cardStyle = useBlock(2 * S, 12);
  const stat1Style = useBlock(3 * S, 10);
  const stat2Style = useBlock(4 * S, 10);
  const stat3Style = useBlock(5 * S, 10);
  const coinsStyle = useBlock(6 * S, 10);
  const footerStyle = useAnimatedStyle(() => {
    const p = easeOutQuart(
      Math.min(1, Math.max(0, (reveal.value * REVEAL_TOTAL - REVEAL_LAST_DELAY) / motion.tailWhip.reveal)),
    );
    return {
      opacity: p,
      transform: [{ translateY: 16 * (1 - p) }, { scale: ctaScale.value }],
    };
  });
  const rootStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: nudge.value }, { translateY: -nudge.value }],
  }));

  const result = lastResult!;
  const { summary, verdict, sync, route, labels } = result;

  // The walk's own window. Declared up here because the import handler below
  // closes over both, and a dependency array cannot reference a `const` that
  // has not been evaluated yet.
  const startedAtMs = summary.startedAt;
  const endedAtMs = startedAtMs + summary.durationS * 1000;

  // ── Moments on the map ──
  // The overlay projects coordinates itself, so it needs the card's real pixel
  // size and the camera the map is actually at.
  //
  // We hand the map OUR camera rather than letting it self-frame, because
  // `onCameraMove` only fires when the map MOVES — and this card is a static
  // preview nobody pans, so a camera we merely waited for would stay null
  // forever and the overlay would render nothing. Passing the same camera to
  // the map and to the projector makes the two agree by construction, which is
  // exactly what WalkMap's `camera` prop is documented for. The reported camera
  // still wins once it arrives, so a pan (or an SDK aspect-ratio adjustment)
  // moves the photos with the streets.
  const [reportedCamera, setReportedCamera] = useState<MapCamera | null>(null);
  /**
   * The moments tapped open, and which one was tapped.
   *
   * The list stays in walk order and the index says where to enter — reordering
   * it so the tapped photo came first would make the carousel's neighbours lie
   * about what comes before and after in the walk.
   */
  const [openKeepsakes, setOpenKeepsakes] = useState<KeepsakeMapPin[] | null>(null);
  const [openIndex, setOpenIndex] = useState(0);
  const openMoments = useCallback((list: KeepsakeMapPin[], at = 0) => {
    setOpenKeepsakes(list);
    setOpenIndex(at);
  }, []);
  const [routeCardSize, setRouteCardSize] = useState({ width: 0, height: 0 });
  const onRouteCardLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setRouteCardSize(prev =>
      Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1
        ? prev
        : { width, height },
    );
  }, []);

  /**
   * Photos brought in from the library after the walk. See `onImport` below.
   *
   * Declared here rather than beside its handler because everything downstream
   * — the pins, the map's framing, the trail, the story — reads `moments`, and
   * an imported photo is a moment on this walk like any other.
   */
  const [imported, setImported] = useState<PendingCapture[]>([]);

  /** Everything this walk holds, in the order it happened. */
  const moments = useMemo(
    () => [...keepsakes, ...imported].sort((a, b) => a.capturedAt - b.capturedAt),
    [keepsakes, imported],
  );

  const keepsakePins = useMemo<KeepsakeMapPin[]>(
    () =>
      moments.flatMap(k =>
        k.lat != null && k.lng != null
          ? [{ id: `local-${k.capturedAt}`, lat: k.lat, lng: k.lng, uri: k.uri }]
          : [],
      ),
    [moments],
  );

  /**
   * The framing we ask the map for, and project against until it says otherwise.
   *
   * Fits the route AND the photo coordinates, with the per-edge inset the cards
   * need — `keepsakeFitPadding` owns that geometry so this never has to guess
   * it. Uniform padding was the bug: a card hangs ~63px above its coordinate,
   * so an evenly-padded fit sliced the top card off against the card's edge.
   *
   * `maxZoom` is left at the default rather than capped: a short walk should be
   * allowed to zoom right in so its moments separate, which is the whole point
   * of fitting them rather than the route alone.
   */
  const fittedCamera = useMemo(() => {
    if (keepsakePins.length === 0 || routeCardSize.width <= 0) return null;
    const framed = [...route, ...keepsakePins.map(p => ({ lat: p.lat, lng: p.lng }))];
    return fitCamera(framed, {
      width: routeCardSize.width,
      height: routeCardSize.height,
      padding: keepsakeFitPadding(),
    });
  }, [keepsakePins, route, routeCardSize]);
  const mapCamera = reportedCamera ?? fittedCamera;

  // ── Paw Moment share card ──
  // Only a clean, measured walk becomes a card: the verdict gate keeps
  // drives, stubs, and GPS junk off Instagram wearing the Pawtchi mark. The
  // editor itself lives in MomentShareModal (shared with the Home feed).
  const canShare = verdict.verdict === 'valid' && route.length >= 2;
  const [shareOpen, setShareOpen] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  /**
   * Photos brought in from the library AFTER the walk, and why they live here
   * rather than in the camera.
   *
   * The in-walk camera cannot win a race it is structurally set up to lose: the
   * native camera is a lock-screen swipe, and reaching Pawtchi's is unlock, find
   * app, tap, warm up. So for the spontaneous shots the walker will, correctly,
   * use the other camera — and this is where those get picked up. Putting the
   * button beside the shutter was the mistake it replaced: mid-walk, "add an
   * existing photo" is a question nobody is asking, and it turned a one-purpose
   * surface into a menu.
   *
   * ── Written straight to the outbox ──
   * Not through the hook's pending queue: that queue exists to hold captures
   * until the walk HAS a session id, and by now it has one. Enqueue-then-drain
   * gives the insert, the thumbnail upload and the offline retry in one step,
   * all of it already tested.
   */
  const [importing, setImporting] = useState(false);

  const onImport = useCallback(async () => {
    if (importing || !activePet?.id || !user?.id) return;
    haptic.tap();
    setImporting(true);
    try {
      // The system picker and nothing else — never
      // `requestMediaLibraryPermissionsAsync`, which is asserted against source
      // in lib/privacy/photoLibraryAccess.test.ts. This runs out of process on
      // both platforms and has no permission to ask for.
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.9,
        exif: true,
      });
      if (picked.canceled || !picked.assets?.length) return;

      const asset = picked.assets[0];
      if (!asset?.uri) return;

      // ── Placement honesty ──
      // A picked photo takes its time and its coordinate from its OWN EXIF, and
      // gets null where the EXIF is silent. Borrowing the walk's coordinates
      // would pin a photo of the kitchen to a tree three streets away and
      // quietly poison the place index that lets a location recognise you months
      // later. The rule lib/walk/keepsakeImport.ts documents.
      const capturedAt = exifCapturedAt(asset.exif) ?? Date.now();
      const coordinate = exifCoordinate(asset.exif);
      const hasCoordinate = coordinate != null;
      const withinWalk = isWithinWalkWindow(startedAtMs, endedAtMs, capturedAt);

      const persisted = await persistCapture({
        uri: asset.uri,
        capturedAt,
        width: asset.width,
        height: asset.height,
      });

      const draft: PendingCapture = {
        uri: persisted?.uri ?? asset.uri,
        localPath: persisted?.fileName ?? null,
        width: asset.width,
        height: asset.height,
        capturedAt,
        source: 'import',
        lat: coordinate?.lat ?? null,
        lng: coordinate?.lng ?? null,
        routeIndex: hasCoordinate
          ? snapToRoute(route, { lat: coordinate.lat, lng: coordinate.lng })
          : withinWalk
            ? estimateRouteIndexByTime(route, startedAtMs, endedAtMs, capturedAt)
            : null,
        // "Eleven minutes in" is only true of a photo taken during the walk. One
        // from last summer has no position on this timeline, and
        // elapsedSecondsInto would happily return minus four hundred days.
        elapsedS: withinWalk ? elapsedSecondsInto(startedAtMs, capturedAt) : null,
        placeKey: hasCoordinate ? placeKeyOrNull(coordinate.lat, coordinate.lng) : null,
      };

      setImported((prev) => [...prev, draft]);
      haptic.success();

      await enqueueOutbox([
        {
          id: newOutboxId(capturedAt),
          ownerId: user.id,
          petId: activePet.id,
          walkSessionId: result.walkSessionId,
          capturedAt,
          lat: draft.lat,
          lng: draft.lng,
          routeIndex: draft.routeIndex,
          elapsedS: draft.elapsedS,
          mediaType: 'photo',
          source: 'import',
          localPath: draft.localPath,
          localAssetId: null,
          width: draft.width,
          height: draft.height,
          placeKey: draft.placeKey,
          attempts: 0,
          queuedAt: Date.now(),
        },
      ]);
      void drainOutbox(outboxPorts);
    } catch {
      // A picker that failed costs nothing; the walk is already saved and the
      // row was never written. Nothing to roll back, nothing worth a dialog.
    } finally {
      setImporting(false);
    }
  }, [importing, activePet?.id, user?.id, result.walkSessionId, route, startedAtMs, endedAtMs]);

  const confirmDiscard = useCallback(() => {
    Alert.alert(
      'Discard this walk?',
      `This removes it from ${petName}’s walk history and today’s activity. This can’t be undone.`,
      [
        { text: 'Keep walk', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: async () => {
            if (!activePet?.id || discarding) return;
            setDiscarding(true);
            try {
              await discardWalk({
                walkSessionId: result.walkSessionId,
                petId: activePet.id,
                ownerId: user?.id ?? null,
                walkDate: getLocalYMD(new Date(summary.startedAt)),
                outcome: sync.outcome,
                matchedActivityId: sync.matchedActivityId,
              });
              haptic.success();
              onDone();
            } catch (error) {
              reportError(toAppError(error), 'generic');
              setDiscarding(false);
              Alert.alert(
                'Walk wasn’t discarded',
                'We kept the walk safe because part of the cleanup could not finish. Please try again.',
              );
            }
          },
        },
      ],
    );
  }, [
    activePet?.id,
    user?.id,
    discarding,
    onDone,
    petName,
    result.walkSessionId,
    summary.startedAt,
    sync,
  ]);

  // Walk Story is the reward moment after any real walk — offered for every
  // walk the Home feed keeps (everything except a discarded car ride), so a
  // short doorstep loop or a patchy-GPS amble still gets one. The story
  // degrades gracefully to time/weather/closer beats when there's no route,
  // unlike the route-gated share button.
  const storyAvailable = WALK_STORY_ENABLED && verdict.verdict !== 'likely_vehicle';

  // Goal-gradient under the share button: the nearest still-locked share
  // card. Totals land in the store when this walk's sync runs its award
  // check; until then the line simply doesn't show.
  const pawTotals = usePawPrintStore(s => s.totals);
  const primeWalkStory = useWalkStoryStore(s => s.prime);
  const nextUnlockLine = pawTotals ? nextTemplateChipLine(pawTotals.walkCount) : null;
  const openWalkStory = useCallback(() => {
    if (activePet) {
      const snapshot = createWalkStorySnapshot({
        walkSessionId: result.walkSessionId,
        petId: activePet.id,
        petName,
        petGender: activePet.gender,
        breed: activePet.breed,
        ageYears: activePet.age_years,
        startedAt: summary.startedAt,
        durationS: summary.durationS,
        movingTimeS: summary.movingTimeS,
        distanceM: summary.distanceM,
        avgSpeedKmh: summary.avgMovingSpeedKmh,
        route,
        pausePoints: summary.pausePoints,
        sniffPoints: summary.sniffPoints,
        startLabel: labels.startLabel,
        endLabel: labels.endLabel,
        farthestLabel: labels.farthestLabel,
        totals: pawTotals,
        // Built from the local captures rather than read back from the
        // database. The primed snapshot is what the FIRST viewing renders, and
        // the row + thumbnail may still be uploading — without this the moment
        // would be missing from the story until a later replay, which is the
        // one viewing that matters least.
        //
        // `local_path` is what carries the photograph, and it used to be absent
        // here: the snapshot passed `local_asset_id` alone, on the reasoning
        // that useKeepsakeImage would resolve it from the camera roll. That was
        // true only while every capture was copied there automatically. It is
        // not any more — nothing writes to the photo library — so a story primed
        // without this would open on captions with no pictures under them.
        keepsakes: moments.map((k) => ({
          id: `local-${k.capturedAt}`,
          walk_session_id: result.walkSessionId,
          pet_id: activePet.id,
          captured_at: k.capturedAt,
          lat: k.lat,
          lng: k.lng,
          route_index: k.routeIndex,
          elapsed_s: k.elapsedS,
          media_type: 'photo',
          source: k.source,
          local_path: k.localPath,
          local_asset_id: null,
          width: k.width,
          height: k.height,
          place_key: k.placeKey,
        })),
      });
      if (snapshot) primeWalkStory(snapshot);
    }
    router.push({
      pathname: '/walk-story',
      params: { id: result.walkSessionId, source: 'summary' },
    });
  }, [
    activePet,
    moments,
    labels,
    pawTotals,
    petName,
    primeWalkStory,
    result.walkSessionId,
    route,
    router,
    summary,
  ]);

  // Elapsed minutes for display (matches the timeline row), moving minutes
  // for kcal — a stationary session shows its duration but burns ~nothing.
  const minutes = Math.max(1, Math.round(summary.durationS / 60));
  const activeMinutes = Math.round(summary.movingTimeS / 60);
  const km = summary.distanceM / 1000;

  const isLoop = labels.isLoop;
  const startLabel = labels.startLabel;
  const trailingLabel = isLoop ? labels.farthestLabel : labels.endLabel;

  /**
   * The walk as a sequence of beats — set off, what happened, home again.
   *
   * This screen used to be nine centred bands stacked down a page, each with
   * its own margin and no relationship to the one above it. The worst of them
   * put the photograph on the same baseline as the stat row, so a kept moment
   * read as a fourth statistic.
   *
   * A walk IS a sequence, so it is drawn as one. Every fact now hangs off the
   * beat it belongs to: the route under "set off", each photo where it happened,
   * the numbers under "home again". That also fixes the thin-data case that
   * looked worst — a one-minute walk has almost no numbers to show, but it
   * still has a beginning, a middle and an end.
   */

  /** "8:28 pm" — a wall clock, not a duration. */
  const clockAt = (ms: number) =>
    new Date(ms).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' });

  const eyebrow = [
    // "Tonight" rather than "This night", which nobody says.
    partOfDay(startedAtMs) === 'night' ? 'Tonight' : `This ${partOfDay(startedAtMs)}`,
    startLabel,
  ]
    .filter(Boolean)
    .join(' · ');

  const setOffMeta = [clockAt(startedAtMs), startLabel].filter(Boolean).join(' · ');
  const homeMeta = [clockAt(endedAtMs), trailingLabel].filter(Boolean).join(' · ');

  /**
   * How many steps the DOG took — modelled, not measured.
   *
   * Pawtchi has no pedometer; this comes from the distance and pace we did
   * measure, converted through this dog's own build. It is deliberately the
   * dog's number rather than the walker's: a Chihuahua does three or four times
   * the work of a Great Dane over the same kilometre, and that is the fact worth
   * showing on a dog's walk card.
   *
   * Unlike `kcal` this does not need a logged weight — breed defaults supply the
   * size band — so it survives an incomplete profile.
   */
  const dogSteps = useMemo(
    () =>
      estimateDogSteps({
        // The session machine's cleaned distance, never a raw trace — a GPS
        // jump must not become extra steps.
        distanceM: summary.distanceM,
        species: activePet?.species ?? 'dog',
        breed: activePet?.breed ?? null,
        sex: activePet?.gender ?? null,
        ageYears: activePet?.age_years ?? null,
        weightKg: activePet?.current_weight_kg ?? null,
      }).steps,
    [activePet, summary.distanceM],
  );

  const kcal = useMemo(() => {
    if (!activePet?.current_weight_kg) return 0;
    const profile = deriveDogWalkProfile({
      species: activePet.species,
      breed: activePet.breed ?? null,
      ageYears: activePet.age_years ?? null,
      weightKg: activePet.current_weight_kg,
      medicalConditions: activePet.medical_conditions ?? null,
    });
    const intensity = intensityForPace(summary.avgMovingSpeedKmh, profile);
    return Math.round(
      estimateActivityBurn('walk', intensity, activeMinutes, activePet.current_weight_kg),
    );
  }, [activePet, summary.avgMovingSpeedKmh, activeMinutes]);

  // Only a drive is discarded — every real walk is logged, however short.
  const isWalkLogged = verdict.verdict !== 'likely_vehicle';
  const outcomeCopy = (() => {
    if (!isWalkLogged) {
      return 'Most of this moved faster than a walk, so it wasn’t counted.';
    }
    if (verdict.verdict === 'too_short') {
      return `A short one — still logged on ${petName}’s day.`;
    }
    if (verdict.verdict === 'gps_junk') {
      return `The GPS was patchy, but the walk counts — logged for ${petName}.`;
    }
    switch (sync.outcome) {
      case 'matched':
        return `${petName}’s scheduled walk is done — logged for you.`;
      case 'logged_new':
        return `Logged as a new walk on ${petName}’s day.`;
      case 'skipped_duplicate':
        return 'This walk was already marked done.';
      default:
        return 'Saved — it will finish syncing when you’re back online.';
    }
  })();

  /**
   * The numbers, as a grid rather than a centred row of columns.
   *
   * Labels are sentence case and quieter than their values — deliberately NOT
   * `type.caption`, whose 1.2 letter-spaced caps made "KCAL BURNED" shout over
   * the single digit above it. A caption should name a number, not compete
   * with it.
   *
   * Steps are absent on purpose: they stay a sentence below this grid, because
   * a sentence can say WHOSE steps these are and can carry the "around" hedge
   * that a bare column cannot. See the note by `formatStepsProse` below.
   */
  const statCells: { value: string; unit?: string; label: string }[] = [
    { value: String(minutes), unit: minutes === 1 ? 'min' : 'mins', label: 'Duration' },
    { value: km.toFixed(2), unit: 'km', label: 'Distance' },
    ...(kcal > 0 ? [{ value: String(kcal), unit: 'kcal', label: 'Burned' }] : []),
  ];

  return (
    <Reanimated.View style={[styles.summaryScreen, rootStyle]}>
      {/* ── Header ──
          Left-aligned, so the screen has an edge to read down. Everything used
          to be centred, which left no anchor and turned the outcome sentence
          into a two-line ribbon floating under a title. */}
      <Reanimated.View style={[styles.sumHeader, { paddingTop: insets.top + space.lg }, titleStyle]}>
        <Text style={styles.sumEyebrow} numberOfLines={1}>{eyebrow}</Text>
        <View style={styles.sumTitleRow}>
          <Reanimated.View style={pawStyle}>
            {/* Breathes while hidden under the cover, fires its ONE heartbeat
                the moment the tail reveals it (Living Paw contract). */}
            <BreathingPaw settled={revealed} size={22} />
          </Reanimated.View>
          <Text style={styles.sumTitle} numberOfLines={1}>
            {isWalkLogged ? `Good walk, ${petName}` : 'Walk saved'}
          </Text>
        </View>
        <Text style={styles.sumOutcome}>{outcomeCopy}</Text>
      </Reanimated.View>

      {/* The trail scrolls; the footer does not. A moment is rendered at full
          column width, so a walk with several of them is taller than a phone —
          the old fixed layout could only have fitted them by shrinking them
          back into thumbnails. */}
      <ScrollView
        style={styles.sumScroll}
        contentContainerStyle={styles.sumScrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Beat: set off ── */}
        <Reanimated.View style={[styles.beat, cardStyle]}>
          <View style={styles.beatRail}>
            <View style={[styles.node, styles.nodeStart]} />
            <View style={styles.railLine} />
          </View>
          <View style={styles.beatBody}>
            <Text style={styles.beatTitle}>Set off</Text>
            {setOffMeta ? <Text style={styles.beatMeta}>{setOffMeta}</Text> : null}

            {route.length >= 2 ? (
              /* A plain measured wrapper around BOTH the map and its overlay.
                 The projection only works if the box we fit the camera to is
                 exactly the box the map fills — measuring anything else (the
                 animated card, the screen) leaves the two disagreeing, and a
                 width of 0 silently yields no camera and no pins at all.

                 The corner pills that used to hang off this card are gone: the
                 beat above and the one below now say where the walk started and
                 ended, in the reading order, so the pills were repeating the
                 trail on top of the map. */
              <View style={styles.routeCard}>
                <View style={styles.routeMapWrap} onLayout={onRouteCardLayout}>
                  <WalkMap
                    mode="summary"
                    path={route}
                    style={styles.routeMap as any}
                    camera={fittedCamera}
                    onCameraChange={keepsakePins.length > 0 ? setReportedCamera : undefined}
                  />
                  {/* Photos pinned where they were taken. */}
                  <KeepsakeMapOverlay
                    pins={keepsakePins}
                    camera={mapCamera}
                    width={routeCardSize.width}
                    height={routeCardSize.height}
                    // A tapped cluster enters at its lead, but pages the whole
                    // walk, so the sequence stays continuous either side of it.
                    onPress={(tapped) =>
                      openMoments(keepsakePins, keepsakePins.indexOf(tapped[0]))
                    }
                  />
                </View>
              </View>
            ) : (
              <View style={[styles.routeCard, styles.routeEmpty]}>
                <MaterialIcons name="satellite-alt" size={22} color={color.slateFaint} />
                <Text style={styles.routeEmptyText}>
                  GPS was patchy — the route didn&rsquo;t draw itself this time.
                </Text>
              </View>
            )}
          </View>
        </Reanimated.View>

        {/* ── Beats: the moments ──
            Rendered from the local uris the camera just wrote, NOT from the
            database: these must appear the instant the summary does, and the
            insert plus thumbnail upload are still in flight behind them.
            Waiting on the network here would mean a blank space on exactly the
            screen that is supposed to hand the walk back to its owner.

            Each photo gets the full column at the camera's own 4:3, in the
            place along the walk where it was taken. It was a 68px thumbnail
            sharing a baseline with the stat row, which made a kept moment read
            as a fourth statistic. */}
        {moments.map((k, i) => {
          const elapsed = elapsedPhrase(k.elapsedS);
          // Only a placed photo can be opened: the viewer's route rail sits a
          // moment on the walk by its coordinate, and an import with no EXIF
          // GPS has none to sit on. The beat still shows it — larger here than
          // the viewer would anyway.
          const pinIndex = keepsakePins.findIndex(p => p.id === `local-${k.capturedAt}`);
          const body = (
            <>
              <Text style={styles.beatTitle}>A moment kept</Text>
              <Text style={styles.beatMeta}>
                {[clockAt(k.capturedAt), elapsed].filter(Boolean).join(' · ')}
              </Text>
              <Image
                source={{ uri: k.uri }}
                style={styles.beatPhoto}
                contentFit="cover"
                transition={180}
              />
            </>
          );
          return (
            <Reanimated.View key={`${k.capturedAt}-${i}`} style={[styles.beat, stat1Style]}>
              <View style={styles.beatRail}>
                {/* Electric marks discovery — something the dog found — which
                    is precisely what a moment kept on a walk is. */}
                <View style={[styles.node, styles.nodeMoment]} />
                <View style={styles.railLine} />
              </View>
              {pinIndex >= 0 ? (
                <TouchableOpacity
                  style={styles.beatBody}
                  activeOpacity={0.9}
                  onPress={() => openMoments(keepsakePins, pinIndex)}
                  accessibilityRole="button"
                  accessibilityLabel="Open this moment"
                >
                  {body}
                </TouchableOpacity>
              ) : (
                <View style={styles.beatBody}>{body}</View>
              )}
            </Reanimated.View>
          );
        })}

        {/* ── Beat: home again ──
            The last node draws no line below it, which is what makes the trail
            read as finished rather than cut off. */}
        <Reanimated.View style={[styles.beat, stat2Style]}>
          <View style={styles.beatRail}>
            <View style={[styles.node, styles.nodeEnd]} />
          </View>
          <View style={styles.beatBody}>
            <Text style={styles.beatTitle}>{isLoop ? 'Home again' : 'Finished'}</Text>
            {homeMeta ? <Text style={styles.beatMeta}>{homeMeta}</Text> : null}

            <Reanimated.View style={[styles.statGrid, stat3Style]}>
              {statCells.map((cell, i) => {
                // An odd last cell takes the whole row rather than half of it.
                // Left at 50% it would carry a rule across only half the grid,
                // which reads as a broken table rather than a short one.
                const alone = i > 0 && i === statCells.length - 1 && statCells.length % 2 === 1;
                return (
                  <View
                    key={cell.label}
                    style={[
                      styles.statCell,
                      i % 2 === 1 && styles.statCellRight,
                      i >= 2 && styles.statCellLower,
                      alone && styles.statCellWide,
                    ]}
                  >
                    <Text style={styles.sumStatValue}>
                      {cell.value}
                      {cell.unit ? <Text style={styles.sumStatUnit}> {cell.unit}</Text> : null}
                    </Text>
                    <Text style={styles.sumStatLabel}>{cell.label}</Text>
                  </View>
                );
              })}
            </Reanimated.View>

            {/* The dog's own step count, in a sentence rather than a fourth
                column. A sentence can say WHOSE steps these are, which a bare
                stat cannot — and the phone counted the walker's route, not
                Max's legs, so the attribution is the honest part. "around" is
                the hedge: this is modelled from distance and pace, never
                measured. */}
            {dogSteps > 0 && (
              <Reanimated.View style={stat3Style}>
                <Text style={styles.stepsLine}>
                  {petName} took {formatStepsProse(dogSteps)} steps
                </Text>
              </Reanimated.View>
            )}

            {isWalkLogged && lastEarnEvent && lastEarnEvent.coins > 0 && (
              <Reanimated.View style={[styles.coinChip, coinsStyle]}>
                <MaterialIcons name="paid" size={15} color={color.alert} />
                <Text style={styles.coinChipText}>+{lastEarnEvent.coins} PawCoins</Text>
              </Reanimated.View>
            )}
          </View>
        </Reanimated.View>

        {/* The backstop for everything the in-walk camera could not catch — the
            shot taken on the phone's own camera, which will always be faster to
            reach. Quiet, and after the walk rather than during it: mid-walk this
            is a question nobody is asking.

            Hidden behind its own flag while the flow is reworked — it did not
            work on device. See WALK_PHOTO_IMPORT_ENABLED in constants/features.ts
            for what to check when it comes back. */}
        {WALK_CAMERA_ENABLED && WALK_PHOTO_IMPORT_ENABLED && (
          <TouchableOpacity
            style={styles.addPhotoRow}
            onPress={onImport}
            disabled={importing}
            accessibilityRole="button"
            accessibilityLabel="Add a photo from your library to this walk"
          >
            <View style={styles.addPhotoIcon}>
              <MaterialIcons name="add-photo-alternate" size={18} color={color.slateMuted} />
            </View>
            <Text style={styles.addPhotoText}>
              {importing ? 'Adding…' : 'Add a photo from your library'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Destructive, and therefore last — past everything the walk is for,
            rather than stacked under the primary action where it was competing
            with "Done" for the same tap. */}
        <TouchableOpacity
          style={styles.discardBtn}
          onPress={confirmDiscard}
          disabled={discarding}
          accessibilityRole="button"
          accessibilityLabel="Discard this walk"
        >
          <MaterialIcons name="delete-outline" size={16} color={color.error} />
          <Text style={styles.discardBtnText}>
            {discarding ? 'Discarding walk…' : 'Discard this walk'}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <KeepsakeViewer
        pins={openKeepsakes}
        initialIndex={openIndex}
        context={{
          petId: activePet?.id ?? null,
          petName,
          placeLabel: labels.startLabel ?? labels.farthestLabel ?? labels.endLabel,
          // The summary screen never loaded the walk's weather — it is fetched
          // for the Story, not for this. The caption simply omits the line
          // rather than this screen opening a query to fill it.
          weather: null,
          route,
          // Lets the viewer's route rail sit the photos on the real duration
          // rather than on the stretch between the first and last of them.
          durationS: summary.durationS,
        }}
        onClose={() => setOpenKeepsakes(null)}
      />

      {/* ── Footer ──
          One primary action on its own plane, with the quiet ones as peers in a
          single row beneath it. It was a vertical stack of three — a yellow
          pill, "Done", and a red destructive link — which asked the walker to
          rank three unrelated things at the moment they were trying to put the
          phone away. */}
      <Reanimated.View
        style={[styles.sumFooter, { paddingBottom: insets.bottom + space.lg }, footerStyle]}
        pointerEvents={discarding ? 'none' : 'auto'}
      >
        {storyAvailable ? (
          <>
            <TouchableOpacity
              style={styles.finishBtnLight}
              onPress={openWalkStory}
              activeOpacity={0.9}
            >
              <MaterialIcons name="auto-awesome" size={18} color={color.navy} />
              <Text style={styles.finishBtnLightText}>See your Walk Story</Text>
            </TouchableOpacity>
            <View style={styles.quietRow}>
              {canShare && (
                <TouchableOpacity style={styles.quietBtn} onPress={() => setShareOpen(true)}>
                  <Text style={styles.quietBtnText}>Share this walk</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.quietBtn} onPress={onDone}>
                <Text style={styles.quietBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : canShare ? (
          <>
            <TouchableOpacity style={styles.finishBtnLight} onPress={() => setShareOpen(true)} activeOpacity={0.9}>
              <MaterialIcons name="ios-share" size={18} color={color.navy} />
              <Text style={styles.finishBtnLightText}>Share this walk</Text>
            </TouchableOpacity>
            {nextUnlockLine && <Text style={styles.nextUnlockText}>{nextUnlockLine}</Text>}
            <View style={styles.quietRow}>
              <TouchableOpacity style={styles.quietBtn} onPress={onDone}>
                <Text style={styles.quietBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <TouchableOpacity style={styles.finishBtnLight} onPress={onDone} activeOpacity={0.9}>
            <Text style={styles.finishBtnLightText}>Done</Text>
          </TouchableOpacity>
        )}
      </Reanimated.View>

      <MomentShareModal
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        source="walk_summary"
        petName={petName}
        petGender={activePet?.gender ?? null}
        startedAt={summary.startedAt}
        route={route}
        sniffStops={resolveSniffStops(summary.sniffPoints, summary.pausePoints)}
        labels={labels}
        stats={{
          durationS: summary.durationS,
          movingTimeS: summary.movingTimeS,
          distanceM: summary.distanceM,
        }}
        sessionId={String(summary.startedAt)}
      />
    </Reanimated.View>
  );
}

/** Diameter of a trail node, and therefore the width of the node column. */
const TRAIL_NODE = 14;

/**
 * The route preview's height.
 *
 * Load-bearing, and it must stay a literal on all three of `routeCard`,
 * `routeMapWrap` and `routeMap`. WalkMap's own root is `flex: 1`, which React
 * Native resolves to `flexBasis: 0%`; Yoga then sizes the child from flexBasis
 * and IGNORES `height`, so inside an auto-height parent the map collapses to
 * nothing and the card renders as a bare hairline. A definite height on the
 * chain is what gives it real space to grow into.
 */
const ROUTE_CARD_H = 190;

const styles = StyleSheet.create({
  // ── Screen shell — body + tail whip overlay share one root ──
  screenRoot: {
    flex: 1,
  },

  // ── Live full-bleed layout ──
  liveRoot: {
    flex: 1,
    backgroundColor: color.surfaceSubtle,
  },
  headerOverlay: {
    position: 'absolute',
    left: space.xl,
    right: space.xl,
  },
  headerChip: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.lg,
    gap: 2,
    ...shadow.card,
  },
  eyebrow: {
    ...type.caption,
    color: color.slateFaint,
  },
  petName: {
    ...type.heading,
    color: color.navy,
  },
  pausedStrip: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: color.yellow,
    paddingHorizontal: space.lg,
    paddingVertical: 8,
    borderRadius: radius.pill,
    ...shadow.card,
  },
  pausedStripText: {
    ...type.label,
    color: color.navy,
  },
  destinationChip: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    maxWidth: '86%',
    // White rather than yellow: the milestone chip below is a celebration and
    // owns the brand colour. This one is a heading, and two yellow pills
    // stacked would make neither of them mean anything.
    backgroundColor: color.surface,
    borderRadius: radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 14,
    ...shadow.card,
  },
  destinationChipText: {
    flexShrink: 1,
    fontFamily: font.semibold,
    fontSize: 12,
    color: color.navy,
  },
  milestoneChip: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: color.yellow,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 14,
    ...shadow.card,
  },
  milestoneChipText: {
    fontFamily: font.bold,
    fontSize: 11.5,
    color: color.navy,
    letterSpacing: 0.4,
  },
  capChip: {
    position: 'absolute',
    alignSelf: 'center',
    left: space.xl,
    right: space.xl,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: radius.md,
    paddingVertical: 8,
    paddingHorizontal: space.md,
    ...shadow.card,
  },
  capChipText: {
    ...type.label,
    color: color.navy,
    textAlign: 'center',
  },

  // ── Bottom card ──
  // Rides just above the stats card so the prompt never covers the timer or
  // the Finish button. `box-none` on the wrapper keeps the map pannable
  // through the gap either side of the card.
  keepsakePromptWrap: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    bottom: 252,
  },
  captureBtn: {
    position: 'absolute',
    right: space.lg,
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.navy,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.hairlineOnNavy,
    ...shadow.raised,
  },
  /** Inset by the border width so the photo sits inside the ring, not over it. */
  captureThumb: {
    width: 48 - 2,
    height: 48 - 2,
    borderRadius: radius.pill,
  },
  captureCount: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: radius.pill,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureCountText: {
    fontFamily: font.bold,
    fontSize: 10,
    color: color.navy,
  },
  bottomCard: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingHorizontal: space.xxl,
    paddingTop: space.lg,
    borderTopWidth: 0.5,
    borderColor: color.hairline,
    ...shadow.raised,
  },
  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    marginBottom: space.md,
  },
  statusLineText: {
    ...type.label,
    color: color.slateMuted,
  },
  timer: {
    fontFamily: font.display,
    fontSize: 68,
    lineHeight: 72,
    color: color.navy,
    letterSpacing: 2,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  /**
   * The two supporting numbers, as one object.
   *
   * A filled group rather than two columns adrift in white space: it gives the
   * pair a single edge to sit against, which is what stops them competing with
   * the timer above. Same shape as the groups in SpotDetailsSheet — one card
   * language across both walk surfaces.
   */
  statGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.lg,
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.lg,
    paddingVertical: space.md,
  },
  /**
   * The live card's half of the group. Distinct from `stat` below, which the
   * post-walk summary shares — the two look similar and are not: this one
   * splits a filled group in half, that one is a free-standing column with a
   * caption under it. Folding them into one style is how a tweak to the live
   * readout silently reflows the summary.
   */
  liveStat: {
    flex: 1,
    alignItems: 'center',
  },
  stat: {
    alignItems: 'center',
    gap: space.xs,
    minWidth: 96,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    height: 26,
    backgroundColor: color.hairline,
  },
  statValue: {
    fontFamily: font.display,
    fontSize: 28,
    lineHeight: 30,
    color: color.navy,
    fontVariant: ['tabular-nums'],
  },
  /** Lowercase and quieter: the unit qualifies the number, it is not a heading. */
  statUnit: {
    fontFamily: font.semibold,
    fontSize: 13,
    color: color.slateMuted,
  },
  finishBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: color.yellow,
    borderRadius: radius.pill,
    paddingVertical: 16,
    marginTop: space.lg,
    ...shadow.card,
  },
  finishBtnText: {
    ...type.heading,
    color: color.navy,
  },
  minimizeBtn: {
    alignItems: 'center',
    paddingVertical: space.md,
  },
  minimizeBtnText: {
    ...type.label,
    color: color.slateMuted,
  },

  // ── Permission-denied / saving ──
  deniedScreen: {
    flex: 1,
    backgroundColor: color.surfaceSubtle,
    paddingHorizontal: space.xxl,
  },
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  savingText: {
    ...type.bodyMedium,
    color: color.slateMuted,
    marginTop: space.lg,
  },
  deniedTitle: {
    ...type.title,
    color: color.navy,
    textAlign: 'center',
    marginTop: space.xl,
  },
  deniedBody: {
    ...type.body,
    color: color.slateMuted,
    textAlign: 'center',
    marginTop: space.md,
    marginBottom: space.xxl,
  },
  primaryBtn: {
    backgroundColor: color.yellow,
    borderRadius: radius.pill,
    paddingVertical: 14,
    paddingHorizontal: space.xxxl,
  },
  primaryBtnText: {
    ...type.heading,
    color: color.navy,
  },

  // ── Location disclosure ──
  // Left-aligned and tighter than deniedBody: this is three paragraphs the user
  // is meant to actually read, not a one-line status message.
  disclosureBody: {
    ...type.body,
    color: color.slateMuted,
    textAlign: 'left',
    marginTop: space.md,
    marginBottom: space.xxl,
  },
  secondaryBtn: {
    marginTop: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.xxl,
  },
  secondaryBtnText: {
    ...type.body,
    color: color.slateMuted,
    textDecorationLine: 'underline',
  },

  // ── Summary ──
  //
  // One rhythm for the whole screen: a fixed header, a scrolling trail of
  // beats, a pinned footer. The horizontal inset lives on the header, the
  // scroll content and the footer rather than on the root, so the footer's
  // surface can span the full width and read as its own plane.
  summaryScreen: {
    flex: 1,
    backgroundColor: color.surfaceSubtle,
  },
  sumHeader: {
    paddingHorizontal: space.xxl,
    paddingBottom: space.lg,
  },
  /** "Tonight · Arpora" — when and where, before the headline says how it went. */
  sumEyebrow: {
    ...type.caption,
    color: color.slateFaint,
    textTransform: 'uppercase',
  },
  sumTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.sm,
  },
  sumTitle: {
    ...type.display,
    color: color.navy,
    flexShrink: 1,
  },
  sumOutcome: {
    ...type.body,
    color: color.slateMuted,
    marginTop: space.xs,
  },
  sumScroll: { flex: 1 },
  sumScrollContent: {
    paddingHorizontal: space.xxl,
    paddingBottom: space.xl,
  },

  // ── The trail ──
  beat: {
    flexDirection: 'row',
    gap: space.md,
  },
  /**
   * The node column, and the line between nodes.
   *
   * The line is drawn per beat rather than as one absolute spine, so it always
   * ends exactly at the last node — a spine would have to guess where the final
   * beat's content stops, and would trail past it every time the content
   * changed. The negative bottom margin carries it through the gap to the next
   * node.
   */
  beatRail: {
    width: TRAIL_NODE,
    alignItems: 'center',
  },
  railLine: {
    flex: 1,
    width: 2,
    backgroundColor: color.hairline,
    marginTop: space.xs,
    marginBottom: -space.xl,
  },
  beatBody: {
    flex: 1,
    paddingBottom: space.xl,
  },
  node: {
    width: TRAIL_NODE,
    height: TRAIL_NODE,
    borderRadius: radius.pill,
    marginTop: 3,
  },
  /** Open, then discoveries, then closed. Yellow is spent on the CTA, not here. */
  nodeStart: {
    borderWidth: 2.5,
    borderColor: color.navy,
    backgroundColor: color.surfaceSubtle,
  },
  nodeMoment: { backgroundColor: color.electric },
  nodeEnd: { backgroundColor: color.navy },

  beatTitle: {
    ...type.heading,
    color: color.navy,
  },
  beatMeta: {
    ...type.label,
    fontFamily: font.medium,
    color: color.slateFaint,
    marginTop: 2,
  },
  /**
   * Portrait 3:4 — the shape the walk camera actually saves, so a keepsake is
   * shown whole rather than cropped again on the way in.
   *
   * Note it is NOT what the walker framed: the camera preview is full-bleed and
   * expo-camera's hardcoded `.resizeAspectFill` shows the centre ~61% of the
   * photo's width. So this frame carries a little more scene either side than
   * was on screen at the shutter. That gap is documented and deliberate — see
   * the header of components/walk/WalkCamera.tsx.
   */
  beatPhoto: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: radius.lg,
    backgroundColor: color.surface,
    marginTop: space.md,
  },
  /**
   * The explicit height is load-bearing — without it this card renders as a
   * bare 1px hairline and the route vanishes.
   *
   * WalkMap's own root is `flex: 1`, which React Native expands to
   * `flexBasis: 0%`. Yoga resolves a child's main-axis size from flexBasis when
   * one is set, IGNORING `height`, so inside an auto-height parent the map
   * collapses to nothing and takes its 210px with it. Home never hit this
   * because HomeMapLayer is an absoluteFill — a definite box for flex to fill.
   *
   * Giving the card a definite height restores that: the map has real space to
   * grow into. Keep it in sync with `routeMap` / `routeEmpty` below.
   */
  routeCard: {
    height: ROUTE_CARD_H,
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    borderWidth: 0.5,
    borderColor: color.hairline,
    overflow: 'hidden',
    marginTop: space.md,
  },
  routeMapWrap: {
    width: '100%',
    height: ROUTE_CARD_H,
  },
  routeMap: {
    width: '100%',
    height: ROUTE_CARD_H,
  },
  routeEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.xl,
  },
  routeEmptyText: {
    ...type.label,
    color: color.slateMuted,
    textAlign: 'center',
  },

  // ── The numbers ──
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.hairline,
  },
  statCell: {
    width: '50%',
    paddingVertical: space.md,
  },
  statCellRight: {
    paddingLeft: space.lg,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: color.hairline,
  },
  statCellLower: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.hairline,
  },
  statCellWide: { width: '100%' },
  /**
   * Aligned to the trail's content column, so it reads as one more thing the
   * walk can hold rather than as chrome bolted under it.
   */
  addPhotoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 44,
    marginLeft: TRAIL_NODE + space.md,
  },
  addPhotoIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.hairline,
    backgroundColor: color.surface,
  },
  addPhotoText: {
    ...type.label,
    color: color.slateMuted,
  },
  /**
   * Distinct from the live card's `statValue` — same reason that one is
   * distinct from `stat`. These are numbers read once at the end of a walk, in
   * a grid; that one is a live readout being glanced at mid-walk.
   */
  sumStatValue: {
    fontFamily: font.display,
    fontSize: 26,
    lineHeight: 28,
    color: color.navy,
    fontVariant: ['tabular-nums'],
  },
  /** Lowercase and quieter: the unit qualifies the number, it is not a heading. */
  sumStatUnit: {
    fontFamily: font.semibold,
    fontSize: 12,
    color: color.slateMuted,
  },
  /**
   * Sentence case, and deliberately NOT `type.caption`.
   *
   * The caption token is 1.2-letter-spaced caps, which turned "KCAL BURNED"
   * into the loudest thing in a cell whose whole job was to present the number
   * above it. A label names a value; it does not compete with one.
   */
  sumStatLabel: {
    fontFamily: font.medium,
    fontSize: 11,
    lineHeight: 15,
    color: color.slateFaint,
    marginTop: 1,
  },
  stepsLine: {
    ...type.body,
    color: color.slateMuted,
    marginTop: space.md,
  },
  coinChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 2,
    marginTop: space.md,
    paddingVertical: space.xs + 2,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: color.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.hairline,
  },
  coinChipText: {
    ...type.label,
    color: color.navy,
  },
  /**
   * Its own plane, so the primary action never floats over the trail's last
   * beat and the screen has a floor.
   */
  sumFooter: {
    paddingHorizontal: space.xxl,
    paddingTop: space.md,
    backgroundColor: color.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.hairline,
  },
  quietRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xxxl,
  },
  finishBtnLight: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: color.yellow,
    borderRadius: radius.pill,
    paddingVertical: 16,
    ...shadow.card,
  },
  finishBtnLightText: {
    ...type.heading,
    color: color.navy,
  },
  quietBtn: {
    alignItems: 'center',
    paddingVertical: space.md,
  },
  quietBtnText: {
    ...type.label,
    color: color.slateMuted,
  },
  /**
   * Left-aligned with the trail it follows, and separated by a rule — it is
   * the end of the page, not a peer of the footer's actions.
   */
  discardBtn: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 2,
    marginTop: space.sm,
    paddingLeft: TRAIL_NODE + space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.hairline,
    paddingTop: space.lg,
  },
  discardBtnText: {
    ...type.label,
    color: color.error,
  },
  nextUnlockText: {
    fontFamily: font.medium,
    fontSize: 12,
    color: color.slateMuted,
    textAlign: 'center',
    marginTop: space.sm,
  },
});
