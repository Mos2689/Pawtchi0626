/**
 * useAnnouncements — decides, once per app open, whether Home shows a launch
 * announcement, and records what the person did with it.
 *
 * ── When ────────────────────────────────────────────────────────────────────
 *
 * An "app open" is a cold start, or a return to the foreground after at least
 * 30 minutes away. Each open gets one decision, taken once Home has settled
 * (its pet loaded, nothing else on screen, 1.5 s of quiet).
 *
 * ── One pop-up per open ─────────────────────────────────────────────────────
 *
 * Home already has its own moments (Walksign, milestones, template unlocks,
 * the notification primer, the first-walk intro). If any of them appears
 * during this open — before or while we wait — the announcement stands down
 * until the next open rather than queueing up behind it. Nobody should close
 * one sheet only to be handed another. It also never shows while a walk is
 * being recorded.
 *
 * ── Counting ────────────────────────────────────────────────────────────────
 *
 * A showing is recorded the moment the sheet appears; the CTA marks it done
 * for good; every other close is a dismissal. See lib/announcements.
 */

import React from 'react';
import { AppState } from 'react-native';
import { useRouter } from 'expo-router';

import { ANNOUNCEMENTS, type Announcement } from '../lib/announcements/catalogue';
import { pickAnnouncement } from '../lib/announcements/eligibility';
import {
  readAnnouncementState,
  recordCompleted,
  recordDismissed,
  recordShown,
  resetAnnouncementState,
  rewindAnnouncementStateForDev,
} from '../lib/announcements/announcementState';
import { isPerfFlagOn, whenPerfFlagsReady } from '../lib/perfFlags';
import { track } from '../lib/analytics';
import type { AnnouncementOutcome } from '../components/announcements/AnnouncementSheet';

const SETTLE_MS = 1500;
const NEW_OPEN_AFTER_MS = 30 * 60 * 1000;
/** Flags normally load in well under a second; past this, read them as off. */
const FLAG_WAIT_MS = 4000;

interface Options {
  userId: string | null | undefined;
  /** Home has what it needs to judge the audience (the active pet). */
  ready: boolean;
  isDogOwner: boolean;
  /** Another Home pop-up is on screen. */
  otherOverlayOpen: boolean;
  /** A walk is being recorded. */
  walkActive: boolean;
}

interface Showing {
  announcement: Announcement;
  showNumber: number;
}

export function useAnnouncements({ userId, ready, isDogOwner, otherOverlayOpen, walkActive }: Options) {
  const router = useRouter();
  const [showing, setShowing] = React.useState<Showing | null>(null);

  // Each app open gets a token; a decision is taken at most once per token.
  const [openToken, setOpenToken] = React.useState(0);
  const decidedFor = React.useRef(-1);
  const standDownFor = React.useRef(-1);
  const backgroundedAt = React.useRef<number | null>(null);

  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background') backgroundedAt.current = Date.now();
      if (next === 'active' && backgroundedAt.current != null) {
        const away = Date.now() - backgroundedAt.current;
        backgroundedAt.current = null;
        if (away >= NEW_OPEN_AFTER_MS) setOpenToken((t) => t + 1);
      }
    });
    return () => sub.remove();
  }, []);

  // Another moment this open means no announcement this open.
  React.useEffect(() => {
    if (otherOverlayOpen && !showing) standDownFor.current = openToken;
  }, [otherOverlayOpen, showing, openToken]);

  // Read inside the async decision so it sees the latest values, not the
  // ones captured when the timer started.
  const latest = React.useRef({ otherOverlayOpen, walkActive, isDogOwner });
  latest.current = { otherOverlayOpen, walkActive, isDogOwner };

  React.useEffect(() => {
    if (!userId || !ready || otherOverlayOpen || walkActive || showing) return;
    if (decidedFor.current === openToken || standDownFor.current === openToken) return;

    let cancelled = false;
    const token = openToken;
    const timer = setTimeout(() => {
      void (async () => {
        await whenPerfFlagsReady(FLAG_WAIT_MS);
        const state = await readAnnouncementState(userId);
        if (cancelled) return;
        const now = Date.now();
        const pick = pickAnnouncement(
          ANNOUNCEMENTS,
          state,
          { isDogOwner: latest.current.isDogOwner, isFlagOn: isPerfFlagOn },
          now,
        );
        // Something else claimed the screen while we were reading: try again
        // on the next open rather than stacking on top of it.
        if (latest.current.otherOverlayOpen || latest.current.walkActive || standDownFor.current === token) {
          return;
        }
        decidedFor.current = token;
        if (!pick) return;
        const record = await recordShown(userId, pick.id, now);
        if (cancelled) return;
        track('announcement_shown', { id: pick.id, show_number: record.shows });
        setShowing({ announcement: pick, showNumber: record.shows });
      })();
    }, SETTLE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [userId, ready, otherOverlayOpen, walkActive, showing, openToken]);

  const onClosed = React.useCallback(
    (outcome: AnnouncementOutcome) => {
      const current = showing;
      setShowing(null);
      if (!current || !userId) return;
      const props = { id: current.announcement.id, show_number: current.showNumber };
      if (outcome === 'cta') {
        track('announcement_cta', props);
        void recordCompleted(userId, current.announcement.id);
        router.navigate(current.announcement.cta.route as never);
      } else {
        track('announcement_dismissed', { ...props, via: outcome });
        void recordDismissed(userId, current.announcement.id);
      }
    },
    [router, showing, userId],
  );

  // Development only, from the debugger:
  //   __pawtchiAnnouncements.reset()    forget this account's counts
  //   __pawtchiAnnouncements.nextDay()  move every showing back 25 h, then reopen
  //   __pawtchiAnnouncements.reopen()   start a fresh app open now
  // so showings two and three, and the cap, can be tried without waiting.
  React.useEffect(() => {
    if (!__DEV__ || !userId) return;
    const g = globalThis as { __pawtchiAnnouncements?: unknown };
    g.__pawtchiAnnouncements = {
      reset: () => resetAnnouncementState(userId),
      reopen: () => setOpenToken((t) => t + 1),
      nextDay: async () => {
        await rewindAnnouncementStateForDev(userId, 25 * 60 * 60 * 1000);
        setOpenToken((t) => t + 1);
      },
      state: () => readAnnouncementState(userId),
    };
    return () => {
      delete g.__pawtchiAnnouncements;
    };
  }, [userId]);

  return { announcement: showing?.announcement ?? null, onClosed };
}
