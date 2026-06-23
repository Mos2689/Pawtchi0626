import { create } from 'zustand';

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
  // The reveal screen reads from these — populated when goal.tsx finishes.
  targetWeightKg: number | null;
  dailyKcal: number | null;
  lifeStageLabel: string | null;

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
  setPlanSummary: (summary: { targetWeightKg: number; dailyKcal: number; lifeStageLabel: string }) => void;

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
  targetWeightKg: null as number | null,
  dailyKcal: null as number | null,
  lifeStageLabel: null as string | null,
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
  setPlanSummary: (summary) => set({
    targetWeightKg: summary.targetWeightKg,
    dailyKcal: summary.dailyKcal,
    lifeStageLabel: summary.lifeStageLabel,
  }),
  resetForm: () => set(initialState),
}));
