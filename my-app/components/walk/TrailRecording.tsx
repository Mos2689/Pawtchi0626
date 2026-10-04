/**
 * Everything a Trail walk needs recording — and no screen at all.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * A Trail walk used to be recorded by `/walk`, the solo walk screen. Starting
 * one pushed you there, it cleared the location disclosure, started tracking,
 * and only then pushed the shared map over itself — which is the flash of the
 * personal walk screen people saw. Worse, it then STAYED mounted underneath for
 * the whole walk, because it owned the camera pipeline, the live-location
 * side-channel and the finish work, and because "Finish" on the shared map did
 * `router.back()` onto it and used it as a trampoline to the memory screen.
 *
 * None of that work is visual. It was in a screen because that is where it was
 * written, and the cost was that the two kinds of walk could never be cleanly
 * separated: a Trail always had the solo recorder somewhere underneath it.
 *
 * So it lives here instead — headless, mounted once at the app root beside
 * WalkLiveActivityBridge, and awake only while the durable walk record says
 * this phone is on a Trail.
 *
 * ── Why the root, and not the live screen ──────────────────────────────────
 *
 * Because a walk outlives a screen. Somebody on a Trail can open the trail's
 * own page, look at the memory of a previous walk, or put the phone in a
 * pocket and let the OS relaunch the app from a location event. If this were
 * rendered by the shared map, every one of those would unpublish the camera
 * and stop the position updates for as long as they were away.
 *
 * ── Where the trail comes from ──────────────────────────────────────────────
 *
 * `marker.trail` — walkTracker's durable record, not a route param and not a
 * one-shot handoff. That is what makes this correct after a cold relaunch: the
 * OS restarts the app, `recoverOrphanedWalk` restores the marker, this mounts
 * itself, and the walk carries on being a Trail walk. See
 * [[trail-vs-solo-walk-separation]].
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { router, usePathname } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { WALK_CAMERA_ENABLED } from '../../constants/features';
import { useWalkKeepsakes } from '../../hooks/useWalkKeepsakes';
import { simplifyRoute } from '../../lib/walk/geo';
import {
  publishRecorderHandle,
  updateRecorderHandle,
  type LiveCapture,
} from '../../lib/walk/recorderHandle';
import {
  finishCommunityParticipation,
  isTrailHost,
  linkPersonalWalk,
  publishLiveLocation,
} from '../../lib/communityWalks';
import { publishCommunityCaptures, publishOneCapture } from '../../lib/communityMedia';
import {
  hostClosedMemoryHref,
  shouldFollowHostClose,
  shouldReplaceForMemory,
  type ClosableWalk,
} from '../../lib/community/hostClose';
import { beginLegSettle, settleLeg } from '../../lib/community/legSettle';
import { supabase } from '../../lib/supabase';
import { withTimeout } from '../../lib/withTimeout';
import { isPerfFlagOn } from '../../lib/perfFlags';
import { closeCheckDue } from '../../lib/community/liveRoster';
import { useWalkStore } from '../../store/useWalkStore';
import type { ActiveWalkTrail } from '../../lib/walk/walkTracker';
import { useActivePetStore } from '../../store/useActivePetStore';
import { useAuth } from '../../providers/AuthProvider';
import type { WalkCaptureResult } from './WalkCamera';

/**
 * How often a position is published to the pack.
 *
 * Twelve seconds, unchanged from when this lived in the walk screen. The map
 * reads as live at this rate and it is nowhere near the cadence of the GPS
 * fixes themselves, which arrive every three.
 */
const LOCATION_INTERVAL_MS = 12_000;

/** How often a recording phone re-reads its walk's state, in case a close was missed. */
const CLOSE_POLL_MS = 10_000;

/** A close-check read is abandoned (not cancelled) after this, freeing the slot. */
const CLOSE_CHECK_TIMEOUT_MS = 10_000;

/** A position publish is abandoned (not cancelled) after this, freeing the slot. */
const PUBLISH_TIMEOUT_MS = 10_000;

/** Points kept in a published trace. Enough shape, not the whole recording. */
const TRACE_POINTS = 160;

