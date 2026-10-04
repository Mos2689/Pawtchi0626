import React, { useCallback, useState } from 'react';
import { describeError, errorCopy, toAppError, type AppError } from '../../lib/appError';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import {
  CommunityButton,
  CommunityCard,
  CommunityDogsOnly,
  CommunityHeader,
  DogStack,
  PackRouteArtwork,
  StatusPill,
  communityScreenStyles,
} from '../../components/community/CommunityUI';
import { color, radius, space, type } from '../../constants/design';
import { useWalkEnabled } from '../../hooks/useWalkEnabled';
import { useAutoRetry } from '../../hooks/useAutoRetry';
import { ErrorState } from '../../components/ErrorState';
import {
  getMyUsername,
  listInvitations,
  listPacks,
  respondToInvitation,
  type CommunityInvitation,
  type CommunityPack,
} from '../../lib/communityWalks';
import { useActivePetStore } from '../../store/useActivePetStore';
import { dateFormat } from '../../lib/dateFormats';

function formatWalkTime(value: string | null): string {
  if (!value) return 'Choose a date together';
  return dateFormat({
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(value));
}

export default function CommunityScreen() {
  const router = useRouter();
  const walkEnabled = useWalkEnabled();
  const activePet = useActivePetStore(state => state.activePet);
  const [packs, setPacks] = useState<CommunityPack[]>([]);
  const [invitations, setInvitations] = useState<CommunityInvitation[]>([]);
  const [username, setUsername] = useState<string | null>(null);
  /**
   * Whether an answer has ever landed. Until one has, nothing on this screen
   * may claim anything — not "no meetups", not "choose your username". A
   * failed first load used to fall through to both.
   */
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [loadInFlight, setLoadInFlight] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  /** An action that did not go through. */
  const [error, setError] = useState<string | null>(null);
  /** The latest load failed and is being retried. */
  const [loadIssue, setLoadIssue] = useState<AppError | null>(null);
  const [responding, setResponding] = useState<string | null>(null);

  const load = useCallback(async (): Promise<boolean> => {
    setError(null);
    setLoadInFlight(true);
    try {
      const [nextPacks, nextInvitations, nextUsername] = await Promise.all([
        listPacks(), listInvitations(), getMyUsername(),
      ]);
      setPacks(nextPacks);
      setInvitations(nextInvitations);
      setUsername(nextUsername);
      setLoadedOnce(true);
      setLoadIssue(null);
      return true;
    } catch (cause) {
      setLoadIssue(toAppError(cause));
      return false;
    } finally {
      setLoadInFlight(false);
      setRefreshing(false);
    }
  }, []);

  /** `load`, retried on its own after a failure (hooks/useAutoRetry.ts). */
  const run = useAutoRetry(load);

  useFocusEffect(useCallback(() => {
    if (!walkEnabled) return;
    void run();
  }, [run, walkEnabled]));

  const respond = async (invitation: CommunityInvitation, accept: boolean) => {
    setResponding(invitation.id);
    setError(null);
    try {
      await respondToInvitation(invitation.id, accept);
      await run();
    } catch (cause) {
      setError(describeError(cause, 'community_action'));
    } finally {
      setResponding(null);
    }
  };

  // An invitation push routes here explicitly, so this screen can be reached
  // with a cat active and has to answer for itself rather than assume the
  // caller already checked.
  if (!walkEnabled) {
    return (
      <SafeAreaView style={communityScreenStyles.screen}>
        <CommunityDogsOnly petName={activePet?.name} onBack={() => router.back()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={communityScreenStyles.screen}>
      <CommunityHeader
        eyebrow="Walk together"
        title="Your meetups"
        subtitle="Each meetup is a standing arrangement with people you know — the next walk, and every one you have shared."
        onBack={() => router.back()}
        action={
          <Pressable
            onPress={() => router.push('/community/create' as never)}
            style={styles.addButton}
            accessibilityRole="button"
            accessibilityLabel="Plan a meetup"
          >
            <Ionicons name="add" size={24} color={color.navy} />
          </Pressable>
        }
      />

      {!loadedOnce ? (
        // Only the very first visit waits, and quietly. A modal loader on every
        // refocus wiped a list that was already on screen and made coming back
        // from a trail feel like a cold start. If that first answer will not
        // come, say so calmly and offer to try again — never an empty list.
        loadIssue && !loadInFlight ? (
          <View style={styles.unavailable}>
            <ErrorState
              copy={errorCopy(loadIssue, { context: 'community_load' })}
              errorKind={loadIssue.kind}
              errorContext="community_load"
              screen="/(tabs)/community"
              onAction={action => { if (action === 'retry') void run(); }}
            />
          </View>
        ) : (
          <View style={styles.firstLoad} />
        )
      ) : (
        <ScrollView
          contentContainerStyle={communityScreenStyles.scroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); void run(); }}
              tintColor={color.electric}
            />
          }
        >
          {!username ? (
            <CommunityCard style={styles.usernameCard}>
              <View style={styles.usernameIcon}><Text style={styles.at}>@</Text></View>
              <View style={styles.flex}>
                <Text style={styles.cardTitle}>Choose your username</Text>
                <Text style={styles.cardBody}>Friends use your exact username to find you. Pawtchi never lists you publicly.</Text>
              </View>
              <Pressable onPress={() => router.push('/community/create?mode=username' as never)} style={styles.roundArrow}>
                <Ionicons name="arrow-forward" size={19} color={color.navy} />
              </Pressable>
            </CommunityCard>
          ) : null}

          {invitations.length ? <Text style={communityScreenStyles.sectionEyebrow}>INVITATIONS</Text> : null}
          {invitations.map(invitation => (
            <CommunityCard key={invitation.id} style={styles.inviteCard}>
              <StatusPill label="PRIVATE INVITATION" />
              <Text style={styles.inviteTitle}>{invitation.pack?.name ?? 'A new meetup'}</Text>
              {invitation.dogs?.length ? <View style={styles.inviteDogs}><DogStack dogs={invitation.dogs} /><Text style={styles.inviteDogNames}>{invitation.dogs.map(dog => dog.name).join(', ')}</Text></View> : null}
              <Text style={styles.cardBody}>
                {invitation.inviter?.full_name || (invitation.inviter?.username ? `@${invitation.inviter.username}` : 'A friend')} invited you. Accepting gives you access to this trail’s shared archive and future plans. Location sharing stays off until you join a walk.
              </Text>
              {/*
                Sits between the invitation and the buttons, which is the only
                place it does any work. Trails have no people search and nobody
                can find you here — an invitation always came from somebody who
                already knew your handle or had your number. This says the
                quiet part: that is the whole of the vetting, and the rest of
                the judgement is the reader's.
              */}
              <Text style={styles.inviteCaution}>
                Meetups are private and invitation-only. Accept from people you know, or people you
                are happy to meet and walk with.
              </Text>
              <View style={styles.inviteActions}>
                <CommunityButton label="Accept" onPress={() => void respond(invitation, true)} disabled={responding === invitation.id} style={styles.flex} />
                <CommunityButton label="Decline" variant="secondary" onPress={() => void respond(invitation, false)} disabled={responding === invitation.id} style={styles.flex} />
              </View>
            </CommunityCard>
          ))}

          {packs.length ? <Text style={communityScreenStyles.sectionEyebrow}>YOUR MEETUPS</Text> : null}
          {packs.map(pack => (
            <Pressable
              key={pack.id}
              onPress={() => router.push(`/community/${pack.id}` as never)}
              style={({ pressed }) => [styles.packCard, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`Open ${pack.name}`}
            >
              <PackRouteArtwork compact />
              <View style={styles.packBody}>
                <View style={styles.packTitleRow}>
                  <View style={styles.flex}>
                    <Text style={styles.packTitle}>{pack.name}</Text>
                    <Text style={styles.packMeta}>{pack.memberCount ?? 1} {(pack.memberCount ?? 1) === 1 ? 'owner' : 'owners'}</Text>
                  </View>
                  {pack.dogs?.length ? <DogStack dogs={pack.dogs} /> : null}
                </View>
                {pack.nextWalk ? (
                  <View style={styles.nextRow}>
                    <Ionicons name="calendar-outline" size={18} color={color.electric} />
                    <View style={styles.flex}>
                      <Text style={styles.nextLabel}>{pack.nextWalk.state === 'active' ? 'HAPPENING NOW' : 'NEXT WALK'}</Text>
                      <Text style={styles.nextValue}>{formatWalkTime(pack.nextWalk.scheduled_for)}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={color.slateFaint} />
                  </View>
                ) : (
                  <View style={styles.nextRow}>
                    <Ionicons name="paw-outline" size={18} color={color.slateMuted} />
                    <Text style={[styles.nextValue, styles.flex]}>Plan the first walk</Text>
                    <Ionicons name="chevron-forward" size={20} color={color.slateFaint} />
                  </View>
                )}
              </View>
            </Pressable>
          ))}

          {!packs.length && !invitations.length ? (
            <View style={styles.empty}>
              <View style={styles.emptyMark}><Ionicons name="paw" size={32} color={color.electric} /></View>
              <Text style={communityScreenStyles.emptyTitle}>Start with familiar faces</Text>
              <Text style={communityScreenStyles.emptyBody}>Plan a meetup, invite people you already know, and build a shelf of walks together.</Text>
              <CommunityButton label="Plan a meetup" icon="add" onPress={() => router.push('/community/create' as never)} style={styles.emptyCta} />
              <CommunityButton label="Use invitation code" variant="quiet" icon="key-outline" onPress={() => router.push('/community-invite' as never)} style={styles.codeCta} />
            </View>
          ) : (
            <View style={styles.bottomActions}>
              <CommunityButton label="Plan another meetup" variant="secondary" icon="add" onPress={() => router.push('/community/create' as never)} />
              <CommunityButton label="Use invitation code" variant="quiet" icon="key-outline" onPress={() => router.push('/community-invite' as never)} />
            </View>
          )}

          {error ? <Text style={communityScreenStyles.error}>{error}</Text> : null}
          {!error && loadIssue ? (
            <Text style={styles.loadIssue}>{errorCopy(loadIssue, { context: 'community_load' }).message}</Text>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  firstLoad: { flex: 1 },
  unavailable: { flex: 1, paddingHorizontal: space.xl, paddingTop: space.xxl },
  loadIssue: { ...type.body, fontSize: 12.5, color: color.slateMuted, textAlign: 'center', marginTop: space.md },
  flex: { flex: 1 },
  addButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: color.yellow, alignItems: 'center', justifyContent: 'center' },
  usernameCard: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  usernameIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: color.electricSoft, alignItems: 'center', justifyContent: 'center' },
  at: { ...type.heading, color: color.electric },
  cardTitle: { ...type.heading, color: color.navy },
  cardBody: { ...type.body, color: color.slateMuted, marginTop: 4 },
  roundArrow: { width: 44, height: 44, borderRadius: 22, backgroundColor: color.surfaceSubtle, alignItems: 'center', justifyContent: 'center' },
  inviteCard: { marginBottom: space.md },
  inviteTitle: { ...type.title, color: color.navy, marginTop: space.lg },
  inviteDogs: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.md },
  inviteDogNames: { ...type.label, color: color.navy, flex: 1 },
  inviteCaution: { ...type.body, fontSize: 12, lineHeight: 18, color: color.slateFaint, marginTop: space.md },
  inviteActions: { flexDirection: 'row', gap: space.sm, marginTop: space.lg },
  packCard: { backgroundColor: color.surface, borderRadius: radius.xxl, overflow: 'hidden', borderWidth: 1, borderColor: color.hairline, marginBottom: space.lg },
  pressed: { opacity: 0.9, transform: [{ scale: 0.992 }] },
  packBody: { padding: space.lg },
  packTitleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  packTitle: { ...type.title, color: color.navy },
  packMeta: { ...type.body, color: color.slateMuted, marginTop: 2 },
  nextRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: space.md, borderTopWidth: 1, borderTopColor: color.hairline, marginTop: space.lg, paddingTop: space.md },
  nextLabel: { ...type.caption, color: color.electric },
  nextValue: { ...type.bodyMedium, color: color.ink, marginTop: 2 },
  empty: { alignItems: 'center', paddingTop: space.xxxl },
  emptyMark: { width: 76, height: 76, borderRadius: 38, backgroundColor: color.electricSoft, alignItems: 'center', justifyContent: 'center' },
  emptyCta: { marginTop: space.xxl, alignSelf: 'stretch' },
  codeCta: { alignSelf: 'stretch' },
  bottomActions: { marginTop: space.md, gap: space.xs },
});
