import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { color, font, space } from '../../constants/design';
import { track } from '../../lib/analytics';
import {
  WALKSIGN_COPY,
  buildConfirmationBody,
  buildConfirmationHeadline,
  buildTransitionHeadline,
} from '../../lib/walksign/copy';
import type { PendingWalksignCelebration } from '../../lib/walksign/walksignSync';
import { PawtchiModal } from '../PawtchiModal';
import { WalksignCrest } from './WalksignCrest';
import { WalksignShareModal } from './WalksignShareModal';

interface Props {
  celebration: PendingWalksignCelebration | null;
  petName?: string | null;
  petGender?: string | null;
  /** Called for both dismiss and completion — the caller clears the pending flag. */
  onClose: () => void;
}

/**
 * The Walksign moment — fired once when walks confirm the sign, or when a
 * life transition brings a new one (Wonderbound graduation, Storywalker
 * arrival). Celebrated with the crest, one calm line, and a share action;
 * never a toast, never repeated.
 */
export function WalksignMomentModal({ celebration, petName, petGender, onClose }: Props) {
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    if (!celebration) setShareOpen(false);
  }, [celebration]);

  if (!celebration) return null;

  const { sign, event, transitionKind } = celebration;
  const title =
    event === 'transition' && transitionKind
      ? buildTransitionHeadline(transitionKind, sign, petName)
      : buildConfirmationHeadline(petName, petGender);
  const body =
    event === 'transition'
      ? WALKSIGN_COPY[sign].manifesto
      : buildConfirmationBody(sign, petName);

  const handleShare = () => {
    track('walksign_shared', { sign, surface: 'modal' });
    setShareOpen(true);
  };

  const closeShare = () => {
    setShareOpen(false);
    onClose();
  };

  return (
    <>
      <PawtchiModal
        visible={!shareOpen}
        onClose={onClose}
        title={title}
        actions={[
          { label: 'Share', onPress: handleShare },
          { label: 'Done', onPress: onClose, variant: 'secondary' },
        ]}
      >
        <View style={styles.body}>
          <WalksignCrest sign={sign} size={88} color={color.ink} />
          <Text style={styles.signName}>{WALKSIGN_COPY[sign].displayName}</Text>
          <Text style={styles.manifesto}>{body}</Text>
        </View>
      </PawtchiModal>
      <WalksignShareModal
        visible={shareOpen}
        onClose={closeShare}
        sign={sign}
        petName={petName}
      />
    </>
  );
}

const styles = StyleSheet.create({
  body: {
    alignItems: 'center',
    marginBottom: space.lg,
    gap: space.sm,
  },
  signName: {
    fontFamily: font.display,
    fontSize: 28,
    letterSpacing: 0.5,
    color: color.ink,
    marginTop: space.sm,
  },
  manifesto: {
    fontFamily: font.regular,
    fontSize: 13.5,
    lineHeight: 20,
    color: color.slateMuted,
    textAlign: 'center',
  },
});
