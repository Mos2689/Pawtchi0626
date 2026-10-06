import React, { useCallback, useMemo, useState } from 'react';
import { describeError } from '../../../lib/appError';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import {
  CommunityButton,
  CommunityCard,
  DogAvatar,
  communityScreenStyles,
} from '../../../components/community/CommunityUI';
import { color, font, radius, space, type } from '../../../constants/design';
import { TOGETHER_READ_TIMEOUT_MS, cacheKey, readSnapshot } from '../../../lib/communityCache';
import { timed } from '../../../lib/community/perf';
import { prefetchOuting } from '../../../lib/community/outingPrefetch';
import { isPerfFlagOn } from '../../../lib/perfFlags';
import { withTimeout } from '../../../lib/withTimeout';
import {
  approveExternalInvite,
  listExternalInviteClaims,
  loadOuting,
  listPackWalkCards,
  loadPack,
  type CommunityDog,
  type CommunityPack,
  type CommunityWalk,
  type ExternalInviteClaim,
  type OutingSnapshot,
  type PackMember,
  type PackSnapshot,
  type PendingInvite,
} from '../../../lib/communityWalks';
import { useAuth } from '../../../providers/AuthProvider';
import { useAutoRetry } from '../../../hooks/useAutoRetry';
import { dateFormat } from '../../../lib/dateFormats';
import { requestedLine, requesterDogs, requesterName } from '../../../lib/community/joinRequest';
import { communityMediaUrls } from '../../../lib/communityMedia';
import type { WalkCard } from '../../../lib/community/walkCards';
import { WalkMemoryCard } from '../../../components/community/WalkMemoryCard';

