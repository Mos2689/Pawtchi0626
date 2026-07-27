import type { WalksignId } from '../../lib/walksign/types';

export type WalksignAssetResolution = 'ui' | 'share';

interface WalksignAssetSet {
  /** 512px lossless WebP for in-app identity surfaces. */
  ui: number;
  /** 1024px lossless WebP for captured social artifacts. */
  share: number;
}

/**
 * The single asset registry for every Walksign surface.
 *
 * Literal requires are intentional: Metro must see each bundled asset at
 * build time. Keeping the record exhaustive also makes a future WalksignId
 * addition fail type-checking until its artwork is supplied.
 */
export const WALKSIGN_ASSETS: Record<WalksignId, WalksignAssetSet> = {
  newbond: {
    ui: require('../../assets/images/walksigns/ui/newbond.webp'),
    share: require('../../assets/images/walksigns/share/newbond.webp'),
  },
  loopkeeper: {
    ui: require('../../assets/images/walksigns/ui/loopkeeper.webp'),
    share: require('../../assets/images/walksigns/share/loopkeeper.webp'),
  },
  blockscout: {
    ui: require('../../assets/images/walksigns/ui/blockscout.webp'),
    share: require('../../assets/images/walksigns/share/blockscout.webp'),
  },
  packheart: {
    ui: require('../../assets/images/walksigns/ui/packheart.webp'),
    share: require('../../assets/images/walksigns/share/packheart.webp'),
  },
  softstep: {
    ui: require('../../assets/images/walksigns/ui/softstep.webp'),
    share: require('../../assets/images/walksigns/share/softstep.webp'),
  },
  storywalker: {
    ui: require('../../assets/images/walksigns/ui/storywalker.webp'),
    share: require('../../assets/images/walksigns/share/storywalker.webp'),
  },
  wonderbound: {
    ui: require('../../assets/images/walksigns/ui/wonderbound.webp'),
    share: require('../../assets/images/walksigns/share/wonderbound.webp'),
  },
};
