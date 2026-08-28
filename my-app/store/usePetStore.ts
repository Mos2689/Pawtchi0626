import { create } from 'zustand';

import type { BcsCheckRecord } from '../lib/bcsCheck';
import type { BcsPhotoEstimateRaw, BcsSource } from '../lib/bcsPhotoEstimate';

export type Species = 'dog' | 'cat' | null;
export type WeightUnit = 'kg' | 'lb';
export type ActivityLevel = 'sedentary' | 'normal' | 'active' | 'highly_active';
export type Goal = 'lose' | 'maintain' | 'gain';

export type Gender = 'male' | 'female' | null;

interface PetState {
  // Pet Data
  species: Species;
  name: string;
  breed: string;
  weight: string; // string to handle text input
  weightUnit: WeightUnit;
  ageYears: string;
  ageMonths: string;
  gender: Gender;
  isNeutered: boolean;
  activityLevel: ActivityLevel;
  goal: Goal;
  imageUri: string | null;
  allergies: string[];
  medicalConditions: string[];
  bodyConditionScore: number | null;
  /**
   * Whether this is the owner's first dog — the Newbond Walksign signal.
   * Null = the (skippable) question wasn't answered. Dogs only; the identity
   * step never asks it for cats.
   */
  firstDog: boolean | null;
  /**
   * Number of people who regularly walk this dog. `3` is the Packheart
   * threshold; null means the optional onboarding question was skipped.
   */
  householdWalkers: number | null;
  /**
   * Reproductive status — only meaningful when gender === 'female' && !isNeutered.
   * Pregnant / nursing dogs and cats need 1.5–4× maintenance kcal; we don't try
   * to nail the exact multiplier ourselves, but we do flag the profile so the
   * UI surfaces a "vet-supervised feeding" banner.
   */
  reproductiveStatus: 'pregnant' | 'nursing' | 'neither' | null;
  /**
   * Weeks into pregnancy (1-9). Only meaningful when reproductiveStatus === 'pregnant'.
   * Null means "not tracked"; the kcal math defaults to mid-gestation (week 6).
   * Ramps the pregnancy multiplier over MAINTENANCE MER rather than sitting at
   * a static value that overshoots early and undershoots late.
   */
  pregnancyWeeks: number | null;
  // Photo BCS read — fired in the background after body-basics, consumed by
  // the goal screen's body-shape picker. `raw` is the sanitized edge-function
  // response; gating into an actual suggestion happens at display time
  // (lib/bcsPhotoEstimate.ts) so it always uses the live weight/breed.
  bcsPhotoStatus: 'idle' | 'pending' | 'ready' | 'unavailable';
  bcsPhotoRaw: BcsPhotoEstimateRaw | null;
  /** Photo uri the estimate was computed from — stale-guards photo swaps. */
  bcsPhotoSourceUri: string | null;
  /** How the confirmed BCS was arrived at — persisted for calibration. */
  bcsSource: BcsSource | null;
  /**
   * Hands-on check answers + outcome — persisted to `pets.bcs_check_answers`
   * so the calibration loop can compare palpation vs photo vs vet reports.
   * Null when the owner used the quick-pick fallback instead.
   */
  bcsCheckRecord: BcsCheckRecord | null;
  // The reveal screen reads from these — populated when goal.tsx finishes.
  targetWeightKg: number | null;
  dailyKcal: number | null;
  lifeStageLabel: string | null;
  // Journey context for the reveal's map — the reconciled final ideal and the
  // healthy band from the estimator. Null when the estimate wasn't 'ok'
  // (growth mode) or no band exists.
  idealWeightKg: number | null;
  healthyBandLow: number | null;
  healthyBandHigh: number | null;

