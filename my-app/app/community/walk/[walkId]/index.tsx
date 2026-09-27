import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import {
  CommunityDogsOnly,
  DogAvatar,
  communityScreenStyles,
} from '../../../../components/community/CommunityUI';
import { color, font, makeShadow, radius, space, type } from '../../../../constants/design';
import { useWalkEnabled } from '../../../../hooks/useWalkEnabled';
import { TOGETHER_READ_TIMEOUT_MS, cacheKey, readSnapshot } from '../../../../lib/communityCache';
import { timed } from '../../../../lib/community/perf';
import { withTimeout } from '../../../../lib/withTimeout';
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

type DateDetails = {
  /** The chip's two lines. Month above, day below. */
  month: string;
  day: string;
  /** The sentence beside the chip. Never repeats what the chip already says. */
  when: string;
};

/**
 * `known` is whether the walk itself has arrived. Without it every placeholder
 * on this screen made a claim: a walk that had not loaded yet rendered exactly
 * like a walk whose host had genuinely not picked a date, down to the em dash.
 *
 * The split between the chip and the sentence is deliberate. The card used to
 * show "THU 24" in the chip and "Thursday, 24 Sep" beside it — the same fact,
 * twice, a centimetre apart. The chip now carries the month and the date, the
 * line carries the weekday and the time, and between them they say it once.
 */
