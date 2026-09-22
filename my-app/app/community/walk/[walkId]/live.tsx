import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
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
import { cacheKey, readSnapshot } from '../../../../lib/communityCache';
import {
  closeOuting,
  listLiveParties,
  loadOuting,
  type CommunityPack,
  type CommunityWalk,
  type LiveParty,
  type OutingSnapshot,
  type WalkAttendance,
} from '../../../../lib/communityWalks';
import { WalkCamera } from '../../../../components/walk/WalkCamera';
import { KeepsakeMapOverlay, type KeepsakeMapPin } from '../../../../components/walk/KeepsakeMapOverlay';
import { liveMomentCount, momentPinsFrom } from '../../../../lib/community/liveMoments';
import { WALK_CAMERA_ENABLED } from '../../../../constants/features';
import { useRecorderHandle } from '../../../../lib/walk/recorderHandle';
import { fitCamera, projectPoint, type MapCamera } from '../../../../lib/walk/mapCamera';
import { supabase } from '../../../../lib/supabase';
import { useWalkStore } from '../../../../store/useWalkStore';
import { useAuth } from '../../../../providers/AuthProvider';

const LIVE_FOR_MS = 2 * 60_000;

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

function freshness(iso: string, now: number): { label: string; stale: boolean } {
  const age = Math.max(0, now - Date.parse(iso));
  if (age < 30_000) return { label: 'now', stale: false };
  const minutes = Math.max(1, Math.round(age / 60_000));
  return { label: `${minutes}m ago`, stale: age > LIVE_FOR_MS };
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
  const [parties, setParties] = useState<LiveParty[]>([]);
  const [momentCount, setMomentCount] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });
  const [reportedCamera, setReportedCamera] = useState<MapCamera | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const load = useCallback(async () => {
    if (!walkId) return;
    try {
      const [outing, live, moments] = await Promise.all([
        loadOuting(walkId),
        listLiveParties(walkId),
        supabase
          .from('community_shared_media')
          .select('id', { count: 'exact', head: true })
          .eq('walk_id', walkId)
          .is('removed_at', null),
      ]);
      if (moments.error) throw new Error(moments.error.message);
      setWalk(outing.walk);
      setPack(outing.pack);
      setAttendance(outing.attendance);
      setParties(live);
      setMomentCount(moments.count ?? 0);
      setSelectedId(current => current ?? live.find(item => item.user_id === user?.id)?.user_id ?? live[0]?.user_id ?? null);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The shared map could not update.');
    } finally {
    }
  }, [user?.id, walkId]);

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
  const refreshParties = useCallback(async () => {
    if (!walkId) return;
    try {
      const live = await listLiveParties(walkId);
      setParties(live);
      setSelectedId(current => current ?? live.find(item => item.user_id === user?.id)?.user_id ?? live[0]?.user_id ?? null);
    } catch {
      // The existing positions stay on the map and age out on their own.
    }
  }, [user?.id, walkId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!walkId) return;
    const channel = supabase
      .channel(`community-walk-${walkId}`)
      // Positions move; rosters do not. Only the other two tables change
      // anything this screen would have to re-derive.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'community_live_locations', filter: `walk_id=eq.${walkId}` }, () => { void refreshParties(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'community_walk_attendance', filter: `walk_id=eq.${walkId}` }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'community_shared_media', filter: `walk_id=eq.${walkId}` }, () => { void load(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [load, refreshParties, walkId]);

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
    () => parties.filter(party => !freshness(party.recorded_at, staleClock).stale),
    [parties, staleClock],
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
    const updated: LiveParty = {
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
  const rosterKey = mappedParties.map(party => party.user_id).join('|');
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
    return mappedParties.map(party => {
      const person = attendance.find(row => row.user_id === party.user_id);
      return {
        party,
        person,
        at: projectPoint({ lat: party.lat, lng: party.lng }, viewCamera, mapSize.width, mapSize.height),
      };
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
    () => momentPinsFrom(recorder?.captures ?? []),
    [recorder?.captures],
  );

  /**
   * What the sheet counts.
   *
   * The published rows plus this phone's un-uploaded ones. During a walk the
   * first number is nearly always zero — `community_shared_media` is written at
   * the end — so without the second the counter sat on nought no matter how
   * many photos were taken.
   */
  const momentTotal = liveMomentCount(momentCount, recorder?.captures ?? []);

  /**
   * How wide the unrolled detail is.
   *
   * Measured rather than flexed: the header hugs its content so it can be a
   * chip when closed, and a `flex: 1` child inside a self-sizing parent has
   * nothing to divide. This is the rest of the row, exactly.
   */
  const detailWidth = Math.max(0, windowWidth - space.lg * 2 - CHIP_WIDTH - space.sm - HEADER_PAD * 2);

  const partyLine = walking.length > 1
    ? `${walking.length} walking · ${dogCount} ${dogCount === 1 ? 'dog' : 'dogs'}`
    : `Just you · ${dogCount} ${dogCount === 1 ? 'dog' : 'dogs'}`;

  const isHost = !!walk && walk.organizer_id === user?.id;

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

  /** Ends this phone's recording. Never anyone else's. */
  const finishMine = async (alsoCloseShared: boolean) => {
    setFinishing(true);
    try {
      if (alsoCloseShared && walkId) {
        // Closing the shared walk does not stop anybody's recorder — it marks
        // the outing over so the memory can be built. Whoever is still out
        // keeps walking and finishes in their own time.
        try {
          await closeOuting(walkId);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'The walk could not be closed for everyone.');
        }
      }
      if (walkPhase === 'tracking' || walkPhase === 'starting') await endWalk('manual');
      router.back();
    } finally {
      setFinishing(false);
    }
  };

  const finish = () => {
    if (finishing) return;
    if (walkPhase !== 'tracking' && walkPhase !== 'starting') {
      router.back();
      return;
    }
    // Only the host is asked, because only the host can close the shared walk.
    // Everyone else's finish is unambiguous: their own walk, and nothing else.
    if (isHost) {
      Alert.alert(
        'Finish your walk?',
        'You can end just your own recording, or close the walk for the whole pack. Closing it does not stop anyone else’s recording.',
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
        onCameraChange={setReportedCamera}
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
            <Pressable
              onPress={() => pack && router.push(`/community/${pack.id}/invite` as never)}
              disabled={!pack}
              style={({ pressed }) => [styles.inviteButton, pressed && styles.pressed, !pack && styles.disabled]}
              accessibilityRole="button"
              accessibilityLabel="Invite someone to this trail"
            >
              <Text style={styles.inviteButtonText}>Invite</Text>
            </Pressable>
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
              accessibilityLabel={`${names}, ${freshness(party.recorded_at, now).label}`}
            >
              <DogAvatar
                dog={dog}
                size={50}
                ringColor={colorFor(party.user_id)}
              />
              <View style={[styles.markerLabel, selectedId === party.user_id && styles.markerLabelSelected]}>
                <Text style={styles.markerLabelText} numberOfLines={1}>
                  {names} · {freshness(party.recorded_at, now).label}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {error ? <View style={[styles.errorChip, { top: insets.top + 190 }]}><Text style={styles.errorText}>{error}</Text></View> : null}

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
              <Text style={styles.statValue}>{elapsedSince(walk?.started_at ?? null, now)}</Text>
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
            onPress={() => setReportedCamera(fittedCamera)}
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
  markerLabel: { position: 'absolute', top: 42, maxWidth: 132, paddingHorizontal: 8, minHeight: 22, borderRadius: radius.pill, backgroundColor: color.navy, alignItems: 'center', justifyContent: 'center' },
  markerLabelSelected: { backgroundColor: '#031A22' },
  markerLabelText: { fontFamily: font.bold, fontSize: 8.5, color: color.surface },
  errorChip: { position: 'absolute', zIndex: 9, left: space.xl, right: space.xl, padding: space.sm, borderRadius: radius.md, backgroundColor: color.errorSoft },
  errorText: { ...type.label, color: color.error, textAlign: 'center' },
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