  // Actions
  setSpecies: (species: Species) => void;
  setName: (name: string) => void;
  setBreed: (breed: string) => void;
  setWeight: (weight: string) => void;
  setWeightUnit: (unit: WeightUnit) => void;
  setAgeYears: (years: string) => void;
  setAgeMonths: (months: string) => void;
  setGender: (gender: Gender) => void;
  setIsNeutered: (isNeutered: boolean) => void;
  setActivityLevel: (level: ActivityLevel) => void;
  setGoal: (goal: Goal) => void;
  setImageUri: (uri: string | null) => void;
  setAllergies: (allergies: string[]) => void;
  setMedicalConditions: (conditions: string[]) => void;
  setBodyConditionScore: (score: number | null) => void;
  setFirstDog: (firstDog: boolean | null) => void;
  setHouseholdWalkers: (householdWalkers: number | null) => void;
  setBcsPhotoEstimate: (update: {
    status: 'idle' | 'pending' | 'ready' | 'unavailable';
    raw: BcsPhotoEstimateRaw | null;
    sourceUri: string | null;
  }) => void;
  setBcsSource: (source: BcsSource | null) => void;
  setBcsCheckRecord: (record: BcsCheckRecord | null) => void;
  setReproductiveStatus: (status: 'pregnant' | 'nursing' | 'neither' | null) => void;
  setPregnancyWeeks: (weeks: number | null) => void;
  setPlanSummary: (summary: {
    targetWeightKg: number;
    dailyKcal: number;
    lifeStageLabel: string;
    idealWeightKg?: number | null;
    healthyBandLow?: number | null;
    healthyBandHigh?: number | null;
  }) => void;

  /**
   * Fill the draft from an existing pet row.
   *
   * The health completion flow reuses the onboarding screens, and those screens
   * read and write this draft. Entering them from the Health tab with an empty
   * draft would show a dog owner blank fields for facts they already gave us —
   * and worse, writing that draft back would erase them. Hydrating first makes
   * the flow an edit rather than a re-entry.
   *
   * Deliberately skips the sentinel weight that createLightweightPet writes:
   * `0` means "never measured", and showing it as a prefilled answer would
   * invite someone to just tap past it.
   */
  hydrateFromPet: (pet: HydratablePet) => void;

  // Reset
  resetForm: () => void;
}

/** The subset of a `pets` row the draft can be rebuilt from. */
export interface HydratablePet {
  species?: string | null;
  name?: string | null;
  breed?: string | null;
  gender?: string | null;
  is_neutered?: boolean | null;
  age_years?: number | null;
  current_weight_kg?: number | null;
  activity_level?: string | null;
  allergies?: string[] | null;
  medical_conditions?: string[] | null;
  body_condition_score?: number | null;
  image_url?: string | null;
  reproductive_status?: string | null;
  pregnancy_weeks?: number | null;
}

const initialState = {
  /**
   * Dog by default, because onboarding no longer asks.
   *
   * Pawtchi is a walk-first, dog-only product now, so the species picker was
   * removed and identity is the first screen. This default is what makes that
   * safe: every downstream `species === 'dog'` branch — the walk-ready exit,
   * the first-dog and household-walkers questions, the name placeholder, the
   * step counter — already reads from here, so none of them needed touching.
   *
   * It is a DRAFT default, not a schema change. `species` stays on the row and
   * in the type, `hydrateFromPet` still resolves a stored cat to 'cat', and
   * every existing cat profile keeps working exactly as it did.
   */
  species: 'dog' as Species,
  name: '',
  breed: '',
  weight: '',
  weightUnit: 'kg' as WeightUnit,
  ageYears: '',
  ageMonths: '',
  gender: null as Gender,
  isNeutered: true,
  activityLevel: 'normal' as ActivityLevel,
  goal: 'maintain' as Goal,
  imageUri: null,
  allergies: [] as string[],
  medicalConditions: [] as string[],
  bodyConditionScore: null as number | null,
  firstDog: null as boolean | null,
  householdWalkers: null as number | null,
  bcsPhotoStatus: 'idle' as 'idle' | 'pending' | 'ready' | 'unavailable',
  bcsPhotoRaw: null as BcsPhotoEstimateRaw | null,
  bcsPhotoSourceUri: null as string | null,
  bcsSource: null as BcsSource | null,
  bcsCheckRecord: null as BcsCheckRecord | null,
  reproductiveStatus: null as 'pregnant' | 'nursing' | 'neither' | null,
  pregnancyWeeks: null as number | null,
  targetWeightKg: null as number | null,
  dailyKcal: null as number | null,
  lifeStageLabel: null as string | null,
  idealWeightKg: null as number | null,
  healthyBandLow: null as number | null,
  healthyBandHigh: null as number | null,
};

