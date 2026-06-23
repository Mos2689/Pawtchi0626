import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useFocusEffect } from '@react-navigation/native';
import { color, font, space } from '../constants/design';
import { useAuth } from '../providers/AuthProvider';

// Streamed from the same Supabase public-assets bucket used for pet avatars.
// Swap by replacing the file in the bucket — no app release needed.
const INTRO_VIDEO_URL =
  'https://mbvpjbwukhypvmgeuyyw.supabase.co/storage/v1/object/public/public-assets/download%20(6).mp4';

// If the video hasn't shown a frame in this long, fall back to typography only.
const VIDEO_FALLBACK_MS = 1500;

// Welcome — the first brand moment. Atmospheric video bleeds to the edges; the
// locked tagline NOTICE EVERYTHING is split across corners over a soft scrim.
// Navy + cream + the one yellow (§4.02). Authed users skip straight to /(tabs).
export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();

  const player = useVideoPlayer(INTRO_VIDEO_URL, (p) => {
    try {
      p.muted = true;
      p.loop = true;
    } catch {}
  });

  // Reactive status from expo-video. useEvent owns the subscription lifecycle —
  // safe under React 18 Strict Mode double-mount, unlike a manual addListener.
  const statusEvent = useEvent(player, 'statusChange', { status: player.status });
  const playerStatus = statusEvent?.status ?? player.status ?? 'idle';
  const videoReady = playerStatus === 'readyToPlay';
  const videoErrored = playerStatus === 'error';

  // Drop to the typography fallback if nothing has rendered within
  // VIDEO_FALLBACK_MS — keeps the hero feeling intentional offline / on slow nets.
  const [slowConnection, setSlowConnection] = useState(false);
  useEffect(() => {
    if (videoReady || videoErrored) return;
    const id = setTimeout(() => setSlowConnection(true), VIDEO_FALLBACK_MS);
    return () => clearTimeout(id);
  }, [videoReady, videoErrored]);

  const videoFailed = videoErrored || (slowConnection && !videoReady);

  // Play on focus, pause on blur so we don't burn CPU while elsewhere in the app.
  // Try/catch is defensive in case the player has already been released by the
  // time the cleanup runs during fast unmounts.
  useFocusEffect(
    useCallback(() => {
      try { player.play(); } catch {}
      return () => {
        try { player.pause(); } catch {}
      };
    }, [player]),
  );

  // Navigation for authed users is owned by the centralized auth gate in
  // app/_layout.tsx — this screen never redirects on `session` itself. We only
  // render a spinner (no navigation) when a session exists, to avoid a one-frame
  // flash of the welcome video while the gate moves an authed user into /(tabs).
  if (session) {
    return (
      <View style={[styles.container, styles.center]}>
        <StatusBar style="light" />
        <ActivityIndicator size="large" color={color.yellow} />
      </View>
    );
  }

  const showVideo = videoReady && !videoFailed;

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* ── Layer 1: video, full-bleed ── */}
      {!videoFailed && (
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          nativeControls={false}
          allowsFullscreen={false}
          allowsPictureInPicture={false}
        />
      )}

      {/* ── Layer 2: scrim — keeps headline + CTA legible on every frame ── */}
      <LinearGradient
        colors={
          showVideo
            ? ['rgba(7,32,42,0.55)', 'rgba(7,32,42,0.25)', 'rgba(7,32,42,0.85)']
            // Fallback: a richer navy curtain so the typography still feels intentional.
            : ['rgba(7,32,42,0.92)', 'rgba(7,32,42,0.88)', 'rgba(7,32,42,0.98)']
        }
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* ── Layer 3: content ── */}
      <View style={[styles.content, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.xl }]}>
        {/* Wordmark — centered top */}
        <Animated.View entering={FadeIn.duration(500)} style={styles.wordmarkWrap}>
          <Text style={styles.wordmark}>PAWTCHI</Text>
        </Animated.View>

        {/* Sub-tagline + CTAs */}
        <Animated.View entering={FadeInDown.duration(500).delay(320)} style={styles.actions}>
          <Text style={styles.tagline}>Notice everything</Text>

          <TouchableOpacity
            style={styles.cta}
            activeOpacity={0.9}
            onPress={() => {
              Haptics.selectionAsync();
              router.push({ pathname: '/(auth)/login', params: { mode: 'signup' } } as any);
            }}
          >
            <Text style={styles.ctaText}>Get started</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.push({ pathname: '/(auth)/login', params: { mode: 'signin' } } as any)}
            style={styles.secondary}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.secondaryText}>I already have an account</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.navy },
  center: { justifyContent: 'center', alignItems: 'center' },

  content: {
    flex: 1,
    paddingHorizontal: space.xxl,
  },

  wordmarkWrap: { alignItems: 'center' },
  wordmark: {
    fontFamily: font.bold,
    fontSize: 18,
    letterSpacing: 4,
    color: color.cream,
  },

  actions: {
    position: 'absolute',
    left: space.xxl,
    right: space.xxl,
    bottom: space.xxxl,
    alignItems: 'center',
  },
  tagline: {
    fontFamily: font.display,
    fontSize: 44,
    lineHeight: 44,
    letterSpacing: 1,
    color: color.cream,
    textAlign: 'center',
    marginBottom: space.xxl,
  },

  cta: {
    height: 56,
    borderRadius: 999, // pill, matches Feeld
    backgroundColor: color.cream,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    fontFamily: font.bold,
    fontSize: 16,
    color: color.navy,
    letterSpacing: 0.2,
  },

  secondary: { marginTop: space.xl },
  secondaryText: {
    fontFamily: font.semibold,
    fontSize: 14,
    color: color.cream,
  },
});
