/**
 * FirstWalkIntroVideo — the ~9s silent Walk demo shown once on Home after a
 * fresh dog owner completes onboarding. Native controls only: a Skip pill
 * from the first frame, and a "Start a walk" CTA that fades in once the
 * final map frame is on screen.
 *
 * Presentation is pure overlay (absoluteFill), not a Modal — the intro
 * belongs to Home, and letting it float in the same view hierarchy means
 * the status bar, safe-area, and tab-bar layout stay exactly as designed.
 *
 * All eligibility / persistence logic lives in useFirstWalkIntro so this
 * component only owns playback and presentation. Analytics events fire
 * exactly once per lifecycle via refs, so a re-render can't double-count.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  type AppStateStatus,
  Modal,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';

import { color, font, motion, radius, space } from '../constants/design';
import { track } from '../lib/analytics';
import { haptic } from '../lib/haptics';

// Local bundled asset — resolved at build time by Metro and packaged into the
// app binary, so the video is always available offline / on slow connections
// and starts on the first frame without a network round-trip.
const INTRO_VIDEO_SOURCE = require('../assets/pawtchi-clean-map-final.mp4');

// If the player never becomes ready within this window, treat it as a load
// failure and dismiss the overlay so the user is never stranded on a black
// screen. 3s is generous for a bundled asset — a real failure surfaces well
// inside this budget.
const LOAD_TIMEOUT_MS = 3000;

// Known duration (per the spec / encoder), used as the fallback denominator
// for completion_percentage when the player has not yet reported its own
// duration on the event where we compute the metric.
const VIDEO_DURATION_S = 9.2;

export type FirstWalkIntroVideoProps = {
  visible: boolean;
  /** Called on skip, on error, and on `Maybe later`. Persists the seen flag. */
  onDismiss: () => void;
  /**
   * Called after the CTA is tapped. Should perform the same navigation as the
   * Home record button — the CTA must not open a duplicate walk-start path.
   * The parent still receives `onDismiss` first (via the same tap) so the
   * seen flag is persisted before navigation.
   */
  onStartWalk: () => void;
};

export function FirstWalkIntroVideo(props: FirstWalkIntroVideoProps) {
  const { visible, onDismiss, onStartWalk } = props;
  const insets = useSafeAreaInsets();

  // Modal presentation so the intro genuinely covers the tab bar and status
  // bar — a plain absoluteFill inside a tab screen sits UNDER the navigator's
  // tab bar, which would leave part of Home visible under the video.
  //
  // `onRequestClose` fires on Android back-press: treat it as a skip so the
  // system gesture and the on-screen Skip pill share one exit path.
  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <StatusBar barStyle="dark-content" backgroundColor={INTRO_GROUND} />
      {visible ? (
        <IntroOverlay
          onDismiss={onDismiss}
          onStartWalk={onStartWalk}
          insetsTop={insets.top}
          insetsBottom={insets.bottom}
        />
      ) : null}
    </Modal>
  );
}

type OverlayProps = {
  onDismiss: () => void;
  onStartWalk: () => void;
  insetsTop: number;
  insetsBottom: number;
};

