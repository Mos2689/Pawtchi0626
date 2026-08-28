/**
 * useWalkStore — the live walk session's UI/orchestration layer.
 *
 * This store is deliberately THIN. It owns UI state (phase, live session) and
 * the auto-stop tick; it does NOT own tracking lifecycle. The single authority
 * for "is a walk happening" is the durable record in `lib/walk/walkTracker.ts`
 * (the `walk:active` AsyncStorage key), and the OS location task is authorized
 * only by that record. Consequences the store relies on:
 *
 *   • `phase` is transient UI state — NEVER persisted. A cold launch starts
 *     'idle', so nothing in JS can inherit a stale "a walk is running".
 *   • Starting a walk writes the record + starts the OS task (walkTracker).
 *     Finishing clears the record + stops it. A launch NEVER starts tracking —
 *     it only reads the record to decide continue-vs-finalize.
 *   • The full point stream lives in walkTracker's buffer; any process (even an
 *     OS-relaunched one) reconstructs a walk by replaying it through the pure
 *     session machine.
 */

import { create } from 'zustand';
import { track } from '../lib/analytics';
import { GeoPoint, simplifyRoute } from '../lib/walk/geo';
import {
  checkAutoStop,
  createSession,
  finalizeSession,
  ingestPoint,
  EndReason,
  RawGpsPoint,
  SessionConfig,
  WalkSessionState,
  WalkSummary,
} from '../lib/walk/walkSession';
import {
  deriveDogWalkProfile,
  sessionConfigFor,
} from '../lib/walk/dogCalibration';
import { validateWalk, ValidationResult } from '../lib/walk/walkValidator';
import {
  finalizeAndSyncWalk,
  flushWalkQueue,
  generateWalkSessionId,
  WalkSyncResult,
} from '../lib/walk/walkSync';
import { collectWalkLabels, WalkLabels } from '../lib/walk/geoLabels';
import {
  ActiveWalkDescriptor,
  clearPoints,
  isRunning,
  readActiveWalk,
  readPoints,
  requestPermission,
  setLiveListener,
  startWalk as trackerStartWalk,
  stopWalk as trackerStopWalk,
  WalkPermission,
} from '../lib/walk/walkTracker';
import type { Pet } from './useActivePetStore';
import { supabase } from '../lib/supabase';
import { trackFirebaseEvent } from '../lib/firebaseAnalytics';

/**
 * Whether this would be the owner's first walk that the validator called
 * `valid` — the acquisition activation moment, measured once per account.
 *
 * Asked BEFORE the walk is written, like `isFirstFoodLogForUser` on Meal, since
 * the row this walk is about to create would otherwise answer its own question.
 * `walkSessionId` is excluded because the recovery path finalizes an orphan
 * whose row may already exist.
 *
 * Both sides of the comparison use the same 'valid' bar, so an owner whose
 * first outing was too short or GPS-junk still activates on the first real one.
 *
 * Fails closed: a lookup error must never turn an ordinary walk into a false
 * acquisition milestone.
 */
async function isFirstValidWalkForOwner(
  ownerId: string,
  walkSessionId: string,
): Promise<boolean> {
  if (!ownerId) return false;
  try {
    const { data: pets, error: petsError } = await supabase
      .from('pets')
      .select('id')
      .eq('owner_id', ownerId);
    if (petsError || !pets?.length) return false;

    const { data: priorWalks, error: walksError } = await supabase
      .from('walk_sessions')
      .select('id')
      .in('pet_id', pets.map(pet => pet.id))
      .eq('validation_verdict', 'valid')
      .neq('id', walkSessionId)
      .limit(1);

    return !walksError && priorWalks?.length === 0;
  } catch {
    return false;
  }
}

export type WalkPhase = 'idle' | 'starting' | 'tracking' | 'saving' | 'summary';

/** The in-memory mirror of the active-walk record (the durable copy lives in
 *  walkTracker). Same shape as walkTracker's descriptor. */
export type ActiveWalkMarker = ActiveWalkDescriptor;

/** How recent the last buffered point must be to treat a walk as still ongoing
 *  on launch — the OS is provably still delivering. Point-freshness, NOT the
 *  unreliable `isRunning()` read, is what tells a live walk from a finished one. */
const ONGOING_WINDOW_MS = 3 * 60_000;

export interface WalkResult {
  walkSessionId: string;
  summary: WalkSummary;
  verdict: ValidationResult;
  sync: WalkSyncResult;
  route: GeoPoint[];
  petName: string;
  recovered: boolean;
  labels: WalkLabels;
}

interface WalkState {
  phase: WalkPhase;
  /** In-memory mirror of the active-walk record; non-null while a walk is live.
   *  NOT persisted — walkTracker owns the durable copy. */
  marker: ActiveWalkMarker | null;
  /** In-memory live session (rebuilt from the buffer after restarts). */
  session: WalkSessionState | null;
  /** Clinical session-cap notice (activityRestrictions) — shown once. */
  capReached: boolean;
  lastResult: WalkResult | null;

