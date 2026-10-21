/**
 * Which announcement, if any, to show on this app open.
 *
 * Pure: everything it needs arrives as arguments, so every rule below is
 * covered by eligibility.test.ts without a device, a clock or PostHog.
 */

import type { PerfFlag } from '../perfFlags';
import type { Announcement } from './catalogue';

export interface AnnouncementRecord {
  shows: number;
  dismissals: number;
  /** The CTA was tapped. Done for good. */
  completed: boolean;
  /** Epoch ms of the most recent showing, or null if never shown. */
  lastShownAt: number | null;
}

export type AnnouncementState = Record<string, AnnouncementRecord>;

export interface AnnouncementContext {
  isDogOwner: boolean;
  isFlagOn: (flag: PerfFlag) => boolean;
}

const HOUR_MS = 60 * 60 * 1000;

export const EMPTY_RECORD: AnnouncementRecord = {
  shows: 0,
  dismissals: 0,
  completed: false,
  lastShownAt: null,
};

function inWindow(entry: Announcement, now: number): boolean {
  const start = entry.startsAt ? Date.parse(entry.startsAt) : NaN;
  const end = entry.endsAt ? Date.parse(entry.endsAt) : NaN;
  if (Number.isFinite(start) && now < start) return false;
  if (Number.isFinite(end) && now > end) return false;
  return true;
}

export function isEligible(
  entry: Announcement,
  record: AnnouncementRecord | undefined,
  ctx: AnnouncementContext,
  now: number,
): boolean {
  const r = record ?? EMPTY_RECORD;
  if (!inWindow(entry, now)) return false;
  if (entry.audience === 'dog_owners' && !ctx.isDogOwner) return false;
  if (r.completed) return false;
  if (r.shows >= entry.maxShows) return false;
  if (r.dismissals >= entry.maxDismissals) return false;
  if (r.lastShownAt != null && now - r.lastShownAt < entry.minHoursBetween * HOUR_MS) return false;
  // Last, so a flag is only read for an entry that would otherwise show:
  // PostHog then sees exposures for real candidates, not for everyone.
  if (entry.gateFlag && !ctx.isFlagOn(entry.gateFlag)) return false;
  return true;
}

/** The single entry to show, highest priority first, or null. */
export function pickAnnouncement(
  entries: readonly Announcement[],
  state: AnnouncementState,
  ctx: AnnouncementContext,
  now: number,
): Announcement | null {
  const ranked = [...entries].sort((a, b) => b.priority - a.priority);
  return ranked.find((entry) => isEligible(entry, state[entry.id], ctx, now)) ?? null;
}
