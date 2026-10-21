/**
 * Launch announcements — the catalogue.
 *
 * One entry per thing we are telling people about. A new launch adds an entry
 * here (and, if it has media, one line in components/announcements/
 * announcementMedia.ts); nothing else in the app changes.
 *
 * ── Why the copy is capped ──────────────────────────────────────────────────
 *
 * The sheet is 40% of the screen and half of that is media. A title and ONE
 * line of body is what fits without the sheet feeling crowded, and the first
 * preview proved that a second line and a secondary button were already too
 * much. catalogue.test.ts holds every entry to the limits below, so the next
 * launch cannot quietly bring the clutter back.
 *
 * ── Why media is a key, not a require() ─────────────────────────────────────
 *
 * This module is pure data so the eligibility rules can be tested under
 * ts-jest, where requiring an .mp4 is an error. The component maps the key to
 * the bundled asset.
 *
 * Copy follows the brand copy spec: sentence case, no exclamation marks.
 */

import type { PerfFlag } from '../perfFlags';

export const EYEBROW_MAX = 24;
export const TITLE_MAX = 24;
export const BODY_MAX = 48;

export type AnnouncementAudience = 'everyone' | 'dog_owners';

/** Keys resolved to bundled assets in components/announcements/announcementMedia.ts. */
export type AnnouncementMediaKey = 'connect-loop';

export interface Announcement {
  /**
   * Stable forever: every user's show and dismissal counts are keyed on it.
   * Renaming an id re-shows the announcement to everyone who has already
   * seen it, so a new campaign gets a new id instead.
   */
  id: string;
  /** Higher wins when several are eligible. One announcement per app open. */
  priority: number;
  /** ISO timestamps. Outside the window the entry never shows. */
  startsAt?: string;
  endsAt?: string;
  /**
   * When set, the PostHog flag must be on. Lets a launch be started, paused
   * or rolled out by percentage without a build (there is no OTA). Unknown or
   * unreachable reads as off, like every flag in lib/perfFlags.ts.
   */
  gateFlag?: PerfFlag;
  audience: AnnouncementAudience;
  maxShows: number;
  minHoursBetween: number;
  /** Close, swipe or backdrop tap this many times and it is done for good. */
  maxDismissals: number;
  media: AnnouncementMediaKey;
  /** Optional small line above the title that names what is new. */
  eyebrow?: string;
  title: string;
  body: string;
  cta: {
    label: string;
    /** A relative in-app route. Never a URL. */
    route: string;
  };
}

export const ANNOUNCEMENTS: readonly Announcement[] = [
  {
    id: 'connect-launch-2026-10',
    priority: 10,
    gateFlag: 'announceConnect',
    audience: 'dog_owners',
    maxShows: 3,
    minHoursBetween: 24,
    maxDismissals: 2,
    media: 'connect-loop',
    eyebrow: 'Connect is live',
    title: 'Walk together',
    body: 'Plan a meetup. Every dog on one live map.',
    cta: { label: 'Plan a meetup', route: '/(tabs)?segment=together' },
  },
];