export const usePetStore = create<PetState>((set) => ({
  ...initialState,
  setSpecies: (species) => set({ species }),
  setName: (name) => set({ name }),
  setBreed: (breed) => set({ breed }),
  setWeight: (weight) => set({ weight }),
  setWeightUnit: (weightUnit) => set({ weightUnit }),
  setAgeYears: (ageYears) => set({ ageYears }),
  setAgeMonths: (ageMonths) => set({ ageMonths }),
  setGender: (gender) => set({ gender }),
  setIsNeutered: (isNeutered) => set({ isNeutered }),
  setActivityLevel: (activityLevel) => set({ activityLevel }),
  setGoal: (goal) => set({ goal }),
  setImageUri: (imageUri) => set({ imageUri }),
  setAllergies: (allergies) => set({ allergies }),
  setMedicalConditions: (medicalConditions) => set({ medicalConditions }),
  setBodyConditionScore: (bodyConditionScore) => set({ bodyConditionScore }),
  setFirstDog: (firstDog) => set({ firstDog }),
  setHouseholdWalkers: (householdWalkers) => set({ householdWalkers }),
  setBcsPhotoEstimate: ({ status, raw, sourceUri }) => set({
    bcsPhotoStatus: status,
    bcsPhotoRaw: raw,
    bcsPhotoSourceUri: sourceUri,
  }),
  setBcsSource: (bcsSource) => set({ bcsSource }),
  setBcsCheckRecord: (bcsCheckRecord) => set({ bcsCheckRecord }),
  setReproductiveStatus: (reproductiveStatus) => set({ reproductiveStatus }),
  setPregnancyWeeks: (pregnancyWeeks) => set({ pregnancyWeeks }),
  setPlanSummary: (summary) => set({
    targetWeightKg: summary.targetWeightKg,
    dailyKcal: summary.dailyKcal,
    lifeStageLabel: summary.lifeStageLabel,
    idealWeightKg: summary.idealWeightKg ?? null,
    healthyBandLow: summary.healthyBandLow ?? null,
    healthyBandHigh: summary.healthyBandHigh ?? null,
  }),
  hydrateFromPet: (pet) => {
    const ageYears = typeof pet.age_years === 'number' && pet.age_years > 0 ? pet.age_years : null;
    const wholeYears = ageYears != null ? Math.floor(ageYears) : null;
    const months = ageYears != null ? Math.round((ageYears - wholeYears!) * 12) : null;
    const weight = pet.current_weight_kg;

    set({
      species: pet.species === 'cat' ? 'cat' : pet.species === 'dog' ? 'dog' : null,
      name: pet.name ?? '',
      breed: pet.breed ?? '',
      gender: pet.gender === 'male' || pet.gender === 'female' ? pet.gender : null,
      isNeutered: pet.is_neutered ?? false,
      ageYears: wholeYears != null ? String(wholeYears) : '',
      ageMonths: months ? String(months) : '',
      // 0 is the "never measured" sentinel — leave the field empty so it reads
      // as a question rather than an answer.
      weight: typeof weight === 'number' && weight > 0 ? String(weight) : '',
      activityLevel:
        pet.activity_level === 'sedentary' ||
        pet.activity_level === 'active' ||
        pet.activity_level === 'highly_active'
          ? pet.activity_level
          : 'normal',
      allergies: pet.allergies ?? [],
      medicalConditions: pet.medical_conditions ?? [],
      bodyConditionScore:
        typeof pet.body_condition_score === 'number' && pet.body_condition_score > 0
          ? pet.body_condition_score
          : null,
      imageUri: pet.image_url ?? null,
      reproductiveStatus:
        pet.reproductive_status === 'pregnant' ||
        pet.reproductive_status === 'nursing' ||
        pet.reproductive_status === 'neither'
          ? pet.reproductive_status
          : null,
      pregnancyWeeks: pet.pregnancy_weeks ?? null,
    });
  },
  resetForm: () => set(initialState),
}));
