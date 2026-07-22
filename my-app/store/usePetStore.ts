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

  // Reset
  resetForm: () => void;
}

const initialState = {
  species: null,
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
  resetForm: () => set(initialState),
}));
