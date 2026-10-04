/**
 * Inviting someone to a trail.
 *
 * Two paths, and the shareable one leads.
 *
 * It used to be the other way round — username first, share link last, under a
 * rule and in grey. The reasoning was that a link costs the recipient an
 * install so it should not be offered first. That reasoning was about us. The
 * username path needs the other person to already have Pawtchi, to have chosen
 * a handle, and to have told you what it is; a host inviting their first friend
 * has none of those, and was shown the narrow path twice the size of the one
 * that would actually work.
 *
 * The username field is still here and still exact — no search-as-you-type and
 * no suggestions, because the absence of those IS the feature: a private trail
 * that could be browsed into is not private. The confirmation card below the
 * field exists so the host can see they have the right person before sending.
 *
 * ── "Invited before" is not a suggestion list ──────────────────────────────
 *
 * A host sees the people THEY have invited before, and can tick several at
 * once. That does not break the rule above: nobody can be on it whom this host
 * did not already reach by exact username or by approving their link. It is
 * their own history, and the server derives it and re-checks every id on send
 * (migration 20260924000000_previous_invitees). Members never see it.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { describeError, rawErrorMessage } from '../../../lib/appError';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { DogAvatar, communityScreenStyles } from '../../../components/community/CommunityUI';
import { color, font, space, type } from '../../../constants/design';
import { cacheKey, invalidate, readSnapshot } from '../../../lib/communityCache';
import {
  createExternalInvite,
  invitePreviousInvitees,
  inviteUsername,
  isTrailHost,
  listPreviousInvitees,
  loadPack,
  lookupUsername,
  normalizeUsername,
  type CommunityPack,
  type PackMember,
  type CommunityWalk,
  type PackSnapshot,
  type UsernameMatch,
} from '../../../lib/communityWalks';
import {
  buildInviteMessage,
  inviteFirstName,
  inviteShareTitle,
} from '../../../lib/community/inviteMessage';
import {
  MAX_PREVIOUS_INVITE_BATCH,
  inviteSelectedLabel,
  inviteeSubtitle,
  inviteeTitle,
  previousInviteError,
  type PreviousInvitee,
} from '../../../lib/community/previousInvitees';
import { haptic } from '../../../lib/haptics';
import { useAuth } from '../../../providers/AuthProvider';
import { dateFormat } from '../../../lib/dateFormats';

export default function InviteToPackScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { packId, from } = useLocalSearchParams<{ packId: string; from?: string }>();
  /**
   * Whether this is the last step of starting a trail, or a detour off one that
   * already exists.
   *
   * It changes where "done" goes, and that was the bumpy part of the loop: a
   * host finished creating a trail, finished inviting, and then had to work out
   * for themselves that the way onward was the back arrow.
   */
  const finishingCreation = from === 'create';
  // This screen is only ever reached from the trail, which has just loaded
  // exactly this data. Re-fetching it before showing the trail's own name in
  // the header was a round trip spent re-learning something one screen away.
  const cached = React.useMemo(
    () => (packId ? readSnapshot<PackSnapshot>(cacheKey.pack(packId)) : null),
    [packId],
  );
  const [pack, setPack] = useState<CommunityPack | null>(cached?.pack ?? null);
  const [members, setMembers] = useState<PackMember[]>(cached?.members ?? []);
  /** The next walk, so the message can say what there is to say yes to. */
  const [nextWalk, setNextWalk] = useState<CommunityWalk | null>(null);
  /**
   * What to call the person sending this.
   *
   * Read from their own member row rather than from the auth user, because
   * that is where the display name lives — and a message that cannot name its
   * sender reads as a system notice rather than as a friend asking.
   */
  const hostName = React.useMemo(
    () => inviteFirstName(
      members.find(member => member.user_id === user?.id)?.person?.full_name,
      members.find(member => member.user_id === user?.id)?.person?.username,
    ),
    [members, user?.id],
  );
  const [query, setQuery] = useState('');
  const [match, setMatch] = useState<UsernameMatch | null>(null);
  const [searched, setSearched] = useState(false);
  /**
   * One flag per action, not one for the screen.
   *
   * A single `busy` meant sending an invitation also greyed out the search
   * field's button and the share row, and the share row greyed out the invite —
   * three unrelated controls locking each other because they happened to share
   * a boolean.
   */
  const [finding, setFinding] = useState(false);
  const [sending, setSending] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  /**
   * The external code made for this trail on this visit.
   *
   * `createExternalInvite` mints a new row every call, and the share sheet can
   * be cancelled — so a host who opened it three times left three live codes
   * behind, each one able to admit someone. Reusing the code within a visit
   * means tapping share twice shares the same invitation twice.
   */
  const externalCode = React.useRef<string | null>(null);

  /**
   * People this host has invited before — see the header. Empty for members,
   * for a host who has never invited anyone, and on a database that does not
   * have the function yet; in every one of those the section simply is not
   * drawn, so there is no error to show for a feature that is not there.
   */
  const isHost = isTrailHost(pack, user?.id);
  const [previous, setPrevious] = useState<PreviousInvitee[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [sendingPrevious, setSendingPrevious] = useState(false);
  const [previousError, setPreviousError] = useState<string | null>(null);

  const loadPrevious = useCallback(async () => {
    if (!packId || !isHost) return;
    try {
      const people = await listPreviousInvitees(packId);
      setPrevious(people);
      // Anyone who stopped being eligible drops out of the selection too.
      setSelected(current => new Set(
        [...current].filter(id => people.some(person => person.id === id && !person.pendingHere)),
      ));
    } catch {
      setPrevious([]);
    }
  }, [packId, isHost]);
  useEffect(() => { void loadPrevious(); }, [loadPrevious]);

  const selectable = previous.filter(person => !person.pendingHere);
  const allSelected = selectable.length > 0 && selectable.every(person => selected.has(person.id));

  const toggle = (id: string) => {
    setPreviousError(null);
    setSelected(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_PREVIOUS_INVITE_BATCH) next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setPreviousError(null);
    setSelected(allSelected
      ? new Set()
      : new Set(selectable.slice(0, MAX_PREVIOUS_INVITE_BATCH).map(person => person.id)));
  };

  const sendPrevious = async () => {
    const ids = [...selected];
    if (!packId || ids.length === 0) return;
    setSendingPrevious(true);
    setPreviousError(null);
    try {
      await invitePreviousInvitees(packId, ids);
      haptic.tap();
      // Same reason as the username path: the meetup screen would otherwise
      // show a roster without the people just invited.
      invalidate(cacheKey.pack(packId));
      setPrevious(list => list.map(person => (ids.includes(person.id) ? { ...person, pendingHere: true } : person)));
      setSelected(new Set());
      setSent(true);
    } catch (cause) {
      const raw = rawErrorMessage(cause);
      setPreviousError(previousInviteError(raw));
      if (raw.includes('not_a_previous_invitee')) void loadPrevious();
    } finally {
      setSendingPrevious(false);
    }
  };

  useEffect(() => {
    if (!packId) return;
    loadPack(packId)
      .then(data => {
        setPack(data.pack);
        setMembers(data.members);
        setNextWalk(
          data.walks
            .filter(walk => walk.state === 'planned' || walk.state === 'active')
            .sort((a, b) => (a.scheduled_for ?? '9').localeCompare(b.scheduled_for ?? '9'))[0]
          ?? null,
        );
      })
      .catch(() => {});
  }, [packId]);

  const find = async () => {
    setFinding(true);
    setError(null);
    setSent(false);
    try {
      const result = await lookupUsername(query);
      setMatch(result);
      setSearched(true);
    } catch (cause) {
      setError(describeError(cause, 'community_action'));
    } finally {
      setFinding(false);
    }
  };

  const sendInvite = async () => {
    if (!match || !packId) return;
    setSending(true);
    setError(null);
    try {
      await inviteUsername(packId, match.username ?? query);
      // The trail screen skips its refetch inside the freshness window, and
      // going back there takes a couple of seconds. Without this the person
      // just invited would be missing from the roster they were added to.
      invalidate(cacheKey.pack(packId));
      setSent(true);
    } catch (cause) {
      setError(describeError(cause, 'community_action'));
    } finally {
      setSending(false);
    }
  };

  /**
   * End the creation flow on the Together list, where the new trail now is.
   *
   * Popping rather than replacing, and it matters: /create replaced itself with
   * this screen, so what sits behind is Home — already mounted, still on the
   * Together chip. `replace('/(tabs)')` would push a fresh copy of Home
   * instead, remounting it onto its default chip, so finishing a trail would
   * land the host on the Walk map wondering where their trail went.
   *
   * The fallback is for a deep link straight into this screen, where there is
   * genuinely nothing behind it.
   */
  const done = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)' as never);
  };

  const shareExternal = async () => {
    if (!packId) return;
    setSharing(true);
    setError(null);
    try {
      if (!externalCode.current) {
        const invitation = await createExternalInvite(packId);
        externalCode.current = invitation.invite_code;
      }
      const code = externalCode.current;
      const link = `https://pawtchi.com/app/community-invite?code=${code}`;
      const trailName = pack?.name ?? 'our meetup';
      await Share.share({
        title: inviteShareTitle(hostName, trailName),
        message: buildInviteMessage({
          hostName,
          trailName,
          when: nextWalk?.scheduled_for
            ? dateFormat({
                weekday: 'long', hour: 'numeric', minute: '2-digit',
              }).format(new Date(nextWalk.scheduled_for))
            : null,
          where: nextWalk?.meeting_label ?? null,
          link,
        }),
        url: link,
      });
    } catch (cause) {
      setError(describeError(cause, 'community_action'));
    } finally {
      setSharing(false);
    }
  };

  return (
    <SafeAreaView style={communityScreenStyles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.navRow}>
          <Pressable onPress={() => (finishingCreation ? done() : router.back())} style={styles.back} accessibilityRole="button" accessibilityLabel={finishingCreation ? 'Finish and see your meetups' : 'Go back'}>
            <Ionicons name="chevron-back" size={24} color={color.navy} />
          </Pressable>
          <Text style={styles.navTitle} numberOfLines={1}>{pack?.name ?? 'Your meetup'}</Text>
          {finishingCreation ? (
            <Pressable
              onPress={done}
              style={styles.doneAction}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Finish and see your meetups"
            >
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => router.push(`/community/${packId}/settings` as never)}
              style={styles.circleAction}
              accessibilityRole="button"
              accessibilityLabel="Meetup settings"
            >
              <Ionicons name="ellipsis-horizontal" size={19} color={color.navy} />
            </Pressable>
          )}
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.display}>WHO ARE WE MEETING?</Text>

          {/* ── Invited before ─────────────────────────────────────────────
              First when it exists, because a host who has invited people
              before almost always wants the same people again, and ticking
              them beats retyping five usernames. A first-time host has no
              list, and the share link below leads exactly as it did. */}
          {isHost && previous.length > 0 ? (
            <View style={styles.previousCard}>
              <View style={styles.previousHead}>
                <View style={styles.flex}>
                  <Text style={styles.previousTitle}>Invited before</Text>
                  <Text style={styles.previousBody}>People you have asked to your meetups. Only you see this.</Text>
                </View>
                {selectable.length > 1 ? (
                  <Pressable onPress={toggleAll} hitSlop={8} accessibilityRole="button">
                    <Text style={styles.previousAll}>{allSelected ? 'Clear' : 'Select all'}</Text>
                  </Pressable>
                ) : null}
              </View>

              {previous.map(person => {
                const chosen = selected.has(person.id);
                const dog = person.dogs[0] ?? {
                  id: person.id,
                  name: person.full_name ?? 'Friend',
                  image_url: person.avatar_url,
                };
                return (
                  <Pressable
                    key={person.id}
                    onPress={() => toggle(person.id)}
                    disabled={person.pendingHere || sendingPrevious}
                    style={({ pressed }) => [styles.previousRow, pressed && styles.pressed]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: chosen || person.pendingHere, disabled: person.pendingHere }}
                    accessibilityLabel={`${inviteeTitle(person)}, ${inviteeSubtitle(person)}`}
                  >
                    <DogAvatar dog={dog} size={40} />
                    <View style={styles.flex}>
                      <Text style={styles.memberName} numberOfLines={1}>{inviteeTitle(person)}</Text>
                      <Text style={styles.memberHandle} numberOfLines={1}>{inviteeSubtitle(person)}</Text>
                    </View>
                    {person.pendingHere ? (
                      <View style={styles.sentPill}>
                        <Ionicons name="checkmark" size={14} color={color.navy} />
                        <Text style={styles.sentText}>Invited</Text>
                      </View>
                    ) : (
                      <Ionicons
                        name={chosen ? 'checkmark-circle' : 'ellipse-outline'}
                        size={26}
                        color={chosen ? color.navy : color.slateFaint}
                      />
                    )}
                  </Pressable>
                );
              })}

              {selected.size >= MAX_PREVIOUS_INVITE_BATCH ? (
                <Text style={styles.hint}>Twelve at a time. Send these, then choose the rest.</Text>
              ) : null}
              {previousError ? <Text style={communityScreenStyles.error}>{previousError}</Text> : null}

              {selectable.length > 0 ? (
                <Pressable
                  onPress={() => void sendPrevious()}
                  disabled={selected.size === 0 || sendingPrevious}
                  style={({ pressed }) => [
                    styles.previousSend,
                    (selected.size === 0 || sendingPrevious) && styles.previousSendIdle,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                >
                  <Text style={styles.previousSendText}>{inviteSelectedLabel(selected.size, sendingPrevious)}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {/* ── First, because it is the one that works on anybody ─────────
              The username path needs the other person to already have Pawtchi
              AND to have chosen a handle AND to have told you what it is. The
              share link needs none of that, so burying it under a rule at the
              bottom of the page put the narrow path in front of the general
              one. A host inviting their first friend almost always needs this.
              The promise it has to keep is printed on it rather than in a
              footnote: a forwarded link cannot admit anyone by itself. */}
          <Pressable
            onPress={() => void shareExternal()}
            disabled={sharing}
            style={({ pressed }) => [styles.shareCard, (pressed || sharing) && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Send an invitation link"
          >
            <View style={styles.shareIcon}>
              <Ionicons name="paper-plane" size={20} color={color.navy} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.shareTitle}>
                {sharing ? 'Opening…' : 'Send an invitation link'}
              </Text>
              <Text style={styles.shareBody}>
                Share it in any app. It opens Pawtchi, or the app store if they do not have it yet.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={19} color={color.slateFaint} />
          </Pressable>

          <Text style={styles.shareNote}>
            A forwarded link cannot add anyone on its own. You confirm who they are before they join.
          </Text>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR BY USERNAME</Text>
            <View style={styles.dividerLine} />
          </View>

          <View style={styles.inviteCard}>
            <Text style={styles.label}>Pawtchi username</Text>
            <View style={styles.search}>
              <TextInput
                value={query}
                onChangeText={value => { setQuery(normalizeUsername(value)); setSearched(false); setMatch(null); setSent(false); setError(null); }}
                onSubmitEditing={() => void find()}
                placeholder="@samandolive"
                placeholderTextColor={color.slateFaint}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                maxLength={24}
                style={styles.searchBox}
                accessibilityLabel="Pawtchi username"
              />
              <Pressable
                onPress={() => void find()}
                disabled={finding || query.trim().length < 3}
                style={({ pressed }) => [
                  styles.searchGo,
                  (finding || query.trim().length < 3) && styles.searchGoDisabled,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Find this username"
              >
                <Ionicons name="arrow-forward" size={20} color={color.cream} />
              </Pressable>
            </View>
            <Text style={styles.hint}>Usernames are exact so private meetups stay private.</Text>

            {match ? (
              <View style={styles.result}>
                <DogAvatar
                  dog={match.dogs[0] ?? { id: match.id, name: match.full_name ?? 'Friend', image_url: match.avatar_url }}
                  size={46}
                />
                <View style={styles.flex}>
                  <Text style={styles.resultName} numberOfLines={1}>
                    {match.full_name || (match.username ? `@${match.username}` : 'A Pawtchi owner')}
                  </Text>
                  <Text style={styles.resultMeta} numberOfLines={1}>
                    @{match.username}
                    {match.dogs.length > 0 ? ` · ${match.dogs.map(dog => dog.name).join(' & ')}` : ''}
                  </Text>
                </View>
                {sent ? (
                  <View style={styles.sentPill}>
                    <Ionicons name="checkmark" size={14} color={color.navy} />
                    <Text style={styles.sentText}>Invited</Text>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => void sendInvite()}
                    disabled={sending}
                    style={({ pressed }) => [styles.add, (pressed || sending) && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel={`Invite ${match.full_name ?? match.username}`}
                  >
                    <Text style={styles.addText}>{sending ? 'Inviting…' : 'Invite'}</Text>
                  </Pressable>
                )}
              </View>
            ) : null}

            {/* Only ever after a real lookup. Saying "no such owner" while
                someone is still typing would read as an accusation. */}
            {searched && !match ? (
              <View style={styles.result}>
                <View style={styles.noMatchMark}>
                  <Ionicons name="help-outline" size={20} color={color.slateMuted} />
                </View>
                <Text style={[styles.resultMeta, styles.flex]}>
                  No owner uses that exact username. Check the spelling with them.
                </Text>
              </View>
            ) : null}
          </View>

          {error ? <Text style={communityScreenStyles.error}>{error}</Text> : null}

          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>The pack</Text>
            <Text style={styles.sectionCount}>
              {members.length} {members.length === 1 ? 'person' : 'people'}
            </Text>
          </View>

          {members.map(member => {
            const dog = member.dogs[0] ?? {
              id: member.user_id,
              name: member.person?.full_name ?? 'Friend',
              image_url: member.person?.avatar_url ?? null,
            };
            return (
              <View key={member.user_id} style={styles.memberRow}>
                <DogAvatar dog={dog} size={42} />
                <View style={styles.flex}>
                  <Text style={styles.memberName} numberOfLines={1}>
                    {member.dogs.map(item => item.name).join(' & ') || member.person?.full_name || 'Friend'}
                  </Text>
                  <Text style={styles.memberHandle} numberOfLines={1}>
                    {member.person?.username ? `@${member.person.username}` : 'No username yet'}
                  </Text>
                </View>
                <View style={styles.rolePill}>
                  <Text style={styles.roleText}>{member.role === 'owner' ? 'Owner' : 'Member'}</Text>
                </View>
              </View>
            );
          })}


          {/* The end of the flow, at the end of the page. Inviting nobody is a
              perfectly good answer — a trail with one owner is still a trail,
              and people can be added any day after this one. */}
          {finishingCreation ? (
            <Pressable
              onPress={done}
              style={({ pressed }) => [styles.finish, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.finishText}>
                {sent ? 'Done — see my meetups' : 'Skip for now'}
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingHorizontal: space.xl, paddingBottom: 120 },

  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
  },
  back: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  navTitle: { ...type.heading, fontSize: 17, color: color.navy, flex: 1, textAlign: 'center' },
  circleAction: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: color.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },

  display: {
    fontFamily: font.display,
    marginTop: space.lg,
    fontSize: 42,
    // Never below fontSize. Bebas puts its caps high in the em box, and RN
    // clips whatever falls outside the line box rather than letting it overflow
    // the way CSS does — which took the tops off every letter of this heading.
    // The preview's `line-height: .94` is a browser-only luxury.
    lineHeight: 44,
    letterSpacing: 0.5,
    color: color.navy,
  },
  body: { ...type.body, fontSize: 13.5, lineHeight: 21, color: color.slateMuted, marginTop: 11 },

  inviteCard: {
    marginTop: 22,
    padding: 18,
    borderRadius: 24,
    backgroundColor: color.surfaceSubtle,
  },
  label: { fontFamily: font.bold, fontSize: 12, color: color.navy, marginBottom: 8 },
  search: { flexDirection: 'row', gap: 8 },
  searchBox: {
    flex: 1,
    minWidth: 0,
    height: 52,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: color.hairline,
    borderRadius: 15,
    backgroundColor: color.surface,
    ...type.bodyMedium,
    fontSize: 14,
    color: color.navy,
  },
  searchGo: {
    width: 52,
    height: 52,
    borderRadius: 15,
    backgroundColor: color.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchGoDisabled: { opacity: 0.4 },
  hint: { ...type.caption, fontSize: 10.5, lineHeight: 15, color: color.slateMuted, marginTop: 9, marginHorizontal: 2 },

  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
    padding: 12,
    borderRadius: 17,
    backgroundColor: color.surface,
  },
  resultName: { ...type.bodyMedium, fontSize: 13.5, color: color.navy },
  resultMeta: { ...type.caption, fontSize: 10.5, lineHeight: 15, color: color.slateMuted, marginTop: 3 },
  noMatchMark: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: color.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  add: {
    minHeight: 38,
    paddingHorizontal: 16,
    borderRadius: 19,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addText: { fontFamily: font.bold, fontSize: 12.5, color: color.navy },
  sentPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: 19,
    backgroundColor: color.surfaceSubtle,
  },
  sentText: { fontFamily: font.bold, fontSize: 12, color: color.navy },

  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 26,
    marginBottom: 4,
  },
  sectionTitle: { ...type.heading, fontSize: 17, color: color.navy },
  sectionCount: { ...type.caption, fontSize: 10.5, color: color.slateMuted },

  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: color.hairline,
  },
  memberName: { ...type.bodyMedium, fontSize: 13, color: color.ink },
  memberHandle: { ...type.caption, fontSize: 10, color: color.slateMuted, marginTop: 3 },
  rolePill: {
    paddingVertical: 6,
    paddingHorizontal: 9,
    borderRadius: 999,
    backgroundColor: color.surfaceSubtle,
  },
  roleText: { fontFamily: font.bold, fontSize: 9, letterSpacing: 0.3, color: color.slateMuted },

  shareCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    marginTop: 22,
    padding: 14,
    borderRadius: 20,
    backgroundColor: color.navy,
  },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 26 },
  dividerLine: { flex: 1, height: 1, backgroundColor: color.hairline },
  dividerText: { ...type.caption, fontSize: 9.5, letterSpacing: 1.3, color: color.slateFaint },
  // Solid brand yellow on navy. The pale wash this replaced read as a disabled
  // control — a 10%-opacity tint of an accent is the same shape the rest of the
  // app uses for "you cannot press this".
  shareIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareTitle: { ...type.bodyMedium, fontSize: 14.5, color: color.surface },
  shareBody: { ...type.caption, fontSize: 10.5, lineHeight: 15, letterSpacing: 0, color: color.creamDim, marginTop: 3 },
  shareNote: { ...type.caption, fontSize: 10, lineHeight: 15, letterSpacing: 0, color: color.slateFaint, marginTop: space.md, paddingHorizontal: 4 },

  previousCard: {
    marginTop: 22,
    padding: 16,
    borderRadius: 24,
    backgroundColor: color.surfaceSubtle,
  },
  previousHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 4 },
  previousTitle: { ...type.heading, fontSize: 16, color: color.navy },
  previousBody: { ...type.caption, fontSize: 10.5, lineHeight: 15, letterSpacing: 0, color: color.slateMuted, marginTop: 3 },
  previousAll: { fontFamily: font.bold, fontSize: 12.5, color: color.electric, paddingTop: 2 },
  previousRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: color.hairline,
  },
  previousSend: {
    minHeight: 50,
    marginTop: 14,
    borderRadius: 16,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previousSendIdle: { opacity: 0.45 },
  previousSendText: { fontFamily: font.bold, fontSize: 14, color: color.navy },

  pressed: { opacity: 0.88 },
  doneAction: { minHeight: 42, paddingHorizontal: 10, justifyContent: 'center' },
  doneText: { fontFamily: font.bold, fontSize: 14, color: color.electric },
  finish: {
    minHeight: 54,
    borderRadius: 17,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.xl,
  },
  finishText: { fontFamily: font.bold, fontSize: 14, color: color.navy },
});