function dateDetails(value: string | null, known = true): DateDetails {
  if (!known) return { month: '', day: '', when: '' };
  const undated = { month: 'TBC', day: '—', when: 'Date to be confirmed' };
  if (!value) return undated;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undated;
  return {
    month: dateFormat({ month: 'short' }).format(date).toUpperCase(),
    day: dateFormat({ day: 'numeric' }).format(date),
    when: `${dateFormat({ weekday: 'long' }).format(date)}, ${
      dateFormat({ hour: 'numeric', minute: '2-digit' }).format(date)
    }`,
  };
}

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
  const [myDogs, setMyDogs] = useState<CommunityDog[]>([]);
  const [selectedDogIds, setSelectedDogIds] = useState<string[]>([]);
  /** Whether the roster is still unknown — a primed plan does not answer it. */
  const [loading, setLoading] = useState(!cached || !!cached.partial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The Play-policy disclosure stands between joining and tracking. */
  const [pendingStart, setPendingStart] = useState(false);

  const load = useCallback(async () => {
    if (!walkId) return;
    setError(null);
    try {
      // Bounded so `loading` always resolves and the button can never sit on a
      // request that will not answer. The catch below keeps the painted snapshot.
      const [outing, dogs] = await withTimeout(
        timed('loadOuting+dogs', 1, () => Promise.all([loadOuting(walkId), listMyDogs()])),
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This walk could not load.');
    } finally {
      setLoading(false);
    }
  }, [activePet, walkId]);

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
    void load();
  }, [load, walkEnabled]));

  const mine = attendance.find(row => row.user_id === user?.id);
  // The trail's host, not this walk's organiser. Starting, editing and
  // inviting all belong to them now — see isTrailHost.
  const isOrganizer = isTrailHost(pack, user?.id);
  const date = useMemo(() => dateDetails(walk?.scheduled_for ?? null, !!walk), [walk]);
  /** Only shown when the host actually named this walk something of its own. */
  const named = distinctTitle(walk?.title, pack?.name);
  const comingCount = attendance.filter(row => ['coming', 'checked_in', 'walking', 'finished'].includes(row.status)).length;

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
      void load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'They could not be invited.');
      void load();
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
      await setAttendance(walkId, status);
      void load();
    } catch (cause) {
      setAttendanceRows(previous);
      setNotAsked(previousNotAsked);
      setError(cause instanceof Error ? cause.message : 'Your response could not be saved.');
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
      await joinOuting(walkId, selectedDogIds, shareLocation, { start: startSharedOuting });

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
      setError(cause instanceof Error ? cause.message : 'The walk could not start.');
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
      return;
    }
    if (result === 'services_off') {
      setError('Location services are turned off on this phone.');
      setBusy(false);
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
    return error ? 'This walk could not open' : 'Opening this walk…';
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
    || (walk.state === 'planned' && !isOrganizer);

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
        <Pressable onPress={() => router.back()} style={styles.headerButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={22} color={color.navy} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {pack?.name ?? ''}
        </Text>
        {isOrganizer && walk?.state === 'planned' ? (
          <Pressable
            onPress={() => router.push(`/community/${walk.pack_id}/plan?walkId=${walk.id}` as never)}
            style={styles.headerButton}
            accessibilityRole="button"
            accessibilityLabel="Edit this walk"
          >
            <Ionicons name="ellipsis-horizontal" size={21} color={color.navy} />
          </Pressable>
        ) : <View style={styles.headerButtonSpacer} />}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── One card, one grid ──────────────────────────────────────────
            Two facts, said the same way twice over: a 52pt block, a 14pt gap,
            then an eyebrow above a value. Both rows share that lead width and
            that gap, which is the whole repair — they used to be 54+20 and
            40+16, so the two text columns began eighteen points apart and the
            card read as though it had been assembled by two people. */}
        <View style={styles.planCard}>
          {named ? <Text style={styles.planName} numberOfLines={2}>{named}</Text> : null}

          <View style={styles.planRow}>
            <View style={styles.dateChip}>
              <Text style={styles.dateMonth}>{date.month}</Text>
              <Text style={styles.dateDay}>{date.day}</Text>
            </View>
            <View style={styles.planCell}>
              <View style={styles.eyebrowRow}>
                {walk?.state === 'active' ? <View style={styles.liveDot} /> : null}
                <Text style={[styles.cellEyebrow, walk?.state === 'active' && styles.cellEyebrowLive]}>
                  {walk?.state === 'active' ? 'WALKING NOW' : 'WHEN'}
                </Text>
              </View>
              <Text style={styles.cellValue} numberOfLines={2}>
                {walk ? date.when : ''}
              </Text>
            </View>
          </View>

          <View style={styles.planRule} />

          <View style={styles.planRow}>
            <View style={styles.locationMark}>
              <Ionicons name="location" size={20} color={color.navy} />
            </View>
            <View style={styles.planCell}>
              <Text style={styles.cellEyebrow}>MEETING POINT</Text>
              <Text style={styles.cellValue} numberOfLines={2}>
                {walk ? walk.meeting_label || 'To be confirmed' : ''}
              </Text>
            </View>
          </View>

          {/* Full width, under both rows. A sentence indented into a column two
              thirds of the card wide wraps into a ribbon. */}
          {walk?.note ? <Text style={styles.planNote}>{walk.note}</Text> : null}
        </View>

        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>Who’s walking</Text>
          <Text style={styles.comingCount}>
            {loading && attendance.length === 0 ? ' ' : `${comingCount} of ${attendance.length} coming`}
          </Text>
        </View>

        <View style={styles.roster}>
          {attendance.map(person => {
            const organizer = person.user_id === walk?.organizer_id;
            const isMe = person.user_id === user?.id;
            const ownerName = firstName(person.person?.full_name || person.person?.username);
            const dogNames = person.dogs?.map(dog => dog.name).join(' & ');
            const avatarDog = person.dogs?.[0] ?? { id: person.user_id, name: ownerName, image_url: person.person?.avatar_url ?? null };
            const answeredYes = ['coming', 'checked_in', 'walking', 'finished'].includes(person.status);
            return (
              <View key={person.user_id} style={styles.personRow}>
                <DogAvatar dog={avatarDog} size={48} />
                <View style={styles.personCopy}>
                  <Text style={styles.personName} numberOfLines={1}>{dogNames ? `${ownerName} & ${dogNames}` : ownerName}</Text>
                  {/* Suppressed where a button beside it already says the same
                      word: my own answered row showed "Coming" in grey text
                      next to a yellow chip reading "Coming". */}
                  {walk?.state === 'planned' && isMe && !organizer && person.status !== 'invited'
                    ? null
                    : <Text style={styles.personStatus}>{statusCopy(person, organizer)}</Text>}
                </View>

                {/* One fixed-width column for whatever ends the row. Without
                    it a Host pill, two answer buttons and a bare tick each set
                    their own right edge, and four rows stack into a ragged
                    margin that reads as a layout bug. */}
                <View style={styles.rowAction}>
                  {walk?.state === 'planned' && isMe && !organizer ? (
                    <View style={styles.responseGroup}>
                      <Pressable
                        onPress={() => void respond('coming')}
                        disabled={busy}
                        style={[styles.responseButton, person.status === 'coming' && styles.responseButtonSelected]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: person.status === 'coming' }}
                      >
                        <Text style={[styles.responseButtonText, person.status === 'coming' && styles.responseTextSelected]}>
                          Coming
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => void respond('cant_make_it')}
                        disabled={busy}
                        style={[styles.responseButton, person.status === 'cant_make_it' && styles.responseButtonMutedSelected]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: person.status === 'cant_make_it' }}
                      >
                        <Text style={styles.responseMutedText}>Can’t</Text>
                      </Pressable>
                    </View>
                  ) : organizer ? (
                    <View style={styles.hostBadge}><Text style={styles.hostBadgeText}>HOST</Text></View>
                  ) : answeredYes ? (
                    <Ionicons name="checkmark-circle" size={23} color={color.success} />
                  ) : person.status === 'cant_make_it' ? (
                    <Ionicons name="close-circle" size={23} color={color.slateFaint} />
                  ) : (
                    <Ionicons name="time-outline" size={21} color={color.slateFaint} />
                  )}
                </View>
              </View>
            );
          })}
        </View>

        {notAsked.length ? (
          <View style={styles.notAskedBlock}>
            <Text style={styles.notAskedTitle}>
              Also in the pack · not asked to this one
            </Text>
            {notAsked.map(person => {
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
                    {dogNames ? `${ownerName} & ${dogNames}` : ownerName}
                  </Text>
                  {/* Nobody asked them, and they can still come — being in the
                      pack is the permission. The host gets the other half of
                      that: asking them without leaving this screen. */}
                  {/* The same fixed column as the roster above, so both lists
                      share one right margin instead of two. */}
                  <View style={styles.rowAction}>
                    {isMe && walk?.state === 'planned' ? (
                      <Pressable
                        onPress={() => void respond('coming')}
                        disabled={busy}
                        style={styles.notAskedJoin}
                        accessibilityRole="button"
                        accessibilityLabel="Come to this walk anyway"
                      >
                        <Text style={styles.notAskedJoinText}>I’ll come</Text>
                      </Pressable>
                    ) : isOrganizer && walk?.state === 'planned' ? (
                      <Pressable
                        onPress={() => void invite(person.user_id)}
                        disabled={inviting !== null}
                        style={({ pressed }) => [
                          styles.notAskedInvite,
                          (pressed || inviting === person.user_id) && styles.notAskedInvitePressed,
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
                </View>
              );
            })}
          </View>
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

        {/* Waiting is not an action, so it does not get an action's shape.
            A full-width slab in the brand's loudest colour, greyed out and
            reading "Waiting for organiser", made the most prominent object on
            the screen the one telling you there is nothing to do. */}
        {waiting ? (
          <View style={styles.waitingNote}>
            <Ionicons name="time-outline" size={16} color={color.slateMuted} />
            <Text style={styles.waitingText}>{primaryLabel}</Text>
          </View>
        ) : (
          <Pressable
            onPress={openPrimaryAction}
            disabled={primaryDisabled}
            style={({ pressed }) => [
              styles.primaryAction,
              primaryDisabled && styles.primaryActionDisabled,
              pressed && styles.primaryActionPressed,
            ]}
            accessibilityRole="button"
            accessibilityState={{ disabled: primaryDisabled }}
          >
            <Text style={styles.primaryActionText}>{primaryLabel}</Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * The plan card's grid, as three numbers rather than six scattered ones.
 *
 * Every leading block is CARD_LEAD wide and every row uses CARD_GAP, so the
 * eyebrows and values in both rows begin on the same vertical line. Named
 * because the previous version set these per row and they drifted apart.
 */
const CARD_PAD = 20;
const CARD_LEAD = 52;
const CARD_GAP = 14;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FBFAF7' },
  flex: { flex: 1 },
  header: { minHeight: 72, paddingHorizontal: space.xl, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerButton: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface },
  headerButtonSpacer: { width: 46, height: 46 },
  headerTitle: { flex: 1, paddingHorizontal: space.sm, fontFamily: font.bold, fontSize: 21, lineHeight: 26, letterSpacing: -0.5, color: color.navy, textAlign: 'center' },
  scroll: { paddingHorizontal: space.xl, paddingBottom: 80 },
  planCard: {
    marginTop: space.sm,
    backgroundColor: color.navy,
    borderRadius: radius.xxl,
    padding: CARD_PAD,
    ...makeShadow(7, 22, 0.12),
  },
  planName: {
    fontFamily: font.bold,
    fontSize: 18,
    lineHeight: 23,
    letterSpacing: -0.3,
    color: color.surface,
    marginBottom: space.lg,
  },
  /**
   * The grid. Both rows use this and nothing else sets its own lead width.
   * `flex-start` because a cell can wrap to two lines and the block beside it
   * cannot — centring made the chip drift down the card as the place name got
   * longer.
   */
  planRow: { flexDirection: 'row', alignItems: 'flex-start', gap: CARD_GAP },
  planCell: { flex: 1, minWidth: 0, paddingTop: 2 },

  dateChip: {
    width: CARD_LEAD,
    height: CARD_LEAD,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateMonth: { fontFamily: font.bold, fontSize: 9.5, letterSpacing: 1, color: color.creamDim },
  dateDay: { fontFamily: font.bold, fontSize: 21, lineHeight: 25, color: color.yellow },

  locationMark: {
    width: CARD_LEAD,
    height: CARD_LEAD,
    borderRadius: radius.md,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },

  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 13 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: color.yellow },
  cellEyebrow: { fontFamily: font.bold, fontSize: 9.5, letterSpacing: 1.1, color: 'rgba(255,255,255,0.45)' },
  cellEyebrowLive: { color: color.yellow },
  cellValue: {
    fontFamily: font.bold,
    fontSize: 15.5,
    lineHeight: 21,
    letterSpacing: -0.2,
    color: color.surface,
    marginTop: 3,
  },

  // Indented to the text column, so the rule starts where the reading starts
  // rather than cutting under the chips.
  planRule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginVertical: space.lg,
    marginLeft: CARD_LEAD + CARD_GAP,
  },
  planNote: {
    fontFamily: font.medium,
    fontSize: 12.5,
    lineHeight: 18,
    color: 'rgba(255,255,255,0.62)',
    marginTop: space.lg,
    marginLeft: CARD_LEAD + CARD_GAP,
  },

  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.md,
    marginTop: space.xxl,
    marginBottom: space.sm,
  },
  sectionTitle: { ...type.heading, color: color.navy, fontSize: 19 },
  comingCount: { ...type.caption, fontSize: 10.5, letterSpacing: 0.6, color: color.slateFaint },
  notAskedBlock: { marginTop: space.lg },
  notAskedTitle: { ...type.caption, fontSize: 10.5, color: color.slateFaint, marginBottom: space.sm },
  notAskedRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 },
  notAskedAvatar: { opacity: 0.5 },
  notAskedName: { ...type.body, fontSize: 13, color: color.slateMuted, flex: 1 },
  notAskedJoin: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notAskedJoinText: { ...type.label, fontSize: 12, color: color.navy },
  notAskedInvite: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: color.yellow,
  },
  notAskedInvitePressed: { opacity: 0.85 },
  notAskedInviteText: { ...type.label, fontSize: 12, color: color.navy },
  roster: { gap: 2 },
  personRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: space.md },
  personCopy: { flex: 1, minWidth: 0 },
  /** The one column every row's trailing element lives in. */
  rowAction: { width: 112, alignItems: 'flex-end', justifyContent: 'center' },
  personName: { ...type.label, color: color.navy, fontSize: 13.5 },
  personStatus: { ...type.body, color: color.slateMuted, marginTop: 2 },
  // Bordered, because white-on-warm-paper is invisible — the old pill read as
  // a gap in the row rather than as a label.
  hostBadge: {
    minHeight: 26,
    justifyContent: 'center',
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.hairline,
    borderRadius: radius.pill,
    paddingHorizontal: 11,
  },
  hostBadgeText: { fontFamily: font.bold, fontSize: 9.5, letterSpacing: 0.8, color: color.slateMuted },
  responseGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  // Equal halves of the fixed column, so the pair reads as one control rather
  // than as two chips that happen to sit together.
  responseButton: {
    width: 53,
    minHeight: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.hairline,
  },
  responseButtonSelected: { backgroundColor: color.yellow, borderColor: color.yellow },
  responseButtonMutedSelected: { backgroundColor: color.surfaceSubtle, borderColor: color.slateFaint },
  responseButtonText: { fontFamily: font.bold, fontSize: 10.5, color: color.slateMuted },
  responseTextSelected: { color: color.navy },
  responseMutedText: { fontFamily: font.bold, fontSize: 10.5, color: color.slateMuted },
  dogPicker: { marginTop: space.xl },
  dogPickerLabel: { ...type.caption, color: color.slateMuted, marginBottom: space.sm },
  dogChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  dogChoice: { minHeight: 46, paddingHorizontal: space.sm, paddingRight: space.md, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: color.surface },
  dogChoiceSelected: { backgroundColor: color.electricSoft, borderWidth: 1, borderColor: color.electric },
  dogChoiceText: { ...type.label, color: color.navy },
  error: { ...type.bodyMedium, color: color.error, marginTop: space.md },
  primaryAction: {
    marginTop: space.lg,
    minHeight: 56,
    borderRadius: radius.lg,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionDisabled: { opacity: 0.45 },
  primaryActionPressed: { opacity: 0.88 },
  primaryActionText: { fontFamily: font.bold, fontSize: 14, color: color.navy },
  waitingNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    minHeight: 48,
    marginTop: space.lg,
  },
  waitingText: { ...type.label, fontSize: 12.5, color: color.slateMuted },
});
