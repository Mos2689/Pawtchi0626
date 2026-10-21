/**
 * Bundled media for launch announcements, by catalogue key.
 *
 * Kept out of lib/announcements/catalogue.ts because a require() of an .mp4
 * cannot run under the ts-jest suite that tests the catalogue.
 *
 * Videos are silent, ~8 s seamless loops at 1170×450 (the sheet's media band,
 * 2.6:1, at 3x). Source: pawtchi-connect-assets/videos/announcement-connect-loop.
 */

import type { AnnouncementMediaKey } from '../../lib/announcements/catalogue';

export interface AnnouncementMediaAsset {
  video: number;
  poster: number;
}

export const ANNOUNCEMENT_MEDIA: Record<AnnouncementMediaKey, AnnouncementMediaAsset> = {
  'connect-loop': {
    video: require('../../assets/announcements/connect-loop.mp4'),
    poster: require('../../assets/announcements/connect-loop-poster.jpg'),
  },
};
