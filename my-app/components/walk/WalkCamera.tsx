/**
 * WalkCamera — capturing a moment without leaving the walk.
 *
 * ── One purpose ──
 * Point, tap, keep walking. That is the whole surface.
 *
 * It briefly carried two more controls — a Save-to-Photos toggle and an Import
 * button — and on device they read as a settings panel wrapped around a
 * shutter. Someone holding a lead in one hand at dusk does not want to make a
 * storage decision; they want the photo. Both are gone from here. The camera
 * roll copy is gone entirely (the photo lives in Pawtchi, which is what the
 * permission gate has always promised), and importing an existing photo moved
 * to the walk summary, where "here is one I took on the other camera" is a
 * thing you think after the walk rather than during it.
 *
 * ── Full bleed, and the one thing it costs ──
 * The preview fills the screen and every control floats on top of it. Nothing
 * about that touches the capture pipeline: the frame is presentation, and no
 * code downstream of the shutter reads it.
 *
 * What it does cost is exact framing, and the reason is native. expo-camera
 * hardcodes `previewLayer.videoGravity = .resizeAspectFill` and does not expose
 * it, so the preview always shows the centre crop that matches THE VIEW'S
 * aspect rather than the photo's. On a ~19.5:9 screen (0.461) against a 4:3
 * portrait buffer (0.75) that means 0.461/0.75 — about 61% of the photo's
 * width is on screen, and the saved frame carries roughly 39% more scene on
 * either side than the walker saw.
 *
 * That is a deliberate, accepted trade (Sep 2026), not an oversight. The
 * alternatives were both worse: a letterboxed 4:3 box is exact but cannot fill
 * a modern phone — a full-width 4:3 preview is 390×520 on a 390×844 screen, so
 * a third of the screen stays empty — and cropping the capture to screen shape
 * makes every keepsake a ~9:19.5 sliver that then gets cropped AGAIN by the
 * summary, the gallery tiles and the map pins. Between "you get a little more
 * than you framed" and "your archive is full of slivers", the generous error is
 * the right one for a keepsake.
 *
 * `pictureSize` stays on `Photo` (the full 4:3 sensor frame) rather than
 * expo-camera's default `high`, which is a 16:9 VIDEO preset — that default is
 * what made the field of view read as 0.5x on device.
 *
 * ── Where the photo goes ──
 * Into Pawtchi's own app container — a downscaled copy we own and can read back
 * without any permission, on either platform, forever. That copy is what every
 * surface renders from. See lib/walk/keepsakeFile.ts for why the previous
 * arrangement (give the photo away, keep a `ph://` receipt, read the library
 * back to display it) put an unrequested system permission sheet over the Home
 * screen at launch.
 *
 * Nothing here touches the photo library, in either direction. The original
 * never reaches a Pawtchi server either: what syncs is metadata and a ~20 KB
 * thumbnail.
 *
 * ── The shutter must feel instant, and instant is a lie we have to tell ──
 * A capture is two waits: the native encode, then our downscale into the
 * container. Only the first is unavoidable before there is an image to show, so
 * the corner slot fills from the camera's own cache file the moment
 * `takePictureAsync` resolves and quietly swaps to the owned copy afterwards.
 * Between the tap and that, the slot breathes. Nothing about the confirmation
 * waits on storage.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Reanimated, {
  FadeIn,
  FadeOut,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { color, font, motion, radius, space } from '../../constants/design';
import { BreathingPaw } from '../BreathingPaw';
import { haptic } from '../../lib/haptics';
import { persistCapture } from '../../lib/walk/keepsakeFile';

/** What the walk knows, shown live above the frame. */
export interface WalkCameraContext {
  /** "1.4 km" */
  distanceLabel: string | null;
  /** "18 min" */
  elapsedLabel: string | null;
  /** "Riverside Park" */
  placeLabel: string | null;
}

export interface WalkCaptureResult {
  /**
   * Uri to render RIGHT NOW — the owned copy where one was written, otherwise
   * the camera's cache file. Good for this session only; never persisted, as
   * the container path it points into does not survive an app update.
   */
  uri: string;
  /**
   * Filename of Pawtchi's own copy, for walk_media.local_path. Null when the
   * capture could not be persisted, which degrades this keepsake to exactly
   * what every keepsake used to be.
   */
  localPath: string | null;
  width: number;
  height: number;
  capturedAt: number;
  /** Taken here, or brought in from the library afterwards. */
  source: 'camera' | 'import';
}

