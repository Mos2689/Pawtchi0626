import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { describeError } from '../../../../lib/appError';
import { useAutoRetry } from '../../../../hooks/useAutoRetry';
import {
  Alert, AppState, Pressable, StyleSheet, Text, View,
  type AppStateStatus, type LayoutChangeEvent, type StyleProp, type TextStyle,
} from 'react-native';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';

import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  LinearTransition,
  SlideInRight,
  SlideOutRight,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import WalkMap from '../../../../components/walk/WalkMap';
import { DogAvatar, DogStack, partyColors } from '../../../../components/community/CommunityUI';
import { haversineMeters } from '../../../../lib/walk/geo';
import { color, font, makeShadow, radius, space, type } from '../../../../constants/design';
import { TOGETHER_READ_TIMEOUT_MS, cacheKey, invalidate, readSnapshot } from '../../../../lib/communityCache';
import { isPerfFlagOn } from '../../../../lib/perfFlags';
import { withTimeout } from '../../../../lib/withTimeout';
import {
  closeOuting,
  listLiveParties,
  loadOuting,
  type CommunityPack,
  type CommunityWalk,
  type LiveParty,
  isTrailHost,
  type OutingSnapshot,
  type WalkAttendance,
} from '../../../../lib/communityWalks';
import { WalkCamera } from '../../../../components/walk/WalkCamera';
import { KeepsakeMapOverlay, type KeepsakeMapPin } from '../../../../components/walk/KeepsakeMapOverlay';
import {
  liveMomentCount,
  momentPinsFrom,
  publishedPinsFrom,
  type PublishedMoment,
} from '../../../../lib/community/liveMoments';
import { spreadMarkers } from '../../../../lib/community/spreadMarkers';
import { LIVE_RECONCILE_MS, applyLivePartyChange, walkerColourOrder } from '../../../../lib/community/liveRoster';
import { communityMediaUrls } from '../../../../lib/communityMedia';
import { WALK_CAMERA_ENABLED } from '../../../../constants/features';
import { useRecorderHandle } from '../../../../lib/walk/recorderHandle';
import { fitCamera, projectPoint, type MapCamera } from '../../../../lib/walk/mapCamera';
import { supabase } from '../../../../lib/supabase';
import { LiveReceiver } from '../../../../lib/community/liveReceiver';
import { acquireLiveLink } from '../../../../lib/community/liveLink';
import { liveRealtimeClient } from '../../../../lib/community/liveLinkClient';
import { reconcileClockNow, rpcWithClock } from '../../../../lib/community/liveClock';
import { useWalkStore } from '../../../../store/useWalkStore';
import { useAuth } from '../../../../providers/AuthProvider';

const LIVE_FOR_MS = 2 * 60_000;

/**
 * How long realtime events are gathered before the screen reloads.
 *
 * Long enough that a pack setting off together — everyone's attendance moving
 * to `walking` within a second or two — costs one reload instead of one each.
 * Short enough that a photo somebody just shared is on the map before they have
 * finished putting their phone away.
 */
const REALTIME_COALESCE_MS = 500;

/**
 * A ceiling on other people's photos.
 *
 * The map can meaningfully show a few dozen pins; past that they overlap into a
 * smear, and each one costs a signed URL and a thumbnail. Newest first, because
 * a pin that appeared thirty seconds ago is the one somebody is looking for.
 * The full set is always in the shared memory afterwards.
 */
const LIVE_MOMENT_LIMIT = 60;

/**
 * How far apart two walkers' markers must sit on screen, in px.
 *
 * Sized for the label, not the avatar: the 50 px faces clear each other well
 * before their name chips do, and two chips overlapping read as one garbled
 * name. 84 px clears a typical "Name · 1m" chip either side.
 */
const MARKER_SEPARATION = 84;

/** How tall the foldable block is when open. Fixed content, so a fixed number. */
const FOLD_HEIGHT = 100;
/** Past this much of a drag, let go and the sheet changes its mind. */
const FOLD_THRESHOLD = 30;
/**
 * Timing, not a spring, and the difference is visible here.
 *
 * A spring overshoots. Overshoot on a clipped height means the panel springs
 * PAST its open size and back — the content jumps, gets cropped for a frame,
 * and settles. On a translate that reads as bounce; on a height it reads as a
 * stutter. A short cubic ease-out has nothing to correct.
 */
const FOLD_MS = 220;
const FOLD_EASING = Easing.out(Easing.cubic);

/** The header's width change, when the Live chip unfurls. */
const HEADER_LAYOUT = LinearTransition.duration(260).easing(Easing.out(Easing.cubic));

/** The resting chip's width, and the card's padding. The row is built from both. */
const CHIP_WIDTH = 74;
const HEADER_PAD = 5;
/** The back button at the head of the pill. */
const BACK_SIZE = 34;


/**
 * How far away the nearest other walker is, in words.
 *
 * Deliberately "away" rather than the handoff's "ahead". Ahead and behind are
 * claims about direction, and direction needs a heading this screen does not
 * have — a walker's bearing is not in a position row, and guessing it from two
 * consecutive fixes is wrong the moment somebody stops or turns. Distance is
 * measured, so distance is what it says.
 */
function proximityCopy(meters: number | null, name: string | null, walking: number): string {
  if (meters === null || !name) {
    return walking > 1 ? `${walking} walking together` : 'Walking on your own so far';
  }
  if (meters < 25) return `${name} is right here`;
  if (meters < 1000) return `${name} is ${Math.round(meters / 5) * 5} m away`;
  return `${name} is ${(meters / 1000).toFixed(1)} km away`;
}

/**
 * A position as this screen holds it. Live Walk v2 adds `age_known`: when the
 * GPS age cannot honestly be said (this phone has no server-clock calibration
 * yet), the marker shows the name alone, never "now".
 */
type ShownParty = LiveParty & { contact_at?: string | null; age_known?: boolean };

function ageLabel(party: ShownParty, now: number): string | null {
  return party.age_known === false ? null : freshness(party.recorded_at, now).label;
}

function freshness(iso: string, now: number): { label: string; stale: boolean } {
  const age = Math.max(0, now - Date.parse(iso));
  if (age < 30_000) return { label: 'now', stale: false };
  const minutes = Math.max(1, Math.round(age / 60_000));
  return { label: `${minutes}m ago`, stale: age > LIVE_FOR_MS };
}

/**
 * The one thing on this screen that has to move every second.
 *
 * Its own component, with its own interval, so the 1 Hz re-render is confined
 * to this Text and cannot reach the map. The parent used to hold that timer
 * and re-rendered everything it owns to advance these characters.
 *
 * `startedAt` is a string rather than a computed elapsed value on purpose:
 * passing the number down would put the tick back in the parent, which is the
 * whole thing being avoided.
 */
function ElapsedClock({
  startedAt,
  style,
}: { startedAt: string | null; style: StyleProp<TextStyle> }) {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <Text style={style}>{elapsedSince(startedAt, tick)}</Text>;
}