function IntroOverlay({ onDismiss, onStartWalk, insetsTop, insetsBottom }: OverlayProps) {
  const player = useVideoPlayer(INTRO_VIDEO_SOURCE, (p) => {
    try {
      p.muted = true;
      p.loop = false;
      // Hold on the last frame after playback ends — the map is the CTA's
      // background. Without this the player would black out on completion.
      p.showNowPlayingNotification = false;
    } catch {
      // Player already released; nothing to configure.
    }
  });

  // Reactive status — useEvent owns its subscription lifecycle so React 18
  // Strict Mode double-mounts don't leak listeners. Mirrors welcome.tsx.
  const statusEvent = useEvent(player, 'statusChange', { status: player.status });
  const playerStatus = statusEvent?.status ?? player.status ?? 'idle';
  const ready = playerStatus === 'readyToPlay';
  const errored = playerStatus === 'error';

  const [completed, setCompleted] = useState(false);

  // Fire-once analytics guards.
  const viewedRef = useRef(false);
  const settledRef = useRef(false);

  // Report the view exactly once — the first successful mount, before any
  // playback outcome. `settledRef` gates the outcome events (skipped /
  // completed / cta / failed) so a re-render or a duplicate handler call
  // cannot inflate the funnel.
  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    track('walk_intro_video_viewed', {
      video_version: 'v1',
      duration_seconds: VIDEO_DURATION_S,
      source: 'post_onboarding',
      platform: Platform.OS,
    });
  }, []);

  // Autoplay as soon as the player reports ready. Wrapped in try/catch
  // because the player can be released mid-frame during a rapid unmount.
  useEffect(() => {
    if (!ready) return;
    try {
      player.play();
    } catch {
      // Nothing to do — the load-timeout branch below will dismiss us.
    }
  }, [ready, player]);

  // Load-failure safety net. If the player never becomes ready inside
  // LOAD_TIMEOUT_MS (or reports an error at any point), dismiss the overlay
  // so the user always lands on Home rather than a black screen.
  useEffect(() => {
    if (ready || errored) return;
    const timer = setTimeout(() => {
      if (!ready) reportFailureAndDismiss('load_timeout');
    }, LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, errored]);

  useEffect(() => {
    if (errored) reportFailureAndDismiss('player_error');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errored]);

  // Pause on background, resume on foreground. AppState is the honest signal
  // — the player has no lifecycle awareness of its own here.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      try {
        if (state === 'active') {
          if (!completed) player.play();
        } else {
          player.pause();
        }
      } catch {
        // Player released — ignore.
      }
    });
    return () => sub.remove();
  }, [player, completed]);

  // Completion — hold on the last frame and reveal the CTA. `playToEnd` is
  // an expo-video runtime event; we subscribe directly (not via useEvent)
  // because the emit is single-shot and the manual subscribe is cheaper.
  useEffect(() => {
    const sub = player.addListener('playToEnd', () => {
      setCompleted(true);
      try {
        // Pausing on the last frame keeps the map visible under the CTA
        // rather than looping or flashing back to the first frame.
        player.pause();
      } catch {}
      if (settledRef.current) return;
      settledRef.current = true;
      track('walk_intro_video_completed', {
        video_version: 'v1',
        duration_seconds: VIDEO_DURATION_S,
        completion_percentage: 100,
        source: 'post_onboarding',
        platform: Platform.OS,
      });
    });
    return () => {
      try { sub.remove(); } catch {}
    };
  }, [player]);

  const currentCompletionPercentage = useCallback(() => {
    try {
      const total = player.duration || VIDEO_DURATION_S;
      const at = player.currentTime || 0;
      if (total <= 0) return 0;
      return Math.min(100, Math.round((at / total) * 100));
    } catch {
      return 0;
    }
  }, [player]);

  const reportFailureAndDismiss = useCallback((reason: string) => {
    if (settledRef.current) {
      onDismiss();
      return;
    }
    settledRef.current = true;
    track('walk_intro_video_failed', {
      video_version: 'v1',
      failure_reason: reason,
      source: 'post_onboarding',
      platform: Platform.OS,
    });
    onDismiss();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDismiss]);

  const handleSkip = useCallback(() => {
    haptic.tap();
    if (!settledRef.current) {
      settledRef.current = true;
      track('walk_intro_video_skipped', {
        video_version: 'v1',
        duration_seconds: VIDEO_DURATION_S,
        completion_percentage: currentCompletionPercentage(),
        source: 'post_onboarding',
        platform: Platform.OS,
      });
    }
    try { player.pause(); } catch {}
    onDismiss();
  }, [onDismiss, player, currentCompletionPercentage]);

  // Anti-double-tap for the CTA. Two rapid taps could otherwise push /walk
  // twice on a slow device and land the user on a stacked screen.
  const ctaHandledRef = useRef(false);
  const handleStart = useCallback(() => {
    if (ctaHandledRef.current) return;
    ctaHandledRef.current = true;
    haptic.success();
    track('walk_intro_video_cta_clicked', {
      video_version: 'v1',
      duration_seconds: VIDEO_DURATION_S,
      completion_percentage: 100,
      source: 'post_onboarding',
      platform: Platform.OS,
    });
    try { player.pause(); } catch {}
    onDismiss();
    onStartWalk();
  }, [onDismiss, onStartWalk, player]);

  const handleMaybeLater = useCallback(() => {
    if (ctaHandledRef.current) return;
    ctaHandledRef.current = true;
    haptic.tap();
    if (!settledRef.current) {
      settledRef.current = true;
      track('walk_intro_video_skipped', {
        video_version: 'v1',
        duration_seconds: VIDEO_DURATION_S,
        completion_percentage: currentCompletionPercentage(),
        source: 'post_onboarding',
        platform: Platform.OS,
      });
    }
    try { player.pause(); } catch {}
    onDismiss();
  }, [onDismiss, player, currentCompletionPercentage]);

  return (
    <Animated.View
      style={styles.root}
      entering={FadeIn.duration(motion.duration.base)}
      exiting={FadeOut.duration(motion.duration.fast)}
      pointerEvents="box-none"
      accessible
      accessibilityLabel="A short silent demo of Pawtchi recording and preserving a walk"
    >
      {/* Solid brand ground under the video so nothing behind the overlay
          bleeds through while the player is still loading. */}
      <View style={styles.ground} pointerEvents="none" />

      {/* The player itself. `contain` keeps every element of the UI shown
          inside the video from being cropped on tall / narrow screens. */}
      {ready && (
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          nativeControls={false}
          allowsPictureInPicture={false}
          allowsFullscreen={false}
        />
      )}

      {/* Bottom gradient for CTA contrast — subtle enough to leave the last
          frame readable, dark enough that the yellow pill stays legible. */}
      {completed && (
        <Animated.View
          entering={FadeIn.duration(motion.duration.base)}
          pointerEvents="none"
          style={styles.bottomGradientWrap}
        >
          <LinearGradient
            colors={['rgba(7,32,42,0)', 'rgba(7,32,42,0.55)']}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}

      {/* Skip — top-right, from the first frame. */}
      <Pressable
        onPress={handleSkip}
        style={[styles.skipHit, { top: insetsTop + space.sm }]}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        accessibilityRole="button"
        accessibilityLabel="Skip the intro video"
        accessibilityHint="Closes the intro and returns you to Home"
      >
        {({ pressed }) => (
          <View style={[styles.skipPill, pressed && styles.skipPillPressed]}>
            <Text style={styles.skipText}>Skip</Text>
          </View>
        )}
      </Pressable>

      {/* Completion CTA — revealed only after the last frame. */}
      {completed && (
        <Animated.View
          entering={FadeInDown.duration(motion.duration.base)
            .easing(Easing.out(Easing.cubic))}
          style={[styles.ctaWrap, { paddingBottom: insetsBottom + space.lg }]}
          pointerEvents="box-none"
        >
          <Pressable
            onPress={handleStart}
            style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
            accessibilityRole="button"
            accessibilityLabel="Start a walk"
            accessibilityHint="Closes the intro and opens the walk recorder"
          >
            <Text style={styles.ctaText}>Start a walk</Text>
          </Pressable>
          <Pressable
            onPress={handleMaybeLater}
            style={styles.secondary}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Maybe later"
            accessibilityHint="Closes the intro and leaves you on Home"
          >
            <Text style={styles.secondaryText}>Maybe later</Text>
          </Pressable>
        </Animated.View>
      )}
    </Animated.View>
  );
}

