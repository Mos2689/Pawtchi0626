import { ActivityLevel } from './healthMath';

export type SizeCategory = 'toy' | 'small' | 'medium' | 'large' | 'giant';

export interface BreedDefaults {
  typicalActivityLevel: ActivityLevel;
  commonAllergens: string[];
  weightRange: { male: [number, number]; female: [number, number] };
  sizeCategory: SizeCategory;
  seniorAgeYears: number;
}

const DOG_BREED_DATA: Record<string, BreedDefaults> = {
  'Labrador Retriever': {
    typicalActivityLevel: 'active',
    commonAllergens: ['Chicken', 'Beef', 'Wheat'],
    weightRange: { male: [29, 36], female: [25, 32] },
    sizeCategory: 'large',
    seniorAgeYears: 7,
  },
  'French Bulldog': {
    typicalActivityLevel: 'sedentary',
    commonAllergens: ['Chicken', 'Beef', 'Dairy', 'Soy'],
    weightRange: { male: [10, 13], female: [9, 12] },
    sizeCategory: 'small',
    seniorAgeYears: 8,
  },
  'German Shepherd': {
    typicalActivityLevel: 'active',
    commonAllergens: ['Beef', 'Dairy', 'Chicken', 'Wheat'],
    weightRange: { male: [30, 40], female: [22, 32] },
    sizeCategory: 'large',
    seniorAgeYears: 7,
  },
  'Golden Retriever': {
    typicalActivityLevel: 'active',
    commonAllergens: ['Chicken', 'Beef', 'Wheat', 'Dairy'],
    weightRange: { male: [30, 34], female: [25, 30] },
    sizeCategory: 'large',
    seniorAgeYears: 7,
  },
  'Bulldog': {
    typicalActivityLevel: 'sedentary',
    commonAllergens: ['Beef', 'Dairy', 'Chicken', 'Soy'],
    weightRange: { male: [23, 25], female: [18, 23] },
    sizeCategory: 'medium',
    seniorAgeYears: 7,
  },
  'Poodle': {
    typicalActivityLevel: 'active',
    commonAllergens: ['Corn', 'Soy', 'Lamb'],
    weightRange: { male: [20, 32], female: [18, 28] },
    sizeCategory: 'medium',
    seniorAgeYears: 9,
  },
  'Beagle': {
    typicalActivityLevel: 'active',
    commonAllergens: ['Beef', 'Dairy', 'Chicken'],
    weightRange: { male: [10, 11], female: [9, 10] },
    sizeCategory: 'medium',
    seniorAgeYears: 9,
  },
  'Rottweiler': {
    typicalActivityLevel: 'active',
    commonAllergens: ['Beef', 'Wheat', 'Chicken'],
    weightRange: { male: [43, 61], female: [36, 45] },
    sizeCategory: 'giant',
    seniorAgeYears: 6,
  },
  'Yorkshire Terrier': {
    typicalActivityLevel: 'normal',
    commonAllergens: ['Dairy', 'Wheat', 'Beef'],
    weightRange: { male: [2, 3.2], female: [2, 3.2] },
    sizeCategory: 'toy',
    seniorAgeYears: 11,
  },
  'Dachshund': {
    typicalActivityLevel: 'normal',
    commonAllergens: ['Chicken', 'Beef', 'Dairy'],
    weightRange: { male: [7, 15], female: [7, 15] },
    sizeCategory: 'small',
    seniorAgeYears: 10,
  },
  'Boxer': {
    typicalActivityLevel: 'active',
    commonAllergens: ['Beef', 'Chicken', 'Wheat'],
    weightRange: { male: [27, 32], female: [25, 29] },
    sizeCategory: 'large',
    seniorAgeYears: 7,
  },
  'Husky': {
    typicalActivityLevel: 'highly_active',
    commonAllergens: ['Beef', 'Dairy', 'Fish'],
    weightRange: { male: [20, 27], female: [16, 23] },
    sizeCategory: 'medium',
    seniorAgeYears: 9,
  },
  'Corgi': {
    typicalActivityLevel: 'normal',
    commonAllergens: ['Chicken', 'Beef', 'Dairy'],
    weightRange: { male: [10, 14], female: [10, 13] },
    sizeCategory: 'small',
    seniorAgeYears: 10,
  },
  'Pug': {
    typicalActivityLevel: 'sedentary',
    commonAllergens: ['Chicken', 'Beef', 'Dairy'],
    weightRange: { male: [6, 8], female: [6, 8] },
    sizeCategory: 'small',
    seniorAgeYears: 9,
  },
  'Australian Shepherd': {
    typicalActivityLevel: 'highly_active',
    commonAllergens: ['Beef', 'Chicken', 'Dairy'],
    weightRange: { male: [23, 29], female: [18, 25] },
    sizeCategory: 'medium',
    seniorAgeYears: 8,
  },
  'Shih Tzu': {
    typicalActivityLevel: 'sedentary',
    commonAllergens: ['Chicken', 'Dairy', 'Wheat'],
    weightRange: { male: [4, 7], female: [4, 7] },
    sizeCategory: 'toy',
    seniorAgeYears: 10,
  },
  'Pomeranian': {
    typicalActivityLevel: 'normal',
    commonAllergens: ['Chicken', 'Dairy', 'Beef'],
    weightRange: { male: [1.4, 3.2], female: [1.4, 3.2] },
    sizeCategory: 'toy',
    seniorAgeYears: 11,
  },
};

