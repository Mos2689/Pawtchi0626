import React from 'react';
import { Image } from 'expo-image';
import type { WalksignId } from '../../lib/walksign/types';
import {
  WALKSIGN_ASSETS,
  type WalksignAssetResolution,
} from './walksignAssets';

interface Props {
  sign: WalksignId;
  /** Rendered square size in px. */
  size?: number;
  /**
   * Compatibility-only. The full-colour emblem artwork owns its palette, so
   * this value is intentionally not applied.
   */
  color?: string;
  /** Use the 1024px source only for captured sharing surfaces. */
  resolution?: WalksignAssetResolution;
  /** Optional spoken label when the emblem is not decorative. */
  accessibilityLabel?: string;
}

export function WalksignCrest({
  sign,
  size = 64,
  color: _legacyColor,
  resolution = 'ui',
  accessibilityLabel,
}: Props) {
  return (
    <Image
      source={WALKSIGN_ASSETS[sign][resolution]}
      style={{ width: size, height: size }}
      contentFit="contain"
      cachePolicy="memory-disk"
      recyclingKey={`${sign}-${resolution}`}
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
    />
  );
}