/**
 * A photo chosen from the library, with whatever its EXIF admitted.
 *
 * Position is separate from the capture result because an imported photo must
 * NEVER borrow the walker's live fix — see the import handler in app/walk.tsx.
 */
export interface WalkImportResult extends WalkCaptureResult {
  /** EXIF GPS, or null. Never the live fix. */
  lat: number | null;
  lng: number | null;
}

interface WalkCameraProps {
  visible: boolean;
  onClose: () => void;
  onCaptured: (result: WalkCaptureResult) => void;
  context: WalkCameraContext | null;
}

/** Long enough to read a short sentence, short enough not to follow you home. */
const FAIL_NOTICE_MS = 4_000;

/** Lens names that are never the default, lower-cased for comparison. */
const NOT_THE_WIDE_LENS = ['ultra wide', 'ultrawide', 'telephoto'];

/**
 * Prefer the plainest back lens on offer — "Back Camera" is the wide angle.
 *
 * On a multi-lens iPhone the platform default can land on a VIRTUAL device
 * (`builtInDualWideCamera`, `builtInTripleCamera`) whose `videoZoomFactor` of
 * 1.0 IS the ultra-wide — the classic "everything is 0.5x" trap, and
 * expo-camera never sets a zoom to correct it. The virtual devices all carry an
 * extra qualifier in their name; the plain one never does.
 *
 * Matching is on `localizedName`, so this only fires in locales where the name
 * is recognisable. That is acceptable because of how the native side fails: a
 * `selectedLens` matching nothing falls straight through to the platform
 * default, so a wrong guess is a no-op and never a regression.
 */
function preferredLens(lenses: readonly string[]): string | undefined {
  const usable = lenses.filter(
    (name) => !NOT_THE_WIDE_LENS.some((bad) => name.toLowerCase().includes(bad)),
  );
  if (usable.length === 0) return undefined;
  return usable.reduce((best, name) => (name.length < best.length ? name : best));
}

/**
 * The zoom steps worth offering, and only the ones we can name honestly.
 *
 * Ultra-wide is 0.5× and wide is 1× by Apple's own definition, so those two
 * labels are true on every device that has the lenses. Telephoto is NOT — it is
 * 2× on one iPhone, 3× on another and 5× on a Pro Max — so it is left out
 * rather than mislabelled. It is also the least useful lens for photographing
 * something at the end of a lead.
 *
 * Anything finer than these two steps is the pinch gesture's job.
 */
function zoomSteps(lenses: readonly string[]): { label: string; lens: string }[] {
  const wide = preferredLens(lenses);
  if (!wide) return [];
  const ultra = lenses.find((n) => {
    const l = n.toLowerCase();
    return l.includes('ultra wide') || l.includes('ultrawide');
  });
  // One step is not a control, it is decoration.
  if (!ultra) return [];
  return [
    { label: '0.5×', lens: ultra },
    { label: '1×', lens: wide },
  ];
}

