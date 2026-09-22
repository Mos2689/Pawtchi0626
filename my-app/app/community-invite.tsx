import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { CommunityButton, CommunityCard, CommunityHeader, communityScreenStyles } from '../components/community/CommunityUI';
import { color, space, type } from '../constants/design';
import { claimExternalInvite } from '../lib/communityWalks';
import { clearCommunityInviteCode, rememberCommunityInviteCode } from '../lib/communityInviteIntent';
import { useAuth } from '../providers/AuthProvider';

export default function CommunityInviteScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState(params.code ?? '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<'waiting' | 'invalid' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const claim = async (value = code) => {
    if (!value.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await claimExternalInvite(value);
      await clearCommunityInviteCode();
      setResult(outcome === 'host_confirmation_required' ? 'waiting' : 'invalid');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The invitation could not be recovered.');
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

  return (
    <SafeAreaView style={communityScreenStyles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <CommunityHeader
          eyebrow="Private invitation"
          title={result === 'waiting' ? 'The host will confirm you' : 'Join a Pawtchi trail'}
          subtitle={result === 'waiting'
            ? 'Your request is waiting in the pack. This extra step means a forwarded link can’t admit an unknown account.'
            : 'Paste the recoverable code from your invitation. Signing in never admits you automatically.'}
          onBack={() => router.back()}
        />
        <ScrollView contentContainerStyle={communityScreenStyles.scroll} keyboardShouldPersistTaps="handled">
          {!user ? (
            <CommunityCard style={styles.resultCard}>
              <Ionicons name="lock-closed-outline" size={34} color={color.electric} />
              <Text style={styles.resultTitle}>Sign in to continue</Text>
              <Text style={styles.resultBody}>Pawtchi will keep this invitation code and bring you back after sign-in or onboarding.</Text>
              <CommunityButton label="Sign in or create an account" onPress={() => router.push({ pathname: '/(auth)/login', params: { mode: 'signin' } } as never)} style={styles.resultButton} />
            </CommunityCard>
          ) : result === 'waiting' ? (
            <CommunityCard style={styles.resultCard}>
              <Ionicons name="hourglass-outline" size={34} color={color.electric} />
              <Text style={styles.resultTitle}>Request sent</Text>
              <Text style={styles.resultBody}>You’ll see the pack after its owner confirms that you’re the intended person.</Text>
              <CommunityButton label="Go to my trails" onPress={() => router.replace('/(tabs)/community' as never)} style={styles.resultButton} />
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
              {result === 'invalid' ? <Text style={communityScreenStyles.error}>That code is invalid, expired, or has already been used.</Text> : null}
              {error ? <Text style={communityScreenStyles.error}>{error}</Text> : null}
              <CommunityButton label={busy ? 'Checking…' : 'Ask to join'} onPress={() => void claim()} disabled={busy || code.length < 10} style={styles.submit} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
});
