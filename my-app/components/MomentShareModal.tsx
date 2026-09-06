/**
 * MomentShareModal — the Paw Moment share editor.
 *
 * Lifted out of the walk-summary screen so every surface that offers a Paw
 * Moment (post-walk summary, Home feed, walk gallery) drives one
 * implementation. Renders the walk live inside a captured View (what you see
 * is exactly what the PNG holds) and shares Instagram-story-first.
 *
 * Since the earned-template library, the editor is a horizontal carousel:
 * one page per template, all rendering the SAME walk. Templates the pet
 * hasn't earned yet render live but dimmed under a lock chip with their gate
 * ("Unlocks at 15 walks") — the milestone is only the access key and never
 * appears on a card's face. While a locked page is selected the share button
 * gives way to the progress line; the swipe itself is the want-engine.
 *
 * Unlock state = totals.walkCount (aggregated archive) ∪ persisted
 * `template_*` rows in pet_milestones, fetched lightweight on open. The
 * Fieldbook page keeps its extra powers (grounds, photo, loop captions);
 * premium colorways surface as pills on templates that declare them.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { color, font, radius, shadow, space, type } from '../constants/design';
import { TemplateRenderer } from './moments/TemplateRenderer';
import {
  availableColorways,
  lockedGateLine,
  lockedProgressLine,
  MOMENT_TEMPLATES,
  MomentColorwayId,
  unlockedTemplateIds,
} from '../lib/momentTemplates';
import {
  canShareToInstagramStory,
  shareMoment,
  shareMomentToInstagramStory,
  type ShareMomentContext,
} from '../lib/shareMoment';
import { supabase } from '../lib/supabase';
import type { SniffStop } from '../lib/momentCard';
import { track } from '../lib/analytics';
import { useActivePetStore } from '../store/useActivePetStore';
import { usePawPrintStore } from '../store/usePawPrintStore';
import { useSubscription } from '../providers/SubscriptionProvider';
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
  /** Resolved stop record — callers map rows through resolveSniffStops. */
  sniffStops: SniffStop[];
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
  sniffStops,
  labels,
  stats,
  sessionId,
}: MomentShareModalProps) {
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const activePet = useActivePetStore((s) => s.activePet);
  const storedTotals = usePawPrintStore((s) => s.totals);
  const { isPro } = useSubscription();

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [igAvailable, setIgAvailable] = useState(false);
  const [ground, setGround] = useState<'map' | 'paper'>('map');
  const [loopCaptions, setLoopCaptions] = useState<Record<number, string>>({});
  const [editingLoop, setEditingLoop] = useState<number | null>(null);
  const [captionDraft, setCaptionDraft] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [colorway, setColorway] = useState<MomentColorwayId>('classic');
  // Store totals give an instant, usually-fresh count; the fetch corrects it.
  const [walkCount, setWalkCount] = useState<number | null>(null);
  const [awardedIds, setAwardedIds] = useState<string[]>([]);
  const cardRefs = useRef<Record<string, View | null>>({});
  const pagerRef = useRef<ScrollView>(null);

  const activeGround = photoUri ? 'photo' : ground;
  // Fit the tallest (9:16) card between the header and the action rows.
  const cardWidth = Math.min(300, winW - space.xxl * 4, ((winH - 300) * 9) / 16);
  const pageH = Math.round((cardWidth * 16) / 9);

  const effectiveWalkCount = walkCount ?? storedTotals?.walkCount ?? 0;
  const unlocked = useMemo(
    () => unlockedTemplateIds(effectiveWalkCount, awardedIds),
    [effectiveWalkCount, awardedIds],
  );
  const selectedDef = MOMENT_TEMPLATES[selectedIndex] ?? MOMENT_TEMPLATES[0];
  const selectedLocked = !unlocked.has(selectedDef.id);
  const colorways = availableColorways(selectedDef, isPro);

  // Instagram installed → the primary action jumps straight into the story
  // composer; the sheet stays one tap away for everything else.
  useEffect(() => {
    if (!visible) return;
    canShareToInstagramStory().then((ig) => {
      setIgAvailable(ig);
      track('moment_card_viewed', { source, instagram_available: ig });
    });
    // Every open starts on the Fieldbook page, classic ink.
    setSelectedIndex(0);
    setColorway('classic');
    pagerRef.current?.scrollTo({ x: 0, animated: false });
  }, [visible, source]);

  // Library state — a lightweight count + the persisted template awards.
  // The union with the live count means an unlock can never regress.
  useEffect(() => {
    if (!visible || !activePet?.id) return;
    let cancelled = false;
    (async () => {
      const [countRes, awardsRes] = await Promise.all([
        supabase
          .from('walk_sessions')
          .select('id', { count: 'exact', head: true })
          .eq('pet_id', activePet.id)
          .eq('validation_verdict', 'valid'),
        supabase.from('pet_milestones').select('milestone_id').eq('pet_id', activePet.id),
      ]);
      if (cancelled) return;
      if (countRes.count != null) setWalkCount(countRes.count);
      if (awardsRes.data) setAwardedIds(awardsRes.data.map((r) => r.milestone_id as string));
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, activePet?.id]);

  const dismiss = () => {
    track('moment_card_dismissed', { source, template: selectedDef.id });
    onClose();
  };
  const shareContext = (): ShareMomentContext => ({
    source,
    ground: selectedDef.id === 'fieldbook' ? activeGround : undefined,
    template: selectedDef.id,
  });
  const onShare = async () => {
    const ref = cardRefs.current[selectedDef.id];
    if (!ref) return;
    const outcome = await shareMoment({ current: ref }, shareContext());
    if (outcome === 'shared') onClose();
  };
  const onShareToStory = async () => {
    const ref = cardRefs.current[selectedDef.id];
    if (!ref) return;
    const outcome = await shareMomentToInstagramStory({ current: ref }, shareContext());
    // The composer failing to open should never dead-end the moment — fall
    // through to the sheet so the share still happens somewhere.
    if (outcome === 'shared') onClose();
    else await onShare();
  };
  const onPageSettled = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / winW);
    if (index === selectedIndex || index < 0 || index >= MOMENT_TEMPLATES.length) return;
    setSelectedIndex(index);
    setColorway('classic');
    const def = MOMENT_TEMPLATES[index];
    if (!unlockedTemplateIds(effectiveWalkCount, awardedIds).has(def.id)) {
      track('template_locked_preview_viewed', {
        template: def.id,
        walk_count: effectiveWalkCount,
      });
    }
  };
  const onLoopPress = (index: number) => {
    setCaptionDraft(loopCaptions[index] ?? '');
    setEditingLoop(index);
  };
  const commitCaption = () => {
    if (editingLoop === null) return;
    const text = captionDraft.trim();
    setLoopCaptions((prev) => {
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
        {/* One page per template, every page the SAME walk, rendered live —
            what the user sees is exactly what gets captured. */}
        <ScrollView
          ref={pagerRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onPageSettled}
          style={{ flexGrow: 0, width: winW, height: pageH }}
        >
          {MOMENT_TEMPLATES.map((def) => {
            const isLocked = !unlocked.has(def.id);
            const isSelected = def.id === selectedDef.id;
            return (
              <View key={def.id} style={{ width: winW, height: pageH, alignItems: 'center', justifyContent: 'center' }}>
                <View
                  ref={(r) => {
                    cardRefs.current[def.id] = r;
                  }}
                  collapsable={false}
                  style={isLocked ? styles.lockedCard : undefined}
                >
                  <TemplateRenderer
                    templateId={def.id}
                    petName={petName}
                    petGender={petGender}
                    startedAt={startedAt}
                    route={route}
                    sniffStops={sniffStops}
                    labels={labels}
                    stats={stats}
                    sessionId={sessionId}
                    width={cardWidth}
                    colorway={isSelected ? colorway : 'classic'}
                    ground={activeGround}
                    photoUri={photoUri}
                    loopCaptions={loopCaptions}
                    onLoopPress={def.id === 'fieldbook' ? onLoopPress : undefined}
                  />
                </View>
                {isLocked && (
                  <View style={styles.lockChip} pointerEvents="none">
                    <MaterialIcons name="lock" size={14} color={color.navy} />
                    <Text style={styles.lockChipText}>{lockedGateLine(def)}</Text>
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>

        {/* Template name + page dots */}
        <View style={styles.pagerMeta}>
          <Text style={styles.templateName}>{selectedDef.name}</Text>
          <View style={styles.dotRow}>
            {MOMENT_TEMPLATES.map((def, i) => (
              <View
                key={def.id}
                style={[styles.dot, i === selectedIndex ? styles.dotActive : null]}
              />
            ))}
          </View>
        </View>

        {/* Tap a loop → name the moment ("the corgi", "a good smell") */}
        {editingLoop !== null && selectedDef.id === 'fieldbook' && (
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
          {/* Fieldbook keeps its grounds; templates with colorways offer them
              to subscribers. One quiet pill row either way. */}
          {selectedDef.id === 'fieldbook' && !photoUri && !selectedLocked && (
            <View style={styles.pillRow}>
              <TouchableOpacity
                style={[styles.pill, ground === 'map' && styles.pillActive]}
                onPress={() => setGround('map')}
              >
                <Text style={[styles.pillText, ground === 'map' && styles.pillTextActive]}>Map</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.pill, ground === 'paper' && styles.pillActive]}
                onPress={() => setGround('paper')}
              >
                <Text style={[styles.pillText, ground === 'paper' && styles.pillTextActive]}>Path</Text>
              </TouchableOpacity>
            </View>
          )}
          {colorways.length > 1 && !selectedLocked && (
            <View style={styles.pillRow}>
              {colorways.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.pill, colorway === c.id && styles.pillActive]}
                  onPress={() => setColorway(c.id)}
                >
                  <Text style={[styles.pillText, colorway === c.id && styles.pillTextActive]}>{c.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {selectedLocked ? (
            // The gate, stated calmly where the button would be. The card
            // above is the pitch; the walks are the price.
            <View style={styles.lockedCta}>
              <MaterialIcons name="lock" size={16} color={color.creamDim} />
              <Text style={styles.lockedCtaText}>
                {lockedProgressLine(selectedDef, effectiveWalkCount)}
              </Text>
            </View>
          ) : igAvailable ? (
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
            {selectedDef.id === 'fieldbook' && !selectedLocked && (
              <TouchableOpacity style={styles.quietBtn} onPress={photoUri ? () => setPhotoUri(null) : onPickPhoto}>
                <Text style={styles.quietBtnOnNavyText}>{photoUri ? 'Remove the photo' : 'Add a photo'}</Text>
              </TouchableOpacity>
            )}
            {igAvailable && !selectedLocked && (
              <TouchableOpacity style={styles.quietBtn} onPress={onShare}>
                <Text style={styles.quietBtnOnNavyText}>More ways to share</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.quietBtn} onPress={dismiss}>
              <Text style={styles.quietBtnOnNavyText}>Not now</Text>
            </TouchableOpacity>
          </View>

          {/* ── What the picker is ──
              Tapping "Add a photo" opens Apple's own picker, which shows the
              whole library because that is what a picker is for. It runs
              outside this app: Pawtchi is never granted the library and is
              handed exactly one image. True, and worth saying, because from the
              owner's side a grid of every photo they own looks identical to an
              app that has just been let in. The line only appears next to the
              button it explains. */}
          {selectedDef.id === 'fieldbook' && !selectedLocked && !photoUri && (
            <Text style={styles.pickerNote}>
              Pawtchi only receives the photo you pick. It never reads your library.
            </Text>
          )}
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
  },
  lockedCard: {
    opacity: 0.45,
  },
  lockChip: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: color.cream,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    paddingVertical: 8,
    ...shadow.card,
  },
  lockChipText: {
    ...type.label,
    color: color.navy,
  },
  pagerMeta: {
    alignItems: 'center',
    marginTop: space.md,
    gap: space.sm,
  },
  templateName: {
    ...type.label,
    color: color.cream,
    letterSpacing: 1.2,
  },
  dotRow: {
    flexDirection: 'row',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: color.creamFaint,
  },
  dotActive: {
    backgroundColor: color.cream,
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
  lockedCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.hairlineOnNavy,
    paddingVertical: 16,
  },
  lockedCtaText: {
    ...type.label,
    color: color.creamDim,
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
    marginTop: space.lg,
    paddingHorizontal: space.xxl,
  },
  shareSecondaryRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space.xxl,
    marginTop: space.xs,
  },
  /**
   * Quieter than the buttons above it: read once, not every time.
   *
   * Not `type.caption` — that carries 1.2 of letter-spacing for the uppercase
   * eyebrows it was cut for, and tracking a sentence that wide makes a
   * reassurance read like a legal disclaimer.
   */
  pickerNote: {
    fontFamily: font.regular,
    fontSize: 11.5,
    lineHeight: 16,
    color: color.creamFaint,
    textAlign: 'center',
    paddingHorizontal: space.md,
  },
  pillRow: {
    flexDirection: 'row',
    alignSelf: 'center',
    gap: space.sm,
    marginBottom: space.md,
  },
  pill: {
    paddingHorizontal: space.lg,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.creamFaint,
  },
  pillActive: {
    backgroundColor: color.cream,
    borderColor: color.cream,
  },
  pillText: {
    ...type.label,
    color: color.creamDim,
  },
  pillTextActive: {
    color: color.navy,
  },
  captionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: space.sm,
    marginTop: space.md,
    paddingHorizontal: space.xxl,
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
