/**
 * WalkCamera — capturing a moment without leaving the walk.
 *
 * ── What this is not competing on ──
 * Not speed. The native camera is a lock-screen swipe and will always beat
 * reaching for this one, so nothing here is designed around winning a
 * two-second window; the end-of-walk import exists to catch what this misses.
 *
 * What this wins on is everything the native camera cannot know. It knows how
 * far you have walked, how long you have been out, where you are, and what the
 * light is doing — so the frame carries the walk with it, and the photo lands
 * already attached to the moment it belongs to instead of in a camera roll
 * waiting to be sorted.
 *
 * ── Where the photo goes ──
 * Two places, and the order matters.
 *
 * First into Pawtchi's own app container — a downscaled copy we own and can
 * read back without any permission, on either platform, forever. That copy is
 * what every surface renders from. See lib/walk/keepsakeFile.ts for why the
 * previous arrangement (give the photo away, keep a `ph://` receipt, read the
 * library back to display it) put an unrequested system permission sheet over
 * the Home screen at launch.
 *
 * Then, as a courtesy, a full-resolution copy into the user's own photo
 * library, so a walk photo sits with the rest of their pictures. That save is
 * WRITE-ONLY: on iOS an add-only authorisation has no "limited" state, so it
 * cannot produce the "Select More Photos" sheet, and refusing it now costs the
 * user nothing at all.
 *
 * The original never reaches a Pawtchi server. What syncs is still the
 * metadata and a ~20 KB thumbnail.
 */

import React, { useCallback, useRef, useState } from 'react';
import { Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { color, font, radius, space } from '../../constants/design';
import { haptic } from '../../lib/haptics';
import { persistCapture } from '../../lib/walk/keepsakeFile';

/** What the walk knows, stamped onto the frame. */
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
  /** Photo-library asset id. Null when the courtesy save was refused or failed. */
  localAssetId: string | null;
}

interface WalkCameraProps {
  visible: boolean;
  onClose: () => void;
  onCaptured: (result: WalkCaptureResult) => void;
  context: WalkCameraContext | null;
}