const INTRO_GROUND = '#FCFCF8';

const styles = StyleSheet.create({
  root: {
    flex: 1,
    // The overlay must eat every touch that isn't on Skip or the CTA — a
    // stray tap should not select a rail card underneath. Setting a solid
    // ground handles this while the player is still loading; once mounted,
    // VideoView occupies the middle layer.
    backgroundColor: INTRO_GROUND,
  },
  ground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: INTRO_GROUND,
  },
  bottomGradientWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 220,
  },

  // Skip pill — translucent white, minimum 44×44 touch target.
  skipHit: {
    position: 'absolute',
    right: space.md,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  skipPill: {
    minWidth: 64,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipPillPressed: {
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  skipText: {
    fontFamily: font.semibold,
    fontSize: 13,
    letterSpacing: 0.2,
    color: color.navy,
  },

  // CTA cluster — the primary pill plus a quieter "Maybe later" beneath.
  ctaWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.xxl,
    alignItems: 'center',
  },
  cta: {
    height: 56,
    width: '100%',
    borderRadius: radius.pill,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaPressed: {
    opacity: 0.92,
  },
  ctaText: {
    fontFamily: font.bold,
    fontSize: 16,
    color: color.navy,
    letterSpacing: 0.2,
  },
  secondary: {
    marginTop: space.md,
    paddingVertical: space.xs,
  },
  secondaryText: {
    fontFamily: font.semibold,
    fontSize: 13,
    color: color.navy,
    opacity: 0.7,
  },
});
