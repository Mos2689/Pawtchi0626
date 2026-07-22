/**
 * dogCalibration — tunes the walk engine to the dog, not to a jogger.
 *
 * A Chihuahua ambling at 2 km/h with four sniff stops is a complete walk; a
 * Border Collie doing the same distance is a warm-up. Everything the session
 * machine and validator treat as a threshold comes from here, derived from
 * the same single sources the rest of the app uses: breedData (size/energy),
 * lifeStage (WSAVA staging), and activityRestrictions (clinical ceilings).
 */

import { getBreedDefaults, sizeCategoryFromWeight, SizeCategory } from '../breedData';
import { deriveLifeStage, LifeStage } from '../lifeStage';
import {
  deriveActivityRestrictions,
  maxAllowedIntensity,
} from '../activityRestrictions';
import { DEFAULT_SESSION_CONFIG, SessionConfig } from './walkSession';

export interface DogWalkProfileInput {
  species: 'dog' | 'cat' | null;
  breed?: string | null;
  ageYears?: number | null;
  ageMonths?: number | null;
  weightKg?: number | null;
  medicalConditions?: string[] | null;
}

export interface DogWalkProfile {
  sizeCategory: SizeCategory;
  lifeStage: LifeStage;
  /** Plausible sustained walking pace for this dog (km/h). */
  paceBandKmh: { min: number; max: number };
  /** A session shorter than this can't auto-complete a scheduled walk. */
  minValidDurationS: number;
  /** …nor one that covered less ground than this (meters). */
  minValidDistanceM: number;
  /** Scales the stationary windows — puppies and seniors pause more. */
  stationaryToleranceMultiplier: number;
  /** Clinical ceiling from activityRestrictions; null = unrestricted. */
  sessionCapMinutes: number | null;
  restrictionLabels: string[];
}

/** Base sustained pace bands by size (km/h, leash walk with sniffing). */
const PACE_BANDS: Record<SizeCategory, { min: number; max: number }> = {
  toy: { min: 1.0, max: 4.5 },
  small: { min: 1.2, max: 5.0 },
  medium: { min: 1.5, max: 6.0 },
  large: { min: 1.5, max: 7.0 },
  giant: { min: 1.2, max: 5.5 },
};

/** Minimum distance for a walk to count as a walk, by size (meters). */
const MIN_DISTANCE_M: Record<SizeCategory, number> = {
  toy: 100,
  small: 150,
  medium: 200,
  large: 250,
  giant: 250,
};

const MIN_DURATION_S = 5 * 60;

export function deriveDogWalkProfile(input: DogWalkProfileInput): DogWalkProfile {
  const species = input.species ?? 'dog';
  const breedDefaults = getBreedDefaults(species, input.breed, input.weightKg);
  const sizeCategory: SizeCategory =
    breedDefaults?.sizeCategory ??
    sizeCategoryFromWeight(species, input.weightKg ?? 10);

  const lifeStage = deriveLifeStage(
    species,
    input.ageYears ?? 4,
    input.ageMonths ?? 0,
    sizeCategory,
  );

  const base = PACE_BANDS[sizeCategory];
  let paceMax = base.max;
  let distanceScale = 1;
  let stationaryTolerance = 1;

  if (lifeStage === 'senior' || lifeStage === 'geriatric') {
    paceMax *= 0.75;
    distanceScale = 0.6;
    stationaryTolerance = 1.25;
  } else if (lifeStage === 'puppy' || lifeStage === 'junior') {
    paceMax *= 0.85;
    distanceScale = 0.7;
    stationaryTolerance = 1.3; // everything is smellable when you're new here
  }

  const restrictions = deriveActivityRestrictions(input.medicalConditions);
  const ceiling = maxAllowedIntensity(restrictions);
  const sessionCapMinutes =
    ceiling === 'low' ? 30 : ceiling === 'moderate' ? 60 : null;
  if (ceiling === 'low') stationaryTolerance = Math.max(stationaryTolerance, 1.25);

  return {
    sizeCategory,
    lifeStage,
    paceBandKmh: { min: base.min, max: Math.round(paceMax * 100) / 100 },
    minValidDurationS: MIN_DURATION_S,
    minValidDistanceM: Math.round(MIN_DISTANCE_M[sizeCategory] * distanceScale),
    stationaryToleranceMultiplier: stationaryTolerance,
    sessionCapMinutes,
    restrictionLabels: restrictions.map(r => r.label),
  };
}

/** The session machine's thresholds, scaled to this dog. */
export function sessionConfigFor(profile: DogWalkProfile): SessionConfig {
  const t = profile.stationaryToleranceMultiplier;
  return {
    ...DEFAULT_SESSION_CONFIG,
    autoPauseAfterMs: Math.round(DEFAULT_SESSION_CONFIG.autoPauseAfterMs * t),
    autoStopStationaryMs: Math.round(
      DEFAULT_SESSION_CONFIG.autoStopStationaryMs * t,
    ),
  };
}

/**
 * The intensity label the completed activity row gets, judged against THIS
 * dog's pace band — 4 km/h is brisk for a Pug, gentle for a Vizsla.
 */
export function intensityForPace(
  avgMovingSpeedKmh: number,
  profile: DogWalkProfile,
): 'low' | 'moderate' | 'high' {
  const { min, max } = profile.paceBandKmh;
  const span = Math.max(0.1, max - min);
  const position = (avgMovingSpeedKmh - min) / span;
  if (position < 0.4) return 'low';
  if (position < 0.8) return 'moderate';
  return 'high';
}
