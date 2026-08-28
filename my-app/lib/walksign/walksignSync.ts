/**
 * walksignSync — runs the Walksign state machine against live data.
 *
 * The engine (walksignEngine.ts) is pure; this module feeds it: fetch the
 * pet, fold its valid walk_sessions, evaluate, persist any change, and stash
 * a pending-celebration marker for the UI to consume on next Home focus.
 *
 * Fire-and-forget by design — called from walk completion side effects and
 * on profile focus. Every failure is non-fatal (the sign just stays put) and
 * every write is idempotent (no state change → no write, no event).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase';
import { track } from '../analytics';
import { deriveLifeStage } from '../lifeStage';
import { getBreedDefaults, sizeCategoryFromWeight } from '../breedData';
import { resolveSniffStops } from '../momentCard';
import type { GeoPoint } from '../walk/geo';
import { useActivePetStore } from '../../store/useActivePetStore';
import {
  aggregateWalks,
  BROAD_EVIDENCE_WALK_COUNT,
  evaluateWalksign,
  EVOLUTION_WALK_COUNT,
} from './walksignEngine';
import type {
  WalksignEventKind,
  WalksignHistoryEntry,
  WalksignId,
  WalksignStatus,
  WalksignTransitionKind,
  WalksignWalkRow,
} from './types';

/**
 * The pending-celebration marker is per ACCOUNT. It was a single device-global
 * key, so a reading earned by one owner's dog was still sitting there for the
 * next account created on the same phone; Home only avoided showing it because
 * it also compares petId. Namespaced on the Supabase user id, like
 * `hooks/useFirstWalkIntro.ts` — signing back in restores your own pending
 * moment, and nobody inherits someone else's.
 */
const CELEBRATION_PREFIX = 'walksign:pending_celebration';