function elapsedSince(value: string | null, now: number): string {
  if (!value) return '00:00';
  const seconds = Math.max(0, Math.floor((now - Date.parse(value)) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function firstName(value: string | null | undefined): string {
  return value?.trim().split(/\s+/)[0] || 'A pack member';
}

export default function CommunityLiveScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const { user } = useAuth();
  const { walkId } = useLocalSearchParams<{ walkId: string }>();
  const walkPhase = useWalkStore(state => state.phase);
  const personalSession = useWalkStore(state => state.session);
  const endWalk = useWalkStore(state => state.endWalk);
  // Read before the first paint. This screen is arrived at mid-walk, from the
  // recorder, and the pack's name sitting blank over the map for a round trip
  // is the most visible moment in the whole feature to look unfinished.
  const cached = useMemo(
    () => (walkId ? readSnapshot<OutingSnapshot>(cacheKey.outing(walkId)) : null),
    [walkId],
  );
  const [walk, setWalk] = useState<CommunityWalk | null>(cached?.walk ?? null);
  const [pack, setPack] = useState<CommunityPack | null>(cached?.pack ?? null);
  const [attendance, setAttendance] = useState<WalkAttendance[]>(cached?.attendance ?? []);
  const [parties, setParties] = useState<ShownParty[]>([]);
  /**
   * Live Walk v2 (lib/community/liveReceiver.ts), decided once per visit. On,
   * every position source goes through the receiver, which also decides who is
   * still live; off, this screen reads positions exactly as before.
   */
  const liveV2 = useMemo(() => isPerfFlagOn('liveWalkV2'), []);
  const receiverRef = useRef<LiveReceiver | null>(null);
  /**
   * Photos the REST of the pack has shared on this walk, already published.
   *
   * Only theirs — this phone's own are read from the recorder's drafts, which
   * exist from the instant the shutter fires rather than after an upload.
   */
  const [othersMoments, setOthersMoments] = useState<PublishedMoment[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });
  const [reportedCamera, setReportedCamera] = useState<MapCamera | null>(null);
  const [finishing, setFinishing] = useState(false);
  /** An action that did not go through (closing the walk). */
  const [error, setError] = useState<string | null>(null);
  /**
   * The latest refresh failed and is being retried. The map, the dots and the
   * finish button all stay; this is said quietly, never in the error tone.
   */
  const [loadIssue, setLoadIssue] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  /**
   * The recorder's capture pipeline, published by /walk while it is tracking
   * this outing. Null means nothing on this phone is recording.
   */
  const recorder = useRecorderHandle();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(true);
  /**
   * Starts closed. The chip is the resting state of this screen — a walk's own
   * map should be mostly map, and the detail is one tap away when wanted.
   */
  const [headerOpen, setHeaderOpen] = useState(false);
  /** How much of the foldable block is showing, in px. */
  const fold = useSharedValue(FOLD_HEIGHT);
  const foldAtGrab = useSharedValue(FOLD_HEIGHT);

  /** One row of the others' shared-media read, as the query selects it. */
  type OthersRow = {
    id: string;
    display_path: string | null;
    capture_lat: number | null;
    capture_lng: number | null;
  };

  /**
   * Turn those rows into pins, minting signed URLs for the ones with an image.
   *
   * The URLs are fetched in one batch and the rows are set regardless of
   * whether that succeeds: a pin with no thumbnail still says a moment
   * happened there, and a private bucket that is slow to sign should not make
   * other people's photos vanish from the map.
   */
  const applyOthersMoments = useCallback(async (rows: OthersRow[]) => {
    const paths = rows.flatMap(row => (row.display_path ? [row.display_path] : []));
    let urls: Record<string, string> = {};
    if (paths.length) {
      try {
        urls = await communityMediaUrls(paths);
      } catch {
        // Pins without pictures, rather than no pins.
      }
    }
    setOthersMoments(rows.map(row => ({
      id: row.id,
      lat: row.capture_lat,
      lng: row.capture_lng,
      uri: row.display_path ? urls[row.display_path] ?? null : null,
    })));
  }, []);

  const load = useCallback(async (): Promise<boolean> => {
    if (!walkId) return true;
    try {
      // Other people's photos — the rows, not just a count, because they are
      // pinned on the map now that a photo reaches the pack as it is taken.
      //
      // `neq(contributor_id)` is load-bearing: this phone's own photos are in
      // this table WHILE its drafts are still in the recorder, so counting
      // both would count each of them twice and the number would climb as the
      // uploads landed. Mine come from the drafts, which are instant anyway.
      if (liveV2) {
        void receiverRef.current?.refresh();
        void receiverRef.current?.refreshTransport();
      }
      const [outing, live, moments] = await Promise.all([
        loadOuting(walkId),
        liveV2 ? Promise.resolve(null) : listLiveParties(walkId),
        supabase
          .from('community_shared_media')
          .select('id, display_path, capture_lat, capture_lng')
          .eq('walk_id', walkId)
          .is('removed_at', null)
          .neq('contributor_id', user?.id ?? '')
          // Newest first so the cap keeps the most recent pins, then reversed
          // below so the map draws them in the order they happened.
          .order('captured_at', { ascending: false })
          .limit(LIVE_MOMENT_LIMIT),
      ]);
      if (moments.error) throw new Error(moments.error.message);
      setWalk(outing.walk);
      setPack(outing.pack);
      setAttendance(outing.attendance);
      if (live) setParties(live);
      await applyOthersMoments(((moments.data ?? []) as OthersRow[]).slice().reverse());
      if (live) setSelectedId(current => current ?? live.find(item => item.user_id === user?.id)?.user_id ?? live[0]?.user_id ?? null);
      setLoadIssue(null);
      return true;
    } catch (cause) {
      setLoadIssue(describeError(cause, 'community_load'));
      return false;
    }
    // `applyOthersMoments` is a `useCallback(…, [])`, so naming it here costs
    // nothing and keeps this list honest.
  }, [applyOthersMoments, liveV2, user?.id, walkId]);

  /**
   * Just the moving dots. Deliberately not `load()`.
   *
   * A position event is the most frequent thing that happens on this screen —
   * every walker's phone publishes one every few seconds — and it says nothing
   * about who was invited, what they answered, or what their dogs are called.
   * Refetching all of that on each ping meant a four-person walk re-ran the
   * entire roster query, profiles and pets included, roughly once a second: the
   * map stuttered because it was rebuilding the guest list to move a dot.
   */
  /**
   * One position read at a time, plus at most one trailing read.
   *
   * Every walker's ping arrives as its own event, and each used to start its
   * own read with nothing stopping them overlapping. On a slow connection two
   * could be in flight at once and land out of order, briefly putting a dot
   * back where it was. Now a ping that arrives mid-read only marks the read as
   * stale; when it finishes, exactly one more read runs and picks up everything
   * that changed meanwhile. Reads never overlap, so they cannot land out of
   * order, and a burst of pings costs two reads rather than one each.
   */
  /**
   * perf-live-deltas, read once per visit: apply each position event directly
   * instead of re-reading everybody's position on every ping.
   */
  const lighter = useMemo(() => isPerfFlagOn('liveDeltas'), []);
  const partiesInFlight = useRef(false);
  const partiesStale = useRef(false);
  const refreshParties = useCallback(async () => {
    if (!walkId) return;
    if (liveV2) {
      await receiverRef.current?.refresh();
      return;
    }
    if (partiesInFlight.current) {
      partiesStale.current = true;
      return;
    }
    partiesInFlight.current = true;
    try {
      do {
        partiesStale.current = false;
        try {
          // Bounded: a read that never answers used to hold `partiesInFlight`
          // for good, and every dot froze for the rest of the walk.
          const live = await withTimeout(listLiveParties(walkId), TOGETHER_READ_TIMEOUT_MS, 'listLiveParties');
          setParties(live);
          setSelectedId(current => current ?? live.find(item => item.user_id === user?.id)?.user_id ?? live[0]?.user_id ?? null);
        } catch {
          // The existing positions stay on the map and age out on their own.
        }
      } while (partiesStale.current);
    } finally {
      partiesInFlight.current = false;
    }
  }, [liveV2, user?.id, walkId]);

  /** `load`, retried on its own after a failure (hooks/useAutoRetry.ts). */
  const run = useAutoRetry(load);

  useFocusEffect(useCallback(() => { void run(); }, [run]));

  /**
   * The subscriptions' door into `load`, with a window on it.
   *
   * ── The multiplication this stops ─────────────────────────────────────────
   *
   * Three of the four subscriptions below used to call `load()` the moment an
   * event arrived. Attendance rows move through join → checked_in → walking →
   * finished, so a six-person walk produces roughly two dozen of those plus one
   * per shared photo — and every event is broadcast to every phone watching.
   * Six people generating fifty events is three hundred full reloads across the
   * pack, and they arrive in bursts, because a pack sets off together.
   *
   * `load` is three queries and, before the URL cache, a re-sign of every
   * photo on the map. It is not something to run on each row that changes.
   *
   * ── Why a leading schedule rather than a true debounce ────────────────────
   *
   * A debounce that resets its timer on every event can starve: while the pack
   * is setting off, events land continuously and the reload keeps being pushed
   * into the future. This schedules on the FIRST event and absorbs the rest, so
   * a burst always resolves within the window and never later than it.
   *
   * `refreshParties` deliberately does NOT go through here. It is one small
   * query, it is what moves the dots, and delaying it would be visible.
   */
  const loadRef = useRef(load);
  loadRef.current = load;
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleReload = useCallback(() => {
    if (reloadTimer.current) return;
    reloadTimer.current = setTimeout(() => {
      reloadTimer.current = null;
      // Through the ref, so a reload scheduled just before the pet or walk
      // changed does not fire the closure that belonged to the old one.
      void loadRef.current();
    }, REALTIME_COALESCE_MS);
  }, []);
  useEffect(() => () => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
  }, []);

  /**
   * Catch up on anything missed while the app was in the background.
   *
   * ── The gap this closes ──────────────────────────────────────────────────
   *
   * This screen learns what changed on the walk — photos, the roster, the
   * walk's own state — from realtime events. But Supabase Realtime does not
   * replay events that arrive while the socket is down, and a pocketed phone is
   * exactly when it goes down. Nor does `useFocusEffect` help: coming back to
   * the app does not change navigation focus, because this screen never lost it.
   *
   * So a phone that had been in a pocket came back to a stale screen: photos
   * shared in the meantime missing, the roster out of date. (Following the
   * host's close has its own foreground check, in TrailRecording.)
   *
   * On return to the foreground this goes through the same door as a realtime
   * event: `scheduleReload`, and therefore the same debounce. If the socket
   * reconnects and replays nothing, this is the only thing that notices; if
   * events do arrive at the same moment, the window collapses them into one load.
   *
   * Fires on any return to `active` from `background` or `inactive`. That
   * includes brief interruptions — pulling down the notification shade on iOS
   * passes through `inactive` — which cost one debounced reload each. Cheap, and
   * not worth distinguishing: a brief `inactive` can still drop the socket. The
   * `previous` check only stops repeated `active` events from reloading again.
   * `scheduleReload` is stable, so this subscribes exactly once per mount.
   */
  useEffect(() => {
    let previous: AppStateStatus = AppState.currentState;
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active' && previous !== 'active') scheduleReload();
      previous = next;
    });
    return () => subscription.remove();
  }, [scheduleReload]);

  // Following the host's close — finishing this phone's leg and opening the
  // memory — lives in TrailRecording now, so it works from any screen, not
  // only while this one is open. See components/walk/TrailRecording.tsx.

  /**
   * The coarse clock. Fifteen seconds, not one.
   *
   * It used to tick every second, and every tick re-rendered this entire
   * screen — the map, the roster, the stats shelf, the sheet — to advance one
   * line of text. `staleClock` below already bucketed the expensive
   * consequence (a new `parties` identity rebuilt every native polyline), but
   * the render itself still happened sixty times a minute while somebody was
   * trying to look at a map.
   *
   * Everything reading `now` at this cadence is a judgement in tens of
   * seconds: who has gone quiet (two minutes), and a freshness label whose
   * finest grain is "now" for anything under thirty seconds. Fifteen seconds
   * resolves all of it.
   *
   * The one thing that genuinely needs a second is the elapsed timer, and it
   * now owns its own interval — see ElapsedClock.
   */
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!walkId) return;
    const channel = supabase
      .channel(`community-walk-${walkId}`)
      // Positions move; rosters do not. Only the other two tables change
      // anything this screen would have to re-derive.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'community_live_locations', filter: `walk_id=eq.${walkId}` }, payload => {
        // Live Walk v2: the row goes to the receiver, which orders it by
        // session and sequence and dates it by when the server heard it.
        if (liveV2) {
          receiverRef.current?.onRow(payload.new);
          return;
        }
        // perf-live-deltas: the event carries the row, so apply it. The full
        // read stays for (re)subscribe, foreground and once a minute below.
        if (lighter) {
          setParties(current => applyLivePartyChange(current, payload));
          return;
        }
        void refreshParties();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'community_walk_attendance', filter: `walk_id=eq.${walkId}` }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'community_shared_media', filter: `walk_id=eq.${walkId}` }, scheduleReload)
      // The walk itself. Added when the host became the only person who can
      // end it: without this a member's phone never learned the walk was over
      // and kept recording into a trail that had closed.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'community_walks', filter: `id=eq.${walkId}` }, payload => {
        // The emergency switch reaches a running walk here first.
        const transport = (payload.new as { live_transport?: unknown } | null)?.live_transport;
        if (liveV2 && (transport === 'db' || transport === 'broadcast')) receiverRef.current?.setTransport(transport);
        scheduleReload();
      })
      .subscribe(status => {
        // Every (re)join can follow a gap in which events were missed, so the
        // event-driven map catches up with one full read.
        if ((lighter || liveV2) && status === 'SUBSCRIBED') void refreshParties();
      });
    return () => { void supabase.removeChannel(channel); };
    // `scheduleReload` is stable where `load` was not, so the channel is no
    // longer torn down and re-subscribed every time `load`'s identity changes.
  }, [lighter, liveV2, refreshParties, scheduleReload, walkId]);

  /**
   * perf-live-deltas: a once-a-minute full read, so anything the event stream
   * dropped is corrected within a minute rather than never.
   */
  useEffect(() => {
    if (!lighter || liveV2 || !walkId) return;
    const timer = setInterval(() => { void refreshParties(); }, LIVE_RECONCILE_MS);
    return () => clearInterval(timer);
  }, [lighter, liveV2, refreshParties, walkId]);

  /**
   * Live Walk v2: the receiver for this visit. It runs its own reads (once a
   * minute; every 15 s while a Broadcast walk's room is down) and, on a
   * Broadcast walk, the private room. The host's end hint reloads at once.
   */
  const viewerId = user?.id ?? null;
  useEffect(() => {
    if (!liveV2 || !walkId || !viewerId) return;
    const receiver = new LiveReceiver(
      {
        readPositions: () => rpcWithClock('live_walk_positions', { p_walk_id: walkId }),
        readTransport: async () => {
          const { data, error } = await supabase
            .from('community_walks')
            .select('live_transport')
            .eq('id', walkId)
            .maybeSingle();
          const value = error ? null : (data as { live_transport?: unknown } | null)?.live_transport;
          return value === 'db' || value === 'broadcast' ? value : null;
        },
        acquireLink: consumer => acquireLiveLink(liveRealtimeClient, viewerId, walkId, consumer, 'viewer'),
        clock: reconcileClockNow,
        mono: () => globalThis.performance?.now?.() ?? Date.now(),
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
        onParties: next => {
          if (__DEV__) {
            // Dev builds only: what the map decided, in the Metro terminal.
            const clock = reconcileClockNow();
            console.log('[live-v2] map', {
              clockOffsetMs: clock.offsetMs === null ? 'NOT CALIBRATED' : Math.round(clock.offsetMs),
              walkers: next.map(p => `${p.user_id.slice(0, 8)} age_known=${p.age_known} fix=${p.recorded_at}`),
            });
          }
          setParties(next);
          setSelectedId(current => current ?? next.find(item => item.user_id === viewerId)?.user_id ?? next[0]?.user_id ?? null);
        },
        onEndHint: scheduleReload,
      },
      walkId,
      viewerId,
    );
    receiverRef.current = receiver;
    receiver.start();
    return () => {
      receiver.stop();
      if (receiverRef.current === receiver) receiverRef.current = null;
    };
  }, [liveV2, scheduleReload, viewerId, walkId]);

  // Attendance decides who may be on the map at all. After the receiver
  // effect, and keyed on the same ids, so a new receiver is told at once.
  const walkState = walk?.state ?? null;
  useEffect(() => {
    if (!liveV2 || !walkState) return;
    const sharing = attendance
      .filter(person => person.status === 'walking' && person.share_location)
      .map(person => person.user_id);
    receiverRef.current?.setAttendance(sharing, walkState === 'active');
  }, [attendance, liveV2, viewerId, walkId, walkState]);

  /**
   * A coarse clock, for deciding who has gone quiet.
   *
   * The clock above ticks every second so the elapsed time reads like a
   * stopwatch. Staleness is a two-minute judgement, so hanging it off that
   * tick was disastrous downstream: this list got a new identity every second,
   * which gave `mappedParties` one, which gave `communityRoutes` one — and a
   * new routes array makes WalkMap rebuild every native polyline on the map.
   * Once a second. For the entire walk, while people are trying to look at it.
   *
   * Bucketed to fifteen seconds, the list keeps its identity across roughly
   * fifteen renders, and someone who stops reporting still greys out well
   * inside the two minutes that actually define stale.
   */
  const staleClock = Math.floor(now / 15_000) * 15_000;
  const visibleParties = useMemo(
    // v2: the receiver already judged contact (Presence, heard time) on a
    // fresh clock; the GPS age here is only a label.
    () => (liveV2 ? parties : parties.filter(party => !freshness(party.recorded_at, staleClock).stale)),
    [liveV2, parties, staleClock],
  );
  const walking = useMemo(
    () => attendance.filter(person => person.status === 'walking'),
    [attendance],
  );
  const dogCount = useMemo(
    () => walking.reduce((count, person) => count + Math.max(1, person.dogs?.length ?? 0), 0),
    [walking],
  );

  /**
   * My own route, straight from the recorder on this phone.
   *
   * Not from the server. `publishLiveLocation` uploads at most once every 12
   * seconds and simplifies what it sends, so waiting for my own path to come
   * back to me meant staring at a map with no line on it for the first part of
   * every walk — which is exactly what "no path is getting drawn" looked like.
   * The recorder already holds every accepted fix; this is the same data, a
   * round trip earlier and at full fidelity.
   */
  const myPath = useMemo(() => personalSession?.path ?? [], [personalSession?.path]);
  const iAmRecording = myPath.length > 0;

  /**
   * Everyone on the map, with my own marker moved to where this phone says I am.
   *
   * My published row is up to twelve seconds behind the line being drawn from
   * the recorder, so left alone my portrait trailed the end of my own route
   * like a dropped anchor. Replacing the coordinate — and inventing the row
   * entirely for the first twelve seconds, before anything has been published —
   * keeps one marker per walker, each at the freshest position its own device
   * has managed to report.
   */
  const mappedParties = useMemo(() => {
    const here = personalSession?.lastAccepted;
    if (!user?.id || !here) return visibleParties;
    const mine = visibleParties.find(party => party.user_id === user.id);
    const updated: ShownParty = {
      walk_id: walkId ?? '',
      user_id: user.id,
      accuracy_m: null,
      recorded_at: new Date().toISOString(),
      ...mine,
      lat: here.lat,
      lng: here.lng,
      path: myPath,
    };
    return mine
      ? visibleParties.map(party => (party.user_id === user.id ? updated : party))
      : [...visibleParties, updated];
  }, [myPath, personalSession?.lastAccepted, user?.id, visibleParties, walkId]);

  /**
   * A walker's colour, keyed to the walker rather than to a position in an
   * array.
   *
   * It was `partyColors[index]` over whichever list was being mapped at the
   * time — which is only correct while every list holds the same people in the
   * same order. The moment one of them filters somebody out (my own route is
   * now drawn from the recorder, so it leaves this list) the marker rings and
   * the lines they label disagree, and colour stops identifying anyone.
   */
  /**
   * Keyed on WHO is walking, not on the objects describing them.
   *
   * `mappedParties` gets a new identity on every accepted GPS fix, because my
   * own route grew — which is true but irrelevant to what colour anybody is.
   * Deriving this from the roster instead means one walker moving no longer
   * rebuilds every other walker's line.
   */
  // A STABLE order — never the positions list's, which is sorted by latest
  // ping and so swapped two walkers' colours every few seconds. See
  // lib/community/liveRoster.
  const rosterKey = useMemo(
    () => walkerColourOrder(user?.id, attendance, mappedParties.map(party => party.user_id)).join('|'),
    [attendance, mappedParties, user?.id],
  );
  const identity = useMemo(() => {
    const assigned = new Map<string, { color: string; dashed: boolean }>();
    (rosterKey ? rosterKey.split('|') : []).forEach((userId, index) => {
      assigned.set(userId, {
        color: partyColors[index % partyColors.length],
        dashed: index % 2 === 1,
      });
    });
    return (userId: string) => assigned.get(userId) ?? { color: partyColors[0], dashed: false };
  }, [rosterKey]);
  const colorFor = (userId: string) => identity(userId).color;

  const communityRoutes = useMemo(() => visibleParties
    // Drawn twice otherwise: once from the recorder as `myPath` below, and
    // again, coarser and a few seconds behind, from my own published row.
    .filter(party => !(iAmRecording && party.user_id === user?.id))
    .map(party => ({
      id: party.user_id,
      path: party.path,
      ...identity(party.user_id),
    })), [iAmRecording, identity, user?.id, visibleParties]);

  const meetingPoint = useMemo(
    () => walk?.meeting_lat != null && walk?.meeting_lng != null
      ? { lat: walk.meeting_lat, lng: walk.meeting_lng }
      : null,
    [walk?.meeting_lat, walk?.meeting_lng],
  );

  const fittedCamera = useMemo(() => {
    if (!mapSize.width || !mapSize.height) return null;
    // My own route counts too, or the camera frames the pack around a walker it
    // is not drawing — and on a walk of one, framed nothing at all.
    const points = [
      ...myPath,
      ...visibleParties.flatMap(party => [
        ...party.path,
        { lat: party.lat, lng: party.lng },
      ]),
    ];
    if (!points.length && meetingPoint) points.push(meetingPoint);
    return fitCamera(points, {
      width: mapSize.width,
      height: mapSize.height,
      padding: { top: 205, right: 64, bottom: 250, left: 64 },
      minZoom: 12,
      maxZoom: 17,
      pointZoom: 16,
    });
  }, [mapSize.height, mapSize.width, meetingPoint, myPath, visibleParties]);

  const viewCamera = reportedCamera ?? fittedCamera;
  const placedParties = useMemo(() => {
    if (!viewCamera || !mapSize.width || !mapSize.height) return [];
    const projected = mappedParties.map(party => ({
      party,
      person: attendance.find(row => row.user_id === party.user_id),
      at: projectPoint({ lat: party.lat, lng: party.lng }, viewCamera, mapSize.width, mapSize.height),
    }));
    // People walking together are a metre or two apart — far closer than a
    // marker is wide at any zoom a street map can show — so without this they
    // render as one stacked face. Overlapping markers are fanned out around
    // where they really are; `anchor` keeps that true spot for the small dot
    // drawn under each moved avatar. See lib/community/spreadMarkers.ts.
    const spread = spreadMarkers(
      projected.map(item => ({ id: item.party.user_id, x: item.at.x, y: item.at.y })),
      MARKER_SEPARATION,
    );
    const byId = new Map(spread.map(point => [point.id, point]));
    return projected.flatMap(item => {
      const placed = byId.get(item.party.user_id);
      if (!placed) return [];
      return [{
        ...item,
        at: { x: placed.x, y: placed.y },
        anchor: placed.displaced ? placed.anchor : null,
      }];
    });
  }, [attendance, mapSize.height, mapSize.width, mappedParties, viewCamera]);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setMapSize(current => current.width === width && current.height === height ? current : { width, height });
  };

  const sheetPan = useMemo(
    () =>
      Gesture.Pan()
        .onStart(() => { foldAtGrab.value = fold.value; })
        .onUpdate(event => {
          // Dragging DOWN closes, so a positive translation subtracts height.
          fold.value = Math.min(FOLD_HEIGHT, Math.max(0, foldAtGrab.value - event.translationY));
        })
        .onEnd(() => {
          const wasOpen = foldAtGrab.value > FOLD_HEIGHT / 2;
          const moved = fold.value - foldAtGrab.value;
          const open = wasOpen ? moved > -FOLD_THRESHOLD : moved > FOLD_THRESHOLD;
          fold.value = withTiming(open ? FOLD_HEIGHT : 0, { duration: FOLD_MS, easing: FOLD_EASING });
          runOnJS(setSheetOpen)(open);
        }),
    [fold, foldAtGrab],
  );

  const toggleSheet = useCallback(() => {
    const open = !sheetOpen;
    fold.value = withTiming(open ? FOLD_HEIGHT : 0, { duration: FOLD_MS, easing: FOLD_EASING });
    setSheetOpen(open);
  }, [fold, sheetOpen]);

  const foldStyle = useAnimatedStyle(() => ({ height: fold.value, opacity: fold.value / FOLD_HEIGHT }));

  /**
   * The nearest other walker, measured from this phone's own fix.
   *
   * From `mappedParties` rather than the raw rows so it uses my live position
   * rather than the one I published up to twelve seconds ago — otherwise the
   * distance lags the map it sits under.
   */
  const nearest = useMemo(() => {
    const me = personalSession?.lastAccepted;
    if (!me || !user?.id) return null;
    let best: { name: string; meters: number } | null = null;
    for (const party of mappedParties) {
      if (party.user_id === user.id) continue;
      const person = attendance.find(row => row.user_id === party.user_id);
      const meters = haversineMeters(me, { lat: party.lat, lng: party.lng });
      if (!Number.isFinite(meters)) continue;
      if (!best || meters < best.meters) {
        best = { name: firstName(person?.person?.full_name || person?.person?.username), meters };
      }
    }
    return best;
  }, [attendance, mappedParties, personalSession?.lastAccepted, user?.id]);

  const proximityLine = proximityCopy(nearest?.meters ?? null, nearest?.name ?? null, walking.length);
  /** Faces for the row: everyone but me, since the line is about them. */
  const companionFaces = useMemo(
    () => walking.filter(person => person.user_id !== user?.id).flatMap(person => person.dogs ?? []),
    [user?.id, walking],
  );
  /**
   * Photos from this walk, pinned where the shutter fired.
   *
   * Only the ones marked shared, and only the ones that know where they were
   * taken: a capture with no fix has no business being dropped somewhere on
   * the map, and a personal-only photo is not a moment this pack is part of.
   */
  const momentPins = useMemo<KeepsakeMapPin[]>(
    () => [
      // Everyone else's, already published — they now arrive during the walk
      // rather than after it, which is the whole point of pinning them here.
      ...publishedPinsFrom(othersMoments),
      // Mine, straight from the recorder's drafts: on the map the instant the
      // shutter fires, without waiting for an upload to come back.
      ...momentPinsFrom(recorder?.captures ?? []),
    ],
    [othersMoments, recorder?.captures],
  );

  /**
   * What the sheet counts: the pack's photos plus this phone's.
   *
   * The two halves are kept separate deliberately — see `liveMomentCount`.
   * Now that a photo publishes as it is taken, this phone's own appear in BOTH
   * the table and the drafts, and counting the table wholesale would count
   * every one of them twice.
   */
  const momentTotal = liveMomentCount(othersMoments.length, recorder?.captures ?? []);

  /**
   * How wide the unrolled detail is.
   *
   * Measured rather than flexed: the header hugs its content so it can be a
   * chip when closed, and a `flex: 1` child inside a self-sizing parent has
   * nothing to divide. This is the rest of the row, exactly.
   */
  const detailWidth = Math.max(0, windowWidth - space.lg * 2 - BACK_SIZE - space.sm - CHIP_WIDTH - space.sm - HEADER_PAD * 2);

  const partyLine = walking.length > 1
    ? `${walking.length} walking · ${dogCount} ${dogCount === 1 ? 'dog' : 'dogs'}`
    : `Just you · ${dogCount} ${dogCount === 1 ? 'dog' : 'dogs'}`;

  // The trail's owner, not this walk's organiser — see isTrailHost.
  const isHost = isTrailHost(pack, user?.id);

  /**
   * Capture a moment without leaving the walk.
   *
   * This used to be `router.back()` — the shared map handed you to your own
   * recording to take a photo, which is the individual walk reappearing in the
   * one place a Trail says it does not exist. The camera is rendered here now,
   * writing into the recorder's single draft pipeline through the handle.
   */
  const captureMoment = () => {
    if (recorder) {
      setCameraOpen(true);
      return;
    }
    // Nothing is recording on this phone, so there is no walk for a photo to
    // belong to. Say so rather than opening a camera whose picture would have
    // nowhere to go.
    setError(
      walkPhase === 'tracking'
        ? 'The camera is not ready yet.'
        : 'Join the walk to add a photo to it.',
    );
  };

  /** Ends this phone's recording, and — for the host only — the walk itself. */
  const finishMine = async (alsoCloseShared: boolean) => {
    setFinishing(true);
    try {
      if (alsoCloseShared && walkId) {
        // Closing the shared walk now DOES end everyone's: each member's phone
        // sees the state change and finishes its own recording, saving and
        // linking it exactly as a manual finish would. Nobody loses a metre of
        // what they walked; they lose the choice of when to stop.
        try {
          await closeOuting(walkId);
          // Live Walk v2: tell a Broadcast walk's room straight away. Only a
          // hint — each phone still checks the walk's own state.
          receiverRef.current?.sendEndHint();
          // The walk screen skips its refetch inside the freshness window, and
          // its snapshot still says `active`. Without this, a host who ends a
          // walk and steps back within that window is offered "Join the walk"
          // on a walk they just closed.
          invalidate(cacheKey.outing(walkId));
        } catch (cause) {
          setError(describeError(cause, 'community_action'));
        }
      }
      if (walkPhase === 'tracking' || walkPhase === 'starting') await endWalk('manual');
      /**
       * A finished walk ends on its memory, never on the trail's list.
       *
       * This was `router.back()`, and it broke when the solo recorder stopped
       * mounting underneath: `/walk` used to be the screen behind this one, so
       * going back landed on its summary, which then forwarded to the memory.
       * With that screen gone, "back" meant the trail page — the walk simply
       * ended and dropped you on a list, with nothing to show for it.
       *
       * `replace`, so the live map is not still on the stack behind a walk that
       * is over. `finished=1` tells the memory screen this is the first time
       * anyone has seen it, which is the moment worth marking.
       */
      router.replace(`/community/walk/${walkId}/memory?finished=1` as never);
    } finally {
      setFinishing(false);
    }
  };

  const finish = () => {
    if (finishing) return;
    // Nothing recording on this phone: they are looking at somebody else's
    // walk, or their own already-finished one. Leaving is just leaving.
    if (walkPhase !== 'tracking' && walkPhase !== 'starting') {
      if (walk?.state === 'completed' && walkId) {
        router.replace(`/community/walk/${walkId}/memory` as never);
        return;
      }
      router.back();
      return;
    }
    // Only the host is asked, because only the host can close the shared walk.
    // Everyone else's finish is unambiguous: their own walk, and nothing else.
    if (isHost) {
      Alert.alert(
        'Finish your walk?',
        'You can end just your own recording, or close the walk for the whole pack. Closing it finishes everyone’s recording and saves what they walked.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Just mine', onPress: () => { void finishMine(false); } },
          { text: 'Close for everyone', style: 'destructive', onPress: () => { void finishMine(true); } },
        ],
      );
      return;
    }
    void finishMine(false);
  };

  return (
    <View style={styles.screen} onLayout={onLayout}>
      <StatusBar style="dark" translucent backgroundColor="transparent" />
      <WalkMap
        mode="live"
        // Mine, in the walk's own yellow-on-navy, so it is distinguishable from
        // the pack's party colours at a glance. Everyone else's arrives through
        // communityRoutes.
        path={myPath}
        communityRoutes={communityRoutes}
        // My portrait marker already stands where I am — see mappedParties.
        // A second dot under it would be the same fact drawn twice.
        currentPosition={null}
        center={
          personalSession?.lastAccepted
            ?? (visibleParties[0] ? { lat: visibleParties[0].lat, lng: visibleParties[0].lng } : meetingPoint)
        }
        quiet
        interactive
        camera={viewCamera}
        // Only a PERSON moving the map may take the camera over. MapLibre also
        // reports its own startup position and every move we make; letting
        // those through made the map's default view shadow the fitted one for
        // good on Android. `info` is absent on iOS, which only ever reports
        // gestures, so absent counts as a person.
        onCameraChange={(next, info) => { if (info?.user !== false) setReportedCamera(next); }}
        style={StyleSheet.absoluteFillObject as any}
      />

      {/* The header carries the live state in its eyebrow rather than in a
          separate pill beside the title. "Live together" as a chip next to a
          screen that is self-evidently a live map was a label for something
          nobody was going to mistake; the eyebrow says the same thing and buys
          the space back for the one action worth having up here. */}
      {/* ── The header, at rest ──────────────────────────────────────────────
          A walk's own map should be mostly map. Full width, three lines and a
          button is a lot of chrome to carry for the whole of a walk when the
          only thing it says continuously is "this is live" — so that is all it
          says, in a chip, until somebody asks for the rest.

          The detail enters from the right and leaves the same way, so the chip
          reads as the edge the panel unrolls from rather than as a button that
          swapped one box for another. `LinearTransition` carries the width
          between the two so nothing jumps. */}
      <Animated.View
        layout={HEADER_LAYOUT}
        style={[styles.packHeader, { top: insets.top + 12 }]}
      >
        {/* Leaving the map is not leaving the walk: recording lives at the
            app root (TrailRecording) and carries on. iOS has no system back,
            so without this the only way out was finishing. */}
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)' as never))}
          hitSlop={8}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Leave the map. Your walk keeps recording."
        >
          <Ionicons name="chevron-back" size={18} color={color.cream} />
        </Pressable>
        <Pressable
          onPress={() => setHeaderOpen(open => !open)}
          hitSlop={10}
          style={styles.liveChip}
          accessibilityRole="button"
          accessibilityState={{ expanded: headerOpen }}
          accessibilityLabel={headerOpen ? 'Hide walk details' : 'Show walk details'}
        >
          <View style={styles.liveDot} />
          <Text style={styles.liveLabel}>LIVE</Text>
        </Pressable>

        {headerOpen ? (
          <Animated.View
            entering={SlideInRight.duration(240).easing(Easing.out(Easing.cubic))}
            exiting={SlideOutRight.duration(180).easing(Easing.in(Easing.cubic))}
            style={[styles.headerDetail, { width: detailWidth }]}
          >
            <View style={styles.flex}>
              <Text style={styles.packTitle} numberOfLines={1}>{pack?.name ?? 'Shared walk'}</Text>
              <Text style={styles.packMeta} numberOfLines={1}>{partyLine}</Text>
            </View>
            {/* Host only. Bringing someone into a trail is the host's call,
                and a button that opens a screen the database will refuse is
                worse than no button. */}
            {isHost ? (
              <Pressable
                onPress={() => pack && router.push(`/community/${pack.id}/invite` as never)}
                disabled={!pack}
                style={({ pressed }) => [styles.inviteButton, pressed && styles.pressed, !pack && styles.disabled]}
                accessibilityRole="button"
                accessibilityLabel="Invite someone to this meetup"
              >
                <Text style={styles.inviteButtonText}>Invite</Text>
              </Pressable>
            ) : null}
          </Animated.View>
        ) : null}
      </Animated.View>

      {/* Under the portraits, over the route: a photo marks where it happened,
          and the people walking are what you are looking for. */}
      <KeepsakeMapOverlay
        pins={momentPins}
        camera={viewCamera}
        width={mapSize.width}
        height={mapSize.height}
        size={44}
      />

      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {/* Where fanned-out walkers really are. Drawn first so the avatars sit
            above them. Small, in the walker's own colour, so the map stays
            truthful about position even when a face has been moved aside. */}
        {placedParties.map(({ party, anchor }) => (anchor ? (
          <View
            key={`anchor-${party.user_id}`}
            pointerEvents="none"
            style={[styles.partyAnchor, { left: anchor.x - 4, top: anchor.y - 4, backgroundColor: colorFor(party.user_id) }]}
          />
        ) : null))}
        {placedParties.map(({ party, person, at }) => {
          const dog = person?.dogs?.[0] ?? {
            id: party.user_id,
            name: firstName(person?.person?.full_name || person?.person?.username),
            image_url: person?.person?.avatar_url ?? null,
          };
          const names = person?.dogs?.map(item => item.name).join(' + ')
            || firstName(person?.person?.full_name || person?.person?.username);
          return (
            <Pressable
              key={party.user_id}
              onPress={() => setSelectedId(party.user_id)}
              style={[styles.partyMarker, { left: at.x - 25, top: at.y - 25 }]}
              accessibilityRole="button"
              accessibilityLabel={ageLabel(party, now) ? `${names}, ${ageLabel(party, now)}` : names}
            >
              <DogAvatar
                dog={dog}
                size={50}
                ringColor={colorFor(party.user_id)}
              />
              {/* A row wider than the 50 pt marker, so the pill sizes to its
                  text — inside the marker alone it was squeezed to ~50 pt and
                  "Bruno · 2m ago" read "Bruno ·…". */}
              <View style={styles.markerLabelRow} pointerEvents="none">
                <View style={[styles.markerLabel, selectedId === party.user_id && styles.markerLabelSelected]}>
                  <Text style={styles.markerLabelText} numberOfLines={1}>
                    {ageLabel(party, now) ? `${names} · ${ageLabel(party, now)}` : names}
                  </Text>
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>

      {error ? <View style={[styles.errorChip, { top: insets.top + 190 }]}><Text style={styles.errorText}>{error}</Text></View> : null}
      {!error && loadIssue ? (
        <View style={[styles.issueChip, { top: insets.top + 190 }]}><Text style={styles.issueText}>{loadIssue}</Text></View>
      ) : null}


      {/* ── The sheet ────────────────────────────────────────────────────────
          Collapsible, and the split is what makes it worth collapsing: the
          detail above the rule is worth a glance, the three buttons below it
          are worth reaching for at any moment. So the buttons never move and
          never hide — only the block above them folds away, giving the map
          back about a third of the screen without taking the walk's controls
          with it.

          Anchoring the actions row and animating the block ABOVE it, rather
          than animating the whole sheet's height, is deliberate: a sheet that
          shrinks from the bottom drags its own buttons down past the thumb
          that is reaching for them. */}
      <View style={[styles.controls, { paddingBottom: insets.bottom + 12 }]}>
        {/* The gesture root wraps ONLY the grip, not the sheet.
            It used to wrap the whole sheet, which put a native
            GestureHandlerRootView in the path of a height that changes every
            frame — so each frame of the fold re-laid-out the gesture root and
            everything under it, including the stats and three buttons. That is
            the stutter. The root now contains one 44×4 pill and nothing that
            animates. */}
        <GestureHandlerRootView style={styles.gripRoot}>
          <GestureDetector gesture={sheetPan}>
            <View style={styles.gripStrip}>
              <Pressable
                onPress={toggleSheet}
                hitSlop={14}
                accessibilityRole="button"
                accessibilityLabel={sheetOpen ? 'Hide the walk details' : 'Show the walk details'}
              >
                <View style={styles.grip} />
              </Pressable>
            </View>
          </GestureDetector>
        </GestureHandlerRootView>

        <Animated.View style={[styles.foldable, foldStyle]}>
          <View style={styles.proximityRow}>
            {companionFaces.length ? (
              <View style={styles.faces}><DogStack dogs={companionFaces} max={3} /></View>
            ) : null}
            <Text style={styles.proximityText} numberOfLines={1}>{proximityLine}</Text>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statCell}>
              <ElapsedClock startedAt={walk?.started_at ?? null} style={styles.statValue} />
              <Text style={styles.statLabel}>TOGETHER</Text>
            </View>
            <View style={[styles.statCell, styles.statCellRuled]}>
              <Text style={styles.statValue}>
                {((personalSession?.distanceM ?? 0) / 1000).toFixed(1)}
                <Text style={styles.statUnit}> km</Text>
              </Text>
              <Text style={styles.statLabel}>YOUR PHONE</Text>
            </View>
            <View style={[styles.statCell, styles.statCellRuled]}>
              <Text style={styles.statValue}>{momentTotal}</Text>
              <Text style={styles.statLabel}>MOMENTS</Text>
            </View>
          </View>
        </Animated.View>

        <View style={styles.actionsRow}>
          <Pressable
            onPress={() => void finish()}
            disabled={finishing}
            style={({ pressed }) => [styles.finishButton, pressed && styles.pressed, finishing && styles.disabled]}
            accessibilityRole="button"
          >
            <Text style={styles.finishButtonText}>{finishing ? 'Finishing…' : 'Finish walk'}</Text>
          </Pressable>
          <Pressable
            onPress={captureMoment}
            style={({ pressed }) => [styles.squareButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Open the walk camera"
          >
            <Ionicons name="camera-outline" size={20} color={color.cream} />
          </Pressable>
          <Pressable
            // Clearing, not copying: `fittedCamera` re-fits around everyone as
            // they move, and handing control back to it resumes following the
            // group. Copying it in froze the view at this one moment instead.
            onPress={() => setReportedCamera(null)}
            disabled={!fittedCamera}
            style={({ pressed }) => [styles.squareButton, pressed && styles.pressed, !fittedCamera && styles.disabled]}
            accessibilityRole="button"
            accessibilityLabel="Recenter the pack"
          >
            <Ionicons name="locate-outline" size={20} color={color.cream} />
          </Pressable>
        </View>
      </View>

      {/* Owned by this screen because this screen is the one on top — a Modal
          presented from a covered view controller is how a camera ends up
          opening for some people and silently not for others. The capture
          itself still goes to the recorder's drafts, so it is saved with the
          walk and shared with the pack exactly as one taken on /walk. */}
      {WALK_CAMERA_ENABLED && recorder ? (
        <WalkCamera
          visible={cameraOpen}
          onClose={() => setCameraOpen(false)}
          onCaptured={recorder.onCaptured}
          context={recorder.context}
          sharing={recorder.sharing}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: '#E9EEE8' },
  screen: { flex: 1, overflow: 'hidden', backgroundColor: '#E9EEE8' },
  flex: { flex: 1, minWidth: 0 },
  // Left-anchored only. With no `right` the card sizes to its content, which is
  // what lets it be a chip at rest and a panel when opened — and what makes the
  // width worth animating at all.
  packHeader: {
    position: 'absolute',
    zIndex: 8,
    left: space.lg,
    maxWidth: '92%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: HEADER_PAD,
    borderRadius: radius.pill,
    backgroundColor: color.navy,
    ...makeShadow(8, 22, 0.22),
  },
  backButton: {
    width: BACK_SIZE,
    height: BACK_SIZE,
    borderRadius: BACK_SIZE / 2,
    backgroundColor: color.navyRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 34,
    paddingHorizontal: 10,
  },
  headerDetail: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: color.yellow },
  liveLabel: { fontFamily: font.bold, fontSize: 10, letterSpacing: 1.3, color: color.yellow },
  packTitle: { fontFamily: font.bold, fontSize: 14.5, lineHeight: 18, letterSpacing: -0.2, color: color.cream },
  packMeta: { fontFamily: font.medium, fontSize: 11, lineHeight: 15, color: color.creamDim, marginTop: 1 },
  inviteButton: {
    minHeight: 38,
    paddingHorizontal: 15,
    borderRadius: radius.pill,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  inviteButtonText: { fontFamily: font.bold, fontSize: 12.5, color: color.navy },
  partyMarker: { position: 'absolute', zIndex: 6, width: 50, height: 50, alignItems: 'center' },
  partyAnchor: { position: 'absolute', zIndex: 5, width: 8, height: 8, borderRadius: 4, borderWidth: 1.5, borderColor: color.surface },
  // Centred under the 50 pt marker: (50 − 132) / 2 = −41.
  markerLabelRow: { position: 'absolute', top: 42, left: -41, width: 132, alignItems: 'center' },
  markerLabel: { maxWidth: 132, paddingHorizontal: 8, minHeight: 22, borderRadius: radius.pill, backgroundColor: color.navy, alignItems: 'center', justifyContent: 'center' },
  markerLabelSelected: { backgroundColor: '#031A22' },
  markerLabelText: { fontFamily: font.bold, fontSize: 8.5, color: color.surface },
  errorChip: { position: 'absolute', zIndex: 9, left: space.xl, right: space.xl, padding: space.sm, borderRadius: radius.md, backgroundColor: color.errorSoft },
  errorText: { ...type.label, color: color.error, textAlign: 'center' },
  issueChip: { position: 'absolute', zIndex: 9, left: space.xl, right: space.xl, padding: space.sm, borderRadius: radius.md, backgroundColor: color.surface },
  issueText: { ...type.label, fontSize: 12, color: color.slateMuted, textAlign: 'center' },
  // Same geometry as the error chip, deliberately not the same colour: a walk
  // that ended exactly as designed must not be painted in the error tone.
  // Edge to edge and anchored to the bottom, so the sheet reads as the floor
  // of the screen rather than as a card floating above it.
  controls: {
    position: 'absolute',
    zIndex: 10,
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.lg,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    backgroundColor: color.navy,
    ...makeShadow(-14, 34, 0.24),
  },
  // A generous strip, not just the pill: 4px of handle is a fine target for a
  // cursor and a hopeless one for a thumb on a moving walk.
  gripRoot: { alignSelf: 'stretch' },
  gripStrip: { paddingTop: 9, paddingBottom: 7, alignItems: 'center' },
  grip: { width: 44, height: 4, borderRadius: 999, backgroundColor: color.hairlineOnNavy },
  foldable: { overflow: 'hidden' },

  proximityRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 34 },
  faces: { transform: [{ scale: 0.66 }], marginLeft: -space.md, marginRight: -space.lg },
  proximityText: { ...type.body, fontSize: 12.5, color: color.cream, flex: 1 },

  statsRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: color.hairlineOnNavy,
    paddingTop: space.sm,
    marginTop: 2,
  },
  // Left-aligned with a rule between, the way the handoff sets them: centred
  // cells with a floating divider made three numbers of different widths look
  // like they were drifting.
  statCell: { flex: 1, alignItems: 'flex-start' },
  statCellRuled: { paddingLeft: 16, borderLeftWidth: 1, borderLeftColor: color.hairlineOnNavy },
  statValue: {
    fontFamily: font.bold,
    fontSize: 20,
    lineHeight: 25,
    letterSpacing: -0.5,
    color: color.cream,
    fontVariant: ['tabular-nums'],
  },
  statUnit: { fontSize: 12, letterSpacing: 0 },
  statLabel: { fontFamily: font.bold, fontSize: 8.5, letterSpacing: 1.2, color: color.creamFaint, marginTop: 3 },

  actionsRow: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  finishButton: { flex: 1, minHeight: 52, borderRadius: radius.pill, backgroundColor: color.yellow, alignItems: 'center', justifyContent: 'center' },
  finishButtonText: { fontFamily: font.bold, fontSize: 15, letterSpacing: -0.2, color: color.navy },
  squareButton: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: color.navyRaised,
    borderWidth: 1,
    borderColor: color.hairlineOnNavy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
  disabled: { opacity: 0.48 },
});
