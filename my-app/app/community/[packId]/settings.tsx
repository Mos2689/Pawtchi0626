import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import {
  CommunityButton,
  CommunityCard,
  CommunityHeader,
  DogAvatar,
  communityScreenStyles,
} from '../../../components/community/CommunityUI';
import { color, space, type } from '../../../constants/design';
import {
  blockAndReportUser,
  leavePack,
  loadPack,
  removePackMember,
  setPackMuted,
  transferPackOwnership,
  type CommunityPack,
  type PackMember,
} from '../../../lib/communityWalks';
import { cacheKey, invalidate } from '../../../lib/communityCache';
import { useAuth } from '../../../providers/AuthProvider';

export default function PackSettingsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { packId } = useLocalSearchParams<{ packId: string }>();
  const [pack, setPack] = useState<CommunityPack | null>(null);
  const [members, setMembers] = useState<PackMember[]>([]);
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!packId) return;
    try {
      const data = await loadPack(packId);
      setPack(data.pack);
      setMembers(data.members);
      setMuted(data.members.find(member => member.user_id === user?.id)?.notifications_muted ?? false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Meetup settings could not load.');
    }
  }, [packId, user?.id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const isOwner = pack?.owner_id === user?.id;

  const updateMute = async (value: boolean) => {
    if (!packId) return;
    setMuted(value);
    // Unlike the mutations below, this one does not reload — so the snapshot the
    // trail screen paints from still holds the old preference. Removing and
    // transferring both call `load()`, which refetches and leaves it correct.
    try { await setPackMuted(packId, value); invalidate(cacheKey.pack(packId)); }
    catch (cause) { setMuted(!value); setError(cause instanceof Error ? cause.message : 'That preference could not be saved.'); }
  };

  const confirmRemove = (member: PackMember) => {
    const name = member.person?.full_name || member.person?.username || 'this member';
    Alert.alert(`Remove ${name}?`, 'They lose access immediately. Their historical attribution stays unless they remove the associated content.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        setBusy(true);
        try { await removePackMember(packId!, member.user_id); await load(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : 'The member could not be removed.'); }
        finally { setBusy(false); }
      } },
    ]);
  };

  const confirmTransfer = (member: PackMember) => {
    const name = member.person?.full_name || member.person?.username || 'this member';
    Alert.alert(`Make ${name} the pack owner?`, 'They will manage membership and can transfer ownership again. You remain a member.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Transfer', onPress: async () => {
        setBusy(true);
        try { await transferPackOwnership(packId!, member.user_id); await load(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : 'Ownership could not be transferred.'); }
        finally { setBusy(false); }
      } },
    ]);
  };

  const confirmLeave = () => {
    Alert.alert(`Leave ${pack?.name ?? 'this meetup'}?`, 'You lose access to its archive and future plans immediately.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: async () => {
        setBusy(true);
        // The trail is gone from every list that shows it, and Home is one
        // back-press away with a snapshot that still has it.
        try { await leavePack(packId!); invalidate(cacheKey.packs()); router.replace('/(tabs)/community' as never); }
        catch (cause) { setError(cause instanceof Error ? cause.message : 'You could not leave this meetup.'); setBusy(false); }
      } },
    ]);
  };

  const confirmBlock = (member: PackMember) => {
    const name = member.person?.full_name || member.person?.username || 'this person';
    const consequence = isOwner ? 'They will also be removed from this meetup.' : 'You will also leave this meetup so neither of you keeps shared access.';
    Alert.alert(`Block and report ${name}?`, consequence, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Block & report', style: 'destructive', onPress: async () => {
        setBusy(true);
        try {
          await blockAndReportUser({ userId: member.user_id, packId, reason: 'harassment' });
          if (isOwner) {
            await removePackMember(packId!, member.user_id);
            await load();
          } else {
            await leavePack(packId!);
            router.replace('/(tabs)/community' as never);
          }
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'The report could not be sent.');
        } finally { setBusy(false); }
      } },
    ]);
  };

  return (
    <SafeAreaView style={communityScreenStyles.screen}>
      <CommunityHeader eyebrow="Private meetup" title="Meetup settings" subtitle={pack?.name} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={communityScreenStyles.scroll}>
        <CommunityCard style={styles.preference}>
          <View style={styles.preferenceIcon}><Ionicons name="notifications-off-outline" size={21} color={color.electric} /></View>
          <View style={styles.flex}>
            <Text style={styles.preferenceTitle}>Mute this meetup</Text>
            <Text style={styles.preferenceBody}>Keep access without outing reminders or media updates. Invitations and essential account notices still arrive.</Text>
          </View>
          <Switch value={muted} onValueChange={value => void updateMute(value)} trackColor={{ false: color.track, true: color.electric }} thumbColor={color.surface} />
        </CommunityCard>

        <Text style={communityScreenStyles.sectionEyebrow}>{isOwner ? 'MANAGE MEMBERS' : 'PACK MEMBERS'}</Text>
        <CommunityCard>
          {members.map((member, index) => {
            const dog = member.dogs[0] ?? { id: member.user_id, name: member.person?.full_name ?? 'Friend', image_url: member.person?.avatar_url ?? null };
            const isMe = member.user_id === user?.id;
            return (
              <View key={member.user_id} style={[styles.memberRow, index > 0 && styles.memberRule]}>
                <DogAvatar dog={dog} size={44} />
                <View style={styles.flex}>
                  <Text style={styles.memberName}>{member.dogs.map(item => item.name).join(' & ') || member.person?.full_name || 'Pack member'}</Text>
                  <Text style={styles.memberMeta}>{member.role === 'owner' ? 'Pack owner' : member.person?.username ? `@${member.person.username}` : 'Member'}{isMe ? ' · You' : ''}</Text>
                </View>
                {!isMe ? (
                  <Pressable
                    onPress={() => isOwner && member.role !== 'owner' ? confirmRemove(member) : confirmBlock(member)}
                    disabled={busy}
                    style={styles.memberAction}
                    accessibilityLabel={isOwner && member.role !== 'owner' ? 'Remove member' : 'Safety options'}
                  >
                    <Ionicons name={isOwner && member.role !== 'owner' ? 'person-remove-outline' : 'shield-outline'} size={20} color={color.slateMuted} />
                  </Pressable>
                ) : null}
                {isOwner && !isMe && member.role !== 'owner' ? (
                  <View style={styles.ownerActions}>
                    <Pressable onPress={() => confirmTransfer(member)} disabled={busy}><Text style={styles.ownerActionText}>Transfer</Text></Pressable>
                    <Pressable onPress={() => confirmBlock(member)} disabled={busy}><Text style={styles.reportText}>Report</Text></Pressable>
                  </View>
                ) : null}
              </View>
            );
          })}
        </CommunityCard>

        {!isOwner ? <CommunityButton label={busy ? 'Leaving…' : 'Leave pack'} variant="danger" onPress={confirmLeave} disabled={busy} style={styles.leaveButton} /> : null}
        {isOwner ? <Text style={styles.ownerHelp}>Transfer ownership before leaving. Pack ownership keeps membership changes accountable to one person.</Text> : null}
        <Text style={styles.removalNote}>Downloaded external keepsakes cannot be recalled. Pawtchi states this before every export.</Text>
        {error ? <Text style={communityScreenStyles.error}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  preference: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  preferenceIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: color.electricSoft, alignItems: 'center', justifyContent: 'center' },
  preferenceTitle: { ...type.heading, color: color.navy },
  preferenceBody: { ...type.body, color: color.slateMuted, marginTop: 3 },
  memberRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: space.md, position: 'relative' },
  memberRule: { borderTopWidth: 1, borderTopColor: color.hairline },
  memberName: { ...type.label, color: color.navy },
  memberMeta: { ...type.body, color: color.slateMuted, marginTop: 2 },
  memberAction: { width: 44, height: 44, borderRadius: 22, backgroundColor: color.surfaceSubtle, alignItems: 'center', justifyContent: 'center' },
  ownerActions: { position: 'absolute', right: 50, bottom: 5, flexDirection: 'row', gap: space.md },
  ownerActionText: { ...type.caption, color: color.electric },
  reportText: { ...type.caption, color: color.error },
  leaveButton: { marginTop: space.xxl },
  ownerHelp: { ...type.body, color: color.slateMuted, textAlign: 'center', marginTop: space.xxl },
  removalNote: { ...type.body, color: color.slateMuted, textAlign: 'center', marginTop: space.lg },
});
