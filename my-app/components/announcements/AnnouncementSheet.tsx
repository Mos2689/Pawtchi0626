/**
 * AnnouncementSheet — the launch-announcement bottom sheet.
 *
 * Reusable and props-driven: it renders whatever catalogue entry it is given
 * and knows nothing about Connect. Which entry, and whether to show one at
 * all, is hooks/useAnnouncements.ts.
 *
 * ── Three things, and only three ────────────────────────────────────────────
 *
 * A full-bleed media band, a title with one line under it, and one button.
 * The close "×" sits on the media instead of a "Not now" row. An earlier
 * version with an eyebrow, a two-line body and a secondary button was judged
 * too crowded in preview; catalogue.test.ts keeps the copy short enough that
 * it stays this way.
 *
 * ── Motion ──────────────────────────────────────────────────────────────────
 *
 *   In:   the iOS drawer curve, no overshoot; backdrop fades; text and button
 *         follow 50 ms apart.
 *   Out:  faster than in (200 ms), a strong ease-out.
 *   Drag: down to dismiss — past 30% of the sheet or a quick flick. Upward
 *         drags meet friction rather than a wall.
 *   Reduced motion: fades only, and the video stays on its poster.
 *
 * Every close path animates out first and reports its outcome once the sheet
 * is gone, so the caller can navigate without the sheet still on screen.
 */

import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';

import { color, font, motion, radius, space } from '../../constants/design';
import { haptic } from '../../lib/haptics';
import type { Announcement } from '../../lib/announcements/catalogue';
import { ANNOUNCEMENT_MEDIA } from './announcementMedia';

export type AnnouncementOutcome = 'cta' | 'close' | 'swipe' | 'backdrop' | 'back';

const SHEET_FRACTION = 0.4;
const SHEET_MIN = 320;
const SHEET_MAX = 460;
const MEDIA_FRACTION = 0.45;
const BACKDROP_OPACITY = 0.4;

const ENTER_MS = motion.duration.slow;
const EXIT_MS = 200;
const STAGGER_MS = 50;
const REVEAL_MS = 320;
/** How far text rises as it fades in. */
const RISE = 6;
const ENTER_EASING = Easing.bezier(0.32, 0.72, 0, 1);
const EXIT_EASING = Easing.bezier(0.23, 1, 0.32, 1);

/** Past this share of the sheet's height, a drag dismisses on release. */
const DISMISS_FRACTION = 0.3;
/** A flick this fast (px/s) dismisses regardless of distance. */
const DISMISS_VELOCITY = 600;

interface Props {
  announcement: Announcement;
  onClosed: (outcome: AnnouncementOutcome) => void;
}