export default function PackHomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { packId } = useLocalSearchParams<{ packId: string }>();
  /**
   * The last answer for this trail, read once, synchronously, before the first
   * frame is drawn. Not a fast path — the ONLY way this screen opens filled in,
   * because a `useEffect` that sets state cannot beat the paint it is racing.
   */
  const cached = React.useMemo(
    () => (packId ? readSnapshot<PackSnapshot>(cacheKey.pack(packId)) : null),
    [packId],
  );
  // No snapshot of this meetup yet (a cold start), but Connect's list — which
  // is how most people arrive — already holds its row: name, owner, dogs. Open
  // on that rather than on "Your meetup"; the full load replaces it.
  const [pack, setPack] = useState<CommunityPack | null>(
    () => cached?.pack
      ?? (packId ? readSnapshot<CommunityPack[]>(cacheKey.packs())?.find(item => item.id === packId) : undefined)
      ?? null,
  );
  const [members, setMembers] = useState<PackMember[]>(cached?.members ?? []);
  const [walks, setWalks] = useState<CommunityWalk[]>(cached?.walks ?? []);
  const [claims, setClaims] = useState<ExternalInviteClaim[]>([]);
  const [invited, setInvited] = useState<PendingInvite[]>(cached?.invited ?? []);
  const [respondingClaim, setRespondingClaim] = useState<string | null>(null);
  /** What each finished walk's card draws, by walk id — decoration, loaded behind the meetup. */
  const [walkCards, setWalkCards] = useState<Record<string, WalkCard>>({});
  /** Signed cover URLs, by storage path. */
  const [coverUrls, setCoverUrls] = useState<Record<string, string>>({});
  /**
   * Whether there is anything on screen worth believing. Not "is a request in
   * flight".
   *
   * It exists only to keep empty states quiet until there is something to be
   * empty about — "nothing planned yet" flashing before the walks arrive reads
   * as a bug. Refocusing never resets it, so coming back from a sub-screen
   * repaints the trail already filled in instead of wiping it to a spinner, and
   * a cached open starts true because the cache is a landed answer.
   */
  const [loaded, setLoaded] = useState(!!cached);
  /** An action that did not go through. */
  const [error, setError] = useState<string | null>(null);
  /**
   * The latest refresh failed and is being retried. Said quietly: whatever is
   * on screen stays, and the screen is already trying again.
   */
  const [loadIssue, setLoadIssue] = useState<string | null>(null);

  const load = useCallback(async (): Promise<boolean> => {
    if (!packId) return true;
    setError(null);
    try {
      /**
       * Whether to ask about claims at the same time as loading the trail,
       * rather than in a third round trip behind it.
       *
       * Ownership cannot change without an explicit transfer, so a cached
       * answer is as good as a fresh one for deciding whether to ASK — and if
       * the cache is wrong the RPC simply returns nothing. Guessing wrong costs
       * one pointless query; guessing nothing cost every host a serial hop.
       */
      const ownedByCache = readSnapshot<PackSnapshot>(cacheKey.pack(packId))?.pack.owner_id === user?.id;
      const claimsAhead = ownedByCache ? listExternalInviteClaims(packId).catch(() => []) : null;

      // Bounded so `loaded` always resolves: a stalled request would otherwise
      // leave this screen waiting forever. The catch below keeps what is painted.
      const data = await withTimeout(
        timed('loadPack', 2, () => loadPack(packId)),
        TOGETHER_READ_TIMEOUT_MS,
        'loadPack',
      );
      setPack(data.pack);
      setMembers(data.members);
      setWalks(data.walks);
      setInvited(data.invited);
      // The archive's pictures. Never awaited and never fatal: the cards draw
      // from the walks alone until this lands, and a failure keeps what was drawn.
      if (data.walks.some(walk => walk.state === 'completed')) {
        void listPackWalkCards(packId)
          .then(async found => {
            if (!found) return;
            setWalkCards(Object.fromEntries(found.map(card => [card.walkId, card])));
            const paths = found.flatMap(card => (card.coverPath ? [card.coverPath] : []));
            if (paths.length) setCoverUrls(await communityMediaUrls(paths));
          })
          .catch(() => {});
      }

      const isOwnerNow = data.pack.owner_id === user?.id;
      if (!isOwnerNow) {
        setClaims([]);
      } else {
        setClaims(await (claimsAhead ?? listExternalInviteClaims(packId)));
      }
      // Only a landed answer makes the screen "loaded". A failed first load
      // used to set it too, and the screen then announced "Nothing planned
      // yet" about a meetup it had simply failed to read.
      setLoaded(true);
      setLoadIssue(null);
      return true;
    } catch (cause) {
      setLoadIssue(describeError(cause, 'community_load'));
      return false;
    }
  }, [packId, user?.id]);

  /** `load`, retried on its own after a failure (hooks/useAutoRetry.ts). */
  const run = useAutoRetry(load);

  /** What just happened to a request, said once under the list. */
  const [claimNotice, setClaimNotice] = useState<string | null>(null);

  const respondToClaim = async (claim: ExternalInviteClaim, approve: boolean) => {
    setRespondingClaim(claim.invitation_id);
    setError(null);
    setClaimNotice(null);
    try {
      await approveExternalInvite(claim.invitation_id, approve);
      setClaimNotice(approve
        ? `${requesterName(claim)} is in. They’ll get a notification.`
        : 'Done. That invite link no longer works.');
      await run();
    } catch (cause) {
      setError(describeError(cause, 'community_action'));
    } finally {
      setRespondingClaim(null);
    }
  };

  /**
   * "Not them" cancels the link the person used, so it asks once. Confirming
   * does not: it is the expected answer, and the card already says what it
   * does.
   */
  const confirmNotThem = (claim: ExternalInviteClaim) => {
    Alert.alert(
      `Not ${requesterName(claim)}?`,
      'They won’t join, and the invite link they used stops working. You can send a new invite any time.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Not them', style: 'destructive', onPress: () => void respondToClaim(claim, false) },
      ],
    );
  };

  const isOwner = !!pack && pack.owner_id === user?.id;

  /**
   * Refetched on every focus, behind the snapshot.
   *
   * ── Why there is no freshness gate here ──────────────────────────────────
   *
   * There was one — skip the refetch if the trail was fetched in the last 20 s.
   * It saved one request on a bounce back from Invite, and bought no visible
   * speed at all: this screen already paints instantly from the snapshot, so a
   * refetch behind it is invisible either way.
   *
   * What it cost was an obligation on every mutation anywhere in the app: change
   * something this screen shows and you had better `invalidate()` its key, or
   * the next visit silently shows the old answer. That trap was hit four times
   * in one day across this screen and the walk screen. The gate was removed
   * rather than patched a fifth time.
   *
   * Home keeps its gate. Home is a genuine hot path — toggling the segment chips
   * fans out several requests — so the saving there is real.
   *
   * Not wrapped in `share()` either: `load` also runs straight after a write,
   * and sharing would hand that caller a request that started BEFORE the write.
   */
  useFocusEffect(useCallback(() => { void run(); }, [run]));

  /**
   * perf-walk-instant-open: ask for the walk as the finger lands, so the read
   * travels during the push transition rather than after it. The walk screen
   * claims it once (lib/community/outingPrefetch.ts); with the flag off this
   * does nothing and the walk screen asks on focus, as before.
   */
  const prefetchWalk = useCallback((walkId: string) => {
    if (isPerfFlagOn('walkInstantOpen')) prefetchOuting(walkId, loadOuting);
  }, []);

  /**
   * Everything still ahead of this trail, soonest first, undated last.
   *
   * This used to collapse to a single walk — `active ?? first planned` — which
   * meant a walk somebody had started made every walk anyone planned afterwards
   * invisible. Hosts planned walks, watched them vanish, and planned them
   * again: a trail here ended up with two live walks and two planned ones
   * stacked behind them, none of which the screen would admit to.
   *
   * An undated walk sorts last rather than first. It is a real plan, but it
   * cannot be the next one when a dated walk exists.
   */
  const upcoming = useMemo(() => {
    const ranked = walks.filter(walk => walk.state === 'active' || walk.state === 'planned');
    return ranked.sort((a, b) => {
      if (a.state !== b.state) return a.state === 'active' ? -1 : 1;
      if (!a.scheduled_for) return 1;
      if (!b.scheduled_for) return -1;
      return a.scheduled_for.localeCompare(b.scheduled_for);
    });
  }, [walks]);
  const nextWalk = upcoming[0];
  const laterWalks = upcoming.slice(1);
  const memories = walks.filter(walk => walk.state === 'completed');
  const allDogs = members.flatMap(member => member.dogs);

  // Editing the plan is the host's, like planning it was. `isOwner` above is
  // the same test; kept as its own name because this one also needs the walk
  // to still be editable.
  const canEditPlan = !!nextWalk && isOwner && nextWalk.state === 'planned';

  // ── What the redesign derives (design "Private meetup — the pack") ──────
  const { width: windowWidth } = useWindowDimensions();
  /** Three to a row inside the 16 pt page margins. */
  const tileWidth = Math.floor((windowWidth - space.lg * 2 - TILE_GAP * 2) / 3);
  /** Full width for one walk; otherwise three quarters, so the next one peeks. */
  const memoryCardWidth = memories.length > 1
    ? Math.round(windowWidth * 0.74)
    : windowWidth - space.lg * 2;
  /** Numbers are only said once there is an answer to say them about. */
  const known = loaded || allDogs.length > 0;
  const dogNames = allDogs.map(dog => dog.name);
  const heroBlurb = !known
    ? ' '
    : dogNames.length === 0
      ? 'A private pack. Only invited owners can see it.'
      : `A private pack for ${
        dogNames.length <= 3
          ? dogNames.length === 1 ? dogNames[0] : `${dogNames.slice(0, -1).join(', ')} and ${dogNames[dogNames.length - 1]}`
          : `${dogNames.slice(0, 2).join(', ')} and ${dogNames.length - 2} more`
      }. Only invited owners can see it.`;
  /**
   * Who is coming to the next walk, when this phone already knows: the pack
   * read primes each walk's roster (perf-walk-instant-open). Otherwise the
   * card says what it can — the pack's dogs and how many owners there are —
   * rather than guessing at answers it has not seen.
   */
  const nextOuting = useMemo(
    () => (nextWalk ? readSnapshot<OutingSnapshot>(cacheKey.outing(nextWalk.id)) : null),
    // `walks` because a reload re-primes the snapshot this reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nextWalk?.id, walks],
  );
  const coming = nextOuting && !nextOuting.partial
    ? nextOuting.attendance.filter(row => ['coming', 'checked_in', 'walking'].includes(row.status))
    : null;
  const nextFaces: CommunityDog[] = coming
    ? coming.map(row => row.dogs?.[0] ?? { id: row.user_id, name: row.person?.full_name ?? 'Friend', image_url: row.person?.avatar_url ?? null })
    : allDogs;
  const nextLine = !nextWalk
    ? ''
    : nextWalk.state === 'active'
      ? 'Walking now'
      : coming
        ? coming.length === 0
          ? 'No answers yet'
          : coming.length >= members.length
            ? members.length === 2 ? 'Both owners coming' : 'Everyone’s coming'
            : `${coming.length} of ${members.length} coming`
        : `${members.length} ${members.length === 1 ? 'owner' : 'owners'} in this meetup`;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      {/* Two circles and nothing between them: the meetup's name is the
          hero's job now, so the header does not say it twice. */}
      <View style={styles.navRow}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.circleAction, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={20} color={color.navy} />
        </Pressable>
        <Pressable
          onPress={() => router.push(`/community/${packId}/settings` as never)}
          style={({ pressed }) => [styles.circleAction, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Meetup options"
        >
          <Ionicons name="ellipsis-horizontal" size={19} color={color.navy} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {loadIssue && !error ? <Text style={styles.loadIssue}>{loadIssue}</Text> : null}

        {/* ── The meetup, as an object ──────────────────────────────────────
            Nothing here may claim "0 dogs" or "0 walks" before the meetup has
            loaded — on a cold start there is no snapshot, and a blank hero used
            to read as an empty meetup for a round trip. */}
        <View style={styles.hero}>
          <View style={styles.heroEyebrowRow}>
            <Ionicons name="lock-closed-outline" size={12} color={color.yellow} />
            <Text style={styles.heroEyebrow}>PRIVATE MEETUP</Text>
          </View>
          <Text style={styles.heroName} numberOfLines={2}>{pack?.name ?? 'Your meetup'}</Text>
          <Text style={styles.heroBlurb}>{heroBlurb}</Text>
          <View style={styles.stats}>
            <Stat value={known ? String(memories.length) : ' '} label="WALKS TOGETHER" first />
            <Stat value={known ? String(allDogs.length) : ' '} label={allDogs.length === 1 ? 'DOG' : 'DOGS'} />
            <Stat value={known ? String(members.length) : ' '} label={members.length === 1 ? 'OWNER' : 'OWNERS'} />
          </View>
        </View>

        {claims.length ? (
          <>
            <SectionHead title={claims.length === 1 ? 'Asking to join' : `Asking to join · ${claims.length}`} />
            {claims.map(claim => {
              const face = claim.dogs[0] ?? { id: claim.claimant_id, name: requesterName(claim), image_url: claim.avatar_url ?? null };
              const busyHere = respondingClaim === claim.invitation_id;
              return (
                <CommunityCard key={claim.invitation_id} style={styles.claimCard}>
                  <View style={styles.claimTop}>
                    <DogAvatar dog={face} size={52} />
                    <View style={styles.flex}>
                      <Text style={styles.claimName} numberOfLines={1}>{requesterName(claim)}</Text>
                      <Text style={styles.claimMeta} numberOfLines={1}>
                        {claim.username && claim.full_name?.trim() ? `@${claim.username} · ` : ''}{requesterDogs(claim)}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.claimContext}>
                    <Ionicons name="link-outline" size={15} color={color.electric} />
                    <Text style={styles.claimContextText}>{requestedLine(claim.claimed_at, Date.now())}</Text>
                  </View>
                  <Text style={styles.claimHelp}>
                    Confirm only if you know them. They’ll join this meetup and see its walks and photos.
                  </Text>
                  <View style={styles.claimActions}>
                    <CommunityButton
                      label={busyHere ? 'Confirming…' : 'Confirm'}
                      icon="checkmark"
                      variant="accent"
                      onPress={() => void respondToClaim(claim, true)}
                      disabled={busyHere}
                      style={styles.flex}
                    />
                    <CommunityButton label="Not them" variant="secondary" onPress={() => confirmNotThem(claim)} disabled={busyHere} style={styles.flex} />
                  </View>
                </CommunityCard>
              );
            })}
          </>
        ) : null}
        {claimNotice ? <Text style={styles.claimNotice}>{claimNotice}</Text> : null}

        <SectionHead
          title={laterWalks.length ? 'Upcoming walks' : 'Next walk'}
          actions={nextWalk && isOwner ? [{ label: 'Plan another', onPress: () => router.push(`/community/${packId}/plan` as never) }] : []}
        />

        {nextWalk ? (
          <>
            <View style={styles.walkCard}>
              <View style={styles.walkLine}>
                <DateChip iso={nextWalk.scheduled_for} live={nextWalk.state === 'active'} />
                <View style={styles.walkCopy}>
                  <Text style={styles.walkTitle} numberOfLines={1}>{nextWalk.title}</Text>
                  <Text style={styles.walkMeta} numberOfLines={1}>{whenLine(nextWalk.scheduled_for)}</Text>
                  {nextWalk.meeting_label ? <Text style={styles.walkMeta} numberOfLines={1}>{nextWalk.meeting_label}</Text> : null}
                </View>
                {/* Editing lives on the card it edits, rather than as a second
                    button competing with the yellow one below. */}
                {canEditPlan ? (
                  <Pressable
                    onPress={() => router.push(`/community/${packId}/plan?walkId=${nextWalk.id}` as never)}
                    style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel="Change the time, meeting point or note"
                  >
                    <Ionicons name="pencil-outline" size={17} color={color.navy} />
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.attendance}>
                <View style={styles.faceStack}>
                  {nextFaces.slice(0, 4).map((dog, index) => (
                    <View key={dog.id} style={[styles.miniFace, index > 0 && styles.miniFaceOverlap, { zIndex: 4 - index }]}>
                      <DogAvatar dog={dog} size={24} />
                    </View>
                  ))}
                </View>
                <Text style={styles.attendanceText} numberOfLines={1}>{nextLine}</Text>
              </View>
            </View>
            <Pressable
              onPressIn={() => prefetchWalk(nextWalk.id)}
              onPress={() => router.push(`/community/walk/${nextWalk.id}` as never)}
              style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.primaryText}>
                {nextWalk.state === 'active' ? 'Join the walk' : 'Open this walk'}
              </Text>
            </Pressable>
          </>
        ) : !loaded ? (
          <View style={styles.walkCard}><View style={styles.skeletonLine} /></View>
        ) : (
          <View style={styles.walkCard}>
            <Text style={styles.emptyWalkTitle}>Nothing planned yet</Text>
            {/* Two different sentences, because the reader's position is
                different. The host is being asked to do something; a member is
                being told why there is nothing here, which is not their doing
                and not theirs to fix. */}
            <Text style={styles.emptyWalkBody}>
              {isOwner
                ? 'Pick a time and a meeting point. Everyone can answer without starting location sharing.'
                : 'The host sets the walks in this meetup. You will be asked when there is one.'}
            </Text>
            {isOwner ? (
              <Pressable
                onPress={() => router.push(`/community/${packId}/plan` as never)}
                style={({ pressed }) => [styles.primary, styles.primaryInline, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                <Text style={styles.primaryText}>Plan the first walk</Text>
              </Pressable>
            ) : null}
          </View>
        )}

        {laterWalks.length ? (
          <View style={styles.laterList}>
            {laterWalks.map(walk => (
              <Pressable
                key={walk.id}
                onPressIn={() => prefetchWalk(walk.id)}
                onPress={() => router.push(`/community/walk/${walk.id}` as never)}
                style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`Open ${walk.title}`}
              >
                <DateChip iso={walk.scheduled_for} live={walk.state === 'active'} quiet={walk.state !== 'active'} />
                <View style={styles.flex}>
                  <Text style={styles.listTitle} numberOfLines={1}>{walk.title}</Text>
                  <Text style={styles.listMeta} numberOfLines={1}>
                    {whenLine(walk.scheduled_for)}{walk.meeting_label ? ` · ${walk.meeting_label}` : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={color.pass.faint} />
              </Pressable>
            ))}
          </View>
        ) : null}

        <SectionHead
          title="The pack"
          actions={isOwner ? [
            { label: 'Manage', onPress: () => router.push(`/community/${packId}/settings` as never), muted: true },
            { label: 'Invite', onPress: () => router.push(`/community/${packId}/invite` as never) },
          ] : []}
        />
        <View style={styles.packGrid}>
          {members.map(member => {
            const dog = member.dogs[0] ?? { id: member.user_id, name: member.person?.full_name ?? 'Friend', image_url: member.person?.avatar_url ?? null };
            const isMe = member.user_id === user?.id;
            const isHost = member.role === 'owner';
            const badge: TileBadge = isMe ? 'you' : isHost ? 'host' : 'member';
            return (
              <View key={member.user_id} style={[styles.tile, { width: tileWidth }]}>
                <View style={[styles.tileRing, isMe ? styles.ringYou : styles.ringMember]}>
                  <DogAvatar dog={dog} size={46} />
                </View>
                <Text style={styles.tileName} numberOfLines={1}>
                  {member.dogs.map(item => item.name).join(' & ') || firstNameOf(member.person?.full_name) || 'Friend'}
                </Text>
                <Text style={styles.tileHandle} numberOfLines={1}>
                  {member.person?.username ? `@${member.person.username}` : firstNameOf(member.person?.full_name) || ' '}
                </Text>
                <Badge kind={badge} />
              </View>
            );
          })}

          {invited.map(person => {
            const dog = person.dogs[0] ?? { id: person.id, name: person.full_name ?? 'Friend', image_url: person.avatar_url ?? null };
            const kind: TileBadge = person.state === 'declined' ? 'declined' : person.expired ? 'expired' : 'invited';
            return (
              <View key={person.invitation_id} style={[styles.tile, { width: tileWidth }]}>
                {/* Present rather than absent: the host asked for this person,
                    and a gap where they should be is what made an invitation
                    look like it had never sent. */}
                <View style={[styles.tileRing, kind === 'invited' ? styles.ringInvited : styles.ringLapsed]}>
                  <View style={kind === 'invited' ? null : styles.faded}>
                    <DogAvatar dog={dog} size={46} />
                  </View>
                </View>
                <Text style={styles.tileName} numberOfLines={1}>
                  {person.dogs.map(item => item.name).join(' & ') || firstNameOf(person.full_name) || 'Friend'}
                </Text>
                <Text style={styles.tileHandle} numberOfLines={1}>
                  {person.username ? `@${person.username}` : ' '}
                </Text>
                <Badge kind={kind} />
              </View>
            );
          })}
        </View>

        <SectionHead
          title="Our walks"
          actions={memories.length > 1 ? [{ label: `${memories.length} walks`, onPress: () => {}, muted: true, passive: true }] : []}
        />
        {memories.length ? (
          // A rail, like a listing page's: the next card peeks in from the edge
          // so it reads as "there is more". One walk simply fills the width.
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={memoryCardWidth + MEMORY_GAP}
            decelerationRate="fast"
            disableIntervalMomentum
            style={styles.memoryRail}
            contentContainerStyle={styles.memoryRailContent}
          >
            {memories.map(walk => {
              const card = walkCards[walk.id];
              return (
                <WalkMemoryCard
                  key={walk.id}
                  walk={walk}
                  card={card}
                  coverUrl={card?.coverPath ? coverUrls[card.coverPath] : undefined}
                  width={memoryCardWidth}
                  onOpen={() => router.push(`/community/walk/${walk.id}/memory` as never)}
                />
              );
            })}
          </ScrollView>
        ) : loaded ? (
          <View style={styles.archiveEmpty}>
            <Ionicons name="images-outline" size={18} color={color.pass.faint} />
            <Text style={styles.archiveEmptyText}>The first shared memory appears here after your walk — routes, photos and all.</Text>
          </View>
        ) : null}

        {error ? <Text style={communityScreenStyles.error}>{error}</Text> : null}

        <View style={styles.privacyNote}>
          <Ionicons name="lock-closed-outline" size={14} color={color.pass.muted} />
          <Text style={styles.privacyText}>Walks here stay between the pack. Nobody else can find this meetup.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function firstNameOf(value: string | null | undefined): string {
  return value?.trim().split(/\s+/)[0] ?? '';
}

/** "7 Oct at 9:14 AM" — the chip beside it already says the weekday. */
function whenLine(value: string | null): string {
  if (!value) return 'Date to be confirmed';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date to be confirmed';
  return `${dateFormat({ day: 'numeric', month: 'short' }).format(date)} at ${
    dateFormat({ hour: 'numeric', minute: '2-digit' }).format(date)
  }`;
}

/** One of the hero's three numbers, with a rule before every one but the first. */
function Stat({ value, label, first }: { value: string; label: string; first?: boolean }) {
  return (
    <View style={[styles.stat, !first && styles.statRuled]}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

type TileBadge = 'you' | 'host' | 'member' | 'invited' | 'declined' | 'expired';

const BADGE_TEXT: Record<TileBadge, string> = {
  you: 'YOU',
  host: 'HOST',
  member: 'MEMBER',
  invited: 'INVITED',
  declined: 'DECLINED',
  expired: 'EXPIRED',
};

function Badge({ kind }: { kind: TileBadge }) {
  return (
    <View style={[styles.badge, BADGE_BOX[kind]]}>
      <Text style={[styles.badgeText, BADGE_INK[kind]]}>{BADGE_TEXT[kind]}</Text>
    </View>
  );
}

/**
 * A section heading and the things you can do to that section.
 *
 * Sentence case at reading size rather than the tiny all-caps eyebrow used
 * elsewhere: these are headings on a page someone scrolls, not labels on a
 * dense form, and the trailing text actions keep each section to an obvious
 * next move.
 */
function SectionHead({
  title,
  actions = [],
}: {
  title: string;
  /** `passive`: a count, said where an action would be, not something to tap. */
  actions?: { label: string; onPress: () => void; muted?: boolean; passive?: boolean }[];
}) {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {actions.length ? (
        <View style={styles.sectionActions}>
          {actions.map(action => (action.passive ? (
            <Text key={action.label} style={[styles.sectionAction, styles.sectionActionMuted, styles.sectionCount]}>{action.label}</Text>
          ) : (
            <Pressable key={action.label} onPress={action.onPress} hitSlop={8} accessibilityRole="button">
              <Text style={[styles.sectionAction, action.muted && styles.sectionActionMuted]}>{action.label}</Text>
            </Pressable>
          )))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The date as an object you can point at.
 *
 * A walk with no agreed date still gets a chip — it says "TBC" — because the
 * alternative is a card that starts with a hole where every other card has its
 * anchor.
 */
function DateChip({ iso, live, quiet }: { iso?: string | null; live?: boolean; quiet?: boolean }) {
  const date = iso ? new Date(iso) : null;
  const valid = !!date && !Number.isNaN(date.getTime());
  return (
    <View style={[styles.dateChip, quiet && styles.dateChipQuiet]}>
      <Text style={[styles.dateChipTop, quiet && styles.dateChipTopQuiet, live && styles.dateChipTopLive]}>
        {live
          ? 'NOW'
          : valid
            ? dateFormat({ weekday: 'short' }).format(date).toUpperCase()
            : 'TBC'}
      </Text>
      <Text style={[styles.dateChipDay, quiet && styles.dateChipDayQuiet]}>
        {valid ? dateFormat({ day: 'numeric' }).format(date) : '—'}
      </Text>
    </View>
  );
}

/** Three tiles to a row, ten points apart. */
const TILE_GAP = 10;
/** Between memory cards in the rail. */
const MEMORY_GAP = 12;

const BADGE_BOX: Record<TileBadge, object> = {
  you: { backgroundColor: color.yellow, borderColor: color.yellow },
  host: { backgroundColor: color.navy, borderColor: color.navy },
  member: { borderColor: color.pass.hairlineStrong },
  invited: { borderColor: color.electric, borderStyle: 'dashed' },
  declined: { borderColor: color.pass.hairlineStrong },
  expired: { borderColor: color.pass.hairlineStrong },
};

const BADGE_INK: Record<TileBadge, object> = {
  you: { color: color.navy },
  host: { color: color.yellow },
  member: { color: color.pass.muted },
  invited: { color: color.electric },
  declined: { color: color.error },
  expired: { color: color.alertDeep },
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.pass.paper },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: space.lg, paddingBottom: space.xxxl },
  pressed: { opacity: 0.85 },

  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
  },
  circleAction: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.pass.hairline,
    backgroundColor: color.pass.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Hero ──
  hero: { marginTop: space.lg, borderRadius: 26, backgroundColor: color.navy, padding: 22 },
  heroEyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  heroEyebrow: { fontFamily: font.bold, fontSize: 10, letterSpacing: 1.6, color: color.yellow },
  heroName: { fontFamily: font.bold, fontSize: 31, lineHeight: 35, letterSpacing: -0.9, color: color.pass.paper, marginTop: space.sm },
  heroBlurb: { fontFamily: font.regular, fontSize: 13, lineHeight: 19, color: color.pass.onNavyMuted, marginTop: space.sm },
  stats: {
    flexDirection: 'row',
    marginTop: space.xl,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: color.hairlineOnNavy,
  },
  stat: { flex: 1, gap: 5 },
  statRuled: { paddingLeft: space.lg, borderLeftWidth: 1, borderLeftColor: color.hairlineOnNavy },
  statValue: { fontFamily: font.bold, fontSize: 22, lineHeight: 27, letterSpacing: -0.4, color: color.pass.paper, fontVariant: ['tabular-nums'] },
  statLabel: { fontFamily: font.bold, fontSize: 9, letterSpacing: 1.3, color: color.pass.onNavyFaint },

  // ── Sections ──
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.md,
    paddingHorizontal: space.xs,
    paddingTop: space.xxl,
    marginBottom: space.md,
  },
  sectionTitle: { fontFamily: font.bold, fontSize: 17, lineHeight: 22, letterSpacing: -0.3, color: color.navy },
  sectionActions: { flexDirection: 'row', alignItems: 'baseline', gap: space.lg },
  sectionAction: { fontFamily: font.semibold, fontSize: 13, color: color.electric },
  sectionActionMuted: { color: color.pass.muted },

  // ── Next walk ──
  walkCard: {
    padding: 14,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: color.pass.hairline,
    backgroundColor: color.pass.paper,
  },
  walkLine: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  walkCopy: { flex: 1, minWidth: 0, gap: 3 },
  walkTitle: { fontFamily: font.bold, fontSize: 16, letterSpacing: -0.3, color: color.navy },
  walkMeta: { fontFamily: font.regular, fontSize: 12, color: color.pass.muted },
  editButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.pass.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attendance: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: space.md,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: color.pass.hairline,
  },
  faceStack: { flexDirection: 'row', alignItems: 'center', minHeight: 28 },
  miniFace: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: color.yellow,
    backgroundColor: color.pass.avatarGround,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniFaceOverlap: { marginLeft: -9 },
  attendanceText: { fontFamily: font.regular, fontSize: 12, color: color.pass.muted, flexShrink: 1 },
  emptyWalkTitle: { fontFamily: font.bold, fontSize: 15, color: color.navy },
  emptyWalkBody: { ...type.body, fontSize: 12.5, lineHeight: 18, color: color.pass.muted, marginTop: 4 },

  dateChip: {
    width: 58,
    height: 58,
    borderRadius: 16,
    backgroundColor: color.navy,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  dateChipQuiet: { width: 48, height: 48, borderRadius: 14, backgroundColor: color.pass.avatarGround },
  dateChipTop: { fontFamily: font.bold, fontSize: 9, letterSpacing: 1.2, color: color.pass.onNavyFaint },
  dateChipTopQuiet: { color: color.pass.muted },
  dateChipTopLive: { color: color.yellow },
  dateChipDay: { fontFamily: font.bold, fontSize: 23, lineHeight: 27, color: color.yellow },
  dateChipDayQuiet: { fontSize: 18, lineHeight: 22, color: color.navy },

  primary: {
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  primaryInline: { alignSelf: 'stretch' },
  primaryText: { fontFamily: font.bold, fontSize: 16, letterSpacing: -0.2, color: color.navy },

  loadIssue: { ...type.body, fontSize: 12.5, color: color.pass.muted, textAlign: 'center', marginTop: space.md },
  /** A quiet placeholder the height of a line, not a spinner over the screen. */
  skeletonLine: { height: 14, borderRadius: 7, backgroundColor: color.pass.hairline, width: '62%' },

  laterList: { marginTop: space.md },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: color.pass.hairline,
  },
  listTitle: { fontFamily: font.semibold, fontSize: 13.5, color: color.navy },
  listMeta: { fontFamily: font.regular, fontSize: 11.5, color: color.pass.muted, marginTop: 2 },

  // ── The pack ──
  packGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: TILE_GAP },
  tile: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: color.pass.hairline,
    borderRadius: 18,
  },
  tileRing: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.pass.avatarGround,
    marginBottom: 2,
  },
  ringYou: { borderColor: color.yellow },
  ringMember: { borderColor: color.navy },
  ringInvited: { borderColor: color.electric, borderStyle: 'dashed' },
  ringLapsed: { borderColor: color.pass.hairline },
  faded: { opacity: 0.5 },
  tileName: { fontFamily: font.bold, fontSize: 13.5, color: color.navy, maxWidth: '100%' },
  tileHandle: { fontFamily: font.regular, fontSize: 10, color: color.pass.muted, maxWidth: '100%' },
  badge: { height: 20, paddingHorizontal: space.sm, borderRadius: 6, borderWidth: 1, justifyContent: 'center' },
  badgeText: { fontFamily: font.bold, fontSize: 8.5, letterSpacing: 1 },

  sectionCount: { fontFamily: font.regular },
  // Bleeds to the screen's edges so the cards scroll under the page margin.
  memoryRail: { marginHorizontal: -space.lg },
  memoryRailContent: { paddingHorizontal: space.lg, gap: MEMORY_GAP },
  archiveEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.pass.ringAsked,
  },
  archiveEmptyText: { flex: 1, ...type.body, fontSize: 12.5, lineHeight: 18, color: color.pass.muted },

  privacyNote: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xxxl, paddingHorizontal: space.xs },
  privacyText: { flex: 1, fontFamily: font.regular, fontSize: 11.5, lineHeight: 16, color: color.pass.muted },

  claimCard: { gap: space.md, marginBottom: space.md },
  claimTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  claimName: { ...type.heading, fontSize: 16, color: color.navy },
  claimMeta: { ...type.body, fontSize: 12, color: color.slateMuted, marginTop: 2 },
  claimHelp: { ...type.body, fontSize: 12.5, lineHeight: 18, color: color.slateMuted },
  claimContext: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: color.electricSoft,
  },
  claimContextText: { ...type.label, fontSize: 12, color: color.navy },
  claimNotice: { ...type.body, fontSize: 13, color: color.pass.muted, textAlign: 'center', marginTop: space.md },
  claimActions: { flexDirection: 'row', gap: space.sm },
});
