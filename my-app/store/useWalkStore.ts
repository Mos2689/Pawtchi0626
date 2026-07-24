/**
 * useWalkStore — the live walk session's home.
 *
 * Orchestrates the layers without owning their logic: locationEngine feeds
 * raw points, the pure session machine derives stats, the validator gates,
 * walkSync persists and completes. The store's own jobs are UI state, the
 * auto-stop tick, and crash recovery.
 *
 * Crash recovery model: only a small "active walk" marker is persisted (this
 * store), while the full point stream lives in the location engine's
 * AsyncStorage buffer. A cold start with an orphaned marker replays the
 * buffer through the pure machine — if the OS kept the foreground service
 * alive and points are fresh, the walk resumes; otherwise it's finalized as
 * 'recovered' and synced like any other walk.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  DogWalkProfile,
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
  clearPointBuffer,
  ensureWalkTrackingStopped,
  isTracking,
  readPointBuffer,
  requestWalkPermission,
  setPointListener,
  startWalkLocationUpdates,
  WalkPermission,
} from '../lib/walk/locationEngine';
import { walkTrace } from '../lib/walk/walkTrace';
import type { Pet } from './useActivePetStore';

export type WalkPhase = 'idle' | 'starting' | 'tracking' | 'saving' | 'summary';

interface ActiveWalkMarker {
  walkSessionId: string;
  petId: string;
  petName: string;
  ownerId: string;
  startedAt: number;
  profile: DogWalkProfile;
}

export interface WalkResult {
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
  /**
   * THE single source of truth for "should the OS be tracking right now."
   * In-memory only and deliberately NOT persisted — a cold launch always starts
   * false so nothing can inherit a stale intent and re-arm tracking. True from
   * the moment a walk is committed to starting; flipped false SYNCHRONOUSLY the
   * instant a finish/hard-stop begins, before any await or network. The
   * reconciler enforces `trackingDesired === false ⇒ OS off` on every lifecycle
   * event; a launch drives it false and NEVER resumes a walk. Never infer
   * tracking intent from `phase` again.
   */
  trackingDesired: boolean;
  /** Persisted crash-recovery marker; non-null while a walk is live. */
  marker: ActiveWalkMarker | null;
  /** In-memory live session (rebuilt from the buffer after restarts). */
  session: WalkSessionState | null;
  /** Clinical session-cap notice (activityRestrictions) — shown once. */
  capReached: boolean;
  lastResult: WalkResult | null;

  startWalk: (pet: Pet, ownerId: string) => Promise<'started' | WalkPermission>;
  /** Internal — point batches arriving from the location engine. */
  _ingest: (points: RawGpsPoint[]) => void;
  endWalk: (reason: EndReason) => Promise<void>;
  /** Slow poll from the live screen — auto-stop + cap notice. */
  tick: () => void;
  /** Call once on app launch: resume/finalize orphans, flush the queue. */
  recoverOrphanedWalk: () => Promise<void>;
  dismissSummary: () => void;
  /**
   * Hard-kill every tracking resource with NO finalize — the recovery path.
   * Unlike endWalk (which replays the buffer, validates, and syncs a real
   * walk), this exists for states where there is nothing to save: a leaked OS
   * service with no live walk, or a mid-walk sign-out. It detaches the
   * listener, stops the OS service, clears the buffer, and resets to idle.
   */
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

/**
 * THE walk kill-switch — one synchronous, idempotent teardown of every live
 * walk resource. This is what "Finish kills everything" means: the instant it
 * runs, nothing walk-related is alive, and nothing after it can revive tracking.
 *
 *   • point listener detached  → no further _ingest batch can fire
 *   • trackingDesired = false  → the reconciler enforces OS-off; no path
 *                                believes a walk is active
 *   • marker/session/cap clear → in ONE synchronous set, so recovery has
 *                                nothing to re-arm even if the app is suspended
 *                                the very next line
 *   • OS location stop FIRED   → decisive; the caller's awaited verify and the
 *                                reconciler confirm it actually released
 *
 * The 1s screen clock and the tick() auto-stop poll are keyed on `phase` and
 * tear themselves down (useEffect cleanup) the moment it leaves 'tracking'. The
 * global reconciler is intentionally NOT killed — it is the watchdog that keeps
 * enforcing "stopped", not a walk-session loop.
 *
 * Everything about this is synchronous on purpose: the caller may still salvage
 * the walk's data afterward (from the pre-teardown marker + the point buffer),
 * but that salvage is pure downstream work that cannot start tracking again.
 */
