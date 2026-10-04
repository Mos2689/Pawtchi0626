import React, { useEffect, useState } from 'react';
import { describeError } from '../lib/appError';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { CommunityButton, CommunityCard, CommunityHeader, communityScreenStyles } from '../components/community/CommunityUI';
import { color, space, type } from '../constants/design';
import { claimExternalInvite, type InviteClaimOutcome } from '../lib/communityWalks';
import { clearCommunityInviteCode, rememberCommunityInviteCode } from '../lib/communityInviteIntent';
import { requestPushPermission } from '../lib/notifications/pushRegistration';
import { useNotificationPermission } from '../hooks/useNotificationPermission';
import { useAuth } from '../providers/AuthProvider';

/** Everything after a claim: one screen state per answer the server can give. */
type Result = Exclude<InviteClaimOutcome, 'invalid_or_expired'> | 'invalid' | null;

const COPY: Record<'entry' | 'host_confirmation_required' | 'own_invite' | 'already_member', { title: string; body: string }> = {
  entry: {
    title: 'Join a Pawtchi meetup',
    body: 'Paste the code from your invitation. Signing in never admits you automatically.',
  },
  host_confirmation_required: {
    title: 'The host will confirm you',
    body: 'This is a close-knit meetup, so the host will confirm your request before you’re added. We’ll let you know as soon as they’ve approved you.',
  },
  own_invite: {
    title: 'This is your invite',
    body: 'Opening it yourself doesn’t use it up. Send it to the person you’re inviting, and they’ll ask to join from there.',
  },
  already_member: {
    title: 'You’re already in this meetup',
    body: 'This link is for someone new. Your meetups and their next walks are in Connect.',
  },
};

export default function CommunityInviteScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState(params.code ?? '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [error, setError] = useState<string | null>(null);

  const claim = async (value = code) => {
    if (!value.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await claimExternalInvite(value);
      await clearCommunityInviteCode();
      setResult(outcome === 'invalid_or_expired' ? 'invalid' : outcome);
    } catch (cause) {
      setError(describeError(cause, 'community_action'));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (params.code) {
      void rememberCommunityInviteCode(params.code);
      if (user) void claim(params.code);
    }
    // Run once for the deep-link payload. Manual edits use the button below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Connect lives on Home; this opens it there (see the params in (tabs)/index).
  const goToConnect = () => router.replace({ pathname: '/(tabs)', params: { segment: 'together' } } as never);
  const settled = result === 'host_confirmation_required' || result === 'own_invite' || result === 'already_member';
  const copy = settled ? COPY[result] : COPY.entry;

  return (
    <SafeAreaView style={communityScreenStyles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <CommunityHeader inline title={copy.title} subtitle={copy.body} onBack={() => router.back()} />
        <ScrollView contentContainerStyle={communityScreenStyles.scroll} keyboardShouldPersistTaps="handled">
          {!user ? (
            <CommunityCard style={styles.resultCard}>
              <Ionicons name="lock-closed-outline" size={34} color={color.electric} />
              <Text style={styles.resultTitle}>Sign in to continue</Text>
              <Text style={styles.resultBody}>Pawtchi will keep this invitation code and bring you back after sign-in or onboarding.</Text>
              <CommunityButton label="Sign in or create an account" onPress={() => router.push({ pathname: '/(auth)/login', params: { mode: 'signin' } } as never)} style={styles.resultButton} />
            </CommunityCard>
          ) : result === 'host_confirmation_required' ? (
            <RequestSent onGoToConnect={goToConnect} onOpenSettings={() => router.push('/notifications' as never)} />
          ) : result === 'own_invite' || result === 'already_member' ? (
            <CommunityCard style={styles.resultCard}>
              <Ionicons name={result === 'own_invite' ? 'paper-plane-outline' : 'people-outline'} size={34} color={color.electric} />
              <Text style={styles.resultBody}>
                {result === 'own_invite'
                  ? 'The link still works for the person you send it to.'
                  : 'Open Connect to see it.'}
              </Text>
              <CommunityButton label="Go to Connect" onPress={goToConnect} style={styles.resultButton} />
            </CommunityCard>
          ) : (
            <>
              <Text style={styles.label}>INVITATION CODE</Text>
              <TextInput
                value={code}
                onChangeText={value => { setCode(value.trim()); setResult(null); }}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                placeholderTextColor={color.slateFaint}
                style={communityScreenStyles.field}
                accessibilityLabel="Invitation code"
              />
              {result === 'invalid' ? (
                <Text style={communityScreenStyles.error}>
                  This invite has expired or has already been used. Ask the host to send you a new one.
                </Text>
              ) : null}
              {error ? <Text style={communityScreenStyles.error}>{error}</Text> : null}
              <CommunityButton label={busy ? 'Checking…' : 'Ask to join'} onPress={() => void claim()} disabled={busy || code.length < 10} style={styles.submit} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * The request is with the host. The only thing left to settle is whether
 * Pawtchi can tell this person when they are in — the promise in the copy
 * above. Reachable: straight on to Connect. Not reachable: ask, from this tap,
 * using whichever route can actually change it.
 */
function RequestSent({ onGoToConnect, onOpenSettings }: { onGoToConnect: () => void; onOpenSettings: () => void }) {
  const permission = useNotificationPermission();
  const [asking, setAsking] = useState(false);

  const turnOn = async () => {
    // Switched off inside Pawtchi: only the in-app switch can change that.
    if (permission.isGranted && permission.pushEnabledInApp === false) {
      onOpenSettings();
      return;
    }
    // Spent the one OS prompt: only the system settings app can change it.
    if (permission.isBlocked) {
      permission.openSystemSettings();
      return;
    }
    setAsking(true);
    try {
      await requestPushPermission();
    } catch {
      // The OS said no or could not ask; the card below still reads the truth.
    } finally {
      await permission.refresh();
      setAsking(false);
    }
  };

  const loading = permission.status === 'loading';
  const reachable = permission.isReachable;

  return (
    <CommunityCard style={styles.resultCard}>
      <Ionicons name={reachable ? 'checkmark-circle-outline' : 'hourglass-outline'} size={34} color={color.electric} />
      <Text style={styles.resultTitle}>Request sent</Text>
      {loading ? null : reachable ? (
        <>
          <Text style={styles.resultBody}>You’ll get a notification when you’re in.</Text>
          <CommunityButton label="Go to Connect" onPress={onGoToConnect} style={styles.resultButton} />
        </>
      ) : (
        <>
          <Text style={styles.resultBody}>
            Notifications are off, so you won’t hear when the host confirms you. Turn them on to get the update.
          </Text>
          <CommunityButton
            label={asking ? 'Asking…' : 'Turn on notifications'}
            icon="notifications-outline"
            onPress={() => void turnOn()}
            disabled={asking}
            style={styles.resultButton}
          />
          <CommunityButton label="Go to Connect" variant="quiet" onPress={onGoToConnect} style={styles.secondaryButton} />
        </>
      )}
    </CommunityCard>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  label: { ...type.caption, color: color.slateMuted, marginBottom: space.sm },
  submit: { marginTop: space.xl },
  resultCard: { alignItems: 'center', paddingVertical: space.xxxl },
  resultTitle: { ...type.title, color: color.navy, marginTop: space.lg },
  resultBody: { ...type.body, color: color.slateMuted, textAlign: 'center', marginTop: space.sm },
  resultButton: { alignSelf: 'stretch', marginTop: space.xl },
  secondaryButton: { alignSelf: 'stretch', marginTop: space.xs },
});
