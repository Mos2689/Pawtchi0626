import React, { useCallback, useMemo, useState } from 'react';
import { describeError } from '../../../lib/appError';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import {
  CommunityButton,
  CommunityCard,
  DogAvatar,
  DogStack,
  communityScreenStyles,
} from '../../../components/community/CommunityUI';
import { color, font, space, type } from '../../../constants/design';
import { TOGETHER_READ_TIMEOUT_MS, cacheKey, readSnapshot } from '../../../lib/communityCache';
import { timed } from '../../../lib/community/perf';
import { prefetchOuting } from '../../../lib/community/outingPrefetch';
import { isPerfFlagOn } from '../../../lib/perfFlags';
import { withTimeout } from '../../../lib/withTimeout';
import {
  approveExternalInvite,
  listExternalInviteClaims,
  loadOuting,
  loadPack,
  removePackMember,
  type CommunityPack,
  type CommunityWalk,
  type ExternalInviteClaim,
  type PackMember,
  type PackSnapshot,
  type PendingInvite,
} from '../../../lib/communityWalks';
import { useAuth } from '../../../providers/AuthProvider';
import { useAutoRetry } from '../../../hooks/useAutoRetry';
import { dateFormat } from '../../../lib/dateFormats';

function dateLabel(value: string | null): string {
  if (!value) return 'Date to be confirmed';
  return dateFormat({
    weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(value));
}

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

  const respondToClaim = async (claim: ExternalInviteClaim, approve: boolean) => {
    setRespondingClaim(claim.invitation_id);
    setError(null);
    try {
      await approveExternalInvite(claim.invitation_id, approve);
      await run();
    } catch (cause) {
      setError(describeError(cause, 'community_action'));
    } finally {
      setRespondingClaim(null);
    }
  };

  const isOwner = !!pack && pack.owner_id === user?.id;

  /**
   * Removing someone is immediate and total — they lose the archive, the plans
   * and any live position the moment it happens — so it asks first. The
   * confirmation names the person rather than saying "this member", because the
   * whole point of a private trail is that you know exactly who is in it.
   */
  const confirmRemove = (member: PackMember) => {
    const who = member.person?.full_name || (member.person?.username ? `@${member.person.username}` : 'this owner');
    Alert.alert(
      `Remove ${who}?`,
      'They lose access to this meetup, its plans and its shared memories. Photos they contributed stay unless they remove them.',
      [
        { text: 'Keep them', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setError(null);
              try {
                await removePackMember(packId!, member.user_id);
                await run();
              } catch (cause) {
                setError(describeError(cause, 'community_action'));
              }
            })();
          },
        },
      ],
    );
  };

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

  return (
    <SafeAreaView style={communityScreenStyles.screen}>
      {/* One plain row, the way the rest of the app does chrome: a back arrow,
          the trail's name, and the single action worth keeping at the top. The
          old header stacked an eyebrow, a title and a subtitle before any
          content had started, which pushed the trail itself below the fold. */}
      <View style={styles.navRow}>
        <Pressable onPress={() => router.back()} style={styles.circleAction} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={21} color={color.navy} />
        </Pressable>
        <Text style={styles.navTitle} numberOfLines={1}>{pack?.name ?? 'Your meetup'}</Text>
        {/* Inviting belongs to the host. A spacer rather than nothing, so the
            title stays centred for a member — an action that disappears and
            takes the layout with it reads as a bug. */}
        {isOwner ? (
          <Pressable
            onPress={() => router.push(`/community/${packId}/invite` as never)}
            style={styles.circleAction}
            accessibilityRole="button"
            accessibilityLabel="Invite someone to this meetup"
          >
            <Ionicons name="person-add-outline" size={19} color={color.navy} />
          </Pressable>
        ) : (
          <View style={styles.circleActionSpacer} />
        )}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {loadIssue && !error ? <Text style={styles.loadIssue}>{loadIssue}</Text> : null}
        {/* The trail, as an object. Everything identifying it lives on one navy
            card so the sections below can be about what happens next. */}
        <View style={styles.hero}>
          <View style={styles.heroRing} pointerEvents="none" />
          <Text style={styles.heroEyebrow}>PRIVATE MEETUP</Text>
          <Text style={styles.heroName}>{(pack?.name ?? 'Your meetup').toUpperCase()}</Text>
          {/* Nothing here may claim "no dogs yet" or "0 walks" before the
              meetup has loaded — on a cold start there is no snapshot, and the
              blank hero used to read as an empty meetup for a round trip. */}
          <Text style={styles.heroBlurb}>
            {allDogs.length > 0
              ? `A shared history of ${allDogs.map(dog => dog.name).slice(0, 3).join(', ')}, made together.`
              : loaded
                ? 'Invite the owners you already walk with, and the history starts here.'
                : ' '}
          </Text>
          {allDogs.length > 0 ? <View style={styles.heroDogs}><DogStack dogs={allDogs} max={4} /></View> : null}
          <Text style={styles.heroCount}>
            {loaded || allDogs.length > 0
              ? `${allDogs.length} ${allDogs.length === 1 ? 'dog' : 'dogs'} · ${memories.length} ${memories.length === 1 ? 'walk' : 'walks'} together`
              : ' '}
          </Text>
        </View>

        {claims.length ? (
          <>
            <SectionHead title="Confirm who you invited" />
            {claims.map(claim => (
              <CommunityCard key={claim.invitation_id} style={styles.claimCard}>
                <View style={styles.claimTop}>
                  <DogStack dogs={claim.dogs} />
                  <View style={styles.flex}>
                    <Text style={styles.claimName}>{claim.full_name || (claim.username ? `@${claim.username}` : 'A Pawtchi owner')}</Text>
                    <Text style={styles.claimMeta}>{claim.username ? `@${claim.username}` : 'No username yet'} · {claim.dogs.map(dog => dog.name).join(' & ') || 'No dog profile'}</Text>
                  </View>
                </View>
                <Text style={styles.claimHelp}>Only approve if this is the person you meant to invite.</Text>
                <View style={styles.claimActions}>
                  <CommunityButton label="Confirm" onPress={() => void respondToClaim(claim, true)} disabled={respondingClaim === claim.invitation_id} style={styles.flex} />
                  <CommunityButton label="Not them" variant="secondary" onPress={() => void respondToClaim(claim, false)} disabled={respondingClaim === claim.invitation_id} style={styles.flex} />
                </View>
              </CommunityCard>
            ))}
          </>
        ) : null}

        <SectionHead
          title={laterWalks.length ? 'Upcoming walks' : 'Next walk'}
          actionLabel={nextWalk && isOwner ? 'Plan another' : undefined}
          onAction={nextWalk && isOwner ? () => router.push(`/community/${packId}/plan` as never) : undefined}
        />

        {nextWalk ? (
          <>
            <View style={styles.walkCard}>
              <View style={styles.walkLine}>
                <DateChip iso={nextWalk.scheduled_for} live={nextWalk.state === 'active'} />
                <View style={styles.flex}>
                  <Text style={styles.walkTitle} numberOfLines={1}>{nextWalk.title}</Text>
                  <Text style={styles.walkMeta}>{dateLabel(nextWalk.scheduled_for)}</Text>
                  <Text style={styles.walkMeta}>{nextWalk.meeting_label}</Text>
                </View>
                {/* Editing lives on the card it edits, rather than as a second
                    button competing with the yellow one below. */}
                {canEditPlan ? (
                  <Pressable
                    onPress={() => router.push(`/community/${packId}/plan?walkId=${nextWalk.id}` as never)}
                    style={styles.editIcon}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="Change the time, meeting point or note"
                  >
                    <Ionicons name="create-outline" size={18} color={color.navy} />
                  </Pressable>
                ) : null}
              </View>
              {nextWalk.note ? <Text style={styles.walkNote}>{nextWalk.note}</Text> : null}
              <View style={styles.attendance}>
                {allDogs.length > 0 ? <DogStack dogs={allDogs} max={3} /> : <View />}
                <Text style={styles.attendanceText} numberOfLines={1}>
                  {nextWalk.state === 'active'
                    ? 'Walking now'
                    : `${members.length} ${members.length === 1 ? 'owner' : 'owners'} in this meetup`}
                </Text>
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
                and not theirs to fix. Offering them a button that the database
                would refuse is worse than offering them nothing. */}
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
                style={styles.laterRow}
                accessibilityRole="button"
                accessibilityLabel={`Open ${walk.title}`}
              >
                <DateChip iso={walk.scheduled_for} live={walk.state === 'active'} quiet={walk.state !== 'active'} />
                <View style={styles.flex}>
                  <Text style={styles.laterTitle} numberOfLines={1}>{walk.title}</Text>
                  <Text style={styles.laterMeta} numberOfLines={1}>
                    {walk.scheduled_for ? dateLabel(walk.scheduled_for) : 'Date to be confirmed'} · {walk.meeting_label}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={19} color={color.slateFaint} />
              </Pressable>
            ))}
          </View>
        ) : null}

        <SectionHead
          title="The pack"
          actionLabel={isOwner ? 'Invite' : undefined}
          onAction={isOwner ? () => router.push(`/community/${packId}/invite` as never) : undefined}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.memberRail}>
          {members.map((member, index) => {
            const dog = member.dogs[0] ?? { id: member.user_id, name: member.person?.full_name ?? 'Friend', image_url: member.person?.avatar_url ?? null };
            // The owner cannot be removed and nobody removes themselves here —
            // leaving is a different decision, and it lives in settings.
            const canRemove = isOwner && member.role !== 'owner' && member.user_id !== user?.id;
            return (
              <View key={member.user_id} style={styles.memberCard}>
                <DogAvatar dog={dog} size={56} ringColor={index === 0 ? color.yellow : color.surface} />
                <Text style={styles.dogName} numberOfLines={1}>{member.dogs.map(item => item.name).join(' & ') || member.person?.full_name || 'Friend'}</Text>
                <Text style={styles.ownerName} numberOfLines={1}>{member.person?.username ? `@${member.person.username}` : member.role === 'owner' ? 'Meetup host' : 'Pack member'}</Text>
                {canRemove ? (
                  <Pressable onPress={() => confirmRemove(member)} style={styles.removeMember} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Remove ${member.person?.full_name || member.person?.username || 'this member'}`}>
                    <Text style={styles.removeMemberText}>Remove</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}

          {invited.map(person => {
            const dog = person.dogs[0] ?? { id: person.id, name: person.full_name ?? 'Friend', image_url: person.avatar_url ?? null };
            const declined = person.state === 'declined';
            return (
              <View key={person.invitation_id} style={styles.memberCard}>
                {/* Dimmed rather than absent: the host asked for this person, and
                    a gap where they should be is what made an invitation look
                    like it had never sent. */}
                <View style={styles.invitedAvatar}>
                  <DogAvatar dog={dog} size={56} ringColor={color.hairline} />
                </View>
                <Text style={styles.dogName} numberOfLines={1}>
                  {person.dogs.map(item => item.name).join(' & ') || person.full_name || 'Friend'}
                </Text>
                <View style={styles.invitedStatus}>
                  <Ionicons
                    name={declined ? 'close-circle' : person.expired ? 'alert-circle' : 'time-outline'}
                    size={12}
                    color={declined ? color.error : person.expired ? color.alert : color.slateMuted}
                  />
                  <Text
                    style={[styles.invitedStatusText, declined && styles.invitedDeclined, person.expired && styles.invitedExpired]}
                    numberOfLines={1}
                  >
                    {declined ? 'Declined' : person.expired ? 'Expired' : 'Invited'}
                  </Text>
                </View>
              </View>
            );
          })}
        </ScrollView>

        <SectionHead title="Our walks" />
        {memories.length ? memories.map(walk => (
          <Pressable
            key={walk.id}
            onPress={() => router.push(`/community/walk/${walk.id}/memory` as never)}
            style={styles.memoryRow}
            accessibilityRole="button"
            accessibilityLabel={`Open the memory of ${walk.title}`}
          >
            <DateChip iso={walk.ended_at ?? walk.scheduled_for} quiet />
            <View style={styles.flex}>
              <Text style={styles.memoryTitle} numberOfLines={1}>{walk.title}</Text>
              <Text style={styles.memoryMeta} numberOfLines={1}>{walk.meeting_label}</Text>
            </View>
            <Ionicons name="chevron-forward" size={19} color={color.slateFaint} />
          </Pressable>
        )) : loaded ? (
          <View style={styles.archiveEmpty}>
            <Text style={styles.archiveEmptyText}>The first shared memory appears here after your walk.</Text>
          </View>
        ) : null}

        <Pressable
          onPress={() => router.push(`/community/${packId}/settings` as never)}
          style={styles.settingsRow}
          accessibilityRole="button"
        >
          <Ionicons name="settings-outline" size={18} color={color.slateMuted} />
          <Text style={styles.settingsText}>Meetup settings</Text>
        </Pressable>

        {error ? <Text style={communityScreenStyles.error}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * A section heading and, optionally, the one thing you can do to that section.
 *
 * Sentence case at reading size rather than the tiny all-caps eyebrow used
 * elsewhere: these are headings on a page someone scrolls, not labels on a
 * dense form, and the trailing text action is what keeps each section to a
 * single obvious next move.
 */
function SectionHead({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button">
          <Text style={styles.sectionAction}>{actionLabel}</Text>
        </Pressable>
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
    <View style={[styles.dateChip, quiet && styles.dateChipQuiet, live && styles.dateChipLive]}>
      <Text style={[styles.dateChipMonth, quiet && styles.dateChipMonthQuiet]}>
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

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingHorizontal: space.xl, paddingBottom: 120 },

  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
    marginBottom: space.md,
  },
  navTitle: { ...type.heading, fontSize: 21, letterSpacing: -0.4, color: color.navy, flex: 1 },
  circleAction: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Holds the invite button's place for a member, so the title stays centred.
  // Transparent, not `circleAction` — reusing that style would leave a white
  // circle sitting there with nothing in it.
  circleActionSpacer: { width: 44, height: 44 },

  hero: {
    position: 'relative',
    overflow: 'hidden',
    minHeight: 218,
    borderRadius: 28,
    backgroundColor: color.navy,
    padding: 22,
    marginBottom: space.xxl,
  },
  /** The one flourish: a thick yellow ring cropped by the card's own corner. */
  heroRing: {
    position: 'absolute',
    right: -28,
    bottom: -49,
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 38,
    borderColor: 'rgba(244,246,0,0.14)',
  },
  heroEyebrow: { ...type.caption, color: color.yellow },
  heroName: {
    width: '78%',
    fontFamily: font.display,
    fontSize: 38,
    // See the note on the invite screen's `display`: a line box tighter than
    // the font size clips Bebas at the top in RN.
    lineHeight: 40,
    letterSpacing: 0.5,
    color: color.cream,
    marginTop: space.md,
    marginBottom: space.sm,
  },
  heroBlurb: { width: '72%', ...type.body, fontSize: 12.5, lineHeight: 18, color: color.creamDim },
  heroDogs: { marginTop: space.lg },
  heroCount: { ...type.label, fontSize: 11, color: color.creamFaint, marginTop: 9 },

  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
  sectionTitle: { ...type.heading, fontSize: 17, color: color.navy },
  sectionAction: { fontFamily: font.bold, fontSize: 12.5, color: color.electric },

  walkCard: {
    padding: 18,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: color.hairline,
    backgroundColor: color.surface,
  },
  walkLine: { flexDirection: 'row', gap: 13, alignItems: 'center' },
  walkTitle: { ...type.bodyMedium, fontSize: 15, color: color.ink, marginBottom: 4 },
  walkMeta: { ...type.body, fontSize: 12, lineHeight: 17, color: color.slateMuted },
  walkNote: { ...type.body, fontSize: 12.5, color: color.slateMuted, marginTop: space.md },
  editIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: color.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attendance: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    marginTop: 15,
    paddingTop: 13,
    borderTopWidth: 1,
    borderTopColor: color.hairline,
  },
  attendanceText: { ...type.label, fontSize: 11, color: color.slateMuted, flexShrink: 1 },
  emptyWalkTitle: { ...type.heading, fontSize: 15, color: color.ink },
  emptyWalkBody: { ...type.body, fontSize: 12.5, lineHeight: 18, color: color.slateMuted, marginTop: 4 },

  dateChip: {
    width: 52,
    borderRadius: 14,
    backgroundColor: color.navy,
    paddingVertical: 8,
    alignItems: 'center',
  },
  dateChipQuiet: { backgroundColor: color.surfaceSubtle },
  dateChipLive: { backgroundColor: color.error },
  dateChipMonth: { fontFamily: font.bold, fontSize: 9, letterSpacing: 1, color: color.cream },
  dateChipMonthQuiet: { color: color.slateMuted },
  dateChipDay: { fontFamily: font.display, fontSize: 20, lineHeight: 22, color: color.yellow },
  dateChipDayQuiet: { color: color.navy },

  primary: {
    minHeight: 52,
    borderRadius: 17,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.md,
    marginBottom: space.xxl,
  },
  primaryInline: { marginBottom: 0, alignSelf: 'stretch' },
  primaryText: { fontFamily: font.bold, fontSize: 14, color: color.navy },
  pressed: { opacity: 0.9 },

  loadIssue: { ...type.body, fontSize: 12.5, color: color.slateMuted, textAlign: 'center', marginBottom: space.md },
  /** A quiet placeholder the height of a line, not a spinner over the screen. */
  skeletonLine: {
    height: 14,
    borderRadius: 7,
    backgroundColor: color.hairline,
    width: '62%',
  },
  laterList: { marginTop: space.md, marginBottom: space.xxl },
  laterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: color.hairline,
  },
  laterTitle: { ...type.bodyMedium, fontSize: 13, color: color.ink },
  laterMeta: { ...type.caption, fontSize: 10, color: color.slateMuted, marginTop: 3 },
  memberRail: { gap: space.md, paddingBottom: space.xl, paddingRight: space.xl },
  memberCard: {
    width: 104,
    alignItems: 'center',
    gap: 3,
    backgroundColor: color.surface,
    borderRadius: 18,
    paddingVertical: space.md,
    paddingHorizontal: space.sm,
  },
  dogName: { ...type.label, fontSize: 12, color: color.navy, marginTop: 6 },
  ownerName: { ...type.caption, fontSize: 9.5, color: color.slateFaint },
  removeMember: { minHeight: 28, justifyContent: 'center' },
  removeMemberText: { ...type.caption, fontSize: 9.5, color: color.error },
  invitedAvatar: { opacity: 0.5 },
  invitedStatus: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  invitedStatusText: { ...type.caption, fontSize: 9.5, color: color.slateMuted },
  invitedDeclined: { color: color.error },
  invitedExpired: { color: color.alert },

  memoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: color.hairline,
  },
  memoryTitle: { ...type.bodyMedium, fontSize: 13, color: color.ink },
  memoryMeta: { ...type.caption, fontSize: 10, color: color.slateMuted, marginTop: 3 },
  archiveEmpty: { paddingVertical: space.lg },
  archiveEmptyText: { ...type.body, fontSize: 12.5, color: color.slateMuted },

  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    marginTop: space.xxl,
  },
  settingsText: { ...type.label, fontSize: 12.5, color: color.slateMuted },

  claimCard: { gap: space.md, marginBottom: space.md },
  claimTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  claimName: { ...type.heading, fontSize: 15, color: color.navy },
  claimMeta: { ...type.body, fontSize: 12, color: color.slateMuted, marginTop: 2 },
  claimHelp: { ...type.body, fontSize: 12, color: color.slateMuted },
  claimActions: { flexDirection: 'row', gap: space.sm },
});
