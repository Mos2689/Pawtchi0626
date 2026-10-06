import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { describeError, errorCopy, isTransientError, toAppError, type AppError } from '../../../../lib/appError';
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import * as Location from 'expo-location';
import { showBlockedPermission } from '../../../../lib/permissions/blockedPermission';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import {
  CommunityDogsOnly,
  DogAvatar,
  communityScreenStyles,
} from '../../../../components/community/CommunityUI';
import { color, font, radius, space, type } from '../../../../constants/design';
import { useWalkEnabled } from '../../../../hooks/useWalkEnabled';
import { useAutoRetry } from '../../../../hooks/useAutoRetry';
import { ErrorState } from '../../../../components/ErrorState';
import { TOGETHER_READ_TIMEOUT_MS, cacheKey, readSnapshot } from '../../../../lib/communityCache';
import { timed } from '../../../../lib/community/perf';
import { initialDogSelection, seedDogsFromPack, sortRosterForDisplay } from '../../../../lib/community/outingDoc';
import { claimPrefetchedOuting } from '../../../../lib/community/outingPrefetch';
import { isPerfFlagOn } from '../../../../lib/perfFlags';
import { withTimeout } from '../../../../lib/withTimeout';
import { withRetry } from '../../../../lib/withRetry';
import {
  inviteToWalk,
  joinOuting,
  listMyDogs,
  loadOuting,
  setAttendance,
  isTrailHost,
  type CommunityDog,
  type CommunityPack,
  type CommunityWalk,
  type OutingSnapshot,
  type PackSnapshot,
  type WalkAttendance,
} from '../../../../lib/communityWalks';
import {
  acknowledgeLocationDisclosure,
  hasAcknowledgedLocationDisclosure,
} from '../../../../lib/walk/locationDisclosure';
import { LocationDisclosure } from '../../../../components/walk/LocationDisclosure';
import { useActivePetStore } from '../../../../store/useActivePetStore';
import { useWalkStore } from '../../../../store/useWalkStore';
import { useAuth } from '../../../../providers/AuthProvider';
import { dateFormat } from '../../../../lib/dateFormats';
import { passEyebrow, passTime, rosterBadge, distanceFromYou, type RosterRing } from '../../../../lib/community/walkPass';
import { placeDirectionsUrl } from '../../../../lib/spots/directions';
import { haversineMeters, type GeoPoint } from '../../../../lib/walk/geo';
import { deriveDogWalkProfile } from '../../../../lib/walk/dogCalibration';
import { dogPaceKmh, formatEta, walkEtaMinutes } from '../../../../lib/walk/wayfinding';

/**
 * Whether the walk's own title says anything the trail's name does not.
 *
 * Most walks inherit the trail's name, so printing both put the same words on
 * screen twice. Worse, the header used to derive "Thursday's walk" from the
 * date while the card printed "Tuesday trail" — two names for one thing, one
 * of them naming a different day than the walk was on.
 */
function distinctTitle(walkTitle: string | undefined, packName: string | undefined): string | null {
  const title = walkTitle?.trim();
  if (!title) return null;
  if (title.toLowerCase() === (packName ?? '').trim().toLowerCase()) return null;
  if (title.toLowerCase() === 'pack walk') return null;
  return title;
}

function firstName(value: string | null | undefined): string {
  return value?.trim().split(/\s+/)[0] || 'Pack member';
}

/**
 * What each person's row says under their name.
 *
 * `invited` reads as "Asked · no reply yet" rather than "Waiting for an
 * answer": the old wording was applied to the whole pack, including people
 * nobody had asked, so a walk with one guest looked like a walk five people
 * were ignoring.
 *
 * It no longer prefixes "Host ·" either. The row already carries a Host badge
 * in its trailing column, and a line reading "Host · Coming" beside a pill
 * reading "Host" is the same word twice on one row.
 */
function statusCopy(person: WalkAttendance, organizer: boolean): string {
  if (organizer) {
    return person.status === 'walking' ? 'Walking now' : 'Coming';
  }
  switch (person.status) {
    case 'coming': return 'Coming';
    case 'cant_make_it': return 'Can’t make it';
    case 'checked_in': return 'At the meeting point';
    case 'walking': return 'Walking now';
    case 'finished': return 'Finished this walk';
    default: return 'Asked · no reply yet';
  }
}

