import React from 'react';
import { useWindowDimensions } from 'react-native';

import { space } from '../../constants/design';
import type { WalksignId } from '../../lib/walksign/types';
import { PawPrintShareModal } from '../pawprints/PawPrintShareModal';
import { WalksignShareCard } from './WalksignShareCard';

interface Props {
  visible: boolean;
  onClose: () => void;
  sign: WalksignId;
  petName?: string | null;
}

export function WalksignShareModal({ visible, onClose, sign, petName }: Props) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const availableCardHeight = Math.max(300, windowHeight - 230);
  const cardWidth = Math.min(
    300,
    windowWidth - space.xxl * 4,
    (availableCardHeight * 9) / 16,
  );

  return (
    <PawPrintShareModal
      visible={visible}
      onClose={onClose}
      source="walksign"
    >
      <WalksignShareCard sign={sign} petName={petName} width={cardWidth} />
    </PawPrintShareModal>
  );
}