/** Per-account storage key. */
export function walksignCelebrationKey(userId: string): string {
  return `${CELEBRATION_PREFIX}:${userId}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function parseGeoPoints(value: unknown): GeoPoint[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const point = raw as Partial<GeoPoint> | null;
    const lat = Number(point?.lat);
    const lng = Number(point?.lng);
    return Number.isFinite(lat) && Number.isFinite(lng)
      ? [{ lat, lng }]
      : [];
  });
}

/** What the celebration modal needs to stage the moment. */
export interface PendingWalksignCelebration {
  petId: string;
  event: Extract<WalksignEventKind, 'confirmed' | 'transition'>;
  transitionKind?: WalksignTransitionKind;
  sign: WalksignId;
  previousSign: WalksignId | null;
  validWalkCount: number;
  at: string;
}

export async function readPendingWalksignCelebration(
  userId: string | null | undefined,
): Promise<PendingWalksignCelebration | null> {
  if (!userId) return null;
  try {
    const raw = await AsyncStorage.getItem(walksignCelebrationKey(userId));
    return raw ? (JSON.parse(raw) as PendingWalksignCelebration) : null;
  } catch {
    return null;
  }
}

export async function clearPendingWalksignCelebration(
  userId: string | null | undefined,
): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.removeItem(walksignCelebrationKey(userId));
  } catch {
    // Worst case the moment shows again — better than losing it.
  }
}

// Focus-triggered evaluations are cheap but not free; don't re-run within
// the same session more than once per pet per interval. Walk completions
// bypass this (force) — that's the moment confirmation can actually happen.
const EVALUATION_INTERVAL_MS = 6 * 60 * 60 * 1000;
const lastEvaluatedAt = new Map<string, number>();

/**
 * Evaluate and persist the pet's Walksign. Returns the pending celebration
 * it staged, if any (callers may present it immediately instead of waiting
 * for the next Home focus).
 *
 * `ownerId` only scopes the stored celebration marker; the sign itself lives on
 * the pet row. Without an owner the reading is still saved — the moment just
 * isn't stashed for a later Home focus, because there is no account to stash it
 * against.
 */
export async function maybeEvaluateWalksign(
  petId: string,
  ownerId: string | null | undefined,
  options?: { force?: boolean },
): Promise<PendingWalksignCelebration | null> {
  const now = Date.now();
  if (!options?.force) {
    const last = lastEvaluatedAt.get(petId) ?? 0;
    if (now - last < EVALUATION_INTERVAL_MS) return null;
  }
  lastEvaluatedAt.set(petId, now);

  try {
    const { data: pet, error: petErr } = await supabase
      .from('pets')
      .select(
        'id, species, breed, age_years, current_weight_kg, activity_level, first_dog, household_walkers, created_at, walksign, walksign_status, walksign_assigned_at, walksign_history',
      )
      .eq('id', petId)
      .single();
    if (petErr || !pet || pet.species !== 'dog') return null;

    const ageYears = Math.floor(pet.age_years ?? 0);
    const ageMonths = Math.round(((pet.age_years ?? 0) % 1) * 12);
    const weightKg = pet.current_weight_kg ?? 0;
    const breedDefaults = getBreedDefaults('dog', pet.breed ?? '', weightKg);
    const sizeCategory = breedDefaults?.sizeCategory ?? sizeCategoryFromWeight('dog', weightKg);
    const lifeStage = deriveLifeStage('dog', ageYears, ageMonths, sizeCategory);
    const ownershipMonths = pet.created_at
      ? Math.max(0, (now - new Date(pet.created_at).getTime()) / (30.44 * 24 * 3600 * 1000))
      : null;

    const { data: sessions, error: walkErr } = await supabase
      .from('walk_sessions')
      .select(
        'started_at, duration_s, moving_time_s, distance_m, avg_speed_kmh, end_reason, start_label, end_label, farthest_label, route, sniff_points, pause_points',
      )
      .eq('pet_id', petId)
      .eq('validation_verdict', 'valid')
      .order('started_at', { ascending: false })
      .limit(100);
    if (walkErr) return null;

    const rows: WalksignWalkRow[] = (sessions ?? []).map((session) => {
      const pausePoints = parseGeoPoints(session.pause_points);
      return {
        startedAt: session.started_at,
        durationS: session.duration_s ?? 0,
        movingTimeS: session.moving_time_s ?? 0,
        distanceM: session.distance_m ?? 0,
        avgSpeedKmh: session.avg_speed_kmh ?? 0,
        endReason: session.end_reason ?? 'manual',
        startLabel: session.start_label ?? null,
        endLabel: session.end_label ?? null,
        farthestLabel: session.farthest_label ?? null,
        sniffCount: resolveSniffStops(
          session.sniff_points,
          pausePoints,
        ).length,
        route: parseGeoPoints(session.route),
      };
    });

    const current =
      pet.walksign && pet.walksign_status
        ? {
            sign: pet.walksign as WalksignId,
            status: pet.walksign_status as WalksignStatus,
          }
        : null;

    const storedHistory =
      (pet.walksign_history as WalksignHistoryEntry[] | null) ?? [];
    const latestHistoryAt =
      [...storedHistory]
        .reverse()
        .find((entry) => Boolean(entry?.at))?.at ?? null;
    const assignmentDate = pet.walksign_assigned_at ?? latestHistoryAt;
    const assignedAtMs = assignmentDate
      ? new Date(assignmentDate).getTime()
      : Number.NaN;
    const hasAssignmentDate = Number.isFinite(assignedAtMs);
    const validWalksSinceAssignment = hasAssignmentDate
      ? rows.filter((row) => {
          const startedAtMs = new Date(row.startedAt).getTime();
          return (
            Number.isFinite(startedAtMs) &&
            startedAtMs > assignedAtMs
          );
        }).length
      : 0;
    const daysSinceAssignment = hasAssignmentDate
      ? Math.max(0, (now - assignedAtMs) / DAY_MS)
      : 0;
    const recentRows = rows.slice(0, EVOLUTION_WALK_COUNT);
    const evidenceRows = rows.slice(0, BROAD_EVIDENCE_WALK_COUNT);

    const { change } = evaluateWalksign({
      current,
      facts: {
        species: 'dog',
        lifeStage,
        firstDog: pet.first_dog,
        ownershipMonths,
        householdWalkers: pet.household_walkers,
        activityLevel: pet.activity_level ?? null,
      },
      aggregates:
        evidenceRows.length > 0 ? aggregateWalks(evidenceRows) : null,
      validWalkCount: rows.length,
      recentAggregates:
        recentRows.length >= EVOLUTION_WALK_COUNT
          ? aggregateWalks(recentRows)
          : null,
      validWalksSinceAssignment,
      daysSinceAssignment,
    });
    if (!change) return null;

    const atIso = new Date(now).toISOString();
    const entry: WalksignHistoryEntry = {
      sign: change.assignment.sign,
      status: change.assignment.status,
      reason: change.assignment.reason,
      at: atIso,
    };
    const history = [...storedHistory, entry];

    const { error: updateErr } = await supabase
      .from('pets')
      .update({
        walksign: change.assignment.sign,
        walksign_status: change.assignment.status,
        walksign_assigned_at: atIso,
        walksign_history: history,
      })
      .eq('id', petId);
    if (updateErr) return null;

    // Keep the in-memory pet in step so profile surfaces update without a
    // refetch. Only touch the store when it's showing this pet.
    const store = useActivePetStore.getState();
    if (store.activePet?.id === petId) {
      useActivePetStore.setState({
        activePet: {
          ...store.activePet,
          walksign: change.assignment.sign,
          walksign_status: change.assignment.status,
          walksign_assigned_at: atIso,
          walksign_history: history,
        },
      });
    }

    track(`walksign_${change.event}`, {
      sign: change.assignment.sign,
      status: change.assignment.status,
      reason: change.assignment.reason,
      ...(change.transitionKind ? { transition_kind: change.transitionKind } : {}),
      ...(change.evidence
        ? {
            evidence_score: change.evidence.score,
            evidence_margin: change.evidence.margin,
            evidence_walk_count: change.evidence.walkCount,
          }
        : {}),
    });

    // Confirmations and transitions are celebrated; quiet provisional
    // re-readings are not.
    if (change.event === 'confirmed' || change.event === 'transition') {
      const celebration: PendingWalksignCelebration = {
        petId,
        event: change.event,
        transitionKind: change.transitionKind,
        sign: change.assignment.sign,
        previousSign: current?.sign ?? null,
        validWalkCount: rows.length,
        at: atIso,
      };
      try {
        if (ownerId) {
          await AsyncStorage.setItem(
            walksignCelebrationKey(ownerId),
            JSON.stringify(celebration),
          );
        }
      } catch {
        // The moment is lost but the sign is saved — acceptable.
      }
      return celebration;
    }
    return null;
  } catch {
    return null;
  }
}
