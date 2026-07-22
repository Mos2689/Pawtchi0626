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
import { useActivePetStore } from '../../store/useActivePetStore';
import { aggregateWalks, evaluateWalksign } from './walksignEngine';
import type {
  WalksignEventKind,
  WalksignHistoryEntry,
  WalksignId,
  WalksignStatus,
  WalksignTransitionKind,
  WalksignWalkRow,
} from './types';

const CELEBRATION_KEY = 'walksign:pending_celebration';

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

export async function readPendingWalksignCelebration(): Promise<PendingWalksignCelebration | null> {
  try {
    const raw = await AsyncStorage.getItem(CELEBRATION_KEY);
    return raw ? (JSON.parse(raw) as PendingWalksignCelebration) : null;
  } catch {
    return null;
  }
}

export async function clearPendingWalksignCelebration(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CELEBRATION_KEY);
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
 */
export async function maybeEvaluateWalksign(
  petId: string,
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
        'id, species, breed, age_years, current_weight_kg, activity_level, first_dog, created_at, walksign, walksign_status, walksign_history',
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
        'started_at, duration_s, moving_time_s, distance_m, avg_speed_kmh, end_reason, start_label, end_label, farthest_label, pause_points',
      )
      .eq('pet_id', petId)
      .eq('validation_verdict', 'valid')
      .order('started_at', { ascending: false })
      .limit(100);
    if (walkErr) return null;

    const rows: WalksignWalkRow[] = (sessions ?? []).map(s => ({
      startedAt: s.started_at,
      durationS: s.duration_s ?? 0,
      movingTimeS: s.moving_time_s ?? 0,
      distanceM: s.distance_m ?? 0,
      avgSpeedKmh: s.avg_speed_kmh ?? 0,
      endReason: s.end_reason ?? 'manual',
      startLabel: s.start_label ?? null,
      endLabel: s.end_label ?? null,
      farthestLabel: s.farthest_label ?? null,
      pauseCount: Array.isArray(s.pause_points) ? s.pause_points.length : 0,
    }));

    const current =
      pet.walksign && pet.walksign_status
        ? {
            sign: pet.walksign as WalksignId,
            status: pet.walksign_status as WalksignStatus,
          }
        : null;

    const { change } = evaluateWalksign({
      current,
      facts: {
        species: 'dog',
        lifeStage,
        firstDog: pet.first_dog,
        ownershipMonths,
        activityLevel: pet.activity_level ?? null,
      },
      aggregates: rows.length > 0 ? aggregateWalks(rows) : null,
      validWalkCount: rows.length,
    });
    if (!change) return null;

    const atIso = new Date(now).toISOString();
    const entry: WalksignHistoryEntry = {
      sign: change.assignment.sign,
      status: change.assignment.status,
      reason: change.assignment.reason,
      at: atIso,
    };
    const history = [...((pet.walksign_history as WalksignHistoryEntry[] | null) ?? []), entry];

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
        await AsyncStorage.setItem(CELEBRATION_KEY, JSON.stringify(celebration));
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
