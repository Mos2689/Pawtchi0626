import React, { useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';

import { color, radius, shadow, space, type } from '../../constants/design';
import {
  canShareToInstagramStory,
  shareMoment,
  shareMomentToInstagramStory,
  type ShareMomentContext,
} from '../../lib/shareMoment';
import { track } from '../../lib/analytics';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Flows into every share/analytics event (milestone / monthly_recap / …). */
  source: ShareMomentContext['source'];
  /** Which earned template the card is, when it is one — analytics only. */
  template?: string;
  /** Small letterspaced line above the card, OUTSIDE the captured pixels. */
  eyebrow?: string;
  /** Calm line under the card, also outside the capture. */
  subline?: string;
  /** The card to capture — rendered live, so preview === shared pixels. */
  children: React.ReactNode;
}

/**
 * Slim share sheet for the Paw Print cards (milestone, monthly recap).
 * Same capture + Instagram-story-first pipeline as the Paw Moment editor,
 * without its grounds/photo/caption editing — these cards have exactly one
 * form, so the sheet is preview + share + not-now, nothing else.
 */
export function PawPrintShareModal({
  visible,
  onClose,
  source,
  template,
  eyebrow,
  subline,
  children,
}: Props) {
  const insets = useSafeAreaInsets();
  const cardRef = useRef<View>(null);
  const [igAvailable, setIgAvailable] = useState(false);

  useEffect(() => {
    if (!visible) return;
    canShareToInstagramStory().then((ig) => {
      setIgAvailable(ig);
      track('moment_card_viewed', { source, instagram_available: ig });
    });
  }, [visible, source]);

  const dismiss = () => {
    track('moment_card_dismissed', { source });
    onClose();
  };
  const onShare = async () => {
    const outcome = await shareMoment(cardRef, { source, template });
    if (outcome === 'shared') onClose();
  };
  const onShareToStory = async () => {
    const outcome = await shareMomentToInstagramStory(cardRef, { source, template });
    if (outcome === 'shared') onClose();
    else await onShare();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={dismiss}>
      <View style={styles.scrim}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow.toUpperCase()}</Text> : null}
        <View ref={cardRef} collapsable={false}>
          {children}
        </View>
        {subline ? <Text style={styles.subline}>{subline}</Text> : null}

        <View style={[styles.actions, { paddingBottom: insets.bottom + space.lg }]}>
          {igAvailable ? (
            <TouchableOpacity style={styles.primaryBtn} onPress={onShareToStory} activeOpacity={0.9}>
              <MaterialIcons name="auto-awesome" size={18} color={color.navy} />
              <Text style={styles.primaryBtnText}>Share to Instagram story</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.primaryBtn} onPress={onShare} activeOpacity={0.9}>
              <MaterialIcons name="ios-share" size={18} color={color.navy} />
              <Text style={styles.primaryBtnText}>Share</Text>
            </TouchableOpacity>
          )}
          <View style={styles.secondaryRow}>
            {igAvailable && (
              <TouchableOpacity style={styles.quietBtn} onPress={onShare}>
                <Text style={styles.quietBtnText}>More ways to share</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.quietBtn} onPress={dismiss}>
              <Text style={styles.quietBtnText}>Not now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(7, 32, 42, 0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xxl,
  },
  eyebrow: {
    ...type.label,
    color: color.creamDim,
    letterSpacing: 2.4,
    marginBottom: space.lg,
  },
  subline: {
    ...type.body,
    color: color.creamDim,
    textAlign: 'center',
    marginTop: space.lg,
  },
  actions: {
    alignSelf: 'stretch',
    marginTop: space.xl,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: color.yellow,
    borderRadius: radius.pill,
    paddingVertical: 16,
    ...shadow.card,
  },
  primaryBtnText: {
    ...type.heading,
    color: color.navy,
  },
  secondaryRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space.xxl,
    marginTop: space.xs,
  },
  quietBtn: {
    alignItems: 'center',
    paddingVertical: space.md,
  },
  quietBtnText: {
    ...type.label,
    color: color.creamDim,
  },
});
