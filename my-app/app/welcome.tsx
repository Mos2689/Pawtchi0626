import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import Animated, {
  FadeIn, FadeInDown,
  useSharedValue, useAnimatedStyle, withDelay, withRepeat, withSequence, withTiming, Easing,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useFocusEffect } from '@react-navigation/native';
import { color, font, space, motion } from '../constants/design';
import { useAuth } from '../providers/AuthProvider';
import { track } from '../lib/analytics';
import { BreathingPaw } from '../components/BreathingPaw';

// Streamed from the same Supabase public-assets bucket used for pet avatars.
// Swap by replacing the file in the bucket — no app release needed.
const INTRO_VIDEO_URL =
  'https://mbvpjbwukhypvmgeuyyw.supabase.co/storage/v1/object/public/public-assets/introscreen-optimized.mp4';

// If the video hasn't shown a frame in this long, fall back to typography only.
const VIDEO_FALLBACK_MS = 1500;

// CTA breathing: starts after an idle beat, one slow inhale/exhale cycle.
// No motion token exists at this timescale — these two are welcome-only.
const BREATH_DELAY_MS = 2000;
const BREATH_MS = 1200;

// Tagline stagger: "Notice" lands, then "everything" follows and its tracking
// settles — typography as the first motion statement of the brand.
const TAGLINE_WORD_DELAY_MS = 160;
const TAGLINE_BASE_DELAY_MS = 320;

