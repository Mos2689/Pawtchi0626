/**
 * MomentShareModal — the Paw Moment share editor.
 *
 * Lifted out of the walk-summary screen so both surfaces that offer a Paw
 * Moment — the post-walk summary and the Home feed's WalkPostCard — drive one
 * implementation. Renders the MomentCard live inside a captured View (what you
 * see is exactly what the PNG holds), plus the ground toggle, photo picker,
 * loop-caption editor, and the Instagram-story / native-sheet share actions.
 *
 * Owns all of its own transient state (ground, photo, captions). Callers only
 * supply the walk's moment data and control `visible`.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { color, radius, shadow, space, type } from '../constants/design';
import { MomentCard } from './MomentCard';
import {
  canShareToInstagramStory,
  shareMoment,
  shareMomentToInstagramStory,
  type ShareMomentContext,
} from '../lib/shareMoment';
import { track } from '../lib/analytics';
import type { GeoPoint } from '../lib/walk/geo';
import type { WalkLabels } from '../lib/walk/geoLabels';

interface MomentStats {
  durationS: number;
  movingTimeS: number;
  distanceM: number;
}

export interface MomentShareModalProps {
  visible: boolean;
  onClose: () => void;
  /** Which surface opened the sheet — flows into every share/analytics event. */
  source: ShareMomentContext['source'];
  petName: string;
  petGender: string | null;
  /** Walk start, ms since epoch. */
  startedAt: number;
  route: GeoPoint[];
  pausePoints: GeoPoint[];
  labels: WalkLabels;
  stats: MomentStats;
  /** Seeds the companion weave so a shared card renders identically forever. */
  sessionId: string;
}