const CAT_BREED_DATA: Record<string, BreedDefaults> = {
  'Domestic Shorthair': {
    typicalActivityLevel: 'normal',
    commonAllergens: ['Fish', 'Beef', 'Dairy'],
    weightRange: { male: [3.5, 5.5], female: [3, 4.5] },
    sizeCategory: 'medium',
    seniorAgeYears: 10,
  },
  'Mixed Breed / Domestic Shorthair': {
    typicalActivityLevel: 'normal',
    commonAllergens: ['Fish', 'Beef', 'Dairy'],
    weightRange: { male: [3.5, 5.5], female: [3, 4.5] },
    sizeCategory: 'medium',
    seniorAgeYears: 10,
  },
  'Domestic Longhair': {
    typicalActivityLevel: 'normal',
    commonAllergens: ['Fish', 'Beef', 'Dairy'],
    weightRange: { male: [4, 6], female: [3.5, 5] },
    sizeCategory: 'medium',
    seniorAgeYears: 10,
  },
  'Ragdoll': {
    typicalActivityLevel: 'sedentary',
    commonAllergens: ['Fish', 'Dairy'],
    weightRange: { male: [5.5, 9], female: [4, 6.5] },
    sizeCategory: 'large',
    seniorAgeYears: 9,
  },
  'Maine Coon': {
    typicalActivityLevel: 'active',
    commonAllergens: ['Fish', 'Chicken', 'Wheat'],
    weightRange: { male: [6, 11], female: [4, 6.5] },
    sizeCategory: 'large',
    seniorAgeYears: 8,
  },
  'Persian': {
    typicalActivityLevel: 'sedentary',
    commonAllergens: ['Beef', 'Fish', 'Dairy'],
    weightRange: { male: [4, 6], female: [3, 5] },
    sizeCategory: 'medium',
    seniorAgeYears: 10,
  },
  'British Shorthair': {
    typicalActivityLevel: 'sedentary',
    commonAllergens: ['Beef', 'Fish'],
    weightRange: { male: [5.5, 8], female: [3.5, 5.5] },
    sizeCategory: 'large',
    seniorAgeYears: 9,
  },
  'Sphynx': {
    typicalActivityLevel: 'active',
    commonAllergens: ['Fish', 'Chicken'],
    weightRange: { male: [3.5, 5.5], female: [3, 4.5] },
    sizeCategory: 'medium',
    seniorAgeYears: 10,
  },
  'Bengal': {
    typicalActivityLevel: 'highly_active',
    commonAllergens: ['Beef', 'Chicken', 'Fish'],
    weightRange: { male: [4.5, 7], female: [3.5, 5.5] },
    sizeCategory: 'medium',
    seniorAgeYears: 10,
  },
  'Abyssinian': {
    typicalActivityLevel: 'active',
    commonAllergens: ['Fish', 'Beef', 'Dairy'],
    weightRange: { male: [3.5, 5.5], female: [3, 4.5] },
    sizeCategory: 'medium',
    seniorAgeYears: 10,
  },
  'Scottish Fold': {
    typicalActivityLevel: 'normal',
    commonAllergens: ['Fish', 'Beef', 'Dairy'],
    weightRange: { male: [4, 6], female: [3, 4.5] },
    sizeCategory: 'medium',
    seniorAgeYears: 10,
  },
  'Siamese': {
    typicalActivityLevel: 'active',
    commonAllergens: ['Fish', 'Dairy', 'Beef'],
    weightRange: { male: [4, 6], female: [3, 4.5] },
    sizeCategory: 'medium',
    seniorAgeYears: 10,
  },
  'Russian Blue': {
    typicalActivityLevel: 'normal',
    commonAllergens: ['Fish', 'Dairy'],
    weightRange: { male: [3.5, 5.5], female: [3, 4.5] },
    sizeCategory: 'medium',
    seniorAgeYears: 10,
  },
};

/**
 * Returns breed-specific defaults for a given species and breed name.
 * Returns null for Mixed Breed, Other, or unknown breeds.
 */
export function getBreedDefaults(
  species: 'dog' | 'cat' | null,
  breed: string | null | undefined,
): BreedDefaults | null {
  if (!species || !breed) return null;
  if (breed === 'Mixed Breed' || breed === 'Other') return null;

  const data = species === 'dog' ? DOG_BREED_DATA : CAT_BREED_DATA;
  return data[breed] ?? null;
}