export default function OutingScreen() {
  const router = useRouter();
  const { walkId } = useLocalSearchParams<{ walkId: string }>();
  const { user } = useAuth();
  const activePet = useActivePetStore(state => state.activePet);
  const trackingPhase = useWalkStore(state => state.phase);
  const startWalk = useWalkStore(state => state.startWalk);
  const walkEnabled = useWalkEnabled();
  /**
   * The plan, as the trail already knew it, read before the first paint.
   *
   * The trail primes every walk it lists (see `primeOuting`), so arriving from
   * there this is never null and the card below is correct immediately. Its
   * `partial` flag is why the roster stays quiet rather than claiming an empty
   * one: the plan is known here, the attendance genuinely is not.
   */
  const cached = useMemo(
    () => (walkId ? readSnapshot<OutingSnapshot>(cacheKey.outing(walkId)) : null),
    [walkId],
  );
  const [walk, setWalk] = useState<CommunityWalk | null>(cached?.walk ?? null);
  const [pack, setPack] = useState<CommunityPack | null>(cached?.pack ?? null);
  const [attendance, setAttendanceRows] = useState<WalkAttendance[]>(cached?.attendance ?? []);
  /** In the pack, but not asked to this walk. They can still join. */
  const [notAsked, setNotAsked] = useState<WalkAttendance[]>(cached?.notAsked ?? []);
  /** The row currently being invited, so only that button shows a wait. */
  const [inviting, setInviting] = useState<string | null>(null);
  /**
   * Live position sharing is on for a shared walk, and the person is told so
   * at the moment it starts rather than by a switch they might never notice.
   *
   * Seeing each other is the point of walking together, so a toggle that
   * defaults off makes the feature look broken; a toggle that defaults on and
   * says nothing is worse. The confirmation in `beginPersonalWalk` is the
   * consent, and it is per walk — never per pack, and never standing.
   *
   * The loop closes without anybody's help. walk.tsx stops publishing the
   * moment tracking stops, and `community_locations_read_attendees` only
   * returns positions while the walk is `active` — so when the host closes it,
   * every position becomes unreadable, including the ones already written.
   */
  const shareLocation = true;
  /**
   * perf-walk-instant-open, read once per visit so the screen never switches
   * path halfway through. Off means exactly what build 98 did.
   */
  const instant = useMemo(() => isPerfFlagOn('walkInstantOpen'), []);
  /**
   * My dogs, already known from my row in this walk's meetup — the same dogs
   * `listMyDogs` would fetch — so the picker and the selected dog are there on
   * the first frame. Null (the old path) when there is no such row.
   */
  const seededDogs = useMemo(
    () => (instant && cached?.walk
      ? seedDogsFromPack(readSnapshot<PackSnapshot>(cacheKey.pack(cached.walk.pack_id)), user?.id)
      : null),
    [cached, instant, user?.id],
  );
  const [myDogs, setMyDogs] = useState<CommunityDog[]>(seededDogs ?? []);
  /**
   * Seeded at mount on every path. It used to be set only by a load that
   * LANDED, so one failed refresh left "Join the walk" greyed out beside a
   * roster that was right there (4 Oct 2026). Whether the roster is known is
   * what gates the button now — see `rosterKnown`.
   */
  const [selectedDogIds, setSelectedDogIds] = useState<string[]>(
    () => initialDogSelection(activePet?.id, seededDogs ?? []),
  );
  /**
   * Whether a complete roster has ever been on this screen: a composed prime,
   * or a load that landed. With a dog seeded up front this — not an empty
   * selection — is what keeps the button waiting on a partial prime.
   */
  const [rosterKnown, setRosterKnown] = useState(!!cached && !cached.partial);
  /** Only the first load may take the meetup screen's press-in read. */
  const firstLoad = useRef(true);
  const [busy, setBusy] = useState(false);
  /** An action that did not go through (join, answer, invite). */
  const [error, setError] = useState<string | null>(null);
  /**
   * Why the latest load failed, if it did. Kept apart from `error`: a failed
   * refresh is the screen's business — it retries on its own — while a failed
   * action is the owner's, and needs their attention.
   */
  const [loadIssue, setLoadIssue] = useState<AppError | null>(null);
  const [loadInFlight, setLoadInFlight] = useState(false);
  /** The Play-policy disclosure stands between joining and tracking. */
  const [pendingStart, setPendingStart] = useState(false);

  const load = useCallback(async (): Promise<boolean> => {
    if (!walkId) return true;
    setError(null);
    setLoadInFlight(true);
    // The read the meetup screen started on press-in, if it is still young —
    // claimed once, because a reload after a write must ask afresh. A failed
    // prefetch is not this load's failure: ask again rather than report it.
    const claimed = instant && firstLoad.current ? claimPrefetchedOuting(walkId) : null;
    firstLoad.current = false;
    const readOuting = () => (claimed ? claimed.catch(() => loadOuting(walkId)) : loadOuting(walkId));
    const readDogs = () => (instant && seededDogs ? Promise.resolve(seededDogs) : listMyDogs());
    try {
      // Bounded so `loading` always resolves and the button can never sit on a
      // request that will not answer. The catch below keeps the painted snapshot.
      const [outing, dogs] = await withTimeout(
        timed('loadOuting+dogs', 1, () => Promise.all([readOuting(), readDogs()])),
        TOGETHER_READ_TIMEOUT_MS,
        'loadOuting',
      );
      setWalk(outing.walk);
      setPack(outing.pack);
      setAttendanceRows(outing.attendance);
      setNotAsked(outing.notAsked);
      setMyDogs(dogs);
      setSelectedDogIds(current => current.length
        ? current
        : activePet
          ? [activePet.id]
          : dogs[0]
            ? [dogs[0].id]
            : []);
      setRosterKnown(true);
      setLoadIssue(null);
      return true;
    } catch (cause) {
      setLoadIssue(toAppError(cause));
      return false;
    } finally {
      setLoadInFlight(false);
    }
  }, [activePet, instant, seededDogs, walkId]);

  /** `load`, retried on its own after a failure (hooks/useAutoRetry.ts). */
  const run = useAutoRetry(load);

  /**
   * Refetched on every focus, behind the snapshot painted at the top of this
   * file. There is no freshness gate — see the note on the trail screen for why
   * it was removed. In short: this screen paints instantly from cache anyway, so
   * the gate saved a request but no visible time, and it made every mutation
   * elsewhere responsible for invalidating this key. This screen is where that
   * went wrong most visibly: a primed stand-in counted as fresh, the roster never
   * loaded, and "Start the walk" was disabled on every planned walk.
   */
  useFocusEffect(useCallback(() => {
    if (!walkEnabled) return;
    void run();
  }, [run, walkEnabled]));

  const mine = attendance.find(row => row.user_id === user?.id);
  // The trail's host, not this walk's organiser. Starting, editing and
  // inviting all belong to them now — see isTrailHost.
  const isOrganizer = isTrailHost(pack, user?.id);
  /** Only shown when the host actually named this walk something of its own. */
  const named = distinctTitle(walk?.title, pack?.name);
  const comingCount = attendance.filter(row => ['coming', 'checked_in', 'walking', 'finished'].includes(row.status)).length;
  /**
   * The order the rows are drawn in. `community_outing` returns its roster in
   * no particular order, so with the composed prime on (instant) both lists
   * are put in one fixed order — otherwise the rows would visibly reshuffle
   * when the fetch replaced the prime with the same people.
   */
  const shownAttendance = useMemo(
    () => (instant ? sortRosterForDisplay(attendance, walk?.organizer_id) : attendance),
    [attendance, instant, walk?.organizer_id],
  );
  const shownNotAsked = useMemo(
    () => (instant ? sortRosterForDisplay(notAsked, walk?.organizer_id) : notAsked),
    [instant, notAsked, walk?.organizer_id],
  );

  /**
   * Ask one more person, after the walk already exists.
   *
   * Host only, because the RPC is — a walk's guest list belongs to the person
   * running the trail. The row moves straight up into the roster on reload.
   */
  const invite = async (userId: string) => {
    if (!walkId) return;
    setInviting(userId);
    setError(null);
    try {
      await inviteToWalk(walkId, [userId]);
      // The row moves the instant the write lands, rather than after a second
      // round trip re-derives a fact this screen already holds. Asking someone
      // makes them `invited`, which is precisely what they now are.
      const asked = notAsked.find(person => person.user_id === userId);
      if (asked) {
        setNotAsked(current => current.filter(person => person.user_id !== userId));
        setAttendanceRows(current => [...current, { ...asked, status: 'invited' }]);
      }
      void run();
    } catch (cause) {
      setError(describeError(cause, 'community_action'));
      void run();
    } finally {
      setInviting(null);
    }
  };

  const respond = async (status: 'coming' | 'cant_make_it') => {
    if (!walkId || !user) return;
    setBusy(true);
    setError(null);
    // Answering is the one action on this screen whose result is entirely
    // predictable, so the tick moves with the tap. A refetch still runs behind
    // it, and a failure below puts the old answer back.
    const previous = attendance;
    const previousNotAsked = notAsked;
    const seat = attendance.find(row => row.user_id === user.id)
      ?? notAsked.find(row => row.user_id === user.id);
    if (seat) {
      setAttendanceRows(current => {
        const without = current.filter(row => row.user_id !== user.id);
        return [...without, { ...seat, status }];
      });
      setNotAsked(current => current.filter(row => row.user_id !== user.id));
    }
    try {
      // An upsert of my own answer, so one quiet retry through a dropped
      // connection or a busy server is safe.
      await withRetry(() => setAttendance(walkId, status), { delayMs: 1_500, retryIf: isTransientError });
      void run();
    } catch (cause) {
      setAttendanceRows(previous);
      setNotAsked(previousNotAsked);
      setError(describeError(cause, 'community_action'));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Start recording, and go straight to the shared map.
   *
   * ── What this used to do, and the flash it caused ─────────────────────────
   *
   * It armed a one-shot intent and pushed `/walk`, the SOLO recorder, which
   * then mounted, cleared the disclosure, started tracking, and pushed the
   * shared map over itself — and stayed underneath for the whole walk. That
   * middle step was visible: a blink of the personal walk screen on the way to
   * a walk that is not personal.
   *
   * Nothing about it was necessary. Tracking starts from the store, the
   * disclosure gate is a two-line check, and the recording work now belongs to
   * `components/walk/TrailRecording.tsx` at the app root. So this screen does
   * the whole start itself and replaces — never pushes — to the shared map.
   *
   * `replace`, so there is nothing to go "back" to: this screen's job is done
   * the moment the walk is running, and leaving it on the stack is what made
   * finishing land somewhere nobody asked for.
   */
  const beginPersonalWalk = async (startSharedOuting: boolean) => {
    if (!walkId || !walk || !pack || !activePet || !user?.id || selectedDogIds.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      // One transaction — starting (host) and joining together. See joinOuting.
      // Idempotent by design (join_community_walk), so one quiet retry through
      // a dropped connection or a busy server is safe; refusals are not retried.
      await withRetry(
        () => joinOuting(walkId, selectedDogIds, shareLocation, { start: startSharedOuting }),
        { delayMs: 1_500, retryIf: isTransientError },
      );

      // Google Play requires a prominent in-app disclosure BEFORE the runtime
      // location request whenever location is collected in the background,
      // which a tracked walk does on both platforms. Asked once per account,
      // and the same acknowledgement the solo walk uses — one consent, not two.
      if (!(await hasAcknowledgedLocationDisclosure(user.id))) {
        setBusy(false);
        setPendingStart(true);
        return;
      }
      await launchTracking();
    } catch (cause) {
      setError(describeError(cause, 'community_action'));
      setBusy(false);
    }
  };

  /**
   * The tracking half, separated so the disclosure gate can call it later.
   *
   * The trail goes into `startWalk` and from there into walkTracker's durable
   * record, which is what makes it survive a background relaunch — and what
   * `TrailRecording` reads to know it should be awake. See
   * [[trail-vs-solo-walk-separation]].
   */
  const launchTracking = useCallback(async () => {
    if (!walkId || !walk || !pack || !activePet || !user?.id) return;
    const result = await startWalk(activePet, user.id, {
      walkId,
      packId: walk.pack_id,
      packName: pack.name,
      shareLocation,
    });
    if (result === 'denied') {
      setError('Location access is off, so this walk can’t be measured.');
      setBusy(false);
      showBlockedPermission('location');
      return;
    }
    if (result === 'services_off') {
      setError('Location services are turned off on this phone.');
      setBusy(false);
      showBlockedPermission('location_services');
      return;
    }
    router.replace(`/community/walk/${walkId}/live` as never);
  }, [walkId, walk, pack, activePet, user?.id, shareLocation, startWalk, router]);

  /**
   * Said once, at the only moment it is true, and before anything is written.
   *
   * Not a switch buried on the screen: this appears on the tap that starts
   * sharing, names exactly who sees what, and says when it stops. Cancelling
   * here writes nothing at all — no attendance row, no walk started.
   */
  const confirmAndBegin = (startSharedOuting: boolean) => {
    Alert.alert(
      'This walk is shared with the pack',
      // Two things happen, and the second used to go unsaid. The live position
      // is temporary and the old copy covered it well. The RECORDED route is
      // not temporary: it joins the shared memory through
      // community_members_read_linked_personal_walks and stays there, readable
      // by everyone on the walk, along with the pace and the stops. Consent to
      // the first is not consent to the second.
      'Everyone walking can see your live position while it is on, and that stops when your walk finishes. The route you record joins this walk’s shared memory and stays there. Your way to the meeting point and home again is never shared.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Start walking', onPress: () => { void beginPersonalWalk(startSharedOuting); } },
      ],
    );
  };

  const openPrimaryAction = () => {
    if (!walk || !walkId) return;
    if (walk.state === 'planned' && isOrganizer) {
      confirmAndBegin(true);
      return;
    }
    // A previous network or policy failure may have saved the attendance row
    // as `walking` before the personal recorder was armed. The recorder is the
    // source of truth for this device: when it is not tracking, let the person
    // retry the idempotent join instead of stranding them on the shared map.
    if (walk.state === 'active' && (mine?.status !== 'walking' || trackingPhase !== 'tracking')) {
      confirmAndBegin(false);
      return;
    }
    if (walk.state === 'active') {
      router.push((trackingPhase === 'tracking' ? '/walk' : `/community/walk/${walkId}/live`) as never);
      return;
    }
    if (walk.state === 'completed') router.push(`/community/walk/${walkId}/memory` as never);
  };

  const primaryLabel = (() => {
    if (busy) return walk?.state === 'planned' ? 'Starting…' : 'Joining…';
    if (walk?.state === 'planned') return isOrganizer ? 'Start the walk' : 'Waiting for organiser';
    if (walk?.state === 'active') return trackingPhase === 'tracking' ? 'Open live walk' : 'Join the walk';
    if (walk?.state === 'completed') return 'Open shared memory';
    if (walk?.state === 'cancelled') return 'This walk was called off';
    // No walk yet means it has not arrived, not that it is broken. This said
    // "Walk unavailable" during the load — an error message, in the primary
    // button, on a walk that was about to appear perfectly fine.
    return 'Opening this walk…';
  })();

  /**
   * The guest's side of a walk that has not been started yet.
   *
   * Separated from `primaryDisabled` because the two mean different things: a
   * disabled button is an action you cannot take YET, and this is not an
   * action at all — it is the state of somebody else's decision.
   */
  const waiting = !!walk && walk.state === 'planned' && !isOrganizer;

  /**
   * A finished walk is a thing you look at, not a thing you join.
   *
   * Opening its memory needs no dog and no pet profile — the walk already
   * happened, and whatever was brought to it is recorded. Without this, a
   * member whose dog was not selected found "Open shared memory" greyed out on
   * the one screen the rules now leave them: once the host ends a walk, the
   * memory IS the walk as far as they are concerned.
   */
  const previewOnly = walk?.state === 'completed';

  const primaryDisabled = busy
    || !walk
    || walk.state === 'cancelled'
    || (!previewOnly && (!activePet || selectedDogIds.length === 0))
    || (walk.state === 'planned' && !isOrganizer)
    // With a dog seeded up front, the roster is the gate: a partial prime does
    // not know whether I am already walking. Once known it stays known, so a
    // failed refresh never takes the button away.
    || (!previewOnly && !rosterKnown);

  // ── The pass ────────────────────────────────────────────────────────────
  const insets = useSafeAreaInsets();
  /** My answer, or null when I am in the pack but was not asked to this one. */
  const myStatus = mine ? mine.status : null;
  const inPack = !!mine || notAsked.some(row => row.user_id === user?.id);
  const hostRow = attendance.find(row => row.user_id === walk?.organizer_id);
  const hostName = hostRow
    ? hostRow.user_id === user?.id ? 'You' : firstName(hostRow.person?.full_name || hostRow.person?.username)
    : null;
  const hostDog = hostRow?.dogs?.[0]?.name;
  const hostLine = walk && hostName
    ? `${hostName}${hostDog ? ` & ${hostDog}` : ''} ${hostDog || hostName === 'You' ? 'are' : 'is'} hosting`
    : '';
  const eyebrow = passEyebrow({ state: walk?.state, isHost: isOrganizer, myStatus });
  const when = useMemo(() => passTime(walk?.scheduled_for, {
    time: value => dateFormat({ hour: '2-digit', minute: '2-digit' }).format(value),
    date: value => dateFormat({ weekday: 'long', day: 'numeric', month: 'long' }).format(value),
  }), [walk?.scheduled_for]);
  /** A guest's answer, pinned to the footer — asked or merely in the pack. */
  const canAnswer = walk?.state === 'planned' && !isOrganizer && inPack;
  const answerPrompt = myStatus === 'coming'
    ? 'You said you’re coming'
    : myStatus === 'cant_make_it' ? 'You said you can’t make it' : 'Can you make it?';
  const startsAt = walk?.scheduled_for && !Number.isNaN(Date.parse(walk.scheduled_for))
    ? dateFormat({ hour: 'numeric', minute: '2-digit' }).format(new Date(walk.scheduled_for))
    : null;
  const waitingLine = `${hostName && hostName !== 'You' ? hostName : 'The host'} starts the walk${startsAt ? ` at ${startsAt}` : ''}`;

  // ── The meeting point, from here ────────────────────────────────────────
  // Only a position the phone already has: this screen never asks for
  // location — the walk itself does that, with its disclosure, when it starts.
  const [here, setHere] = useState<GeoPoint | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (!permission.granted) return;
        const last = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 });
        if (alive && last) setHere({ lat: last.coords.latitude, lng: last.coords.longitude });
      } catch {
        // No distance, then — the card still opens directions.
      }
    })();
    return () => { alive = false; };
  }, []);
  const meeting = walk && walk.meeting_lat != null && walk.meeting_lng != null
    ? { lat: walk.meeting_lat, lng: walk.meeting_lng }
    : null;
  const distanceM = here && meeting ? haversineMeters(here, meeting) : null;
  const paceKmh = useMemo(() => dogPaceKmh(deriveDogWalkProfile({
    species: activePet?.species ?? 'dog',
    breed: activePet?.breed ?? null,
    ageYears: activePet?.age_years ?? null,
    weightKg: activePet?.current_weight_kg ?? null,
    medicalConditions: activePet?.medical_conditions ?? null,
  }).paceBandKmh), [activePet]);
  const distanceTitle = distanceM === null ? 'See the meeting point' : distanceFromYou(distanceM);
  const eta = distanceM === null ? '' : formatEta(walkEtaMinutes(distanceM, paceKmh));
  const distanceDetail = distanceM === null || !eta || distanceM > 8_000
    ? 'Opens in your maps app'
    : `${eta.charAt(0).toUpperCase()}${eta.slice(1)} on foot`;
  const openDirections = () => {
    if (!meeting) return;
    const place = { ...meeting, label: walk?.meeting_label || 'Meeting point' };
    Linking.openURL(placeDirectionsUrl(place, Platform.OS === 'ios' ? 'ios' : 'android'))
      .catch(() => Linking.openURL(placeDirectionsUrl(place, 'web')).catch(() => {}));
  };

  /** Nothing to show and the last try failed: the calm card, not an empty shell. */
  const unavailable = !walk && !!loadIssue && !loadInFlight;
  const loadIssueLine = loadIssue ? errorCopy(loadIssue, { context: 'community_load' }).message : null;

  if (!walkEnabled) {
    return (
      <SafeAreaView style={communityScreenStyles.screen}>
        <CommunityDogsOnly petName={activePet?.name} onBack={() => router.back()} />
      </SafeAreaView>
    );
  }

  /**
   * The disclosure, before the OS prompt and before any tracking.
   *
   * Reached only on this account's first walk — after that the acknowledgement
   * is on file and `beginPersonalWalk` goes straight through. "Not now" leaves
   * them here rather than navigating away: they have already joined the walk,
   * and the only thing they declined is starting to record it.
   */
  if (pendingStart) {
    return (
      <LocationDisclosure
        // The trail variant, and it is not cosmetic. The solo copy tells the
        // reader "only you can see it", which is true of a solo walk and false
        // here — this walk's route joins the shared memory. Shipping the solo
        // text on this screen meant the app's stated consent for sharing was a
        // sentence promising the opposite.
        variant="trail"
        onReadMore={() => router.push('/trail-safety' as never)}
        onContinue={() => {
          acknowledgeLocationDisclosure(user?.id);
          setPendingStart(false);
          setBusy(true);
          void launchTracking();
        }}
        onCancel={() => setPendingStart(false)}
      />
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={20} color={color.navy} />
        </Pressable>
        {isOrganizer && walk?.state === 'planned' ? (
          <Pressable
            onPress={() => router.push(`/community/${walk.pack_id}/plan?walkId=${walk.id}` as never)}
            style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Edit this walk"
          >
            <Ionicons name="ellipsis-horizontal" size={19} color={color.navy} />
          </Pressable>
        ) : <View style={styles.headerButtonSpacer} />}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {unavailable && loadIssue ? (
          <View style={styles.unavailable}>
            <ErrorState
              copy={errorCopy(loadIssue, { context: 'community_load' })}
              errorKind={loadIssue.kind}
              errorContext="community_load"
              screen="/community/walk"
              onAction={action => { if (action === 'retry') void run(); }}
            />
          </View>
        ) : (
          <>
          {/* ── The pass ────────────────────────────────────────────────────
              A ticket: who, what and when above the perforation, where below
              it. The notches are circles in the screen's own colour, so the
              card reads as torn rather than drawn. */}
          <View style={styles.pass} accessibilityLabel="Walk pass">
            <View style={styles.passTop}>
              {eyebrow.text ? (
                <View style={styles.eyebrowRow}>
                  {eyebrow.live ? <View style={styles.liveDot} /> : null}
                  <Text style={styles.passEyebrow}>{eyebrow.text}</Text>
                </View>
              ) : null}
              <Text style={styles.passTitle} numberOfLines={2}>{walk ? (named ?? pack?.name ?? '') : ''}</Text>
              {hostLine ? <Text style={styles.passHost} numberOfLines={1}>{hostLine}</Text> : null}
              <View style={styles.timeRow}>
                <Text style={styles.timeBig}>{walk ? when.time : ' '}</Text>
                {walk && when.period ? <Text style={styles.timePeriod}>{when.period}</Text> : null}
              </View>
              <Text style={styles.passDate}>{walk ? when.date : ' '}</Text>
            </View>

            <View style={styles.perforation}>
              <View style={styles.perforationClip}><View style={styles.perforationLine} /></View>
              <View style={[styles.notch, styles.notchLeft]} />
              <View style={[styles.notch, styles.notchRight]} />
            </View>

            <View style={styles.meetRow}>
              <View style={styles.meetMark}>
                <Ionicons name="location-outline" size={22} color={color.navy} />
              </View>
              <View style={styles.meetCopy}>
                <Text style={styles.meetEyebrow}>MEETING POINT</Text>
                <Text style={styles.meetName} numberOfLines={2}>
                  {walk ? walk.meeting_label || 'To be confirmed' : ''}
                </Text>
                {walk?.note ? <Text style={styles.meetNote} numberOfLines={3}>{walk.note}</Text> : null}
              </View>
              {meeting ? (
                <Pressable
                  onPress={openDirections}
                  style={({ pressed }) => [styles.directions, pressed && styles.pressed]}
                  accessibilityRole="link"
                  accessibilityLabel="Directions to the meeting point"
                >
                  <Text style={styles.directionsText}>Directions</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          <View style={styles.sectionHeading}>
            <Text style={styles.sectionTitle}>Who is walking</Text>
            <Text style={styles.comingCount}>
              {rosterKnown ? `${comingCount} of ${attendance.length} coming` : ' '}
            </Text>
          </View>

          <View style={styles.faces}>
            {/* Circles the shape of people while a partial prime waits on the
                roster, rather than a blank gap that reads as "nobody". */}
            {!rosterKnown && attendance.length === 0
              ? SKELETON_FACES.map(key => (
                <View key={key} style={styles.face} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  <View style={[styles.faceRing, styles.skeletonRing]} />
                  <View style={styles.skeletonName} />
                </View>
              ))
              : null}
            {shownAttendance.map(person => {
              const organizer = person.user_id === walk?.organizer_id;
              const isMe = person.user_id === user?.id;
              const ownerName = firstName(person.person?.full_name || person.person?.username);
              const dogNames = person.dogs?.map(dog => dog.name).join(' & ');
              const avatarDog = person.dogs?.[0] ?? { id: person.user_id, name: ownerName, image_url: person.person?.avatar_url ?? null };
              const badge = rosterBadge({ status: person.status, isOrganizer: organizer, isMe, walkState: walk?.state });
              return (
                <View
                  key={person.user_id}
                  style={styles.face}
                  accessible
                  accessibilityLabel={`${isMe ? 'You' : ownerName}${dogNames ? ` and ${dogNames}` : ''}, ${statusCopy(person, organizer)}`}
                >
                  <View style={[styles.faceRing, RING_STYLE[badge.ring]]}>
                    <DogAvatar dog={avatarDog} size={FACE - 6} />
                  </View>
                  <Text style={[styles.faceName, badge.ring === 'cant' && styles.faceFaded, badge.ring === 'asked' && styles.faceMuted]} numberOfLines={1}>
                    {isMe ? 'You' : ownerName}
                  </Text>
                  <Text style={[styles.faceLabel, LABEL_STYLE[badge.ring]]} numberOfLines={1}>{badge.label}</Text>
                </View>
              );
            })}
          </View>

          {notAsked.length ? (
            <View style={styles.notAskedBlock}>
              <Text style={styles.notAskedTitle}>Also in the pack · not asked to this one</Text>
              {shownNotAsked.map(person => {
                const ownerName = firstName(person.person?.full_name || person.person?.username);
                const dogNames = person.dogs?.map(dog => dog.name).join(' & ');
                const avatarDog = person.dogs?.[0] ?? { id: person.user_id, name: ownerName, image_url: person.person?.avatar_url ?? null };
                const isMe = person.user_id === user?.id;
                return (
                  <View key={person.user_id} style={styles.notAskedRow}>
                    <View style={styles.notAskedAvatar}>
                      <DogAvatar dog={avatarDog} size={36} />
                    </View>
                    <Text style={styles.notAskedName} numberOfLines={1}>
                      {isMe ? 'You' : dogNames ? `${ownerName} & ${dogNames}` : ownerName}
                    </Text>
                    {/* Nobody asked them, and they can still come — being in the
                        pack is the permission (their answer is the footer below).
                        The host gets the other half: asking them from here. */}
                    {!isMe && isOrganizer && walk?.state === 'planned' ? (
                      <Pressable
                        onPress={() => void invite(person.user_id)}
                        disabled={inviting !== null}
                        style={({ pressed }) => [
                          styles.notAskedInvite,
                          (pressed || inviting === person.user_id) && styles.pressed,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={`Ask ${ownerName} to this walk`}
                      >
                        <Ionicons name="add" size={15} color={color.navy} />
                        <Text style={styles.notAskedInviteText}>
                          {inviting === person.user_id ? 'Asking…' : 'Invite'}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : null}

          {meeting && walk?.state !== 'completed' && walk?.state !== 'cancelled' ? (
            <Pressable
              onPress={openDirections}
              style={({ pressed }) => [styles.mapCard, pressed && styles.pressed]}
              accessibilityRole="link"
              accessibilityLabel={`${distanceTitle}. ${distanceDetail}. Opens directions.`}
            >
              <View style={styles.mapThumb}>
                <Svg width={92} height={72} viewBox="0 0 92 72">
                  <Rect width={92} height={72} fill={color.pass.mapGround} />
                  <Path d="M0 52 C 16 48, 28 58, 46 55 S 76 46, 92 50 L92 72 L0 72 Z" fill={color.pass.mapWater} />
                  <Path d="M-4 30 H 96" stroke={color.surface} strokeWidth={5} strokeLinecap="round" />
                  <Path d="M58 -4 V 76" stroke={color.surface} strokeWidth={5} strokeLinecap="round" />
                  <Circle cx={44} cy={28} r={9} fill={color.yellow} stroke={color.navy} strokeWidth={3} />
                </Svg>
              </View>
              <View style={styles.mapCopy}>
                <Text style={styles.mapTitle} numberOfLines={1}>{distanceTitle}</Text>
                <Text style={styles.mapDetail} numberOfLines={1}>{distanceDetail}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={color.pass.faint} />
            </Pressable>
          ) : null}

          {myDogs.length > 1 && walk?.state !== 'completed' ? (
            <View style={styles.dogPicker}>
              <Text style={styles.dogPickerLabel}>Walking with</Text>
              <View style={styles.dogChoices}>
                {myDogs.map(dog => {
                  const selected = selectedDogIds.includes(dog.id);
                  return (
                    <Pressable
                      key={dog.id}
                      onPress={() => setSelectedDogIds(current => selected
                        ? dog.id === activePet?.id ? current : current.filter(id => id !== dog.id)
                        : [...current, dog.id])}
                      style={[styles.dogChoice, selected && styles.dogChoiceSelected]}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                    >
                      <DogAvatar dog={dog} size={30} />
                      <Text style={styles.dogChoiceText}>{dog.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}
          {/* A refresh that failed while the walk is on screen: said quietly,
              because nothing is lost and the screen is already trying again. */}
          {!error && walk && loadIssueLine ? <Text style={styles.staleNote}>{loadIssueLine}</Text> : null}
          </>
        )}
      </ScrollView>

      {/* ── The footer ────────────────────────────────────────────────────
          Pinned, because the one thing this screen asks of you should never
          scroll away. Waiting on the host is not an action, so it is a quiet
          line above the answer, not a greyed-out button. */}
      {!unavailable && walk ? (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space.lg) + 6 }]}>
          {waiting ? (
            <View style={styles.waitingNote}>
              <Ionicons name="time-outline" size={14} color={color.pass.muted} />
              <Text style={styles.waitingText}>{waitingLine}</Text>
            </View>
          ) : null}
          {canAnswer ? (
            <>
              <Text style={styles.answerPrompt}>{answerPrompt}</Text>
              <View style={styles.answerRow}>
                <Pressable
                  onPress={() => void respond('coming')}
                  disabled={busy}
                  style={({ pressed }) => [styles.comingButton, pressed && styles.pressed, busy && styles.disabled]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: myStatus === 'coming', disabled: busy }}
                >
                  {myStatus === 'coming' ? <Ionicons name="checkmark" size={18} color={color.navy} /> : null}
                  <Text style={styles.comingText}>{myStatus === 'coming' ? 'You’re coming' : 'Coming'}</Text>
                </Pressable>
                <Pressable
                  onPress={() => void respond('cant_make_it')}
                  disabled={busy}
                  style={({ pressed }) => [
                    styles.cantButton,
                    myStatus === 'cant_make_it' && styles.cantButtonSelected,
                    pressed && styles.pressed,
                    busy && styles.disabled,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: myStatus === 'cant_make_it', disabled: busy }}
                >
                  <Text style={styles.cantText}>Can’t make it</Text>
                </Pressable>
              </View>
            </>
          ) : !waiting && walk.state !== 'cancelled' ? (
            <Pressable
              onPress={openPrimaryAction}
              disabled={primaryDisabled}
              style={({ pressed }) => [styles.primaryAction, primaryDisabled && styles.disabled, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityState={{ disabled: primaryDisabled }}
            >
              <Text style={styles.primaryActionText}>{primaryLabel}</Text>
            </Pressable>
          ) : walk.state === 'cancelled' ? (
            <Text style={styles.cancelledText}>{primaryLabel}</Text>
          ) : null}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

/** The faces' outer size; the avatar sits inside a 3 pt ring. */
const FACE = 54;
const SKELETON_FACES = ['a', 'b', 'c'] as const;

const RING_STYLE: Record<RosterRing, object> = {
  host: { borderColor: color.navy },
  decide: { borderColor: color.electric, borderStyle: 'dashed' },
  coming: { borderColor: color.yellow },
  walking: { borderColor: color.yellow },
  finished: { borderColor: color.pass.hairline },
  asked: { borderColor: color.pass.ringAsked, borderStyle: 'dashed' },
  cant: { borderColor: color.pass.hairline, opacity: 0.55 },
};

const LABEL_STYLE: Record<RosterRing, object> = {
  host: { color: color.navy },
  decide: { color: color.electric },
  coming: { color: color.pass.muted },
  walking: { color: color.navy },
  finished: { color: color.pass.muted },
  asked: { color: color.pass.muted },
  cant: { color: color.pass.faint },
};

/** Where the perforation sits: its notches overhang the pass by half their size. */
const NOTCH = 22;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.pass.paper },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingTop: space.lg },
  headerButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.pass.hairline,
    backgroundColor: color.pass.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerButtonSpacer: { width: 44, height: 44 },
  scroll: { paddingBottom: space.xxl },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.45 },

  // ── The pass ──
  pass: { marginTop: space.lg, marginHorizontal: space.lg, backgroundColor: color.navy, borderRadius: 26 },
  passTop: { paddingTop: 22, paddingHorizontal: 22, paddingBottom: 20 },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: color.yellow },
  passEyebrow: { fontFamily: font.bold, fontSize: 10, letterSpacing: 1.6, color: color.yellow },
  passTitle: { fontFamily: font.bold, fontSize: 27, lineHeight: 33, letterSpacing: -0.7, color: color.pass.paper },
  passHost: { fontFamily: font.regular, fontSize: 12.5, lineHeight: 17, color: color.pass.onNavyMuted, marginTop: 4 },
  timeRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, marginTop: 18 },
  timeBig: { fontFamily: font.bold, fontSize: 46, lineHeight: 50, letterSpacing: -1.4, color: color.pass.paper, fontVariant: ['tabular-nums'] },
  timePeriod: { fontFamily: font.bold, fontSize: 16, color: color.pass.onNavyMuted },
  passDate: { fontFamily: font.bold, fontSize: 10.5, letterSpacing: 1.7, color: color.yellow, marginTop: space.sm },

  // A dashed line on one side only does not render on iOS, so the line is a
  // fully dashed box inside a clip one stroke tall.
  perforation: { height: 2, justifyContent: 'center' },
  perforationClip: { marginHorizontal: space.lg, height: 1.5, overflow: 'hidden' },
  perforationLine: { height: 4, borderWidth: 1.5, borderStyle: 'dashed', borderColor: color.pass.perforation, borderRadius: 1 },
  notch: { position: 'absolute', top: 1 - NOTCH / 2, width: NOTCH, height: NOTCH, borderRadius: NOTCH / 2, backgroundColor: color.pass.paper },
  notchLeft: { left: -NOTCH / 2 },
  notchRight: { right: -NOTCH / 2 },

  meetRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 18, paddingHorizontal: 22 },
  meetMark: { width: 48, height: 48, borderRadius: 15, backgroundColor: color.yellow, alignItems: 'center', justifyContent: 'center' },
  meetCopy: { flex: 1, minWidth: 0, gap: 2 },
  meetEyebrow: { fontFamily: font.bold, fontSize: 9.5, letterSpacing: 1.3, color: color.pass.onNavyFaint },
  meetName: { fontFamily: font.bold, fontSize: 17, lineHeight: 22, letterSpacing: -0.3, color: color.pass.paper },
  meetNote: { fontFamily: font.regular, fontSize: 11.5, lineHeight: 16, color: color.pass.onNavyMuted },
  directions: {
    height: 44,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.pass.outlineOnNavy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  directionsText: { fontFamily: font.semibold, fontSize: 12.5, color: color.pass.paper },

  // ── Who is walking ──
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingTop: 22,
  },
  sectionTitle: { fontFamily: font.bold, fontSize: 17, lineHeight: 22, letterSpacing: -0.3, color: color.navy },
  comingCount: { fontFamily: font.regular, fontSize: 12.5, color: color.pass.muted },
  faces: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, paddingTop: 14, rowGap: space.lg },
  face: { width: '20%', alignItems: 'center', gap: 6 },
  faceRing: {
    width: FACE,
    height: FACE,
    borderRadius: FACE / 2,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.pass.avatarGround,
  },
  faceName: { fontFamily: font.semibold, fontSize: 11.5, color: color.navy, maxWidth: '100%' },
  faceMuted: { color: color.pass.muted },
  faceFaded: { color: color.pass.faint },
  faceLabel: { fontFamily: font.bold, fontSize: 8.5, letterSpacing: 0.9 },
  skeletonRing: { borderColor: color.pass.hairline },
  skeletonName: { width: 34, height: 9, borderRadius: 5, backgroundColor: color.pass.hairline },

  notAskedBlock: { marginTop: space.xl, paddingHorizontal: space.xl },
  notAskedTitle: { ...type.caption, fontSize: 10.5, color: color.pass.faint, marginBottom: space.sm },
  notAskedRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 },
  notAskedAvatar: { opacity: 0.5 },
  notAskedName: { ...type.body, fontSize: 13, color: color.pass.muted, flex: 1 },
  notAskedInvite: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: color.yellow,
  },
  notAskedInviteText: { ...type.label, fontSize: 12, color: color.navy },

  // ── The meeting point, from here ──
  mapCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: space.xl,
    marginHorizontal: space.lg,
    padding: space.md,
    borderWidth: 1,
    borderColor: color.pass.hairline,
    borderRadius: radius.xl,
    backgroundColor: color.pass.paper,
  },
  mapThumb: { width: 92, height: 72, borderRadius: 14, overflow: 'hidden' },
  mapCopy: { flex: 1, minWidth: 0, gap: 3 },
  mapTitle: { fontFamily: font.bold, fontSize: 14.5, letterSpacing: -0.2, color: color.navy },
  mapDetail: { fontFamily: font.regular, fontSize: 11.5, color: color.pass.muted },

  dogPicker: { marginTop: space.xl, paddingHorizontal: space.xl },
  dogPickerLabel: { ...type.caption, color: color.pass.muted, marginBottom: space.sm },
  dogChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  dogChoice: {
    minHeight: 46,
    paddingHorizontal: space.sm,
    paddingRight: space.md,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderColor: color.pass.hairline,
  },
  dogChoiceSelected: { backgroundColor: color.electricSoft, borderColor: color.electric },
  dogChoiceText: { ...type.label, color: color.navy },
  error: { ...type.bodyMedium, color: color.error, marginTop: space.md, paddingHorizontal: space.xl },
  staleNote: { ...type.body, fontSize: 12.5, color: color.pass.muted, marginTop: space.md, paddingHorizontal: space.xl },
  unavailable: { marginTop: space.xxl, paddingHorizontal: space.xl },

  // ── The footer ──
  footer: {
    borderTopWidth: 1,
    borderTopColor: color.pass.hairline,
    backgroundColor: color.pass.paper,
    paddingTop: 14,
    paddingHorizontal: space.lg,
    gap: 10,
  },
  waitingNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingBottom: 4 },
  waitingText: { fontFamily: font.regular, fontSize: 11.5, color: color.pass.muted },
  answerPrompt: { fontFamily: font.semibold, fontSize: 13, color: color.pass.muted },
  answerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  comingButton: {
    flex: 1,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: color.yellow,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  comingText: { fontFamily: font.bold, fontSize: 16, letterSpacing: -0.2, color: color.navy },
  cantButton: {
    width: 126,
    height: 56,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: color.pass.hairlineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cantButtonSelected: { backgroundColor: color.pass.avatarGround, borderColor: color.pass.faint },
  cantText: { fontFamily: font.semibold, fontSize: 14, color: color.navy },
  primaryAction: {
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionText: { fontFamily: font.bold, fontSize: 16, letterSpacing: -0.2, color: color.navy },
  cancelledText: { fontFamily: font.semibold, fontSize: 13, color: color.pass.muted, textAlign: 'center', paddingVertical: space.md },
});
