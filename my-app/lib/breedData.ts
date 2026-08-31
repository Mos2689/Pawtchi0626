import { ActivityLevel } from './healthMath';

export type SizeCategory = 'toy' | 'small' | 'medium' | 'large' | 'giant';

export interface BreedDefaults {
  typicalActivityLevel: ActivityLevel;
  commonAllergens: string[];
  weightRange: { male: [number, number]; female: [number, number] };
  /**
   * Height at the withers (cm), from the published breed standard.
   *
   * Exists for one consumer: the walk step estimate. Shoulder height predicts
   * a dog's step length far better than body weight does — two dogs of equal
   * weight can be built completely differently — which is why the regression in
   * lib/walk/stepEstimate.ts takes height rather than the weight we already had.
   *
   * Optional: a breed with no standard falls through to the weight estimate.
   * Dogs only; cats never walk.
   */
  heightRange?: { male: [number, number]; female: [number, number] };
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
    heightRange: { male: [57, 62], female: [55, 60] },
    sizeCategory: 'large',
    seniorAgeYears: 8,
    metabolicModifier: 0.95, // POMC deletion → measurable food efficiency at any activity level
  },
  'French Bulldog': {
    typicalActivityLevel: 'sedentary',
    commonAllergens: ['Chicken', 'Beef', 'Dairy', 'Soy'],
    weightRange: { male: [10, 13], female: [9, 12] },
    heightRange: { male: [28, 33], female: [27, 32] },
    sizeCategory: 'small',
    seniorAgeYears: 8,
  },
  'German Shepherd': {
    typicalActivityLevel: 'active',
    commonAllergens: ['Beef', 'Dairy', 'Chicken', 'Wheat'],
    weightRange: { male: [30, 40], female: [22, 32] },
    heightRange: { male: [60, 65], female: [55, 60] },
    sizeCategory: 'large',
    seniorAgeYears: 8,
  },
  'Golden Retriever': {
    typicalActivityLevel: 'active',
    commonAllergens: ['Chicken', 'Beef', 'Wheat', 'Dairy'],
    weightRange: { male: [30, 34], female: [25, 30] },
    heightRange: { male: [58, 61], female: [55, 57] },
    sizeCategory: 'large',
    seniorAgeYears: 8,
    metabolicModifier: 0.95, // shares Lab's thrifty tendency in clinical practice
  },
  'Bulldog': {
    typicalActivityLevel: 'sedentary',
    commonAllergens: ['Beef', 'Dairy', 'Chicken', 'Soy'],
    weightRange: { male: [23, 25], female: [18, 23] },
    heightRange: { male: [36, 41], female: [33, 38] },
    sizeCategory: 'medium',
    seniorAgeYears: 7,
  },
  'Beagle': {
    typicalActivityLevel: 'active',
    commonAllergens: ['Beef', 'Dairy', 'Chicken'],
    weightRange: { male: [10, 11], female: [9, 10] },
    heightRange: { male: [33, 41], female: [33, 38] },
    sizeCategory: 'medium',
    seniorAgeYears: 7,
  },
  'Rottweiler': {
    typicalActivityLevel: 'active',
    commonAllergens: ['Beef', 'Wheat', 'Chicken'],
    weightRange: { male: [43, 61], female: [36, 45] },
    heightRange: { male: [61, 69], female: [56, 63] },
    sizeCategory: 'giant',
    seniorAgeYears: 6,
  },
  'Yorkshire Terrier': {
    typicalActivityLevel: 'normal',
    commonAllergens: ['Dairy', 'Wheat', 'Beef'],
    weightRange: { male: [2, 3.2], female: [2, 3.2] },
    heightRange: { male: [18, 23], female: [18, 23] },
    sizeCategory: 'toy',
    seniorAgeYears: 8,
  },
  'Boxer': {
    typicalActivityLevel: 'active',
    commonAllergens: ['Beef', 'Chicken', 'Wheat'],
    weightRange: { male: [27, 32], female: [25, 29] },
    heightRange: { male: [57, 63], female: [53, 60] },
    sizeCategory: 'large',
    seniorAgeYears: 7,
  },
  'Husky': {
    typicalActivityLevel: 'highly_active',
    commonAllergens: ['Beef', 'Dairy', 'Fish'],
    weightRange: { male: [20, 27], female: [16, 23] },
    heightRange: { male: [53, 60], female: [51, 56] },
    sizeCategory: 'medium',
    seniorAgeYears: 7,
  },
  'Corgi': {
    typicalActivityLevel: 'normal',
    commonAllergens: ['Chicken', 'Beef', 'Dairy'],
    weightRange: { male: [10, 14], female: [10, 13] },
    heightRange: { male: [25, 30], female: [25, 30] },
    sizeCategory: 'small',
    seniorAgeYears: 8,
  },
  'Pug': {
    typicalActivityLevel: 'sedentary',
    commonAllergens: ['Chicken', 'Beef', 'Dairy'],
    weightRange: { male: [6, 8], female: [6, 8] },
    heightRange: { male: [25, 33], female: [25, 33] },
    sizeCategory: 'small',
    seniorAgeYears: 8,
  },
  'Australian Shepherd': {
    typicalActivityLevel: 'highly_active',
    commonAllergens: ['Beef', 'Chicken', 'Dairy'],
    weightRange: { male: [23, 29], female: [18, 25] },
    heightRange: { male: [51, 58], female: [46, 53] },
    sizeCategory: 'medium',
    seniorAgeYears: 7,
  },
  'Shih Tzu': {
    typicalActivityLevel: 'sedentary',
    commonAllergens: ['Chicken', 'Dairy', 'Wheat'],
    weightRange: { male: [4, 7], female: [4, 7] },
    heightRange: { male: [23, 27], female: [23, 27] },
    sizeCategory: 'toy',
    seniorAgeYears: 8,
  },
  'Pomeranian': {
    typicalActivityLevel: 'normal',
    commonAllergens: ['Chicken', 'Dairy', 'Beef'],
    weightRange: { male: [1.4, 3.2], female: [1.4, 3.2] },
    heightRange: { male: [15, 18], female: [15, 18] },
    sizeCategory: 'toy',
    seniorAgeYears: 8,
  },

  // --- Poodle size variants ---
  'Toy Poodle': {
    typicalActivityLevel: 'normal',
    commonAllergens: ['Corn', 'Soy', 'Lamb'],
    weightRange: { male: [2, 4], female: [2, 4] },
    heightRange: { male: [24, 25], female: [24, 25] },
    sizeCategory: 'toy',
    seniorAgeYears: 8,
  },
  'Miniature Poodle': {
    typicalActivityLevel: 'active',
    commonAllergens: ['Corn', 'Soy', 'Lamb'],
    weightRange: { male: [5, 8], female: [5, 7] },
    heightRange: { male: [28, 38], female: [28, 38] },
    sizeCategory: 'small',
    seniorAgeYears: 8,
  },
  'Standard Poodle': {
    typicalActivityLevel: 'active',
    commonAllergens: ['Corn', 'Soy', 'Lamb'],
    weightRange: { male: [20, 32], female: [18, 28] },
    heightRange: { male: [47, 62], female: [45, 60] },
    sizeCategory: 'medium',
    seniorAgeYears: 7,
  },

  // --- Dachshund size variants ---
  'Miniature Dachshund': {
    typicalActivityLevel: 'normal',
    commonAllergens: ['Chicken', 'Beef', 'Dairy'],
    weightRange: { male: [4, 5], female: [4, 5] },
    heightRange: { male: [13, 18], female: [13, 18] },
    sizeCategory: 'toy',
    seniorAgeYears: 8,
  },
  'Standard Dachshund': {
    typicalActivityLevel: 'normal',
    commonAllergens: ['Chicken', 'Beef', 'Dairy'],
    weightRange: { male: [7, 15], female: [7, 15] },
    heightRange: { male: [20, 23], female: [20, 23] },
    sizeCategory: 'small',
    seniorAgeYears: 8,
  },

  // --- Top Australian breeds ---
  'Staffordshire Bull Terrier': {
    typicalActivityLevel: 'active',
    commonAllergens: ['Beef', 'Chicken', 'Wheat', 'Dairy'],
    weightRange: { male: [13, 17], female: [11, 15.4] },
    heightRange: { male: [36, 41], female: [33, 38] },
    sizeCategory: 'medium',
    seniorAgeYears: 7,
  },
  'Cavalier King Charles Spaniel': {
    typicalActivityLevel: 'normal',
    commonAllergens: ['Chicken', 'Dairy', 'Wheat'],
    weightRange: { male: [5.9, 8.2], female: [5.4, 8.2] },
    heightRange: { male: [30, 33], female: [30, 33] },
    sizeCategory: 'small',
    seniorAgeYears: 7,
  },
  'Border Collie': {
    typicalActivityLevel: 'highly_active',
    commonAllergens: ['Beef', 'Dairy', 'Chicken'],
    weightRange: { male: [14, 20], female: [12, 19] },
    heightRange: { male: [48, 56], female: [46, 53] },
    sizeCategory: 'medium',
    seniorAgeYears: 7,
  },
  'Australian Kelpie': {
    typicalActivityLevel: 'highly_active',
    commonAllergens: ['Beef', 'Chicken', 'Wheat'],
    weightRange: { male: [14, 21], female: [11, 18] },
    heightRange: { male: [46, 51], female: [43, 48] },
    sizeCategory: 'medium',
    seniorAgeYears: 7,
  },
  'Miniature Schnauzer': {
    typicalActivityLevel: 'normal',
    commonAllergens: ['Beef', 'Chicken', 'Soy'],
    weightRange: { male: [5, 9], female: [5, 8] },
    heightRange: { male: [30, 36], female: [30, 36] },
    sizeCategory: 'small',
    seniorAgeYears: 8,
  },
  'Maltese': {
    typicalActivityLevel: 'normal',
    commonAllergens: ['Beef', 'Dairy', 'Chicken'],
    weightRange: { male: [3, 4], female: [3, 4] },
    heightRange: { male: [20, 25], female: [20, 25] },
    sizeCategory: 'toy',
    seniorAgeYears: 8,
  },
  'Cocker Spaniel': {
    typicalActivityLevel: 'active',
    commonAllergens: ['Chicken', 'Beef', 'Wheat', 'Dairy'],
    weightRange: { male: [13, 16], female: [12, 15] },
    heightRange: { male: [36, 39], female: [34, 37] },
    sizeCategory: 'medium',
    seniorAgeYears: 7,
  },
  'Jack Russell Terrier': {
    typicalActivityLevel: 'highly_active',
    commonAllergens: ['Beef', 'Dairy', 'Wheat'],
    weightRange: { male: [6, 8], female: [5, 7] },
    heightRange: { male: [25, 35], female: [25, 35] },
    sizeCategory: 'small',
    seniorAgeYears: 8,
  },
  'Australian Cattle Dog': {
    typicalActivityLevel: 'highly_active',
    commonAllergens: ['Beef', 'Chicken', 'Dairy'],
    weightRange: { male: [15, 22], female: [14, 20] },
    heightRange: { male: [46, 51], female: [43, 48] },
    sizeCategory: 'medium',
    seniorAgeYears: 7,
  },
  'West Highland White Terrier': {
    typicalActivityLevel: 'normal',
    commonAllergens: ['Chicken', 'Beef', 'Wheat', 'Dairy'],
    weightRange: { male: [7, 10], female: [6, 7] },
    heightRange: { male: [26, 30], female: [24, 28] },
    sizeCategory: 'small',
    seniorAgeYears: 8,
  },

  // --- Designer crosses (blended from parent breeds) ---
  'Cavoodle': {
    typicalActivityLevel: 'normal',
    commonAllergens: ['Chicken', 'Dairy', 'Corn', 'Soy'],
    weightRange: { male: [5, 12], female: [5, 10] },
    heightRange: { male: [28, 38], female: [28, 38] },
    sizeCategory: 'small',
    seniorAgeYears: 8,
  },
  'Labradoodle': {
    typicalActivityLevel: 'active',
    commonAllergens: ['Chicken', 'Beef', 'Corn', 'Soy'],
    weightRange: { male: [23, 30], female: [20, 27] },
    heightRange: { male: [54, 63], female: [52, 60] },
    sizeCategory: 'medium',
    seniorAgeYears: 7,
  },
  'Groodle': {
    typicalActivityLevel: 'active',
    commonAllergens: ['Chicken', 'Beef', 'Corn', 'Soy'],
    weightRange: { male: [25, 32], female: [22, 28] },
    heightRange: { male: [56, 66], female: [53, 61] },
    sizeCategory: 'large',
    seniorAgeYears: 7,
  },
  'Spoodle': {
    typicalActivityLevel: 'active',
    commonAllergens: ['Chicken', 'Beef', 'Corn', 'Soy', 'Dairy'],
    weightRange: { male: [10, 15], female: [8, 13] },
    heightRange: { male: [33, 45], female: [33, 45] },
    sizeCategory: 'medium',
    seniorAgeYears: 7,
  },
  'Moodle': {
    typicalActivityLevel: 'normal',
    commonAllergens: ['Beef', 'Dairy', 'Corn', 'Soy'],
    weightRange: { male: [4, 7], female: [3, 6] },
    heightRange: { male: [23, 33], female: [23, 33] },
    sizeCategory: 'toy',
    seniorAgeYears: 8,
  },
  'Puggle': {
    typicalActivityLevel: 'normal',
    commonAllergens: ['Chicken', 'Beef', 'Dairy'],
    weightRange: { male: [8, 14], female: [7, 12] },
    heightRange: { male: [28, 38], female: [28, 38] },
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
/**
 * Expected adult height at the withers, in cm, for the step estimate.
 *
 * Returns the midpoint of the sex's published range. With no sex recorded it
 * averages the two midpoints rather than guessing — the sexes differ by only a
 * few centimetres in most breeds, which is well inside the estimate's own error.
 *
 * Null for any breed with no standard on file (`Mixed Breed`, `Other`, free
 * text, every cat). Callers fall through to the weight or size-class estimate.
 */
export function getBreedHeightCm(
  species: 'dog' | 'cat',
  breed: string | null | undefined,
  sex: 'male' | 'female' | null | undefined,
): number | null {
  if (!breed || species !== 'dog') return null;
  const range = DOG_BREED_DATA[breed]?.heightRange;
  if (!range) return null;

  const midpoint = (band: [number, number]) => (band[0] + band[1]) / 2;
  if (sex === 'male') return midpoint(range.male);
  if (sex === 'female') return midpoint(range.female);
  return (midpoint(range.male) + midpoint(range.female)) / 2;
}

/**
 * Expected adult weight, in kg — the denominator of the puppy growth ratio.
 * Same midpoint convention as `getBreedHeightCm`, so the two stay comparable.
 */
export function getBreedAdultWeightKg(
  species: 'dog' | 'cat',
  breed: string | null | undefined,
  sex: 'male' | 'female' | null | undefined,
): number | null {
  if (!breed) return null;
  const data = species === 'dog' ? DOG_BREED_DATA : CAT_BREED_DATA;
  const range = data[breed]?.weightRange;
  if (!range) return null;

  const midpoint = (band: [number, number]) => (band[0] + band[1]) / 2;
  const value =
    sex === 'male'
      ? midpoint(range.male)
      : sex === 'female'
        ? midpoint(range.female)
        : (midpoint(range.male) + midpoint(range.female)) / 2;
  return value > 0 ? value : null;
}

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