export function WalkCamera({ visible, onClose, onCaptured, context }: WalkCameraProps) {
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [libraryPermission, requestLibraryPermission] = MediaLibrary.usePermissions({
    // Write-only on BOTH platforms now. Pawtchi renders from its own copy, so
    // it never needs to read the library back — and add-only authorisation is
    // what keeps iOS from ever showing its limited-access sheet, because
    // add-only has no limited state to nag about.
    writeOnly: true,
    granularPermissions: [],
  });
  const [capturing, setCapturing] = useState(false);

  const handleCapture = useCallback(async () => {
    // Guard rather than disable: a double-tap while the shutter is open would
    // otherwise produce two keepsakes for one moment.
    if (capturing || !cameraRef.current) return;
    setCapturing(true);
    haptic.tap();

    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      if (!photo?.uri) return;

      const capturedAt = Date.now();

      // ── Our copy first ──
      //
      // Before anything that can prompt, because this is the copy the app
      // actually renders from and it needs no permission to write or to read.
      // A capture that gets this far is safe even if every other step below
      // fails or is refused.
      const persisted = await persistCapture({
        uri: photo.uri,
        capturedAt,
        width: photo.width,
        height: photo.height,
      });

      // ── Then the camera roll, as a courtesy ──
      //
      // Full-resolution, unlike ours, because someone who goes looking for the
      // original in Photos should find the original. Refusal is a normal
      // outcome and costs nothing now: a null asset id used to mean the photo
      // existed nowhere we could reach, and today it means only that we did not
      // put a second copy in the user's library.
      let localAssetId: string | null = null;
      try {
        const granted =
          libraryPermission?.granted || (await requestLibraryPermission())?.granted;
        if (granted) {
          const asset = await MediaLibrary.createAssetAsync(photo.uri);
          localAssetId = asset?.id ?? null;
        }
      } catch {
        localAssetId = null;
      }

      onCaptured({
        // Prefer our own file: the camera's cache uri is on borrowed time, and
        // the walk summary may still be showing this frame long after iOS has
        // decided it needed the space back.
        uri: persisted?.uri ?? photo.uri,
        localPath: persisted?.fileName ?? null,
        width: photo.width,
        height: photo.height,
        capturedAt,
        localAssetId,
      });
      onClose();
    } catch {
      // A failed shutter is not worth an error dialog mid-walk; the camera
      // stays open and the user can simply try again.
    } finally {
      setCapturing(false);
    }
  }, [capturing, libraryPermission, requestLibraryPermission, onCaptured, onClose]);

  if (!visible) return null;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        {permission?.granted ? (
          <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
        ) : (
          <PermissionGate
            asked={Boolean(permission)}
            canAskAgain={permission?.canAskAgain !== false}
            onRequest={requestPermission}
          />
        )}

        {/* The stamp — the part no other camera on the phone could draw. */}
        {permission?.granted && context ? (
          <View style={[styles.stamp, { top: insets.top + space.xl }]} pointerEvents="none">
            {context.placeLabel ? (
              <Text style={styles.stampPlace} numberOfLines={1}>
                {context.placeLabel}
              </Text>
            ) : null}
            <View style={styles.stampRow}>
              {context.distanceLabel ? (
                <Text style={styles.stampStat}>{context.distanceLabel}</Text>
              ) : null}
              {context.distanceLabel && context.elapsedLabel ? (
                <Text style={styles.stampDot}>·</Text>
              ) : null}
              {context.elapsedLabel ? (
                <Text style={styles.stampStat}>{context.elapsedLabel}</Text>
              ) : null}
            </View>
          </View>
        ) : null}

        <View style={[styles.controls, { paddingBottom: insets.bottom + space.xxl }]}>
          <TouchableOpacity
            style={styles.close}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close the camera"
            hitSlop={12}
          >
            <MaterialIcons name="close" size={26} color={color.cream} />
          </TouchableOpacity>

          {permission?.granted ? (
            <TouchableOpacity
              style={styles.shutter}
              onPress={handleCapture}
              disabled={capturing}
              accessibilityRole="button"
              accessibilityLabel="Take a photo"
            >
              {/* The shutter reports its own state: it contracts and dims on
                  capture. A spinner here would be both a foreign motion
                  language and slower to read than the button reacting. */}
              <View style={[styles.shutterInner, capturing && styles.shutterInnerBusy]} />
            </TouchableOpacity>
          ) : (
            <View style={styles.shutterPlaceholder} />
          )}

          {/* Balances the close button so the shutter sits centred. */}
          <View style={styles.close} />
        </View>
      </View>
    </Modal>
  );
}

/**
 * Shown until camera access exists.
 *
 * States the trade plainly, because the honest version is the reassuring one:
 * the photo goes to the user's own library and Pawtchi keeps a thumbnail. When
 * permission has been permanently refused the copy stops asking — a button that
 * cannot work is worse than no button.
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
        Photos are saved to your own library. Pawtchi keeps a small thumbnail and where along
        the walk it was taken.
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.navy },

  stamp: {
    position: 'absolute',
    left: space.xl,
    right: space.xl,
    alignItems: 'flex-start',
  },
  stampPlace: {
    fontFamily: font.momentSemibold,
    fontSize: 15,
    color: color.cream,
    letterSpacing: 0.2,
    // The frame behind is arbitrary camera input, so the stamp carries its own
    // legibility rather than trusting the scene to be dark enough.
    textShadowColor: 'rgba(7, 32, 42, 0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  stampRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  stampStat: {
    fontFamily: font.momentMedium,
    fontSize: 13,
    color: color.creamDim,
    textShadowColor: 'rgba(7, 32, 42, 0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  stampDot: {
    fontFamily: font.momentMedium,
    fontSize: 13,
    color: color.creamFaint,
    marginHorizontal: space.sm,
  },

  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  close: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
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
  shutterInner: {
    width: SHUTTER - 14,
    height: SHUTTER - 14,
    borderRadius: radius.pill,
    backgroundColor: color.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInnerBusy: {
    transform: [{ scale: 0.82 }],
    opacity: 0.55,
  },
  shutterPlaceholder: { width: SHUTTER, height: SHUTTER },

  gate: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xxxl,
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
