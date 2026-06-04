import React from 'react';
import { View, Text, StyleSheet, Image, Share, TouchableOpacity, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { useActivePetStore } from '../store/useActivePetStore';
import {
  buildInviteSubcopy,
  buildInviteMessage,
  buildInviteBody,
  PAWTCHI_INVITE_URL,
} from '../lib/referral';

// ─── Brand system (Pradip's design system) ───
// Two colours only: deep navy structure, electric yellow accent. No gradients.
const NAVY = '#07202a';
const YELLOW = '#FFFC00';
const CREAM = '#F4F1EC';
const CREAM_MUTED = 'rgba(244, 241, 236, 0.55)';

const FALLBACK_PET_IMAGE =
  'https://images.unsplash.com/photo-1543466835-00a7907e9de1?q=80&w=1000&auto=format&fit=crop';

export default function InviteScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activePet } = useActivePetStore();

  const petName = activePet?.name?.trim() || null;
  const displayName = petName || 'your companion';
  const subcopy = buildInviteSubcopy(activePet?.name);

  const handleInvite = async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const pet = activePet ?? undefined;
      if (Platform.OS === 'ios') {
        // Pass the link as a separate `url` so iOS unfurls it into a rich preview
        // card (image + title) using the Open Graph tags on pawtchi.com.
        await Share.share({ message: buildInviteBody(pet), url: PAWTCHI_INVITE_URL });
      } else {
        // Android's Share API ignores `url`, so keep the link inside the message.
        await Share.share({ message: buildInviteMessage(pet) });
      }
    } catch (err) {
      // Dismissing the share sheet is expected — nothing to handle.
      console.warn('Share dismissed or failed:', err);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* ─── Minimal nav ─── */}
      <View style={styles.nav}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.navBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <MaterialIcons name="arrow-back" size={24} color={CREAM} />
        </TouchableOpacity>
        <Text style={styles.wordmark}>PAWTCHI</Text>
        <View style={styles.navBtn} />
      </View>

      {/* ─── Hero ─── */}
      <View style={styles.hero}>
        <Animated.View entering={FadeIn.duration(700)} style={styles.portraitRing}>
          <Image
            source={{ uri: activePet?.image_url || FALLBACK_PET_IMAGE }}
            style={styles.portrait}
          />
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(700).delay(140)} style={styles.copyBlock}>
          <Text style={styles.overline}>Notice everything</Text>
          <Text style={styles.headline}>
            A friend for{' '}
            <Text style={styles.headlineAccent}>{displayName}</Text>
          </Text>
          <Text style={styles.subcopy}>{subcopy}</Text>
        </Animated.View>
      </View>

      {/* ─── Call to action ─── */}
      <Animated.View
        entering={FadeInDown.duration(700).delay(280)}
        style={[styles.ctaBar, { paddingBottom: insets.bottom + 20 }]}
      >
        <TouchableOpacity style={styles.ctaButton} onPress={handleInvite} activeOpacity={0.85}>
          <Text style={styles.ctaText}>Invite a friend</Text>
          <MaterialIcons name="arrow-forward" size={20} color={NAVY} />
        </TouchableOpacity>
        <Text style={styles.privacy}>Nothing is shared until you choose where to send it</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: NAVY,
  },

  // Nav
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    height: 56,
  },
  navBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  wordmark: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 14,
    letterSpacing: 3,
    color: CREAM,
  },

  // Hero — centred, generous breathing room
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
  },
  portraitRing: {
    width: 196,
    height: 196,
    borderRadius: 98,
    borderWidth: 1.5,
    borderColor: YELLOW,
    padding: 9,
    marginBottom: 48,
  },
  portrait: {
    flex: 1,
    borderRadius: 90,
  },
  copyBlock: {
    alignItems: 'center',
  },
  overline: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 13,
    letterSpacing: 2,
    color: YELLOW,
    marginBottom: 20,
  },
  headline: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 40,
    lineHeight: 46,
    letterSpacing: -0.5,
    color: CREAM,
    textAlign: 'center',
  },
  headlineAccent: {
    color: YELLOW,
  },
  subcopy: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '400',
    fontSize: 16,
    lineHeight: 26,
    color: CREAM_MUTED,
    textAlign: 'center',
    maxWidth: 320,
    marginTop: 20,
  },

  // CTA
  ctaBar: {
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 62,
    borderRadius: 18,
    backgroundColor: YELLOW,
  },
  ctaText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 17,
    color: NAVY,
  },
  privacy: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '500',
    fontSize: 12,
    letterSpacing: 0.3,
    color: CREAM_MUTED,
    textAlign: 'center',
    marginTop: 16,
  },
});