function killWalkModule(
  set: (partial: Partial<WalkState>) => void,
  get: () => WalkState,
  nextPhase: WalkPhase,
): void {
  setPointListener(null);
  set({ phase: nextPhase, trackingDesired: false, marker: null, session: null, capReached: false });
  void ensureWalkTrackingStopped();
}

export const useWalkStore = create<WalkState>()(
  persist(
    (set, get) => ({
      phase: 'idle',
      trackingDesired: false,
      marker: null,
      session: null,
      capReached: false,
      lastResult: null,

      startWalk: async (pet: Pet, ownerId: string) => {
        if (get().phase === 'tracking' || get().phase === 'starting') return 'started';
        set({ phase: 'starting', lastResult: null, capReached: false });
        walkTrace('start_begin', { phase: 'starting' });

        const permission = await requestWalkPermission();
        if (permission !== 'granted') {
          track('walk_tracking_denied', { reason: permission });
          set({ phase: 'idle', trackingDesired: false });
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
          walkSessionId: generateWalkSessionId(),
          petId: pet.id,
          petName: pet.name,
          ownerId,
          startedAt: Date.now(),
          profile,
        };

        await clearPointBuffer();
        // Commit the intent BEFORE starting the native task, so there is never a
        // window where the OS is tracking while the source of truth says "off"
        // (which the periodic reconcile would otherwise force-stop mid-start).
        set({ marker, session: createSession(marker.startedAt), trackingDesired: true });

        setPointListener(points => get()._ingest(points));
        try {
          await startWalkLocationUpdates(pet.name);
        } catch (e: any) {
          setPointListener(null);
          set({ phase: 'idle', marker: null, session: null, trackingDesired: false });
          walkTrace('start_failed', { detail: 'native_start_threw' });
          return 'denied';
        }

        // Race guard: if the user finished/left while the native start was in
        // flight, endWalk already flipped trackingDesired=false — honor it and
        // kill the just-started service instead of resurrecting an ended walk.
        if (get().phase !== 'starting') {
          setPointListener(null);
          await ensureWalkTrackingStopped();
          walkTrace('start_raced_finish', { trackingDesired: get().trackingDesired });
          return 'started';
        }

        set({ phase: 'tracking' });
        walkTrace('start_tracking', {
          walkSessionId: marker.walkSessionId,
          phase: 'tracking',
          trackingDesired: true,
          hasStarted: await isTracking(),
        });
        track('walk_tracking_started', {
          pet_id: pet.id,
          size_category: profile.sizeCategory,
          life_stage: profile.lifeStage,
        });
        return 'started';
      },

      // Internal — receives batches from the location engine.
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

        // Snapshot the marker/session BEFORE the kill switch clears them — the
        // salvage below finalizes the walk's data from this snapshot.
        const activeMarker = marker;
        const activeSession = session;

        walkTrace('end_begin', {
          walkSessionId: activeMarker.walkSessionId,
          prevPhase: phase,
          phase: 'saving',
          reason,
        });

        // ── KILL SWITCH FIRST ──
        // The instant Finish runs, tear down EVERYTHING walk-related in one
        // synchronous step: listener off, intent off, store cleared (marker
        // included), OS stop fired. Nothing after this line can revive tracking,
        // and recovery has no marker to re-arm even if the app dies next.
        killWalkModule(set, get, 'saving');

        // Verify the OS stop actually released (bounded retries) so a foreground
        // summary never appears with the indicator lit. Correctness no longer
        // depends on this await — the kill already happened; a backgrounded
        // finish leans on the reconciler + launch teardown instead.
        await ensureWalkTrackingStopped();
        walkTrace('end_after_stop', {
          walkSessionId: activeMarker.walkSessionId,
          trackingDesired: false,
          hasStarted: await isTracking(),
        });

        // Authoritative rebuild from the buffer: it holds every point since
        // start, including ones delivered while the JS runtime was dead.
        const buffered = await readPointBuffer();
        const finalState =
          buffered.length > 0 ? replayBuffer(activeMarker, buffered) : (activeSession ?? createSession(activeMarker.startedAt));

        // A walk that ended by stillness really ended when movement stopped —
        // the 10-minute confirmation wait is not part of the walk.
        const endedAt =
          (reason === 'auto_stationary' || reason === 'auto_home') && finalState.stationarySince
            ? finalState.stationarySince
            : Date.now();

        const summary = finalizeSession(finalState, endedAt, reason);
        const verdict = validateWalk(summary, activeMarker.profile);
        const route = simplifyRoute(summary.path);

        // The marker/session were already cleared by the kill switch; now that
        // the buffer has been replayed into finalState, clear it too so a later
        // launch has nothing to salvage twice.
        await clearPointBuffer();

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

        // Reverse-geocode start/end/farthest before persistence so the labels
        // ride with the same upsert as the row itself. Best-effort — offline
        // finalize just persists nulls; the pills stay hidden until a later
        // background job (if any) fills them.
        const labels = await collectWalkLabels({
          startPoint: summary.startPoint,
          endPoint: summary.endPoint,
          farthestPoint: summary.farthestPoint,
          endReason: summary.endReason,
          maxExcursionM: summary.maxExcursionM,
        });

        const sync = await finalizeAndSyncWalk({
          walkSessionId: activeMarker.walkSessionId,
          summary,
          route,
          verdict,
          profile: activeMarker.profile,
          petId: activeMarker.petId,
          ownerId: activeMarker.ownerId,
          labels,
        });

        // Belt-and-braces re-stop: if a native start call resolved late (during
        // this endWalk), the first stop ran before the task registered — this
        // catches it. trackingDesired is already false, so this only ever stops.
        await ensureWalkTrackingStopped();
        walkTrace('end_done', {
          walkSessionId: activeMarker.walkSessionId,
          phase: 'summary',
          trackingDesired: false,
          hasStarted: await isTracking(),
        });
        set({
          phase: 'summary',
          lastResult: {
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

        // ── A LAUNCH NEVER RE-ARMS TRACKING ──
        // This is the fix for the "reopen → tracking auto-starts → never stops
        // until uninstall" bug. iOS can relaunch the app (cold start, or a
        // background location wake) and resume the OS location task on its own;
        // a backgrounded finish can also be suspended before its cleanup writes
        // flush, leaving a persisted marker behind. The OLD code responded by
        // RESUMING the walk — which re-armed tracking on every reopen, forever,
        // because the resumed task kept writing fresh points that re-qualified
        // the resume next launch. Uninstall was the only escape (it wiped the
        // marker from AsyncStorage).
        //
        // Now a launch drives UNCONDITIONALLY to the inactive state: force the
        // intent off, stop whatever the OS is running, and NEVER start. Only a
        // manual startWalk may begin tracking again. An orphaned marker is
        // salvaged (finalized from the buffer) but never resumed.
        set({ trackingDesired: false });
        const wasTracking = await isTracking();
        walkTrace('recover_launch', { trackingDesired: false, hasStarted: wasTracking });
        if (wasTracking) {
          await ensureWalkTrackingStopped();
        }

        const { marker } = get();
        if (!marker) return; // nothing to salvage — already inactive

        // A marker survived a finish that couldn't finalize/clear, or a genuine
        // mid-walk crash. Finalize the effort from the buffer WITHOUT restarting
        // tracking, then clear the marker so this cannot recur next launch. The
        // transient phase:'tracking' only satisfies endWalk's guard; tracking is
        // already stopped and trackingDesired stays false throughout.
        const buffered = await readPointBuffer();
        walkTrace('recover_finalize', {
          walkSessionId: marker.walkSessionId,
          hasStarted: wasTracking,
        });
        track('walk_recovered', { buffered_points: buffered.length });
        set({ session: replayBuffer(marker, buffered), phase: 'tracking', trackingDesired: false });
        await get().endWalk('recovered');
        // Recovery is silent: coins/rings arrive via the normal side effects,
        // and the summary stays available if the user opens the walk screen.
      },

      dismissSummary: () => set({ phase: 'idle', lastResult: null }),

      hardStopTracking: async () => {
        // The same kill switch, no finalize: everything walk-related dies
        // synchronously, then we clear the buffer and verify the OS released.
        walkTrace('hardstop_begin', { trackingDesired: false });
        killWalkModule(set, get, 'idle');
        await ensureWalkTrackingStopped();
        await clearPointBuffer();
        walkTrace('hardstop_done', { trackingDesired: false, hasStarted: await isTracking() });
      },
    }),
    {
      name: 'walk-active-marker',
      storage: createJSONStorage(() => AsyncStorage),
      // ONLY the crash-recovery marker persists. `trackingDesired` is
      // deliberately NOT persisted: a cold launch must always start with intent
      // = false so nothing can inherit a stale "a walk is desired" and re-arm
      // tracking. Live session state is always rebuilt from the point buffer.
      partialize: state => ({ marker: state.marker }),
    },
  ),
);
