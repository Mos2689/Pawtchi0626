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
import type { Pet } from './useActivePetStore';

/** Buffer points younger than this on relaunch → the walk is still going. */
const RESUME_WINDOW_MS = 3 * 60_000;

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

export const useWalkStore = create<WalkState>()(
  persist(
    (set, get) => ({
      phase: 'idle',
      marker: null,
      session: null,
      capReached: false,
      lastResult: null,

      startWalk: async (pet: Pet, ownerId: string) => {
        if (get().phase === 'tracking' || get().phase === 'starting') return 'started';
        set({ phase: 'starting', lastResult: null, capReached: false });

        const permission = await requestWalkPermission();
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
          walkSessionId: generateWalkSessionId(),
          petId: pet.id,
          petName: pet.name,
          ownerId,
          startedAt: Date.now(),
          profile,
        };

        await clearPointBuffer();
        set({ marker, session: createSession(marker.startedAt) });

        setPointListener(points => get()._ingest(points));
        try {
          await startWalkLocationUpdates(pet.name);
        } catch (e: any) {
          setPointListener(null);
          set({ phase: 'idle', marker: null, session: null });
          return 'denied';
        }

        // Race guard: if the user finished/left while the native start was in
        // flight, the walk is already over — kill the just-started service
        // instead of resurrecting a phase the user ended.
        if (get().phase !== 'starting') {
          setPointListener(null);
          await ensureWalkTrackingStopped();
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
        set({ phase: 'saving' });

        // Kill the OS-level tracking FIRST, before any of the heavier async
        // work below (buffer read, reverse-geocode, Supabase sync). Any delay
        // between Finish and this call is time the iOS status-bar indicator
        // stays lit and the Android foreground-service notification persists.
        setPointListener(null);
        await ensureWalkTrackingStopped();

        // Authoritative rebuild from the buffer: it holds every point since
        // start, including ones delivered while the JS runtime was dead.
        const buffered = await readPointBuffer();
        const finalState =
          buffered.length > 0 ? replayBuffer(marker, buffered) : (session ?? createSession(marker.startedAt));

        // A walk that ended by stillness really ended when movement stopped —
        // the 10-minute confirmation wait is not part of the walk.
        const endedAt =
          (reason === 'auto_stationary' || reason === 'auto_home') && finalState.stationarySince
            ? finalState.stationarySince
            : Date.now();

        const summary = finalizeSession(finalState, endedAt, reason);
        const verdict = validateWalk(summary, marker.profile);
        const route = simplifyRoute(summary.path);

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
          walkSessionId: marker.walkSessionId,
          summary,
          route,
          verdict,
          profile: marker.profile,
          petId: marker.petId,
          ownerId: marker.ownerId,
          labels,
        });

        await clearPointBuffer();
        // Belt-and-braces re-stop: if the native start call resolved while
        // this endWalk was running (start/finish race), the first stop ran
        // before the task was registered — this one catches that case.
        // Awaited so the summary screen never appears with the OS indicator
        // still lit.
        await ensureWalkTrackingStopped();
        set({
          phase: 'summary',
          marker: null,
          session: null,
          capReached: false,
          lastResult: {
            summary,
            verdict,
            sync,
            route,
            petName: marker.petName,
            recovered: reason === 'recovered',
            labels,
          },
        });
      },

      recoverOrphanedWalk: async () => {
        // Always give queued offline walks another shot on launch.
        flushWalkQueue().catch(() => {});

        const { marker, phase } = get();
        if (!marker) {
          // No walk in flight — but a service from a previous session may have
          // leaked (start/finish race, crash after finalize). Kill it.
          if (await isTracking()) {
            await ensureWalkTrackingStopped();
          }
          return;
        }
        if (phase === 'tracking' || phase === 'saving') return;

        const buffered = await readPointBuffer();
        const lastPoint = buffered[buffered.length - 1];
        const stillTracking = await isTracking();

        // Foreground service survived the JS restart and points are fresh →
        // the walk never ended. Rebuild and keep going.
        if (
          stillTracking &&
          lastPoint &&
          Date.now() - lastPoint.timestamp < RESUME_WINDOW_MS
        ) {
          set({ session: replayBuffer(marker, buffered), phase: 'tracking' });
          setPointListener(points => get()._ingest(points));
          return;
        }

        // Otherwise the walk is over — finalize what the buffer holds.
        track('walk_recovered', { buffered_points: buffered.length });
        set({ session: replayBuffer(marker, buffered), phase: 'tracking' });
        await get().endWalk('recovered');
        // Recovery is silent: coins/rings arrive via the normal side effects,
        // and the summary stays available if the user opens the walk screen.
      },

      dismissSummary: () => set({ phase: 'idle', lastResult: null }),

      hardStopTracking: async () => {
        // Detach FIRST so no late point batch resurrects a session mid-teardown.
        setPointListener(null);
        await ensureWalkTrackingStopped();
        await clearPointBuffer();
        set({ phase: 'idle', marker: null, session: null, capReached: false });
      },
    }),
    {
      name: 'walk-active-marker',
      storage: createJSONStorage(() => AsyncStorage),
      // Only the crash-recovery marker persists — live session state is
      // always rebuilt from the location engine's point buffer.
      partialize: state => ({ marker: state.marker }),
    },
  ),
);