// Welcome — the first brand moment. Atmospheric video bleeds to the edges; the
// locked tagline NOTICE EVERYTHING is split across corners over a soft scrim.
// Navy + cream + the one yellow (§4.02). Authed users skip straight to /(tabs).
export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();

  // Track explicit welcome screen view
  useEffect(() => {
    track('welcome_screen_viewed', {});
  }, []);

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

  // Second tagline word settles from loose to resting tracking as it lands.
  const trackingSettle = useSharedValue(3);
  useEffect(() => {
    trackingSettle.value = withDelay(
      TAGLINE_BASE_DELAY_MS + TAGLINE_WORD_DELAY_MS,
      withTiming(1, { duration: motion.duration.slow * 2, easing: Easing.out(Easing.cubic) }),
    );
  }, [trackingSettle]);
  const trackingStyle = useAnimatedStyle(() => ({ letterSpacing: trackingSettle.value }));

  // The one actionable element breathes once the screen has been idle a beat.
  const breath = useSharedValue(1);
  useEffect(() => {
    breath.value = withDelay(
      BREATH_DELAY_MS,
      withRepeat(
        withSequence(
          withTiming(1.015, { duration: BREATH_MS, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: BREATH_MS, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
      ),
    );
  }, [breath]);
  const breathStyle = useAnimatedStyle(() => ({ transform: [{ scale: breath.value }] }));

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
  // render a quiet cover (no navigation) when a session exists, to avoid a
  // one-frame flash of the welcome video while the gate moves an authed user on.
  //
  // CRITICAL: this cover must be INLINE, never the Modal-based PawLoader. This
  // screen stays mounted at the bottom of the root stack after login/signup,
  // and a Modal rendered from an unfocused screen floats above the ENTIRE app —
  // on Android it permanently covered the species screen (and the tabs) with a
  // loader that wasn't waiting on anything. iOS detaches inactive screens
  // differently, which is why the bug read as "Android only".
  if (session) {
    return (
      <View style={[styles.container, styles.sessionCover]}>
        <StatusBar style="light" />
        <BreathingPaw size={34} workingColor={color.navy} />
      </View>
    );
  }

  const showVideo = videoReady && !videoFailed;

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* ── Layer 1: video, full-bleed ──
          Mounted only once the player reports readyToPlay. An unbuffered
          VideoView paints its native surface BLACK while loading, which would
          cover the navy container — so during load we show nothing here and let
          the navy ground + scrim (Layer 2) carry the frame. Fading in on first
          ready gives a clean handoff instead of a hard cut. */}
      {showVideo && (
        <Animated.View entering={FadeIn.duration(motion.duration.slow)} style={StyleSheet.absoluteFill}>
          <VideoView
            player={player}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            nativeControls={false}
            allowsPictureInPicture={false}
          />
        </Animated.View>
      )}

      {/* ── Layer 2: scrim — ONLY in the no-video fallback ──
          Over the video we deliberately drop the scrim so the footage reads
          vivid, not dull; legibility comes from the per-glyph navy text shadows
          below. In fallback there's no footage to protect, so a richer navy
          curtain gives the typography depth on the solid navy ground. */}
      {!showVideo && (
        <LinearGradient
          colors={['rgba(7,32,42,0.92)', 'rgba(7,32,42,0.88)', 'rgba(7,32,42,0.98)']}
          locations={[0, 0.45, 1]}
          style={StyleSheet.absoluteFill}
        />
      )}

      {/* ── Layer 3: content ── */}
      <View style={[styles.content, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.xl }]}>
        {/* Wordmark — centered top */}
        <Animated.View entering={FadeIn.duration(500)} style={styles.wordmarkWrap}>
          <Text style={styles.wordmark}>PAWTCHI</Text>
        </Animated.View>

        {/* Sub-tagline + CTAs */}
        <View style={styles.actions}>
          <View style={styles.taglineRow}>
            <Animated.Text
              entering={FadeInDown.duration(motion.duration.slow).delay(TAGLINE_BASE_DELAY_MS)}
              style={styles.tagline}
            >
              Notice{' '}
            </Animated.Text>
            <Animated.Text
              entering={FadeInDown.duration(motion.duration.slow).delay(TAGLINE_BASE_DELAY_MS + TAGLINE_WORD_DELAY_MS)}
              style={[styles.tagline, trackingStyle]}
            >
              everything
            </Animated.Text>
          </View>

          <Animated.View
            entering={FadeInDown.duration(500).delay(TAGLINE_BASE_DELAY_MS + TAGLINE_WORD_DELAY_MS * 2)}
            style={styles.ctaBlock}
          >
            <Animated.View style={[styles.ctaBreath, breathStyle]}>
              <TouchableOpacity
                style={styles.cta}
                activeOpacity={0.9}
                onPress={() => {
                  Haptics.selectionAsync();
                  track('ui_button_tapped', { button_name: 'get_started', screen: 'welcome' });
                  router.push({ pathname: '/(auth)/login', params: { mode: 'signup' } } as any);
                }}
              >
                <Text style={styles.ctaText}>Get started</Text>
              </TouchableOpacity>
            </Animated.View>

            <TouchableOpacity
              onPress={() => {
                track('ui_button_tapped', { button_name: 'already_have_account', screen: 'welcome' });
                router.push({ pathname: '/(auth)/login', params: { mode: 'signin' } } as any);
              }}
              style={styles.secondary}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.secondaryText}>I already have an account</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.navy },
  center: { justifyContent: 'center', alignItems: 'center' },
  // The authed anti-flash cover — matches the loader's white ground but stays
  // INSIDE this screen's view hierarchy (see the session branch above).
  sessionCover: {
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },

  content: {
    flex: 1,
    paddingHorizontal: space.xxl,
  },

  wordmarkWrap: { alignItems: 'center' },
  // Same display treatment as the login hero wordmark — one object, two sizes.
  wordmark: {
    fontFamily: font.display,
    fontSize: 20,
    letterSpacing: 4,
    color: color.cream,
    // Navy halo keeps cream legible now that the scrim is gone over the video.
    textShadowColor: color.navy,
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },

  actions: {
    position: 'absolute',
    left: space.xxl,
    right: space.xxl,
    bottom: space.xxxl,
    alignItems: 'center',
  },
  taglineRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-end',
    marginBottom: space.xxl,
  },
  tagline: {
    fontFamily: font.display,
    fontSize: 44,
    lineHeight: 44,
    letterSpacing: 1,
    color: color.cream,
    textAlign: 'center',
    // The hero line — a strong navy drop shadow anchors "Notice everything"
    // over any video frame without a full-screen dark layer dulling the footage.
    textShadowColor: color.navy,
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 16,
  },
  ctaBlock: {
    width: '100%',
    alignItems: 'center',
  },
  ctaBreath: {
    width: '100%',
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
    textShadowColor: color.navy,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
});
