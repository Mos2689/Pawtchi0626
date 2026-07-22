import { ActivityLevel } from './healthMath';

export type SizeCategory = 'toy' | 'small' | 'medium' | 'large' | 'giant';

export interface BreedDefaults {
  typicalActivityLevel: ActivityLevel;
  commonAllergens: string[];
  weightRange: { male: [number, number]; female: [number, number] };
  sizeCategory: SizeCategory;
  seniorAgeYears: number;
  // Intrinsic metabolic efficiency at the same activity level. Defaults to 1.0.
  // Only set for breeds where allometric scaling consistently over- or
  // under-prescribes calories even after activity/neutering/life-stage are
  // accounted for. Do NOT set on breeds whose thriftiness is already captured
  // via `typicalActivityLevel: 'sedentary'` — that would double-count.
  metabolicModifier?: number;
}

const DOG_BREED_DATA: Record<string, BreedDefaults> = {
  // --- Original breeds (senior thresholds aligned to WSAVA) ---
  'Labrador Retriever': {
    typicalActivityLevel: 'active',
    commonAllergens: ['Chicken', 'Beef', 'Wheat'],
    weightRange: { male: [29, 36], female: [25, 32] },
    sizeCategory: 'large',
    seniorAgeYears: 8,
    metabolicModifier: 0.95, // POMC deletion → measurable food efficiency at any activity level
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
    seniorAgeYears: 8,
  },
  'Golden Retriever': {
    typicalActivityLevel: 'active',
    commonAllergens: ['Chicken', 'Beef', 'Wheat', 'Dairy'],
    weightRange: { male: [30, 34], female: [25, 30] },
    sizeCategory: 'large',
    seniorAgeYears: 8,
    metabolicModifier: 0.95, // shares Lab's thrifty tendency in clinical practice
  },
  'Bulldog': {
    typicalActivityLevel: 'sedentary',
    commonAllergens: ['Beef', 'Dairy', 'Chicken', 'Soy'],
    weightRange: { male: [23, 25], female: [18, 23] },
    sizeCategory: 'medium',
    seniorAgeYears: 7,
  },
  'Beagle': {
    typicalActivityLevel: 'active',
    commonAllergens: ['Beef', 'Dairy', 'Chicken'],
    weightRange: { male: [10, 11], female: [9, 10] },
    sizeCategory: 'medium',
    seniorAgeYears: 7,
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
    seniorAgeYears: 8,
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
    seniorAgeYears: 7,
  },
  'Corgi': {
    typicalActivityLevel: 'normal',
    commonAllergens: ['Chicken', 'Beef', 'Dairy'],
    weightRange: { male: [10, 14], female: [10, 13] },
    sizeCategory: 'small',
    seniorAgeYears: 8,
  },
  'Pug': {
    typicalActivityLevel: 'sedentary',
    commonAllergens: ['Chicken', 'Beef', 'Dairy'],
    weightRange: { male: [6, 8], female: [6, 8] },
    sizeCategory: 'small',
    seniorAgeYears: 8,
  },
  'Australian Shepherd': {
    typicalActivityLevel: 'highly_active',
    commonAllergens: ['Beef', 'Chicken', 'Dairy'],
    weightRange: { male: [23, 29], female: [18, 25] },
    sizeCategory: 'medium',
    seniorAgeYears: 7,
  },
  'Shih Tzu': {
    typicalActivityLevel: 'sedentary',
    commonAllergens: ['Chicken', 'Dairy', 'Wheat'],
    weightRange: { male: [4, 7], female: [4, 7] },
    sizeCategory: 'toy',
    seniorAgeYears: 8,
  },
  'Pomeranian': {
    typicalActivityLevel: 'normal',
    commonAllergens: ['Chicken', 'Dairy', 'Beef'],
    weightRange: { male: [1.4, 3.2], female: [1.4, 3.2] },
    sizeCategory: 'toy',
    seniorAgeYears: 8,
  },

  // --- Poodle size variants ---
  'Toy Poodle': {
    typicalActivityLevel: 'normal',
    commonAllergens: ['Corn', 'Soy', 'Lamb'],
    weightRange: { male: [2, 4], female: [2, 4] },
    sizeCategory: 'toy',
    seniorAgeYears: 8,
  },
  'Miniature Poodle': {
    typicalActivityLevel: 'active',
    commonAllergens: ['Corn', 'Soy', 'Lamb'],
    weightRange: { male: [5, 8], female: [5, 7] },
    sizeCategory: 'small',
    seniorAgeYears: 8,
  },
  'Standard Poodle': {
    typicalActivityLevel: 'active',
    commonAllergens: ['Corn', 'Soy', 'Lamb'],
    weightRange: { male: [20, 32], female: [18, 28] },
    sizeCategory: 'medium',
    seniorAgeYears: 7,
  },

  // --- Dachshund size variants ---
  'Miniature Dachshund': {
    typicalActivityLevel: 'normal',
    commonAllergens: ['Chicken', 'Beef', 'Dairy'],
    weightRange: { male: [4, 5], female: [4, 5] },
    sizeCategory: 'toy',
    seniorAgeYears: 8,
  },
  'Standard Dachshund': {
    typicalActivityLevel: 'normal',
    commonAllergens: ['Chicken', 'Beef', 'Dairy'],
    weightRange: { male: [7, 15], female: [7, 15] },
    sizeCategory: 'small',
    seniorAgeYears: 8,
  },

  // --- Top Australian breeds ---
  'Staffordshire Bull Terrier': {
    typicalActivityLevel: 'active',
    commonAllergens: ['Beef', 'Chicken', 'Wheat', 'Dairy'],
    weightRange: { male: [13, 17], female: [11, 15.4] },
    sizeCategory: 'medium',
    seniorAgeYears: 7,
  },
  'Cavalier King Charles Spaniel': {
    typicalActivityLevel: 'normal',
    commonAllergens: ['Chicken', 'Dairy', 'Wheat'],
    weightRange: { male: [5.9, 8.2], female: [5.4, 8.2] },
    sizeCategory: 'small',
    seniorAgeYears: 7,
  },
  'Border Collie': {
    typicalActivityLevel: 'highly_active',
    commonAllergens: ['Beef', 'Dairy', 'Chicken'],
    weightRange: { male: [14, 20], female: [12, 19] },
    sizeCategory: 'medium',
    seniorAgeYears: 7,
  },
  'Australian Kelpie': {
    typicalActivityLevel: 'highly_active',
    commonAllergens: ['Beef', 'Chicken', 'Wheat'],
    weightRange: { male: [14, 21], female: [11, 18] },
    sizeCategory: 'medium',
    seniorAgeYears: 7,
  },
  'Miniature Schnauzer': {
    typicalActivityLevel: 'normal',
    commonAllergens: ['Beef', 'Chicken', 'Soy'],
    weightRange: { male: [5, 9], female: [5, 8] },
    sizeCategory: 'small',
    seniorAgeYears: 8,
  },
  'Maltese': {
    typicalActivityLevel: 'normal',
    commonAllergens: ['Beef', 'Dairy', 'Chicken'],
    weightRange: { male: [3, 4], female: [3, 4] },
    sizeCategory: 'toy',
    seniorAgeYears: 8,
  },
  'Cocker Spaniel': {
    typicalActivityLevel: 'active',
    commonAllergens: ['Chicken', 'Beef', 'Wheat', 'Dairy'],
    weightRange: { male: [13, 16], female: [12, 15] },
    sizeCategory: 'medium',
    seniorAgeYears: 7,
  },
  'Jack Russell Terrier': {
    typicalActivityLevel: 'highly_active',
    commonAllergens: ['Beef', 'Dairy', 'Wheat'],
    weightRange: { male: [6, 8], female: [5, 7] },
    sizeCategory: 'small',
    seniorAgeYears: 8,
  },
  'Australian Cattle Dog': {
    typicalActivityLevel: 'highly_active',
    commonAllergens: ['Beef', 'Chicken', 'Dairy'],
    weightRange: { male: [15, 22], female: [14, 20] },
    sizeCategory: 'medium',
    seniorAgeYears: 7,
  },
  'West Highland White Terrier': {
    typicalActivityLevel: 'normal',
    commonAllergens: ['Chicken', 'Beef', 'Wheat', 'Dairy'],
    weightRange: { male: [7, 10], female: [6, 7] },
    sizeCategory: 'small',
    seniorAgeYears: 8,
  },

  // --- Designer crosses (blended from parent breeds) ---
  'Cavoodle': {
    typicalActivityLevel: 'normal',
    commonAllergens: ['Chicken', 'Dairy', 'Corn', 'Soy'],
    weightRange: { male: [5, 12], female: [5, 10] },
    sizeCategory: 'small',
    seniorAgeYears: 8,
  },
  'Labradoodle': {
    typicalActivityLevel: 'active',
    commonAllergens: ['Chicken', 'Beef', 'Corn', 'Soy'],
    weightRange: { male: [23, 30], female: [20, 27] },
    sizeCategory: 'medium',
    seniorAgeYears: 7,
  },
  'Groodle': {
    typicalActivityLevel: 'active',
    commonAllergens: ['Chicken', 'Beef', 'Corn', 'Soy'],
    weightRange: { male: [25, 32], female: [22, 28] },
    sizeCategory: 'large',
    seniorAgeYears: 7,
  },
  'Spoodle': {
    typicalActivityLevel: 'active',
    commonAllergens: ['Chicken', 'Beef', 'Corn', 'Soy', 'Dairy'],
    weightRange: { male: [10, 15], female: [8, 13] },
    sizeCategory: 'medium',
    seniorAgeYears: 7,
  },
  'Moodle': {
    typicalActivityLevel: 'normal',
    commonAllergens: ['Beef', 'Dairy', 'Corn', 'Soy'],
    weightRange: { male: [4, 7], female: [3, 6] },
    sizeCategory: 'toy',
    seniorAgeYears: 8,
  },
  'Puggle': {
    typicalActivityLevel: 'normal',
    commonAllergens: ['Chicken', 'Beef', 'Dairy'],
    weightRange: { male: [8, 14], female: [7, 12] },
    sizeCategory: 'small',
    seniorAgeYears: 8,
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
  'Burmese': {
    typicalActivityLevel: 'active',
    commonAllergens: ['Fish', 'Beef', 'Dairy'],
    weightRange: { male: [4, 6], female: [3, 4.5] },
    sizeCategory: 'medium',
    seniorAgeYears: 10,
  },
  'Birman': {
    typicalActivityLevel: 'normal',
    commonAllergens: ['Fish', 'Beef', 'Dairy'],
    weightRange: { male: [4, 7], female: [3, 5] },
    sizeCategory: 'medium',
    seniorAgeYears: 10,
  },
};

/**
 * Derives a size category from weight alone (kg). Used for mixed breeds.
 */
export function sizeCategoryFromWeight(species: 'dog' | 'cat', weightKg: number): SizeCategory {
  if (species === 'cat') return weightKg > 6 ? 'large' : 'medium';
  if (weightKg <= 4) return 'toy';
  if (weightKg <= 10) return 'small';
  if (weightKg <= 25) return 'medium';
  if (weightKg <= 40) return 'large';
  return 'giant';
}

/**
 * Returns generic defaults for mixed breeds based on weight.
 */
export function getMixedBreedDefaults(
  species: 'dog' | 'cat',
  weightKg: number | null,
): BreedDefaults {
  const size = weightKg ? sizeCategoryFromWeight(species, weightKg) : 'medium';
  const seniorMap: Record<SizeCategory, number> = {
    toy: 8, small: 8, medium: 7, large: 8, giant: 6,
  };
  return {
    typicalActivityLevel: 'normal',
    commonAllergens: species === 'dog'
      ? ['Beef', 'Chicken', 'Dairy', 'Wheat']
      : ['Fish', 'Beef', 'Dairy'],
    weightRange: weightKg
      ? { male: [weightKg * 0.85, weightKg * 1.15], female: [weightKg * 0.8, weightKg * 1.1] }
      : { male: [0, 0], female: [0, 0] },
    sizeCategory: size,
    seniorAgeYears: seniorMap[size],
  };
}

/**
 * Returns the pooled (male + female union) breed weight range for a species/
 * breed pair. Convenience for input-validation callers that don't care about
 * sex. Prefer `getBreedDefaults(...).weightRange` when sex matters.
 *
 * Single source of truth — `weightBounds.ts` and any other bounds-check code
 * should consume this, not maintain their own copies.
 */
export function getBreedWeightRange(
  species: 'dog' | 'cat',
  breed: string | null | undefined,
): { lower: number; upper: number } | null {
  if (!breed) return null;
  const data = species === 'dog' ? DOG_BREED_DATA : CAT_BREED_DATA;
  const entry = data[breed];
  if (!entry) return null;
  const { male, female } = entry.weightRange;
  const hasMale = male[1] > 0;
  const hasFemale = female[1] > 0;
  if (!hasMale && !hasFemale) return null;
  const lower = Math.min(hasMale ? male[0] : Infinity, hasFemale ? female[0] : Infinity);
  const upper = Math.max(hasMale ? male[1] : 0, hasFemale ? female[1] : 0);
  return { lower, upper };
}

/**
 * Returns breed-specific defaults for a given species and breed name.
 * For Mixed Breed / unknown, returns weight-based generic defaults if weight is provided.
 */
export function getBreedDefaults(
  species: 'dog' | 'cat' | null,
  breed: string | null | undefined,
  weightKg?: number | null,
): BreedDefaults | null {
  if (!species) return null;

  // Mixed / unknown → weight-based fallback
  if (!breed || breed === 'Mixed Breed' || breed === 'Mixed Breed / Domestic Shorthair' || breed === 'Other') {
    return weightKg ? getMixedBreedDefaults(species, weightKg) : null;
  }

  const data = species === 'dog' ? DOG_BREED_DATA : CAT_BREED_DATA;
  return data[breed] ?? null;
}