export function WalkCamera({ visible, onClose, onCaptured, context }: WalkCameraProps) {
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const [capturing, setCapturing] = useState(false);
  const [failed, setFailed] = useState(false);

  const [lenses, setLenses] = useState<readonly string[]>([]);
  const [selectedLens, setSelectedLens] = useState<string | undefined>(undefined);
  const lensPinnedRef = useRef(false);
  /** Digital zoom on top of the chosen lens. expo-camera's own 0–1 scale. */
  const [zoom, setZoom] = useState(0);

  /**
   * The last photo, and how many this sitting has kept.
   *
   * `pending` is the window between the tap and an image existing — the only
   * part of a capture the user can actually be made to wait through.
   */
  const [kept, setKept] = useState<{ uri: string; count: number } | null>(null);
  const [pending, setPending] = useState(false);

  const flash = useSharedValue(0);
  const drop = useSharedValue(0);
  const press = useSharedValue(0);

  const steps = useMemo(() => zoomSteps(lenses), [lenses]);

  useEffect(() => {
    if (!visible) {
      setKept(null);
      setPending(false);
      setFailed(false);
      setZoom(0);
      lensPinnedRef.current = false;
    }
  }, [visible]);

  // The notice clears itself, like KeepsakePrompt: it reports on one tap, and a
  // walker who has moved on should not still be reading it two streets later.
  useEffect(() => {
    if (!failed) return;
    const timer = setTimeout(() => setFailed(false), FAIL_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [failed]);

  // ── Pin the rear lens ──
  //
  // Runs once the preview exists, because the lens list is a property of the
  // running session. Pinning swaps the capture device, which fires this again —
  // hence the latch. Failure is silent and total: no `selectedLens` means the
  // platform default, which is where this component was before.
  const onCameraReady = useCallback(async () => {
    if (lensPinnedRef.current) return;
    lensPinnedRef.current = true;
    try {
      const available = await cameraRef.current?.getAvailableLensesAsync();
      if (!available?.length) return;
      if (__DEV__) console.log('[WalkCamera] lenses', available);
      setLenses(available);
      setSelectedLens(preferredLens(available));
    } catch {
      // Android has no lens list; nor does a simulator. Neither is a problem.
    }
  }, []);

  const onPickLens = useCallback((lens: string) => {
    haptic.select();
    // A step is a fresh start, not an offset from wherever the pinch left off.
    setZoom(0);
    setSelectedLens(lens);
  }, []);

  /**
   * Pinch for anything between the steps.
   *
   * `GestureHandlerRootView` is wrapped around this screen rather than assumed
   * from the app root: gestures inside a React Native `Modal` live in a
   * separate view hierarchy and do not inherit the root handler.
   */
  const zoomAtPinchStart = useSharedValue(0);
  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .onStart(() => {
          zoomAtPinchStart.value = zoom;
        })
        .onUpdate((e) => {
          // Log scale so a pinch feels the same at either end of the range.
          const next = Math.min(1, Math.max(0, zoomAtPinchStart.value + Math.log2(e.scale) * 0.22));
          runOnJS(setZoom)(next);
        }),
    [zoom, zoomAtPinchStart],
  );

  /** The receipt: a photo lands in the slot and settles. */
  const confirmKept = useCallback(
    (uri: string) => {
      setKept((prev) => ({ uri, count: (prev?.count ?? 0) + 1 }));
      drop.value = withSequence(
        withTiming(1, { duration: motion.duration.instant }),
        withSpring(0, motion.spring.gentle),
      );
    },
    [drop],
  );

  const handleCapture = useCallback(async () => {
    // Guard rather than disable: a double-tap while the shutter is open would
    // otherwise produce two keepsakes for one moment.
    if (capturing || !cameraRef.current) return;
    setCapturing(true);
    setFailed(false);
    setPending(true);

    // Before anything async. The tap is the promise; everything after it is the
    // app catching up. iOS gives no shutter feedback of its own — expo-camera's
    // `animateShutter` is declared on the native view and never read there.
    haptic.medium();
    flash.value = withSequence(
      withTiming(1, { duration: motion.duration.instant }),
      withTiming(0, { duration: motion.duration.fast }),
    );

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.9,
        // Focal length is the only definitive read on which lens actually fired
        // — 13mm is the ultra-wide, ~24-26mm the standard one.
        exif: __DEV__,
      });
      if (!photo?.uri) {
        setFailed(true);
        return;
      }

      if (__DEV__) {
        console.log('[WalkCamera] captured', {
          width: photo.width,
          height: photo.height,
          focal35: photo.exif?.FocalLenIn35mmFilm,
        });
      }

      // ── Show it immediately ──
      //
      // From the camera's own cache file, before the downscale below. Waiting
      // for storage to finish before admitting the photo exists is what made
      // the shutter feel broken: half a second of nothing, on the one screen
      // where the user is asking "did that work?".
      setPending(false);
      confirmKept(photo.uri);

      const capturedAt = Date.now();

      // ── Then our copy ──
      //
      // The copy the app actually renders from, and it needs no permission to
      // write or to read. A capture that gets this far survives anything that
      // fails after it.
      const persisted = await persistCapture({
        uri: photo.uri,
        capturedAt,
        width: photo.width,
        height: photo.height,
      });

      // Prefer our own file: the camera's cache uri is on borrowed time, and
      // the walk summary may still be showing this frame long after iOS has
      // decided it needed the space back. Swapped silently — same image, so
      // there is nothing for the user to notice.
      const uri = persisted?.uri ?? photo.uri;
      if (persisted) setKept((prev) => (prev ? { ...prev, uri } : prev));

      onCaptured({
        uri,
        localPath: persisted?.fileName ?? null,
        width: photo.width,
        height: photo.height,
        capturedAt,
        source: 'camera',
      });
      // The camera STAYS OPEN, as every first-party camera does. Dismissing on
      // capture was most of why the shutter felt like it did nothing.
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
      setCapturing(false);
    }
  }, [capturing, onCaptured, confirmKept, flash]);

  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value * 0.85 }));
  const slotStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + drop.value * 0.35 }],
  }));
  const shutterStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - press.value * 0.07 }],
  }));
  const shutterInnerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - press.value * 0.14 }],
    opacity: 1 - press.value * 0.25,
  }));

  if (!visible) return null;

  const granted = Boolean(permission?.granted);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView style={styles.root}>
        {/* ── The picture, edge to edge ──
            Everything below floats on top of it. Pinch lives on this layer, so
            it works anywhere the image is showing and never fights a control. */}
        <GestureDetector gesture={pinch}>
          <View style={StyleSheet.absoluteFill}>
            {granted ? (
              <CameraView
                ref={cameraRef}
                style={StyleSheet.absoluteFill}
                facing="back"
                onCameraReady={onCameraReady}
                selectedLens={selectedLens}
                zoom={zoom}
                // `Photo` is the full 4:3 sensor frame. expo-camera's own
                // default is `high` — a 16:9 VIDEO preset — which is what made
                // the field of view read as 0.5x on device. Android takes an
                // aspect ratio instead. Never both: `pictureSize` makes `ratio`
                // a no-op.
                pictureSize={Platform.OS === 'ios' ? 'Photo' : undefined}
                ratio={Platform.OS === 'android' ? '4:3' : undefined}
              />
            ) : (
              <PermissionGate
                asked={Boolean(permission)}
                canAskAgain={permission?.canAskAgain !== false}
                onRequest={requestPermission}
              />
            )}
          </View>
        </GestureDetector>

        {/* ── Floating chrome ──
            Every control carries its own translucent backing rather than
            sitting on a scrim band. Over arbitrary camera input a pill is
            legible where a bare glyph is not, and a pill does not darken a
            third of the picture to achieve it. */}
        <View style={[styles.topBar, { paddingTop: insets.top + space.sm }]} pointerEvents="box-none">
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close the camera"
            hitSlop={12}
          >
            <MaterialIcons name="close" size={22} color={color.cream} />
          </TouchableOpacity>

          {/* The one thing this camera knows that the phone's own camera
              cannot: how far you have walked and how long you have been out. */}
          {context && (context.distanceLabel || context.elapsedLabel || context.placeLabel) ? (
            <View style={styles.contextCol} pointerEvents="none">
              {context.distanceLabel || context.elapsedLabel ? (
                <View style={styles.contextChip}>
                  <MaterialIcons name="directions-walk" size={13} color={color.navy} />
                  <Text style={styles.contextChipText}>
                    {[context.distanceLabel, context.elapsedLabel].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              ) : null}
              {context.placeLabel ? (
                <View style={styles.contextChip}>
                  <MaterialIcons name="place" size={13} color={color.navy} />
                  <Text style={styles.contextChipText} numberOfLines={1}>
                    {context.placeLabel}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : (
            <View style={styles.closeBtn} />
          )}
        </View>

        {/* Never an Alert. A dog does not wait for a dialog. */}
        {failed ? (
          <Reanimated.View
            entering={FadeIn.duration(motion.duration.fast)}
            exiting={FadeOut.duration(motion.duration.fast)}
            style={[styles.failChip, { bottom: insets.bottom + CONTROLS_H + space.lg }]}
            accessibilityRole="alert"
            pointerEvents="none"
          >
            <Text style={styles.failChipText}>That one didn&rsquo;t take. Try again.</Text>
          </Reanimated.View>
        ) : null}

        {granted && steps.length > 1 ? (
          <View style={[styles.zoomBar, { bottom: insets.bottom + CONTROLS_H + space.md }]}>
            {steps.map((step) => {
              const active = selectedLens === step.lens && zoom === 0;
              return (
                <TouchableOpacity
                  key={step.label}
                  style={[styles.zoomChip, active && styles.zoomChipOn]}
                  onPress={() => onPickLens(step.lens)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Zoom ${step.label}`}
                >
                  <Text style={[styles.zoomChipText, active && styles.zoomChipTextOn]}>
                    {step.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}

        {/* ── The shutter, and the proof ── */}
        <View
          style={[styles.controls, { paddingBottom: insets.bottom + space.lg }]}
          pointerEvents="box-none"
        >
          <View style={styles.sideSlot}>
            {pending ? (
              // Breathing while working — never a spinner (Living Paw contract).
              <View style={[styles.slotTile, styles.slotPending]}>
                <BreathingPaw size={18} workingColor={color.creamDim} />
              </View>
            ) : kept ? (
              <Reanimated.View style={slotStyle}>
                <View
                  accessibilityRole="image"
                  accessibilityLabel={
                    kept.count === 1
                      ? 'One moment kept on this walk'
                      : `${kept.count} moments kept on this walk`
                  }
                >
                  <Image source={{ uri: kept.uri }} style={styles.slotPhoto} contentFit="cover" />
                  {kept.count > 1 ? (
                    <View style={styles.slotCount}>
                      <Text style={styles.slotCountText}>{kept.count}</Text>
                    </View>
                  ) : null}
                </View>
              </Reanimated.View>
            ) : (
              <View style={styles.slotTile} />
            )}
          </View>

          {granted ? (
            <Reanimated.View style={shutterStyle}>
              <TouchableOpacity
                style={styles.shutter}
                activeOpacity={1}
                onPress={handleCapture}
                onPressIn={() => {
                  press.value = withSpring(1, motion.spring.press);
                }}
                onPressOut={() => {
                  press.value = withSpring(0, motion.spring.press);
                }}
                accessibilityRole="button"
                accessibilityLabel="Take a photo"
              >
                <Reanimated.View style={[styles.shutterInner, shutterInnerStyle]} />
              </TouchableOpacity>
            </Reanimated.View>
          ) : (
            <View style={styles.shutterPlaceholder} />
          )}

          {/* Balances the slot so the shutter is optically centred. Nothing
              lives here on purpose — this is the surface where a second button
              turned a shutter into a settings panel. */}
          <View style={styles.sideSlot} />
        </View>

        {/* Over everything, including the chrome: a shutter flash that stopped
            at the edge of the picture would read as a bug on a full-bleed
            screen. */}
        <Reanimated.View style={[styles.flash, flashStyle]} pointerEvents="none" />
      </GestureHandlerRootView>
    </Modal>
  );
}

/**
 * Shown until camera access exists.
 *
 * States the trade plainly, because the honest version is the reassuring one:
 * the photo stays here and Pawtchi keeps a thumbnail. When permission has been
 * permanently refused the copy stops asking — a button that cannot work is
 * worse than no button.
 */
function PermissionGate({
  asked,
  canAskAgain,
  onRequest,
}: {
  asked: boolean;
  canAskAgain: boolean;
  onRequest: () => void;
}) {
  return (
    <View style={styles.gate}>
      <MaterialIcons name="photo-camera" size={34} color={color.creamDim} />
      <Text style={styles.gateTitle}>Capture the walk</Text>
      <Text style={styles.gateBody}>
        Photos stay in Pawtchi, on this phone. Only a small thumbnail and where along the walk
        it was taken are ever uploaded.
      </Text>
      {canAskAgain ? (
        <TouchableOpacity style={styles.gateButton} onPress={onRequest} accessibilityRole="button">
          <Text style={styles.gateButtonText}>{asked ? 'Try again' : 'Allow camera'}</Text>
        </TouchableOpacity>
      ) : (
        <Text style={styles.gateHint}>
          Camera access is off for Pawtchi. You can turn it on in {Platform.OS === 'ios' ? 'Settings' : 'app settings'}.
        </Text>
      )}
    </View>
  );
}

const SHUTTER = 76;
const SLOT = 48;

/**
 * Height of the bottom control row, for the things that stack above it.
 *
 * A literal because those things are absolutely positioned over a full-bleed
 * preview: there is no flex column left to hang them off, and measuring the row
 * to place a chip that is only ever on screen for four seconds would be a
 * layout pass for nothing.
 */
const CONTROLS_H = SHUTTER + space.lg * 2;

/** Legible over arbitrary camera input without darkening the picture. */
const GLASS = 'rgba(7, 32, 42, 0.42)';
const GLASS_STRONG = 'rgba(7, 32, 42, 0.62)';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.navy },

  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
  },
  /** A pill, not a bare glyph: a cream X over a bright sky is invisible. */
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GLASS,
  },
  contextCol: {
    alignItems: 'flex-end',
    gap: space.xs + 2,
    maxWidth: '64%',
  },
  /**
   * White ground, navy mark — 16.8:1.
   *
   * Yellow ink was tried here and rejected on measurement: #F4F600 on #FFFFFF
   * is 1.16:1, against a WCAG floor of 4.5:1 for text this size, and this chip
   * is read outdoors in daylight. It is the rule `color.letter` already states
   * in constants/design.ts — yellow holds as a filled BLOCK behind navy text,
   * never as ink on white. The shutter below spends the yellow instead, which
   * is the one thing on this screen that should carry it.
   */
  contextChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 2,
    paddingVertical: space.xs + 2,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: color.surface,
  },
  contextChipText: {
    fontFamily: font.semibold,
    fontSize: 12,
    color: color.navy,
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },

  flash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: color.cream,
  },

  /**
   * Floats just above the shutter row, where a thumb already is.
   *
   * Two steps only, and only optical ones — see `zoomSteps`. A row of five
   * would be the same mistake as the controls it replaced.
   */
  zoomBar: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: space.xs,
    padding: space.xs,
    borderRadius: radius.pill,
    backgroundColor: GLASS_STRONG,
  },
  zoomChip: {
    minWidth: 40,
    height: 30,
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomChipOn: { backgroundColor: color.cream },
  zoomChipText: {
    fontFamily: font.semibold,
    fontSize: 12,
    color: color.cream,
  },
  zoomChipTextOn: { color: color.navy },

  failChip: {
    position: 'absolute',
    alignSelf: 'center',
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(7, 32, 42, 0.82)',
    alignItems: 'center',
  },
  failChipText: {
    fontFamily: font.medium,
    fontSize: 13,
    color: color.cream,
  },

  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  /** Both flanks are the same width so the shutter stays optically centred. */
  sideSlot: {
    width: SLOT + space.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * Glass rather than a hairline outline. Over a photograph a 0.5px cream line
   * disappears into whatever happens to be behind it, and an empty slot that
   * cannot be seen is not a slot — it is the thing the walker is looking for
   * when they ask whether the shutter worked.
   */
  slotTile: {
    width: SLOT,
    height: SLOT,
    borderRadius: radius.md,
    backgroundColor: GLASS,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotPending: { backgroundColor: GLASS_STRONG },
  slotPhoto: {
    width: SLOT,
    height: SLOT,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: color.cream,
    backgroundColor: color.navyRaised,
  },
  slotCount: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: radius.pill,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotCountText: {
    fontFamily: font.bold,
    fontSize: 10,
    color: color.navy,
  },

  shutter: {
    width: SHUTTER,
    height: SHUTTER,
    borderRadius: radius.pill,
    borderWidth: 3,
    borderColor: color.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * Yellow, inside a cream ring.
   *
   * The one place on this screen it belongs: the brand rule is that yellow
   * marks the single thing that matters per surface, and here that is
   * unambiguously the shutter. It is also the sanctioned FORM — a filled block
   * rather than ink — so unlike the chip above this one costs no legibility.
   */
  shutterInner: {
    width: SHUTTER - 14,
    height: SHUTTER - 14,
    borderRadius: radius.pill,
    backgroundColor: color.yellow,
  },
  shutterPlaceholder: { width: SHUTTER, height: SHUTTER },

  gate: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xxl,
    gap: space.md,
  },
  gateTitle: {
    fontFamily: font.semibold,
    fontSize: 20,
    color: color.cream,
    marginTop: space.sm,
  },
  gateBody: {
    fontFamily: font.regular,
    fontSize: 14,
    lineHeight: 21,
    color: color.creamDim,
    textAlign: 'center',
  },
  gateButton: {
    marginTop: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.xxl,
    borderRadius: radius.pill,
    backgroundColor: color.yellow,
  },
  gateButtonText: {
    fontFamily: font.semibold,
    fontSize: 15,
    color: color.navy,
  },
  gateHint: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 20,
    color: color.creamFaint,
    textAlign: 'center',
    marginTop: space.sm,
  },
});
