import { create } from 'zustand';

export type Species = 'dog' | 'cat' | null;
export type WeightUnit = 'kg' | 'lb';
export type ActivityLevel = 'sedentary' | 'normal' | 'active' | 'highly_active';
export type Goal = 'lose' | 'maintain' | 'gain';

interface PetState {
  // Pet Data
  species: Species;
  name: string;
  breed: string;
  weight: string; // string to handle text input
  weightUnit: WeightUnit;
  ageYears: string;
  ageMonths: string;
  isNeutered: boolean;
  activityLevel: ActivityLevel;
  goal: Goal;
  imageUri: string | null;
  
  // Actions
  setSpecies: (species: Species) => void;
  setName: (name: string) => void;
  setBreed: (breed: string) => void;
  setWeight: (weight: string) => void;
  setWeightUnit: (unit: WeightUnit) => void;
  setAgeYears: (years: string) => void;
  setAgeMonths: (months: string) => void;
  setIsNeutered: (isNeutered: boolean) => void;
  setActivityLevel: (level: ActivityLevel) => void;
  setGoal: (goal: Goal) => void;
  setImageUri: (uri: string | null) => void;
  
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
  isNeutered: true,
  activityLevel: 'normal' as ActivityLevel,
  goal: 'maintain' as Goal,
  imageUri: null,
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
  setIsNeutered: (isNeutered) => set({ isNeutered }),
  setActivityLevel: (activityLevel) => set({ activityLevel }),
  setGoal: (goal) => set({ goal }),
  setImageUri: (imageUri) => set({ imageUri }),
  resetForm: () => set(initialState),
}));
