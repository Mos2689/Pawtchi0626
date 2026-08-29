/**
 * WalkLiveActivityBridge — the walk's Lock Screen card, driven entirely by
 * watching.
 *
 * ── The one architectural rule ──
 *
 * This component is a READ-ONLY OBSERVER of the walk store. It calls no store
 * action, imports nothing from lib/walk/walkTracker, and never touches the
 * durable `walk:active` record or the OS location task. Background tracking has
 * regressed from this area before; the defence is that there is no code path
 * from here into it at all.
 *
 * Note in particular what this file does NOT do: it does not attach a second
 * listener to walkTracker. That module has a single `liveListener` slot which
 * the walk store owns, and taking it — or making it a list — would be a change
 * to the file that authorizes the OS task. Subscribing to the store instead
 * costs nothing, because `_ingest` already writes a new session on every point
 * batch, so the store ticks at GPS cadence for free.
 *
 * ── The lifecycle it mirrors ──
 *
 *   starting/tracking  → request the card, then update it as the walk changes
 *   saving             → freeze the card on "Walk finished" (the walk really is
 *                        over; leaving "Tracking" up would be a lie while the
 *                        summary is being written)
 *   summary/idle       → end it, preferring the finalized distance so the card
 *                        and the summary screen never disagree
 *   cold launch        → sweep. `phase` is never persisted, so a card still on
 *                        screen at launch belongs to no walk this process knows
 *                        about. Same reasoning as walkTracker's unconditional
 *                        stop; if a walk really is ongoing, recoverOrphanedWalk
 *                        sets `tracking` a moment later and a fresh card starts.
 */

import { useEffect } from 'react';
import { WALK_LIVE_ACTIVITY_ENABLED, WALK_TRACKING_ENABLED } from '../constants/features';
import {
  LiveWalkContent,
  buildLiveWalkContent,
  finalContent,
  shouldPushUpdate,
} from '../lib/walk/liveActivity';
import {
  endAllLiveActivities,
  endLiveActivity,
  isLiveActivitySupported,
  startLiveActivity,
  updateLiveActivity,
} from '../modules/pawtchi-live-activity';
import { useWalkStore } from '../store/useWalkStore';

/** How long the final card stays up. Long enough to notice a walk that
 *  auto-stopped in a pocket, short enough not to loiter. */
const DISMISS_AFTER_MS = 60_000;

/** Re-evaluation cadence. The 60s heartbeat inside `shouldPushUpdate` decides
 *  whether a tick actually pushes; this only guarantees ticks exist when GPS
 *  has gone quiet and the store is therefore not changing. */
const TICK_MS = 15_000;

export function WalkLiveActivityBridge() {
  useEffect(() => {
    if (!WALK_TRACKING_ENABLED || !WALK_LIVE_ACTIVITY_ENABLED) return;
    if (!isLiveActivitySupported()) return;

    // The card we currently believe is on screen, and what it last showed.
    let walkId: string | null = null;
    let content: LiveWalkContent | null = null;
    let lastSentAt = 0;
    let frozen = false;
    let disposed = false;

    /** Serialize every native call: a start and the end that follows it must
     *  never interleave, or the sweep inside `start` can eat the new card. */
    let chain: Promise<unknown> = Promise.resolve();
    const serialize = (fn: () => Promise<unknown>) => {
      chain = chain.then(fn, fn).catch(() => {});
    };

    // Cold-launch sweep — see the header.
    serialize(endAllLiveActivities);

    const sync = () => {
      if (disposed) return;
      const { phase, marker, session, lastResult } = useWalkStore.getState();
      const live = phase === 'starting' || phase === 'tracking';

      if (live && marker) {
        const next = buildLiveWalkContent({
          petName: marker.petName,
          startedAt: marker.startedAt,
          session,
        });

        if (walkId !== marker.id) {
          walkId = marker.id;
          content = next;
          frozen = false;
          lastSentAt = Date.now();
          const payload = { ...next, walkId: marker.id };
          serialize(() => startLiveActivity(payload));
          return;
        }

        const now = Date.now();
        if (!shouldPushUpdate(content, next, lastSentAt, now)) return;
        content = next;
        lastSentAt = now;
        const payload = { ...next, walkId: marker.id };
        serialize(() => updateLiveActivity(payload));
        return;
      }

      if (!walkId || !content) return;

      // 'saving' — the walk is genuinely over but the summary is still being
      // written. Freeze the card rather than ending it, so the timer stops and
      // the copy stops promising that tracking continues. `saved: false` here
      // is simply true: nothing has reached the server yet.
      if (phase === 'saving') {
        if (frozen) return;
        frozen = true;
        const final = finalContent({
          previous: content,
          endedAt: Date.now(),
          saved: false,
          walkSessionId: walkId,
        });
        content = final;
        lastSentAt = Date.now();
        const payload = { ...final, walkId };
        serialize(() => updateLiveActivity(payload));
        return;
      }

      // Over. Prefer the finalized summary — it replays the whole point buffer,
      // including fixes that landed while the JS runtime was dead, so it is the
      // number the owner will see on the summary screen.
      const result = lastResult?.walkSessionId === walkId ? lastResult : null;

      // "SAVED" and the "See the map" link are gated on the row actually
      // existing. 'queued' means the walk is real but still only in the offline
      // queue — the card says finished, and offers no link to a map that has
      // nothing behind it yet.
      const saved =
        result?.sync.outcome === 'matched' || result?.sync.outcome === 'logged_new';

      const final = finalContent({
        previous: content,
        endedAt: Date.now(),
        distanceKm: result ? result.summary.distanceM / 1000 : undefined,
        // `sniffPoints` is optional on WalkSummary (queued summaries predating
        // the detector lack it) — fall back to the live count rather than to 0.
        sniffCount: result?.summary.sniffPoints?.length,
        durationMs: result ? result.summary.durationS * 1000 : undefined,
        saved,
        walkSessionId: walkId,
      });
      const payload = { ...final, walkId };
      walkId = null;
      content = null;
      frozen = false;
      serialize(() => endLiveActivity(payload, DISMISS_AFTER_MS));
    };

    const unsubscribe = useWalkStore.subscribe(sync);
    const ticker = setInterval(sync, TICK_MS);
    sync();

    return () => {
      disposed = true;
      clearInterval(ticker);
      unsubscribe();
    };
  }, []);

  return null;
}