export function MomentShareModal({
  visible,
  onClose,
  source,
  petName,
  petGender,
  startedAt,
  route,
  pausePoints,
  labels,
  stats,
  sessionId,
}: MomentShareModalProps) {
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [igAvailable, setIgAvailable] = useState(false);
  const [ground, setGround] = useState<'map' | 'paper'>('map');
  const [loopCaptions, setLoopCaptions] = useState<Record<number, string>>({});
  const [editingLoop, setEditingLoop] = useState<number | null>(null);
  const [captionDraft, setCaptionDraft] = useState('');
  const cardRef = useRef<View>(null);
  const activeGround = photoUri ? 'photo' : ground;
  // Fit the 9:16 card between the header and the action row on any screen.
  const cardWidth = Math.min(320, winW - space.xxl * 4, ((winH - 240) * 9) / 16);

  // Instagram installed → the primary action jumps straight into the story
  // composer; the sheet stays one tap away for everything else.
  useEffect(() => {
    if (!visible) return;
    canShareToInstagramStory().then(ig => {
      setIgAvailable(ig);
      track('moment_card_viewed', { source, instagram_available: ig });
    });
  }, [visible, source]);

  const dismiss = () => {
    track('moment_card_dismissed', { source });
    onClose();
  };
  const onShare = async () => {
    const outcome = await shareMoment(cardRef, { source, ground: activeGround });
    if (outcome === 'shared') onClose();
  };
  const onShareToStory = async () => {
    const outcome = await shareMomentToInstagramStory(cardRef, { source, ground: activeGround });
    // The composer failing to open should never dead-end the moment — fall
    // through to the sheet so the share still happens somewhere.
    if (outcome === 'shared') onClose();
    else await onShare();
  };
  const onLoopPress = (index: number) => {
    setCaptionDraft(loopCaptions[index] ?? '');
    setEditingLoop(index);
  };
  const commitCaption = () => {
    if (editingLoop === null) return;
    const text = captionDraft.trim();
    setLoopCaptions(prev => {
      const next = { ...prev };
      if (text) next[editingLoop] = text;
      else delete next[editingLoop];
      return next;
    });
    setEditingLoop(null);
    setCaptionDraft('');
  };
  const onPickPhoto = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    });
    if (!picked.canceled && picked.assets[0]) setPhotoUri(picked.assets[0].uri);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={dismiss}>
      <View style={styles.shareScrim}>
        {/* The card is rendered live (not a screenshot of any screen), so what
            the user sees is exactly what gets captured. */}
        <View ref={cardRef} collapsable={false}>
          <MomentCard
            petName={petName}
            petGender={petGender}
            startedAt={startedAt}
            route={route}
            pausePoints={pausePoints}
            labels={labels}
            stats={stats}
            sessionId={sessionId}
            ground={activeGround}
            photoUri={photoUri}
            loopCaptions={loopCaptions}
            onLoopPress={onLoopPress}
            width={cardWidth}
          />
        </View>

        {/* Tap a loop → name the moment ("the corgi", "a good smell") */}
        {editingLoop !== null && (
          <View style={styles.captionRow}>
            <TextInput
              style={styles.captionInput}
              value={captionDraft}
              onChangeText={setCaptionDraft}
              placeholder="Name this stop"
              placeholderTextColor={color.slateFaint}
              maxLength={20}
              autoFocus
              onSubmitEditing={commitCaption}
              returnKeyType="done"
            />
            <TouchableOpacity style={styles.captionDone} onPress={commitCaption}>
              <Text style={styles.captionDoneText}>Done</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={[styles.shareActions, { paddingBottom: insets.bottom + space.lg }]}>
          {!photoUri && (
            <View style={styles.groundToggle}>
              <TouchableOpacity
                style={[styles.groundPill, ground === 'map' && styles.groundPillActive]}
                onPress={() => setGround('map')}
              >
                <Text style={[styles.groundPillText, ground === 'map' && styles.groundPillTextActive]}>Map</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.groundPill, ground === 'paper' && styles.groundPillActive]}
                onPress={() => setGround('paper')}
              >
                <Text style={[styles.groundPillText, ground === 'paper' && styles.groundPillTextActive]}>Plain</Text>
              </TouchableOpacity>
            </View>
          )}
          {igAvailable ? (
            <TouchableOpacity style={styles.finishBtnLight} onPress={onShareToStory} activeOpacity={0.9}>
              <MaterialIcons name="auto-awesome" size={18} color={color.navy} />
              <Text style={styles.finishBtnLightText}>Share to Instagram story</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.finishBtnLight} onPress={onShare} activeOpacity={0.9}>
              <MaterialIcons name="ios-share" size={18} color={color.navy} />
              <Text style={styles.finishBtnLightText}>Share</Text>
            </TouchableOpacity>
          )}
          <View style={styles.shareSecondaryRow}>
            <TouchableOpacity style={styles.quietBtn} onPress={photoUri ? () => setPhotoUri(null) : onPickPhoto}>
              <Text style={styles.quietBtnOnNavyText}>{photoUri ? 'Remove the photo' : 'Add a photo'}</Text>
            </TouchableOpacity>
            {igAvailable && (
              <TouchableOpacity style={styles.quietBtn} onPress={onShare}>
                <Text style={styles.quietBtnOnNavyText}>More ways to share</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.quietBtn} onPress={dismiss}>
              <Text style={styles.quietBtnOnNavyText}>Not now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  shareScrim: {
    flex: 1,
    backgroundColor: 'rgba(7, 32, 42, 0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xxl,
  },
  finishBtnLight: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: color.yellow,
    borderRadius: radius.pill,
    paddingVertical: 16,
    ...shadow.card,
  },
  finishBtnLightText: {
    ...type.heading,
    color: color.navy,
  },
  quietBtn: {
    alignItems: 'center',
    paddingVertical: space.md,
  },
  quietBtnOnNavyText: {
    ...type.label,
    color: color.creamDim,
  },
  shareActions: {
    alignSelf: 'stretch',
    marginTop: space.xl,
  },
  shareSecondaryRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space.xxl,
    marginTop: space.xs,
  },
  groundToggle: {
    flexDirection: 'row',
    alignSelf: 'center',
    gap: space.sm,
    marginBottom: space.md,
  },
  groundPill: {
    paddingHorizontal: space.lg,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.creamFaint,
  },
  groundPillActive: {
    backgroundColor: color.cream,
    borderColor: color.cream,
  },
  groundPillText: {
    ...type.label,
    color: color.creamDim,
  },
  groundPillTextActive: {
    color: color.navy,
  },
  captionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: space.sm,
    marginTop: space.md,
  },
  captionInput: {
    flex: 1,
    backgroundColor: color.surface,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    ...type.body,
    color: color.ink,
  },
  captionDone: {
    paddingHorizontal: space.lg,
    paddingVertical: 10,
    backgroundColor: color.yellow,
    borderRadius: radius.md,
  },
  captionDoneText: {
    ...type.label,
    color: color.navy,
  },
});