  startWalk: (pet: Pet, ownerId: string) => Promise<'started' | WalkPermission>;
  /** Internal — point batches arriving from the tracker's live listener. */
  _ingest: (points: RawGpsPoint[]) => void;
  endWalk: (reason: EndReason) => Promise<void>;
  /** Slow poll from the live screen — auto-stop + cap notice. */
  tick: () => void;
  /** Call once on app launch: continue an ongoing walk or finalize an orphan,
   *  and flush the offline queue. NEVER starts tracking. */
  recoverOrphanedWalk: () => Promise<void>;
  dismissSummary: () => void;
  /** No-finalize kill — leak recovery / mid-walk sign-out. Clears the record,
   *  stops the OS task, clears the buffer, resets to idle. */
  hardStopTracking: () => Promise<void>;
}

function configFor(marker: ActiveWalkMarker): SessionConfig {
  return sessionConfigFor(marker.profile);
}

function replayBuffer(
  marker: ActiveWalkMarker,
  points: RawGpsPoint[],
): WalkSessionState {
  const config = configFor(marker);
  let s = createSession(marker.startedAt);
  for (const p of points) s = ingestPoint(s, p, config);
  return s;
}

export const useWalkStore = create<WalkState>((set, get) => ({
  phase: 'idle',
  marker: null,
  session: null,
  capReached: false,
  lastResult: null,

  startWalk: async (pet: Pet, ownerId: string) => {
    if (get().phase === 'tracking' || get().phase === 'starting') return 'started';
    set({ phase: 'starting', lastResult: null, capReached: false });

    const permission = await requestPermission();
    if (permission !== 'granted') {
      track('walk_tracking_denied', { reason: permission });
      set({ phase: 'idle' });
      return permission;
    }

    const profile = deriveDogWalkProfile({
      species: pet.species,
      breed: pet.breed ?? null,
      ageYears: pet.age_years ?? null,
      weightKg: pet.current_weight_kg ?? null,
      medicalConditions: pet.medical_conditions ?? null,
    });
    const marker: ActiveWalkMarker = {
      id: generateWalkSessionId(),
      petId: pet.id,
      petName: pet.name,
      ownerId,
      startedAt: Date.now(),
      profile,
    };

    await clearPoints();
    set({ marker, session: createSession(marker.startedAt) });
    setLiveListener(points => get()._ingest(points));

    try {
      // Writes the durable record, then starts the OS task (serialized).
      await trackerStartWalk(marker);
    } catch (e: any) {
      setLiveListener(null);
      await trackerStopWalk(); // clears the record if it got written
      set({ phase: 'idle', marker: null, session: null });
      return 'denied';
    }

    // If the user finished/left while the start was in flight, endWalk already
    // ran its (serialized) stop — don't resurrect the walk it ended.
    if (get().phase !== 'starting') {
      setLiveListener(null);
      return 'started';
    }

    set({ phase: 'tracking' });
    track('walk_tracking_started', {
      pet_id: pet.id,
      size_category: profile.sizeCategory,
      life_stage: profile.lifeStage,
    });
    return 'started';
  },

  // Internal — receives batches from the tracker's live listener.
  _ingest: (points: RawGpsPoint[]) => {
    const { marker, session, phase } = get();
    if (phase !== 'tracking' || !marker || !session) return;
    const config = configFor(marker);

    let next: WalkSessionState = session;
    for (const p of points) next = ingestPoint(next, p, config);

    if (session.status === 'active' && next.status === 'auto_paused') {
      track('walk_auto_paused', { elapsed_s: Math.round((Date.now() - marker.startedAt) / 1000) });
    }
    set({ session: next });

    const last = points[points.length - 1];
    const stop = checkAutoStop(next, last?.timestamp ?? Date.now(), config);
    if (stop.shouldStop && stop.reason) {
      get().endWalk(stop.reason);
    }
  },

  tick: () => {
    const { marker, session, phase, capReached } = get();
    if (phase !== 'tracking' || !marker || !session) return;
    const config = configFor(marker);
    const now = Date.now();

    // Clinical cap (never a hard stop — a gentle line on the live screen).
    const cap = marker.profile.sessionCapMinutes;
    if (cap && !capReached && now - marker.startedAt >= cap * 60_000) {
      set({ capReached: true });
    }

    const stop = checkAutoStop(session, now, config);
    if (stop.shouldStop && stop.reason) {
      get().endWalk(stop.reason);
    }
  },

  endWalk: async (reason: EndReason) => {
    const { marker, session, phase } = get();
    if (!marker || (phase !== 'tracking' && phase !== 'starting')) return;

    // Snapshot before teardown — the salvage below finalizes from this.
    const activeMarker = marker;
    const activeSession = session;

    // ── Stop tracking FIRST, before any finalize/network ──
    // trackerStopWalk clears the durable record (so any in-flight/stale delivery
    // self-stops) then stops the OS task. Detach the live listener. Nothing
    // after this can revive tracking — the record is the only authority and it's
    // gone.
    set({ phase: 'saving' });
    setLiveListener(null);
    await trackerStopWalk();

    // Authoritative rebuild from the buffer: it holds every point since start,
    // including ones delivered while the JS runtime was dead.
    const buffered = await readPoints();
    const finalState =
      buffered.length > 0 ? replayBuffer(activeMarker, buffered) : (activeSession ?? createSession(activeMarker.startedAt));

    // A walk that ended by stillness really ended when movement stopped — the
    // 10-minute confirmation wait is not part of the walk.
    const endedAt =
      (reason === 'auto_stationary' || reason === 'auto_home') && finalState.stationarySince
        ? finalState.stationarySince
        : Date.now();

    const summary = finalizeSession(finalState, endedAt, reason);
    const verdict = validateWalk(summary, activeMarker.profile);
    const route = simplifyRoute(summary.path);

    await clearPoints();

    track('walk_completed', {
      end_reason: reason,
      duration_s: summary.durationS,
      distance_m: summary.distanceM,
      avg_speed_kmh: summary.avgMovingSpeedKmh,
    });
    track('walk_validated', {
      verdict: verdict.verdict,
      confidence: verdict.confidence,
    });

    // Reverse-geocode start/end/farthest before persistence so the labels ride
    // with the same upsert as the row. Best-effort — offline finalize persists
    // nulls; the pills stay hidden until a later job (if any) fills them.
    const labels = await collectWalkLabels({
      startPoint: summary.startPoint,
      endPoint: summary.endPoint,
      farthestPoint: summary.farthestPoint,
      endReason: summary.endReason,
      maxExcursionM: summary.maxExcursionM,
    });

    // Asked before the sync writes this walk's own row (see the helper).
    const wasFirstValidWalk =
      verdict.verdict === 'valid' &&
      (await isFirstValidWalkForOwner(activeMarker.ownerId, activeMarker.id));

    const sync = await finalizeAndSyncWalk({
      walkSessionId: activeMarker.id,
      summary,
      route,
      verdict,
      profile: activeMarker.profile,
      petId: activeMarker.petId,
      ownerId: activeMarker.ownerId,
      labels,
    });

    /**
     * The acquisition activation event, once per account.
     *
     * Gated on a confirmed save — 'queued' means the walk is still only in the
     * offline queue, and a conversion reported for a row that may never land
     * would be a lie told to a bidding algorithm. The cost is that a first walk
     * finished offline is not counted; the alternative is counting walks that
     * did not persist, which is worse.
     */
    if (
      wasFirstValidWalk &&
      (sync.outcome === 'matched' || sync.outcome === 'logged_new')
    ) {
      trackFirebaseEvent('first_walk_completed');
    }

    set({
      phase: 'summary',
      marker: null,
      session: null,
      capReached: false,
      lastResult: {
        walkSessionId: activeMarker.id,
        summary,
        verdict,
        sync,
        route,
        petName: activeMarker.petName,
        recovered: reason === 'recovered',
        labels,
      },
    });
  },

  recoverOrphanedWalk: async () => {
    // Always give queued offline walks another shot on launch.
    flushWalkQueue().catch(() => {});

    // The durable record is the ONLY authority. Read it directly.
    const active = await readActiveWalk();

    if (!active) {
      // No walk. Issue one unconditional stop to clear any registration a
      // previous/old build leaked, even if isRunning() lies. NEVER start.
      await trackerStopWalk();
      return;
    }

    // A record exists. Decide continue-vs-finalize on POINT FRESHNESS (the OS is
    // provably still delivering), not the unreliable isRunning() read.
    const buffered = await readPoints();
    const last = buffered[buffered.length - 1];
    const fresh = !!last && Date.now() - last.timestamp < ONGOING_WINDOW_MS;
    const running = await isRunning();

    if (fresh && running) {
      // Genuinely ongoing — backgrounded/killed mid-walk, the OS kept tracking.
      // Reattach the live listener. This is NOT a restart; the OS never stopped.
      set({ marker: active, session: replayBuffer(active, buffered), phase: 'tracking' });
      setLiveListener(points => get()._ingest(points));
      track('walk_recover_reconnect', { buffered_points: buffered.length });
      return;
    }

    // Over (or stale): finalize what the buffer holds, then clear. endWalk stops
    // the OS task (clears the record) and syncs. NEVER resumes.
    track('walk_recover_finalize', { buffered_points: buffered.length });
    set({ marker: active, session: replayBuffer(active, buffered), phase: 'tracking' });
    await get().endWalk('recovered');
  },

  dismissSummary: () => set({ phase: 'idle', lastResult: null }),

  hardStopTracking: async () => {
    setLiveListener(null);
    await trackerStopWalk();
    await clearPoints();
    set({ phase: 'idle', marker: null, session: null, capReached: false });
  },
}));
