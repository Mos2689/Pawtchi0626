/**
 * The memory of a shared walk — "Trace, with the pack".
 *
 * ── Why this is a map and not a page ───────────────────────────────────────
 *
 * It used to be a scroll: a cover card, an artwork, a small map, then every
 * photo as a full-width card. Four ways of saying "here is the walk", stacked,
 * none of them the subject. The route was an illustration in one block and the
 * photos were a list in another, so the one fact that makes a shared walk worth
 * remembering — that these things happened at these places — was the one thing
 * the screen never showed.
 *
 * Now the map is the screen. The pack's lines draw themselves in on arrival,
 * the photos land where they were taken, and the sheet underneath holds who
 * walked. Everything else is one tap from there.
 *
 * ── What was kept, deliberately ────────────────────────────────────────────
 *
 * The share sheet, untouched. It encodes consent rules — map-free artwork only,
 * this dog's identity and nobody else's photos, and a warning that an export
 * cannot be recalled — and none of that is layout. A photo opened from the map
 * still gets the same card it had in the list, with its heart and its author
 * and its owner's ability to take it back out.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { describeError, rawErrorMessage } from '../../../../lib/appError';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import Animated, { FadeIn, FadeOut, useReducedMotion } from 'react-native-reanimated';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import WalkMap from '../../../../components/walk/WalkMap';
import { LassoWorkingContent } from '../../../../components/LassoLoader';

import {
  CommunityButton,
  CommunityCard,
  partyColors,
} from '../../../../components/community/CommunityUI';
import { PackStoryCard, type StoryPhoto, type StoryWalkerLines } from '../../../../components/community/PackStoryCard';
import {
  dogsLine,
  minutesTogether,
  orderWalkers,
  pickStoryPhotos,
  storyDateChip,
  storyDogNames,
  storyHeadline,
  storyLineColor,
  storySubline,
  type StoryWalker,
} from '../../../../lib/community/packStory';
import { color, font, makeShadow, radius, space, type } from '../../../../constants/design';
import { KeepsakeMapOverlay, type KeepsakeMapPin } from '../../../../components/walk/KeepsakeMapOverlay';
import { TrailReel, type ReelMoment } from '../../../../components/community/TrailReel';
import { PackTraceSheet, type PackTraceRow } from '../../../../components/community/PackTraceSheet';
import {
  distanceLabel,
  durationLabel,
  rankTraces,
  togetherSeconds,
} from '../../../../lib/community/memoryTraces';
import { fitCamera, type MapCamera } from '../../../../lib/walk/mapCamera';
import { longestRoute, momentProgress, reelTracePoints } from '../../../../lib/community/reelTrace';
import { communityMediaUrls } from '../../../../lib/communityMedia';
import { loadMemory, removeSharedMoment, setMomentHeart, type CommunityMemory, type SharedMoment } from '../../../../lib/communityWalks';
import { timed } from '../../../../lib/community/perf';
import { TOGETHER_READ_TIMEOUT_MS } from '../../../../lib/communityCache';
import { withTimeout } from '../../../../lib/withTimeout';
import { useLiveMapCamera } from '../../../../hooks/useLiveMapCamera';
import { legSettled } from '../../../../lib/community/legSettle';
import { memoryReadiness, memoryWaitingLine } from '../../../../lib/community/memoryReadiness';
import { reuseRoutes } from '../../../../lib/community/stableRoutes';
import type { GeoPoint } from '../../../../lib/walk/geo';
import { withHeart } from '../../../../lib/community/momentHeart';
import { shareMoment } from '../../../../lib/shareMoment';
import { useActivePetStore } from '../../../../store/useActivePetStore';
import { useAuth } from '../../../../providers/AuthProvider';
import { dateFormat } from '../../../../lib/dateFormats';

/**
 * The reel's trace strip. Wide and short — it sits above a row of buttons.
 *
 * Fixed rather than measured: it is drawn once per walk and handed to every
 * page, so measuring would mean a layout pass per page for a shape that never
 * changes. The width is comfortably inside the narrowest phone this app runs
 * on, minus the card's own padding.
 */
const TRACE_W = 260;
const TRACE_H = 24;

/** A line on the memory map — the shape `reuseRoutes` keeps stable across reloads. */
type MemoryRoute = { id: string; path: readonly GeoPoint[]; color: string; dashed: boolean };

/**
 * The longest the loader waits for this phone's own leg to reach the memory.
 *
 * The attach is one or two round trips once the walk has saved; this is the
 * bound for when it is not coming. Past it the memory opens with what it has,
 * and a later focus fills in the rest.
 */
const LEG_SETTLE_TIMEOUT_MS = 12_000;

/**
 * The loader never flashes. Arriving straight off a walk, a beat of "saving"
 * that is gone before it can be read looks like a glitch rather than care —
 * the same reasoning as the creator-code screen's MIN_WORKING_MS.
 */
const MIN_FINISH_LOADER_MS = 900;

/**
 * Opened from a list, the loader appears only if the load is slow enough to
 * notice. Most take a few hundred milliseconds and never show it at all.
 */
const LIST_LOADER_DELAY_MS = 350;

/**
 * How often an unfinished memory re-reads itself while the pack's walks arrive.
 *
 * Only while it is waiting, and never past the readiness grace (a minute after
 * the walk ended), so it is at most ~20 reads of one RPC per viewer, once.
 */