export function TrailRecording() {
  const { user } = useAuth();
  const activePet = useActivePetStore(state => state.activePet);
  const phase = useWalkStore(state => state.phase);
  const marker = useWalkStore(state => state.marker);
  const session = useWalkStore(state => state.session);
  const lastResult = useWalkStore(state => state.lastResult);
  const endWalk = useWalkStore(state => state.endWalk);
  const pathname = usePathname();

  const recording = phase === 'tracking' || phase === 'starting';

  /**
   * The trail, remembered one beat longer than the walk store keeps it.
   *
   * `useWalkStore` clears `marker` at the exact moment the walk reaches its
   * summary — which is also the moment `lastResult.walkSessionId` appears, and
   * therefore the moment the keepsake flush and the link-to-outing work can
   * finally run. Reading the trail from `marker` alone would switch this
   * component off half a tick before it does the one job that cannot be
   * skipped: writing the photos.
   *
   * Cleared when the walk goes fully idle, so at rest this holds nothing.
   */
  const trailRef = useRef<ActiveWalkTrail | null>(null);
  if (marker?.trail) trailRef.current = marker.trail;
  if (phase === 'idle') trailRef.current = null;
  const trail = marker?.trail ?? trailRef.current;

  /**
   * Is a Trail walk in flight at all — including its wrap-up?
   *
   * Everything below hangs off this. `phase === 'idle'` is the resting state of
   * a phone that is not on a walk, and in that state this component must do
   * NOTHING: no queries, no timers, no outbox drain.
   */
  const active = !!trail && phase !== 'idle';

  /**
   * Whether photos taken from here go to the pack.
   *
   * Defaults to on: somebody who started a walk WITH people has already said
   * they are walking together, and a shutter that silently kept everything
   * private would be the surprising behaviour. The camera shows the switch and
   * this is what it moves.
   */
  const [shareToPack, setShareToPack] = useState(true);
  /**
   * The shutter-time answer for each photo, by capture time.
   *
   * Read when the shutter fires and never re-read, so flipping the switch
   * afterwards cannot retroactively publish something taken while it said
   * personal — or unpublish something already shared.
   */
  const sharedAtShutterRef = useRef<Set<number>>(new Set());
  /** Guards the one-time finish work against a re-render after it has run. */
  const finishedForRef = useRef<string | null>(null);
  const lastLocationRef = useRef(0);

  /**
   * A clock, but only while one is needed.
   *
   * `useWalkKeepsakes` takes `now` to decide when to offer a capture prompt,
   * and an effect inside it depends on that value. Passing `Date.now()` from
   * the render body — which the first version of this file did — gives it a
   * new number on every render, so that effect re-runs continuously for as
   * long as anything in the walk store changes. During a walk that is every
   * GPS fix.
   *
   * State, ticked on an interval that exists only while recording, so a phone
   * that is not on a walk has no timer at all.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!trail || !recording) return;
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, [trail, recording]);

  /**
   * ── `enabled` is the whole reason this component is safe at the root ──────
   *
   * This hook is not passive. On mount it reads the place-prompt log, queries
   * for nearby place candidates, and DRAINS THE KEEPSAKE OUTBOX — which
   * uploads. All of that is correct during a walk and completely wrong at app
   * launch.
   *
   * The first version of this file passed `WALK_CAMERA_ENABLED` here, which is
   * a release flag and always true. Mounted at the root, that ran the entire
   * keepsake machinery on every cold start for every owner, walk or no walk.
   * Those requests queue behind the same Supabase auth lock as everything else
   * at boot, and the result was `fetchPet`, `fetchStreak` and `useRecentWalks`
   * all timing out at 12–15 seconds on a screen with nothing to do with walks.
   *
   * So: only while this phone is actually recording a Trail.
   */
  const keepsakes = useWalkKeepsakes({
    enabled: WALK_CAMERA_ENABLED && active,
    ownerId: user?.id ?? null,
    petId: activePet?.id ?? null,
    session,
    startedAt: marker?.startedAt ?? null,
    now,
    walkSessionId: lastResult?.walkSessionId ?? null,
  });
  const { onCaptured, captures } = keepsakes;

  /**
   * A new walk is a new set of answers — and only a NEW walk.
   *
   * This used to reset on any change of `marker?.id`, including the change to
   * `undefined` when the walk reaches its summary. That is the exact moment the
   * finish-time sweep below reads this set, so the sweep always saw it empty
   * and never published anything: every photo whose shutter-time upload failed
   * (a tunnel, no signal) was silently never shared. Resetting only when a
   * different, real walk starts keeps the answers through the wrap-up.
   */
  const answersForRef = useRef<string | null>(null);
  useEffect(() => {
    const id = marker?.id ?? null;
    if (!id || id === answersForRef.current) return;
    answersForRef.current = id;
    sharedAtShutterRef.current = new Set();
    lastLocationRef.current = 0;
  }, [marker?.id]);

  /**
   * The shutter.
   *
   * Two things happen, in this order and for different reasons. The draft is
   * recorded first, because that is the owner's own keepsake and it must not
   * depend on a network. Then the photo goes to the pack immediately — this is
   * what makes a Trail feel shared while it is happening rather than at the
   * end — and if that fails, nothing is lost: the end-of-walk sweep publishes
   * anything that did not land.
   */
  const handleCapture = useCallback((capture: WalkCaptureResult) => {
    onCaptured(capture);
    if (!trail || !shareToPack) return;
    sharedAtShutterRef.current.add(capture.capturedAt);
  }, [onCaptured, trail, shareToPack]);

  /**
   * Publish shared photos as they appear, one at a time.
   *
   * Driven off the drafts rather than called from the shutter, because the
   * draft is where a capture gains the things publishing needs — its id, its
   * coordinate, its place on the route. `publishedRef` keeps it to once each;
   * the upsert would tolerate a repeat, but a repeat is a wasted upload on a
   * phone that is out walking.
   */
  const publishedRef = useRef<Set<string>>(new Set());
  /** Media ids the server has CONFIRMED — the finish sweep skips exactly these. */
  const confirmedRef = useRef<Set<string>>(new Set());
  /** Publishes still in the air, so the finish sweep waits for them instead of racing them. */
  const inFlightRef = useRef<Map<string, Promise<boolean>>>(new Map());
  useEffect(() => {
    if (!trail || !user?.id || !activePet?.id) return;
    const target = {
      communityWalkId: trail.walkId,
      contributorId: user.id,
      dogId: activePet.id,
    };
    for (const capture of captures) {
      if (!sharedAtShutterRef.current.has(capture.capturedAt)) continue;
      if (publishedRef.current.has(capture.mediaId)) continue;
      const mediaId = capture.mediaId;
      publishedRef.current.add(mediaId);
      const run = publishOneCapture(capture, target)
        .then(ok => {
          // Failed: forget it, so the next render tries again and the sweep at
          // the end has one more chance too. Succeeded: the sweep skips it.
          if (ok) confirmedRef.current.add(mediaId);
          else publishedRef.current.delete(mediaId);
          return ok;
        })
        .finally(() => { inFlightRef.current.delete(mediaId); });
      inFlightRef.current.set(mediaId, run);
    }
  }, [captures, trail, user?.id, activePet?.id]);

  /**
   * The camera pipeline, lent to whichever screen is on top.
   *
   * Published for the walk's LIFETIME, never re-published on a tick: React runs
   * an effect's cleanup before its next body, and a cleanup here nulls the
   * handle — which unmounts the camera on the screen reading it. Values that
   * change ride in through `updateRecorderHandle` below.
   */
  useEffect(() => {
    if (!WALK_CAMERA_ENABLED || !trail || !recording) return;
    return publishRecorderHandle({
      onCaptured: handleCapture,
      context: { distanceLabel: null, elapsedLabel: null, placeLabel: null },
      captures: [],
      sharing: { packName: trail.packName, enabled: shareToPack, onChange: setShareToPack },
    });
    // Lifetime only — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trail?.walkId, recording]);

  const liveCaptures = useMemo<LiveCapture[]>(
    () => captures.map(capture => ({
      id: capture.capturedAt,
      uri: capture.uri,
      lat: capture.lat,
      lng: capture.lng,
      // What was true THEN, from the set the shutter wrote into — not the
      // switch's position now.
      shared: sharedAtShutterRef.current.has(capture.capturedAt),
    })),
    [captures],
  );

  useEffect(() => {
    if (!WALK_CAMERA_ENABLED || !trail || !recording) return;
    const km = (session?.distanceM ?? 0) / 1000;
    const elapsed = marker?.startedAt ? Date.now() - marker.startedAt : 0;
    updateRecorderHandle({
      onCaptured: handleCapture,
      context: {
        distanceLabel: km > 0 ? `${km.toFixed(2)} km` : null,
        elapsedLabel: elapsed > 0 ? formatElapsed(elapsed) : null,
        placeLabel: null,
      },
      captures: liveCaptures,
      sharing: { packName: trail.packName, enabled: shareToPack, onChange: setShareToPack },
    });
  }, [trail, recording, handleCapture, liveCaptures, shareToPack, session?.distanceM, marker?.startedAt]);

  /**
   * Position, to the pack.
   *
   * A best-effort side channel around the walk, never part of it: a failed
   * update touches nothing the recorder owns and interrupts nobody. Only when
   * this walker agreed to share, which is a per-walk decision made on the join
   * step and never a standing one.
   */
  /**
   * One publish in the air at a time (perf audit E6, 2026-10-01).
   *
   * On a stalled connection each 12-second tick used to start another upsert
   * on top of the ones still waiting, so a bad patch of signal stacked
   * requests that all landed at once when it cleared. Now a tick that finds a
   * publish still pending is skipped WITHOUT moving the throttle clock, so the
   * first fix after the stall goes straight out — newer than any it replaced.
   * The timeout only frees the slot; the request itself is not cancelled.
   */
  const publishingRef = useRef(false);
  useEffect(() => {
    const point = session?.lastAccepted;
    if (!trail?.shareLocation || phase !== 'tracking' || !point) return;
    if (point.timestamp - lastLocationRef.current < LOCATION_INTERVAL_MS) return;
    if (publishingRef.current) return;
    publishingRef.current = true;
    lastLocationRef.current = point.timestamp;
    void withTimeout(
      publishLiveLocation(
        trail.walkId,
        point,
        simplifyRoute(session?.path ?? [], TRACE_POINTS),
      ),
      PUBLISH_TIMEOUT_MS,
      'publishLiveLocation',
    )
      .catch(() => {})
      .finally(() => { publishingRef.current = false; });
  }, [trail, phase, session?.lastAccepted, session?.path]);

  /**
   * The walk is over: attach it to the outing, close this walker's
   * participation, and sweep up any photo that did not publish while walking.
   *
   * All three are non-blocking and allowed to fail. A pack outage must never
   * stand between somebody and the walk they just did.
   */
  useEffect(() => {
    if (phase !== 'summary' || !lastResult || !trail || !activePet?.id || !user?.id) return;
    if (finishedForRef.current === lastResult.walkSessionId) return;
    finishedForRef.current = lastResult.walkSessionId;
    void Promise.allSettled([
      linkPersonalWalk({
        communityWalkId: trail.walkId,
        personalWalkId: lastResult.walkSessionId,
        petId: activePet.id,
      }),
      finishCommunityParticipation(trail.walkId),
      // The backstop, for the photos that did NOT make it at the shutter —
      // taken where there was no signal. It waits for any publish still in the
      // air, then skips everything the server confirmed, so a photo that went
      // up during the walk is not resized and uploaded a second time.
      Promise.allSettled([...inFlightRef.current.values()]).then(() =>
        publishCommunityCaptures({
          communityWalkId: trail.walkId,
          contributorId: user.id,
          dogId: activePet.id,
          captures,
          sharedCaptureTimes: sharedAtShutterRef.current,
          alreadyPublished: confirmedRef.current,
        })),
    ]).finally(() => {
      // The memory screen may be waiting on exactly this — see legSettle.
      settleLeg(trail.walkId);
      settlingForRef.current = null;
    });
  }, [phase, lastResult, trail, activePet?.id, user?.id, captures]);

  /**
   * Open the memory's wait the moment this leg starts finishing — whatever
   * finished it: the Finish button, the host, or the auto-stop — and never
   * leave it open. A save that ends anywhere but the summary (a failed
   * finalize drops straight to idle) settles it here, so the memory is not
   * left holding its loader until the timeout.
   */
  const settlingForRef = useRef<string | null>(null);
  useEffect(() => {
    if (phase === 'saving' && trail) {
      beginLegSettle(trail.walkId);
      settlingForRef.current = trail.walkId;
    } else if (phase === 'idle' && settlingForRef.current) {
      settleLeg(settlingForRef.current);
      settlingForRef.current = null;
    }
  }, [phase, trail]);

  /**
   * The host closed the walk: finish this leg and go to the memory.
   *
   * ── Why here, and not on the live map ─────────────────────────────────────
   *
   * This used to live on the live screen, so it only worked for somebody
   * looking at it. A member on the trail page, in the camera, or on Home kept
   * recording into a walk that had ended. This component is awake for the
   * whole of a recording wherever the person is in the app, so the close is
   * followed from anywhere.
   *
   * ── Three doors, one decision ─────────────────────────────────────────────
   *
   * The realtime UPDATE is acted on as it arrives — no reload, no debounce.
   * Realtime does not replay what it missed while the socket was down, so the
   * walk is also read once when recording starts (a cold relaunch mid-walk
   * lands here) and on every return to the foreground (a pocketed phone). All
   * three go through `followHostClose`, and `endWalk`'s own phase guard makes a
   * second arrival a no-op.
   *
   * The recording keeps everything it had: `endWalk` is the ordinary finish,
   * and the attach work above runs exactly as for a manual finish. The memory
   * is opened straight away and shows its loader until this leg is attached,
   * so the member sees their own route in it rather than everybody else's.
   */
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const followedCloseRef = useRef<string | null>(null);
  const walkId = trail?.walkId ?? null;
  const packId = trail?.packId ?? null;
  const userId = user?.id ?? null;

  /**
   * Whether this phone is the trail's host — the pack OWNER, via isTrailHost,
   * never the walk's organiser. Read once per recording and kept; a failed
   * read stays unknown and is asked again by the next check.
   */
  const isHostRef = useRef<boolean | null>(null);
  const resolveIsHost = useCallback(async (): Promise<boolean | null> => {
    if (isHostRef.current !== null) return isHostRef.current;
    if (!packId || !userId) return null;
    const { data, error } = await supabase
      .from('community_packs')
      .select('owner_id')
      .eq('id', packId)
      .maybeSingle();
    if (error || !data) return null;
    isHostRef.current = isTrailHost(data as { owner_id: string }, userId);
    return isHostRef.current;
  }, [packId, userId]);

  const followHostClose = useCallback(async (walk: ClosableWalk | null | undefined) => {
    if (!walkId || !walk) return;
    if (walk.state !== 'completed' && walk.state !== 'cancelled') return;
    const isHost = await resolveIsHost().catch(() => null);
    if (!shouldFollowHostClose(walk, isHost)) return;
    const current = useWalkStore.getState().phase;
    if (current !== 'tracking' && current !== 'starting') return;
    if (followedCloseRef.current === walkId) return;
    followedCloseRef.current = walkId;

    beginLegSettle(walkId);
    void endWalk('host_closed');
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const href = hostClosedMemoryHref(walkId) as never;
    if (shouldReplaceForMemory(pathnameRef.current, walkId)) router.replace(href);
    else router.push(href);
  }, [walkId, resolveIsHost, endWalk]);

  useEffect(() => {
    if (!recording || !walkId) return;
    followedCloseRef.current = null;
    isHostRef.current = null;
    // Asked now, not when the close arrives, so following it costs no extra
    // round trip at the moment it matters.
    void resolveIsHost().catch(() => {});

    // perf-live-deltas: while the realtime channel is connected the close
    // event arrives on its own, so the read below is only a backstop and runs
    // every 30 s instead of every 10 (lib/community/liveRoster closeCheckDue).
    const lighter = isPerfFlagOn('liveDeltas');
    let subscribed = false;
    let lastCheckAt = 0;

    const channel = supabase
      .channel(`trail-close-${walkId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'community_walks', filter: `id=eq.${walkId}` },
        payload => { void followHostClose(payload.new as ClosableWalk); },
      )
      .subscribe(status => { subscribed = status === 'SUBSCRIBED'; });

    // One primary-key read. Cheap enough to do on every foreground, and it is
    // the only thing that sees a close made while the socket was down.
    //
    // One at a time (perf audit E6): with replies slower than the 10-second
    // poll, reads used to overlap and pile up. A pending read makes the next
    // tick a no-op; the timeout frees the slot without cancelling the read.
    let checking = false;
    const check = () => {
      if (checking) return;
      checking = true;
      lastCheckAt = Date.now();
      void withTimeout(
        supabase
          .from('community_walks')
          .select('state')
          .eq('id', walkId)
          .maybeSingle(),
        CLOSE_CHECK_TIMEOUT_MS,
        'closeCheck',
      )
        .then(({ data }) => { void followHostClose(data as ClosableWalk | null); }, () => {})
        .finally(() => { checking = false; });
    };
    check();

    // Belt and braces for the realtime event. That event is the instant path,
    // but it was silently never delivered for months — community_walks was not
    // in the realtime publication (20260924010000) — and a socket can drop
    // without telling anyone. One primary-key read every ten seconds, only
    // while this phone is recording a meetup, bounds a missed close at ten
    // seconds instead of "whenever they next background the app".
    const poll = setInterval(() => {
      if (closeCheckDue({ lighter, subscribed, lastCheckAt, now: Date.now() })) check();
    }, CLOSE_POLL_MS);

    let previous: AppStateStatus = AppState.currentState;
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active' && previous !== 'active') check();
      previous = next;
    });

    return () => {
      clearInterval(poll);
      subscription.remove();
      void supabase.removeChannel(channel);
    };
  }, [recording, walkId, followHostClose, resolveIsHost]);

  return null;
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