export function AnnouncementSheet({ announcement, onClosed }: Props) {
  const { height: windowH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();

  const bodyH = Math.round(Math.min(SHEET_MAX, Math.max(SHEET_MIN, windowH * SHEET_FRACTION)));
  const sheetH = bodyH + insets.bottom;
  const mediaH = Math.round(bodyH * MEDIA_FRACTION);

  const shown = useSharedValue(0); // 0 hidden → 1 open; drives backdrop and fade
  const offset = useSharedValue(reduceMotion ? 0 : sheetH); // translateY
  // Title, body and button follow the sheet in, one stagger step apart.
  const titleIn = useSharedValue(0);
  const bodyIn = useSharedValue(0);
  const ctaIn = useSharedValue(0);
  const pressed = useSharedValue(1);
  const closing = React.useRef(false);
  // The UI-thread twin of `closing`: a drag that starts during the exit must
  // not take over the offset, or the exit is cancelled and onClosed never runs.
  const exiting = useSharedValue(false);

  React.useEffect(() => {
    shown.value = withTiming(1, { duration: reduceMotion ? motion.duration.fast : motion.duration.base });
    if (reduceMotion) {
      titleIn.value = 1;
      bodyIn.value = 1;
      ctaIn.value = 1;
    } else {
      offset.value = withTiming(0, { duration: ENTER_MS, easing: ENTER_EASING });
      const reveal = { duration: REVEAL_MS, easing: EXIT_EASING };
      titleIn.value = withDelay(STAGGER_MS, withTiming(1, reveal));
      bodyIn.value = withDelay(STAGGER_MS * 2, withTiming(1, reveal));
      ctaIn.value = withDelay(STAGGER_MS * 3, withTiming(1, reveal));
    }
    // Mount-only: the sheet animates in exactly once per showing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = React.useCallback(
    (outcome: AnnouncementOutcome) => {
      if (closing.current) return;
      closing.current = true;
      exiting.value = true;
      const finish = (done?: boolean) => {
        'worklet';
        if (done !== false) runOnJS(onClosed)(outcome);
      };
      shown.value = withTiming(0, { duration: EXIT_MS, easing: EXIT_EASING }, reduceMotion ? finish : undefined);
      if (!reduceMotion) {
        offset.value = withTiming(sheetH, { duration: EXIT_MS, easing: EXIT_EASING }, finish);
      }
    },
    [exiting, offset, onClosed, reduceMotion, sheetH, shown],
  );

  const onCta = React.useCallback(() => {
    haptic.tap();
    close('cta');
  }, [close]);

  const pan = React.useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([-8, 8])
        .onUpdate((e) => {
          if (reduceMotion || exiting.value) return;
          const y = e.translationY;
          // Friction upward: the sheet gives a little, then less and less.
          offset.value = y >= 0 ? y : -Math.pow(-y, 0.6);
        })
        .onEnd((e) => {
          if (reduceMotion || exiting.value) return;
          const y = e.translationY;
          if (y > 0 && (y > bodyH * DISMISS_FRACTION || e.velocityY > DISMISS_VELOCITY)) {
            runOnJS(close)('swipe');
          } else {
            offset.value = withTiming(0, { duration: motion.duration.base, easing: ENTER_EASING });
          }
        }),
    [bodyH, close, exiting, offset, reduceMotion],
  );

  const backdropStyle = useAnimatedStyle(() => ({ opacity: shown.value * BACKDROP_OPACITY }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: offset.value }],
    opacity: reduceMotion ? shown.value : 1,
  }));
  const titleStyle = useAnimatedStyle(() => ({
    opacity: titleIn.value,
    transform: [{ translateY: (1 - titleIn.value) * RISE }],
  }));
  const bodyStyle = useAnimatedStyle(() => ({
    opacity: bodyIn.value,
    transform: [{ translateY: (1 - bodyIn.value) * RISE }],
  }));
  const ctaStyle = useAnimatedStyle(() => ({
    opacity: ctaIn.value,
    transform: [{ translateY: (1 - ctaIn.value) * RISE }, { scale: pressed.value }],
  }));

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={() => close('back')}>
      <GestureHandlerRootView style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => close('backdrop')}
            accessibilityRole="button"
            accessibilityLabel="Close"
          />
        </Animated.View>

        <GestureDetector gesture={pan}>
          <Animated.View
            style={[styles.sheet, { height: sheetH, paddingBottom: insets.bottom }, sheetStyle]}
            accessibilityViewIsModal
          >
            <View style={[styles.media, { height: mediaH }]}>
              <AnnouncementMedia announcement={announcement} still={reduceMotion} />
              <View style={styles.grip} />
              <Pressable
                onPress={() => close('close')}
                hitSlop={10}
                style={styles.closeButton}
                accessibilityRole="button"
                accessibilityLabel="Not now"
              >
                <Ionicons name="close" size={16} color={color.navy} />
              </Pressable>
            </View>

            <View style={styles.content}>
              <Animated.Text style={[styles.title, titleStyle]} accessibilityRole="header">
                {announcement.title}
              </Animated.Text>
              <Animated.Text style={[styles.body, bodyStyle]} numberOfLines={1}>
                {announcement.body}
              </Animated.Text>
              <View style={styles.spacer} />
              <Animated.View style={ctaStyle}>
                <Pressable
                  onPress={onCta}
                  onPressIn={() => { pressed.value = withSpring(motion.scale.press, motion.spring.press); }}
                  onPressOut={() => { pressed.value = withSpring(1, motion.spring.press); }}
                  style={styles.cta}
                  accessibilityRole="button"
                  accessibilityLabel={announcement.cta.label}
                >
                  <Text style={styles.ctaLabel}>{announcement.cta.label}</Text>
                </Pressable>
              </Animated.View>
            </View>
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}

/**
 * The muted loop over its poster. The poster is always underneath, so a slow
 * decode, a failed player or reduced motion all show a finished frame rather
 * than black.
 */
function AnnouncementMedia({ announcement, still }: { announcement: Announcement; still: boolean }) {
  const asset = ANNOUNCEMENT_MEDIA[announcement.media];
  return (
    <View style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Image source={asset.poster} style={StyleSheet.absoluteFill} contentFit="cover" />
      {still ? null : <LoopingVideo source={asset.video} />}
    </View>
  );
}

function LoopingVideo({ source }: { source: number }) {
  const player = useVideoPlayer(source, (p) => {
    try {
      p.muted = true;
      p.loop = true;
      p.showNowPlayingNotification = false;
      p.play();
    } catch {
      // Player already released; the poster stays.
    }
  });
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  const ready = status === 'readyToPlay';
  return (
    <VideoView
      player={player}
      style={[StyleSheet.absoluteFill, { opacity: ready ? 1 : 0 }]}
      contentFit="cover"
      nativeControls={false}
      allowsFullscreen={false}
      allowsPictureInPicture={false}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { backgroundColor: color.navy },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: color.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden',
  },
  media: { backgroundColor: color.cream },
  grip: {
    position: 'absolute',
    top: space.sm,
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: color.navy,
    opacity: 0.18,
  },
  closeButton: {
    position: 'absolute',
    top: space.md,
    right: space.md,
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { flex: 1, paddingHorizontal: space.xl, paddingTop: space.lg + 2, paddingBottom: space.lg + 2 },
  title: { fontFamily: font.bold, fontSize: 21, lineHeight: 26, letterSpacing: -0.3, color: color.navy },
  body: { fontFamily: font.regular, fontSize: 14, lineHeight: 20, color: color.slate, marginTop: space.xs },
  spacer: { flex: 1, minHeight: space.md },
  cta: {
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaLabel: { fontFamily: font.semibold, fontSize: 15, color: color.navy },
});