const MEMORY_SETTLE_POLL_MS = 3_000;

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function dayLabel(value: string | null): string {
  const date = value ? new Date(value) : new Date();
  return dateFormat({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(date);
}

/**
 * "23 MIN IN · 4:12 PM", or just the clock when the walk never recorded a start.
 *
 * How far into the walk a photo was taken is the fact a shared memory turns on
 * — it is what places the moment inside the walk rather than merely on the day
 * — so it leads, and the wall-clock time follows it.
 */
function momentDateline(moment: SharedMoment, startedAt: string | null): string {
  const clock = momentTime(moment.captured_at).toUpperCase();
  const from = startedAt ? Date.parse(startedAt) : NaN;
  const at = Date.parse(moment.captured_at);
  if (!Number.isFinite(from) || !Number.isFinite(at) || at < from) return clock;
  const minutes = Math.round((at - from) / 60000);
  return `${minutes < 1 ? 'AT THE START' : `${minutes} MIN IN`} · ${clock}`;
}

function momentTime(value: string): string {
  return dateFormat({ hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

export default function CommunityMemoryScreen() {
  const router = useRouter();
  const { walkId, finished, by } = useLocalSearchParams<{ walkId: string; finished?: string; by?: string }>();
  /** The host closed the walk, rather than this person pressing Finish. */
  const closedByHost = by === 'host';
  /**
   * Arrived here straight off the end of the walk, rather than from a list.
   *
   * The completion beat used to live on the solo recorder's summary, which a
   * Trail walk passed through on its way here. It does not any more, and
   * without this the walk simply stopped and the map appeared — no moment, no
   * numbers, nothing that said the thing you just did was finished.
   *
   * State rather than the param read directly, so dismissing it sticks: the
   * param stays in the URL for as long as the screen is mounted.
   */
  const [justFinished, setJustFinished] = useState(finished === '1');
  /**
   * Arrived off a walk whose leg on this phone may not be in the memory yet.
   *
   * When the host closes the walk a member is brought here at once, while
   * their own walk is still saving — load now and their route is missing from
   * the walk they just did. So the screen holds its loader until TrailRecording
   * says the leg is attached (lib/community/legSettle), bounded, then loads.
   * From a list there is nothing in flight and this starts false.
   */
  const [awaitingLeg, setAwaitingLeg] = useState(finished === '1');
  const awaitingLegRef = useRef(awaitingLeg);
  awaitingLegRef.current = awaitingLeg;
  const activePet = useActivePetStore(state => state.activePet);
  const { user } = useAuth();
  const [memory, setMemory] = useState<CommunityMemory | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  /**
   * Whether the first load has landed. Not "is a request in flight" — it exists
   * so the empty state stays quiet until there is something to be empty about.
   */
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [includeRoute, setIncludeRoute] = useState(true);
  const [sharing, setSharing] = useState(false);
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const [stage, setStage] = useState({ width: 0, height: 0 });
  /** The walker whose line and photos the screen is currently about. */
  const [focusId, setFocusId] = useState<string | null>(null);
  const [openMoment, setOpenMoment] = useState<string | null>(null);

  const onStage = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setStage(current => (current.width === width && current.height === height
      ? current
      : { width, height }));
  }, []);

  /**
   * A walker's colour, fixed by their place in the ranked list.
   *
   * The same colour paints their line on the map, their sparkline in the sheet
   * and the highlight when they are focused. It is the only thing tying the
   * three together — without it the map is a handful of anonymous squiggles.
   */
  const traces = useMemo(() => rankTraces(memory?.traces ?? []), [memory?.traces]);
  const tintFor = useCallback(
    (userId: string) => {
      const index = traces.findIndex(trace => trace.userId === userId);
      return partyColors[(index < 0 ? 0 : index) % partyColors.length];
    },
    [traces],
  );

  /**
   * How many of the pack's lines have arrived.
   *
   * The routes land one walker at a time rather than all at once — three
   * updates about two hundred milliseconds apart, so the map assembles itself
   * instead of appearing. Deliberately NOT a per-frame draw-on: these are
   * native polylines, and animating them would mean re-sending every line to
   * the map sixty times a second, which is the exact cost the live map was
   * fixed to stop paying.
   *
   * Reduced motion gets all of them immediately.
   */
  const [landed, setLanded] = useState(0);
  const drawable = useMemo(() => traces.filter(trace => trace.routes.length > 0), [traces]);
  // WHO is drawn, in order. Every load — the settling poll, every focus —
  // hands back new arrays for the same lines, and keying the landing on the
  // array replayed it each time: the lines vanished and re-landed on a simple
  // return to this screen (perf audit E3). Keyed on the walkers, the lines
  // land once; a new walker arriving still lands them afresh.
  const drawKey = useMemo(() => drawable.map(trace => trace.userId).join('|'), [drawable]);
  const drawCount = drawable.length;
  useEffect(() => {
    if (!drawCount) return;
    if (reducedMotion) { setLanded(drawCount); return; }
    setLanded(0);
    const timers = Array.from({ length: drawCount }, (_, index) =>
      setTimeout(() => setLanded(index + 1), 160 + index * 190));
    return () => { timers.forEach(clearTimeout); };
  }, [drawKey, drawCount, reducedMotion]);

  const previousRoutes = useRef<MemoryRoute[] | null>(null);
  const mapRoutes = useMemo(() => {
    // One entry per SEGMENT, keyed on the walker and the segment's place in
    // their list. A walker who stopped and restarted has several lines and one
    // colour, which is the truth: same person, same walk, two recordings.
    const next: MemoryRoute[] = drawable.slice(0, landed).flatMap(trace =>
      trace.routes.map((segment, index) => ({
        id: `${trace.userId}#${index}`,
        path: segment,
        color: tintFor(trace.userId),
        dashed: false,
      })));
    // Unchanged lines stay the SAME objects (and an unchanged set the same
    // array), so a reload does not re-send polylines to the map.
    const stable = reuseRoutes(next, previousRoutes.current);
    previousRoutes.current = stable;
    return stable;
  }, [drawable, landed, tintFor]);

  const momentPins = useMemo<KeepsakeMapPin[]>(
    () => (memory?.moments ?? [])
      .filter(moment => moment.capture_lat != null && moment.capture_lng != null)
      .map(moment => ({
        id: moment.id,
        lat: moment.capture_lat!,
        lng: moment.capture_lng!,
        uri: moment.display_path ? urls[moment.display_path] ?? null : null,
      })),
    [memory?.moments, urls],
  );

  /**
   * Frames everything at once, above the resting sheet.
   *
   * Recomputed when the focus changes so choosing one walker zooms to their
   * walk — which is most of the payoff of choosing one.
   */
  const framing = useMemo<MapCamera | null>(() => {
    if (!stage.width || !stage.height) return null;
    const source = focusId ? traces.filter(t => t.userId === focusId) : traces;
    const points = source.flatMap(trace => trace.routes.flat());
    for (const pin of momentPins) points.push({ lat: pin.lat, lng: pin.lng });
    if (!points.length) return null;
    return fitCamera(points, {
      width: stage.width,
      height: stage.height,
      padding: { top: 96, right: 48, bottom: 150, left: 48 },
      minZoom: 12,
      maxZoom: 17,
      pointZoom: 16,
    });
  }, [focusId, momentPins, stage.height, stage.width, traces]);

  /**
   * The framing COMMANDS the map; the photos are projected against where the
   * map REPORTS it is. They used to be projected against the framing, so the
   * first pinch left every photo floating over the street it was not taken on.
   * Same contract as Home's canopy — see useLiveMapCamera for the three ways
   * getting this by hand goes wrong.
   */
  const { camera, viewCamera, pinsHidden, handleCameraChange, touchHandlers } =
    useLiveMapCamera(framing);

  const mapCentre = traces[0]?.routes[0]?.[0] ?? (momentPins[0] ? { lat: momentPins[0].lat, lng: momentPins[0].lng } : null);

  /**
   * Android waits for the framing before the map exists at all.
   *
   * MapLibre sat on the whole world here, on every open, while every Android
   * map that mounts WITH its camera — Home's canopy, the walk summary — framed
   * correctly. This screen was the odd one out: it created an empty map at
   * once and added the camera in a later commit, and on Android that later
   * camera did not take. Home gates on its camera for the same reason
   * (HomeMapLayer's `canMap`), so this follows the pattern that is known to
   * work on devices rather than one more theory about why the other does not.
   *
   * A memory with nothing to place (no routes, no located photos) has no
   * framing to wait for, so it gets its map straight away. iOS is unaffected —
   * MapKit takes a late region without complaint, and it keeps its instant map.
   */
  const mapMountable = Platform.OS !== 'android'
    || camera !== null
    || (memory != null && mapCentre === null && stage.width > 0);

  const packRows = useMemo<PackTraceRow[]>(
    () => traces.map(trace => ({
      trace,
      person: memory?.attendance.find(row => row.user_id === trace.userId),
      tint: tintFor(trace.userId),
      moments: (memory?.moments ?? []).filter(m => m.contributor_id === trace.userId).length,
    })),
    [memory?.attendance, memory?.moments, tintFor, traces],
  );

  /**
   * This walker's own trace, for the completion beat.
   *
   * Theirs and nobody else's: three phones measure three different distances
   * on the same walk, and none of them is "the walk's". Null is a real answer
   * — somebody who joined but never recorded still finished the walk, and the
   * card says so without inventing a number for them.
   */
  const mine = useMemo(
    () => traces.find(trace => trace.userId === user?.id) ?? null,
    [traces, user?.id],
  );

  /**
   * Every shared moment, in the order the walk happened, shaped for the reel.
   *
   * Sorted by capture time rather than by contributor: the reel's whole claim
   * is that this is one afternoon rather than several people's albums, and
   * grouping by author would make it the second thing.
   */
  const reelMoments = useMemo<ReelMoment[]>(
    () => [...(memory?.moments ?? [])]
      .sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at))
      .map(moment => {
        const who = memory?.attendance.find(row => row.user_id === moment.contributor_id);
        return {
          id: moment.id,
          uri: moment.display_path ? urls[moment.display_path] ?? null : null,
          dateline: momentDateline(moment, memory?.walk.started_at ?? null),
          author: who?.person?.full_name?.trim().split(/\s+/)[0]
            || (who?.person?.username ? `@${who.person.username}` : 'Someone on the walk'),
          authorDogs: who?.dogs ?? [],
          detail: moment.caption
            || (who?.dogs?.length ? `Walking with ${who.dogs.map(dog => dog.name).join(' & ')}` : null),
          hearted: !!moment.heartedByMe,
          heartCount: moment.heartCount ?? 0,
          progress: momentProgress(
            moment.captured_at,
            memory?.walk.started_at ?? null,
            memory?.walk.ended_at ?? null,
          ),
          canRemove: moment.contributor_id === user?.id,
        };
      }),
    [memory?.moments, memory?.attendance, memory?.walk, urls, user?.id],
  );

  /**
   * The line under every page — one recording, not everyone's.
   *
   * Three overlapping squiggles behind a photograph is texture, not
   * information. See lib/community/reelTrace.ts for why the lit portion is
   * elapsed time rather than a position on the route.
   */
  const tracePoints = useMemo(
    () => reelTracePoints(longestRoute(memory?.routes ?? []), TRACE_W, TRACE_H),
    [memory?.routes],
  );

  const memoryDay = memory?.walk.ended_at ?? memory?.walk.scheduled_for ?? null;
  const shareCardRef = useRef<View>(null);

  /**
   * A heart, answered at once.
   *
   * It used to write, then reload the ENTIRE memory — every moment, every route
   * — to learn one number. The tap felt slow, and the fresh traces made the
   * map's lines draw themselves in again, as if the walk had reloaded. Now the
   * one moment flips locally, the write goes out, and a failure flips it back.
   * `memory.traces` keeps its identity through the patch, so nothing redraws.
   * A second tap on the same photo while its first is in flight is ignored,
   * so fast double taps cannot race each other to the server.
   */
  const heartsInFlight = useRef<Set<string>>(new Set());
  const toggleHeart = useCallback((id: string) => {
    if (heartsInFlight.current.has(id)) return;
    const moment = memory?.moments.find(m => m.id === id);
    if (!moment) return;
    const hearted = !moment.heartedByMe;
    const patch = (value: boolean) => setMemory(current => (current
      ? { ...current, moments: withHeart(current.moments, id, value) }
      : current));
    heartsInFlight.current.add(id);
    patch(hearted);
    setMomentHeart(id, hearted)
      .catch(() => patch(!hearted))
      .finally(() => heartsInFlight.current.delete(id));
  }, [memory?.moments]);

  /**
   * Loads in the air. The settling poll below skips a tick while one is
   * running, so a slow network never stacks reads — each can take up to its
   * 12 s timeout, far longer than the 3 s poll (external audit, 2026-09-26).
   * Direct callers (focus, a heart, a removal) still load: they follow a change
   * and need the answer after it.
   */
  const loadsInFlight = useRef(0);
  const load = useCallback(async () => {
    if (!walkId) return;
    loadsInFlight.current += 1;
    setError(null);
    try {
      // Both awaits are bounded. `finally` below only runs once the whole `try`
      // completes, so a stall in EITHER call would leave `loaded` false for good.
      const next = await withTimeout(
        timed('loadMemory', 1, () => loadMemory(walkId)),
        TOGETHER_READ_TIMEOUT_MS,
        'loadMemory',
      );
      setMemory(next);
      // Routes, people and numbers are usable now. The loader used to stay up
      // until the photo URLs were signed as well — up to twelve more seconds on
      // a slow signing call, with the whole walk already sitting underneath it.
      setLoaded(true);

      // Signed in the background; pins and the reel fill in when it lands.
      // Timed separately from the memory itself: since the URL cache went in,
      // this is the number that should read ~0 ms on a revisit.
      //
      // A stalled signing must not fail the screen, nor BLANK the photos: on a
      // refocus the previous URLs are still on screen. So a timeout leaves
      // `urls` untouched, and a success MERGES rather than replaces — two loads
      // in flight (the settling poll) cannot drop each other's photos.
      void withTimeout(
        timed('memoryUrls', 1, () =>
          communityMediaUrls(next.moments.flatMap(moment => moment.display_path ? [moment.display_path] : []))),
        TOGETHER_READ_TIMEOUT_MS,
        'memoryUrls',
      )
        .then(signed => setUrls(current => ({ ...current, ...signed })))
        .catch(() => {});
    } catch (cause) {
      // `walk_not_attended` is not a failure. A walk's memory belongs to the
      // people who were on it (migration 20260923000000), and somebody in the
      // pack who did not come is in an ordinary, expected state — so they get a
      // sentence explaining it, not a raw Postgres error string.
      const raw = rawErrorMessage(cause);
      setError(
        raw.includes('walk_not_attended')
          ? 'This walk’s memory is kept for the people who walked it. You can see the plan and who came on the walk itself.'
          : describeError(cause, 'community_load'),
      );
    } finally {
      loadsInFlight.current -= 1;
      setLoaded(true);
    }
  }, [walkId]);

  /**
   * Deliberately NOT freshness-gated, unlike the trail and walk screens.
   *
   * Those paint from a snapshot before they fetch, so skipping the fetch still
   * leaves something on screen. This one does not: there is no `readSnapshot`
   * here, and the only cache key `loadMemory` writes is `cacheKey.outing`,
   * which belongs to the walk screen and holds a different shape entirely.
   * Gating on it would mean arriving from a walk — which has just made that key
   * fresh — and skipping the load that fills this screen, leaving it empty.
   *
   * Giving the memory its own key and snapshot would make it gateable. That is
   * worth doing and is not worth doing here, in a pass that is meant to leave
   * working things alone. The URL cache already removed the expensive half of
   * this reload.
   */
  useFocusEffect(useCallback(() => {
    // The first load of a just-finished walk belongs to the wait below —
    // loading now as well would fetch a memory without this person's route.
    if (awaitingLegRef.current) return;
    void load();
  }, [load]));

  useEffect(() => {
    if (!awaitingLeg || !walkId) return;
    let alive = true;
    void Promise.all([
      withTimeout(legSettled(walkId), LEG_SETTLE_TIMEOUT_MS, 'legSettled').catch(() => {}),
      wait(MIN_FINISH_LOADER_MS),
    ])
      .then(() => (alive ? load() : undefined))
      .finally(() => { if (alive) setAwaitingLeg(false); });
    return () => { alive = false; };
    // Once per arrival: the wait is for the leg that was finishing when this
    // screen opened, not for anything that happens after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Nothing honest to draw yet — no memory, or not this person's part of it.
   *
   * The creator-code loader, not a blank map: a blank map right after a walk
   * reads as "your walk is gone", which is the one thing this screen exists to
   * disprove.
   */
  /**
   * Everyone who walked, in the memory? See lib/community/memoryReadiness —
   * this is what stops the memory opening with half the pack's lines on it.
   */
  const [clock, setClock] = useState(() => Date.now());
  const readiness = useMemo(
    () => memoryReadiness({
      attendance: memory?.attendance ?? [],
      traceUserIds: traces.map(trace => trace.userId),
      walkState: memory?.walk.state,
      endedAt: memory?.walk.ended_at,
      now: clock,
    }),
    [clock, memory?.attendance, memory?.walk.ended_at, memory?.walk.state, traces],
  );
  const settling = !!memory && !readiness.ready;
  useEffect(() => {
    if (!settling) return;
    const poll = setInterval(() => {
      setClock(Date.now());
      if (loadsInFlight.current === 0) void load();
    }, MEMORY_SETTLE_POLL_MS);
    return () => clearInterval(poll);
  }, [settling, load]);

  const showLoader = awaitingLeg || !loaded || settling;
  const loaderCopy = closedByHost
    ? {
        title: 'Walk finished',
        body: 'The host finished the walk for everyone. Saving yours and gathering the pack’s photos.',
      }
    : finished === '1'
      ? { title: 'Finishing up', body: 'Saving your walk and gathering the pack’s photos.' }
      : { title: 'One moment', body: 'Gathering the pack’s routes and photos.' };

  /**
   * The pack story's content — see lib/community/packStory for the rules.
   *
   * Everyone who walked, the viewer first so their dog leads and their line is
   * the yellow one; each walker's dogs by name; the viewer's OWN photos only,
   * spread across the walk; and each walker's recorded segments for the lines.
   */
  const { width: windowWidth } = useWindowDimensions();
  const storyWidth = Math.min(windowWidth - space.xl * 2, 340);
  const story = useMemo(() => {
    const walkerIds: string[] = [];
    for (const trace of traces) if (!walkerIds.includes(trace.userId)) walkerIds.push(trace.userId);
    for (const row of memory?.attendance ?? []) {
      if ((row.status === 'walking' || row.status === 'finished') && !walkerIds.includes(row.user_id)) {
        walkerIds.push(row.user_id);
      }
    }
    const walkers: StoryWalker[] = walkerIds.map(userId => {
      const row = memory?.attendance.find(entry => entry.user_id === userId);
      const names = (row?.dogs ?? []).map(dog => dog.name);
      if (!names.length && userId === user?.id && activePet?.name) names.push(activePet.name);
      return { userId, dogNames: names };
    });
    const ordered = orderWalkers(walkers, user?.id ?? null);
    const names = storyDogNames(ordered);
    const lines: StoryWalkerLines[] = ordered.map((walker, index) => ({
      color: storyLineColor(index),
      routes: traces.find(trace => trace.userId === walker.userId)?.routes ?? [],
    }));
    const photos: StoryPhoto[] = pickStoryPhotos(
      (memory?.moments ?? [])
        .filter(moment => moment.contributor_id === user?.id && moment.display_path && urls[moment.display_path])
        .map(moment => ({
          id: moment.id,
          uri: urls[moment.display_path as string],
          cacheKey: moment.display_path as string,
          capturedAt: Date.parse(moment.captured_at) || 0,
        })),
    );
    const whenIso = memory?.walk.started_at ?? memory?.walk.ended_at ?? memory?.walk.scheduled_for ?? null;
    const at = whenIso ? new Date(whenIso) : null;
    const seconds = memory ? togetherSeconds(memory.walk) : null;
    return {
      headline: storyHeadline({ dogNames: names, at, fallbackTitle: memory?.walk.title ?? 'A walk together' }),
      subline: storySubline({ at, seconds, moments: memory?.moments.length ?? 0 }),
      dateChip: storyDateChip(at),
      dogsLine: dogsLine(names),
      dogDots: lines.map(line => line.color),
      minutes: minutesTogether(seconds),
      lines,
      photos,
    };
  }, [activePet?.name, memory, traces, urls, user?.id]);

  const share = async () => {
    setSharing(true);
    const outcome = await shareMoment(shareCardRef, {
      source: 'community_memory',
      ground: includeRoute ? 'route_artwork' : 'paper',
      template: 'pack_story',
    });
    setSharing(false);
    if (outcome === 'shared') setShareOpen(false);
    else if (outcome === 'failed') setError('The keepsake could not be shared.');
    else setError('Sharing is unavailable on this device.');
  };


  return (
    <View style={styles.screen}>
      <View style={styles.stage} onLayout={onStage} {...touchHandlers}>
        {mapMountable && (
          <WalkMap
            mode="summary"
            path={[]}
            communityRoutes={mapRoutes}
            center={mapCentre}
            camera={camera}
            onCameraChange={handleCameraChange}
            // The framing above is authored, never the reported camera fed
            // back, so the map may remount its camera on each new framing.
            cameraIsFraming
            quiet
            interactive
            style={StyleSheet.absoluteFillObject as any}
          />
        )}

        {/* Photos where they happened. Dimmed rather than removed when a
            walker is focused: they are still part of the walk, they are just
            not part of the answer to "show me theirs". */}
        {/* Hidden, not left behind, while a map that cannot report mid-drag
            (iOS) is being dragged — see useLiveMapCamera. */}
        {!pinsHidden && (
        <KeepsakeMapOverlay
          pins={momentPins}
          camera={viewCamera}
          width={stage.width}
          height={stage.height}
          size={46}
          // Each photo drops in after the lines have settled, in the order it
          // was taken — so the map fills the way the walk happened.
          entering={pinId => {
            if (reducedMotion) return undefined;
            const order = momentPins.findIndex(pin => pin.id === pinId);
            return FadeIn.delay(700 + Math.max(0, order) * 110).duration(260);
          }}
          // The overlay clusters pins taken in the same place and hands back
          // the whole group. Opening the first of them is the honest read of
          // "this one" — they were all taken within a few metres.
          onPress={group => setOpenMoment(group[0]?.id ?? null)}
        />
        )}

        {/* Floating chrome, not a header band. The map runs under it edge to
            edge — a memory of a walk that reaches only halfway up the screen is
            a map being quoted rather than a map being looked at. The title sits
            on the back arrow's row, where the rest of the community screens
            put theirs. */}
        <View style={[styles.navRow, { top: insets.top + 8 }]} pointerEvents="box-none">
          <Pressable
            onPress={() => router.back()}
            style={styles.navButton}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={21} color={color.navy} />
          </Pressable>
          <View style={styles.navTitleWrap}>
            <Text style={styles.navTitle} numberOfLines={1}>
              {memory?.pack.name ?? 'A walk together'}
            </Text>
            <Text style={styles.navSub} numberOfLines={1}>{dayLabel(memoryDay)}</Text>
          </View>
          <Pressable
            onPress={() => setShareOpen(true)}
            style={styles.shareIcon}
            accessibilityRole="button"
            accessibilityLabel="Preview external keepsake"
          >
            <Ionicons name="share-outline" size={19} color={color.navy} />
          </Pressable>
        </View>

        {error ? (
          <View style={[styles.errorChip, { top: insets.top + 68 }]}><Text style={styles.errorText}>{error}</Text></View>
        ) : null}

        {traces.length === 0 && momentPins.length === 0 && loaded ? (
          <View style={styles.quiet} pointerEvents="none">
            <Ionicons name="paw-outline" size={26} color={color.slateFaint} />
            <Text style={styles.quietText}>
              A quiet walk still counts. Nobody recorded a route or shared a photo.
            </Text>
          </View>
        ) : null}
      </View>

      {/* ── The completion beat ──────────────────────────────────────────
          Shown once, on arrival straight from the walk, and only after the
          memory has actually loaded — announcing "saved" over an empty screen
          would be a claim we cannot yet back up.

          It sits over the sheet rather than replacing it, so the map and the
          traces are already behind it: the walk is the subject, this is the
          full stop. Numbers are the walker's OWN, because there is no such
          thing as a shared distance — see lib/community/memoryTraces.ts. */}
      {justFinished && loaded && !awaitingLeg && !settling ? (
        <Pressable
          style={[styles.finishedScrim, { paddingBottom: insets.bottom + space.xl }]}
          onPress={() => setJustFinished(false)}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        >
          <View style={styles.finishedCard}>
            <Ionicons name="checkmark-circle" size={34} color={color.success} />
            <Text style={styles.finishedTitle}>
              {closedByHost ? 'The host finished the walk' : 'Walk saved'}
            </Text>
            <Text style={styles.finishedBody}>
              {mine
                ? `${distanceLabel(mine.distanceM)} · ${durationLabel(mine.durationS)}${
                    mine.sniffs > 0
                      ? ` · ${mine.sniffs} ${mine.sniffs === 1 ? 'sniff' : 'sniffs'}`
                      : ''
                  }`
                : closedByHost
                  ? 'Yours is saved and in the meetup.'
                  : 'It is in the meetup now.'}
            </Text>
            <Text style={styles.finishedHint}>Tap anywhere to see the walk</Text>
          </View>
        </Pressable>
      ) : null}

      <PackTraceSheet
        rows={packRows}
        walkSeconds={togetherSeconds(memory?.walk ?? { started_at: null, ended_at: null })}
        momentCount={memory?.moments.length ?? 0}
        focusId={focusId}
        onFocus={setFocusId}
        bottomInset={insets.bottom}
      />

      {/* ── The reel ─────────────────────────────────────────────────────
          Vertical, full bleed, everyone's moments in the order the afternoon
          happened. This used to be the solo walk's KeepsakeViewer with a Trail
          card bolted on; that viewer pages sideways through YOUR archive, and
          reading a shared afternoon sideways made it a folder.

          EVERY moment is here, not only the ones with a coordinate. The map
          behind can pin only located photos — there is no honest place to put
          the others — but a photo whose GPS had not settled is still part of
          the walk, and dropping it from the reel is how a moment silently
          disappears from the thing it belonged to. */}
      {openMoment ? (
        <TrailReel
          moments={reelMoments}
          initialIndex={Math.max(0, reelMoments.findIndex(moment => moment.id === openMoment))}
          tracePoints={tracePoints}
          traceWidth={TRACE_W}
          traceHeight={TRACE_H}
          onHeart={toggleHeart}
          onRemove={id => {
            setOpenMoment(null);
            void removeSharedMoment(id).then(load).catch(() => {});
          }}
          onClose={() => setOpenMoment(null)}
        />
      ) : null}

      {showLoader ? (
        <Animated.View
          style={[styles.loader, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
          entering={reducedMotion
            ? undefined
            : finished === '1'
              ? FadeIn.duration(180)
              : FadeIn.delay(LIST_LOADER_DELAY_MS).duration(220)}
          exiting={reducedMotion ? undefined : FadeOut.duration(260)}
        >
          <StatusBar style="light" />
          <Pressable
            onPress={() => router.back()}
            style={styles.loaderBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={8}
          >
            <Ionicons name="arrow-back" size={22} color={color.cream} />
          </Pressable>
          <LassoWorkingContent
            title={loaderCopy.title}
            body={settling ? `${loaderCopy.body} ${memoryWaitingLine(readiness)}` : loaderCopy.body}
            status={settling ? 'Putting the memory together…' : 'Opening the memory…'}
          />
        </Animated.View>
      ) : null}

      <Modal visible={shareOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShareOpen(false)}>
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHead}>
            <View>
              <Text style={styles.modalEyebrow}>EXACTLY WHAT LEAVES PAWTCHI</Text>
              <Text style={styles.modalTitle}>Share preview</Text>
            </View>
            <Pressable onPress={() => setShareOpen(false)} style={styles.closeIcon} accessibilityLabel="Close share preview">
              <Ionicons name="close" size={22} color={color.navy} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody}>
            {/* The story itself is the image — captured pixel for pixel. */}
            <PackStoryCard
              ref={shareCardRef}
              width={storyWidth}
              headline={story.headline}
              subline={story.subline}
              dateChip={story.dateChip}
              dogsLine={story.dogsLine}
              dogDots={story.dogDots}
              minutes={story.minutes}
              walkers={story.lines}
              photos={story.photos}
              showLines={includeRoute}
            />

            <Pressable onPress={() => setIncludeRoute(value => !value)} style={styles.routeOption} accessibilityRole="checkbox" accessibilityState={{ checked: includeRoute }}>
              <Ionicons name={includeRoute ? 'checkbox' : 'square-outline'} size={24} color={includeRoute ? color.electric : color.slateMuted} />
              <View style={styles.flex}>
                <Text style={styles.optionTitle}>Include everyone’s lines</Text>
                <Text style={styles.optionBody}>Map-free shapes only. No streets, labels, coordinates, or start and end points.</Text>
              </View>
            </Pressable>
            <CommunityCard style={styles.approvalNote}>
              <Ionicons name="shield-checkmark-outline" size={22} color={color.success} />
              <Text style={styles.approvalText}>This story uses your own photos and the names of the dogs who walked. Everyone else’s photos stay private. Once someone downloads a shared story, Pawtchi cannot recall that copy.</Text>
            </CommunityCard>
            <CommunityButton label={sharing ? 'Preparing…' : 'Share this keepsake'} icon="share-outline" onPress={() => void share()} disabled={sharing} style={styles.shareButton} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: color.surfaceSubtle },
  // Elevation as well as zIndex: on Android an elevated sibling (the sheet)
  // draws over a higher zIndex that has none.
  loader: { ...StyleSheet.absoluteFillObject, zIndex: 30, elevation: 30, backgroundColor: color.navy },
  loaderBack: {
    marginTop: space.sm,
    marginLeft: space.md,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navRow: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    zIndex: 9,
  },
  navButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...makeShadow(4, 12, 0.12),
  },
  // A card rather than bare type: this sits on live map tiles of unknown
  // colour, and a title that is legible over a park is not legible over a road.
  navTitleWrap: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: color.surface,
    ...makeShadow(4, 12, 0.12),
  },
  navTitle: { ...type.label, fontSize: 13.5, color: color.navy },
  navSub: { ...type.caption, fontSize: 9.5, letterSpacing: 0.6, color: color.slateFaint, marginTop: 1 },
  /** The map, which is the screen. Everything else floats on it. */
  stage: { flex: 1, backgroundColor: color.surfaceSubtle },
  // The completion beat. A scrim rather than a screen: the walk is already
  // drawn behind it, and dismissing it reveals the thing it is about.
  finishedScrim: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
    backgroundColor: 'rgba(7,32,42,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  finishedCard: {
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.xxl,
    paddingHorizontal: space.xl,
    borderRadius: radius.xxl,
    backgroundColor: color.surface,
    alignSelf: 'stretch',
  },
  finishedTitle: { ...type.heading, fontSize: 22, color: color.navy },
  finishedBody: { ...type.body, fontSize: 14, color: color.slate, textAlign: 'center' },
  finishedHint: { ...type.caption, fontSize: 11, color: color.slateFaint, marginTop: space.xs },
  quiet: {
    position: 'absolute',
    left: space.xl,
    right: space.xl,
    top: '38%',
    alignItems: 'center',
    gap: space.sm,
  },
  quietText: { ...type.body, fontSize: 12.5, color: color.slateMuted, textAlign: 'center' },
  errorChip: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    top: space.md,
    padding: space.sm,
    borderRadius: radius.md,
    backgroundColor: color.errorSoft,
  },
  errorText: { ...type.label, fontSize: 12, color: color.error, textAlign: 'center' },
  shareIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    ...makeShadow(4, 12, 0.14),
  },
  cover: { borderRadius: radius.xxl, overflow: 'hidden', backgroundColor: color.navy },
  replayControl: {
    position: 'absolute',
    top: space.md,
    right: space.md,
    minHeight: 48,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    backgroundColor: color.yellow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  replayText: { ...type.label, color: color.navy },
  coverCopy: { padding: space.xl, backgroundColor: color.navy },
  coverDate: { ...type.caption, color: color.yellow },
  coverTitle: { fontFamily: font.memoryTitle, fontSize: 34, lineHeight: 40, color: color.surface, marginTop: space.sm },
  coverPlace: { ...type.body, color: 'rgba(255,255,255,0.72)', marginTop: space.xs },
  coverDogs: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.lg },
  coverDogNames: { ...type.label, color: color.surface, flex: 1 },
  routeStory: { padding: space.sm },
  routeTitle: { ...type.heading, color: color.navy, marginHorizontal: space.sm, marginTop: space.md },
  routeBody: { ...type.body, color: color.slateMuted, margin: space.sm },
  privateMap: { height: 280, borderRadius: radius.xxl, overflow: 'hidden', marginTop: space.lg, borderWidth: 1, borderColor: color.hairline },
  privateMapLabel: { position: 'absolute', left: space.md, top: space.md, minHeight: 32, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.92)', paddingHorizontal: space.md, flexDirection: 'row', alignItems: 'center', gap: 6 },
  privateMapLabelText: { ...type.caption, color: color.navy, fontSize: 9.5 },
  sparse: { alignItems: 'center', paddingVertical: space.xxl },
  sparseTitle: { ...type.heading, color: color.navy, marginTop: space.md },
  sparseBody: { ...type.body, color: color.slateMuted, textAlign: 'center', marginTop: space.sm },
  momentCard: { padding: 0, overflow: 'hidden', marginBottom: space.lg },
  momentImage: { width: '100%', aspectRatio: 4 / 3, backgroundColor: color.surfaceSubtle },
  momentPending: { width: '100%', aspectRatio: 4 / 3, backgroundColor: color.surfaceSubtle, alignItems: 'center', justifyContent: 'center' },
  momentPendingText: { ...type.body, color: color.slateMuted, marginTop: space.sm },
  momentCopy: { padding: space.lg },
  momentMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  momentTime: { ...type.label, color: color.navy },
  momentAuthor: { ...type.body, color: color.slateMuted, flex: 1, textAlign: 'right' },
  momentCaption: { ...type.heading, color: color.navy, marginTop: space.md },
  tags: { ...type.caption, color: color.electric, marginTop: space.sm },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: space.md },
  locationText: { ...type.body, color: color.slateFaint },
  momentActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.md, paddingTop: space.md, borderTopWidth: 1, borderTopColor: color.hairline },
  heartButton: { minWidth: 48, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 5 },
  heartText: { ...type.label, color: color.slateMuted },
  removeButton: { minHeight: 48, justifyContent: 'center' },
  removeText: { ...type.label, color: color.error },
  closing: { marginTop: space.xxl, padding: space.xxl, backgroundColor: color.navy, borderRadius: radius.xxl },
  closingEyebrow: { ...type.caption, color: color.yellow },
  closingTitle: { fontFamily: font.memoryTitle, fontSize: 31, lineHeight: 38, color: color.surface, marginTop: space.sm },
  closingBody: { ...type.body, color: 'rgba(255,255,255,0.72)', marginTop: space.sm },
  walkAgain: { marginTop: space.xl },
  modal: { flex: 1, backgroundColor: color.surfaceSubtle },
  modalHead: { paddingHorizontal: space.xl, paddingVertical: space.lg, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalEyebrow: { ...type.caption, color: color.electric },
  modalTitle: { ...type.title, color: color.navy, marginTop: 2 },
  closeIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center' },
  modalBody: { paddingHorizontal: space.xl, paddingBottom: space.xxxl },
  routeOption: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.lg },
  optionTitle: { ...type.label, color: color.navy },
  optionBody: { ...type.body, color: color.slateMuted, marginTop: 2 },
  approvalNote: { flexDirection: 'row', gap: space.md },
  approvalText: { ...type.body, color: color.slateMuted, flex: 1 },
  shareButton: { marginTop: space.lg },
});
