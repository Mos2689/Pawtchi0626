import { SizeCategory } from './breedData';

export type LifeStage = 'puppy' | 'kitten' | 'junior' | 'adult' | 'mature' | 'senior' | 'geriatric';

/**
 * Derives the life stage of a pet based on species, age, and breed size.
 * Uses WSAVA/AAHA life stage guidelines with breed-size adjustments for dogs.
 */
export function deriveLifeStage(
  species: 'dog' | 'cat',
  ageYears: number,
  ageMonths: number = 0,
  sizeCategory?: SizeCategory,
): LifeStage {
  const totalMonths = ageYears * 12 + ageMonths;

  if (species === 'cat') {
    if (totalMonths < 6) return 'kitten';
    if (totalMonths < 12) return 'junior';
    if (totalMonths < 84) return 'adult';    // < 7yr
    if (totalMonths < 120) return 'mature';  // < 10yr
    if (totalMonths < 168) return 'senior';  // < 14yr
    return 'geriatric';
  }

  // Dogs — thresholds vary by size
  const size = sizeCategory ?? 'medium';

  if (size === 'toy' || size === 'small') {
    if (totalMonths < 6) return 'puppy';
    if (totalMonths < 12) return 'junior';
    if (totalMonths < 96) return 'adult';     // < 8yr
    if (totalMonths < 120) return 'mature';   // < 10yr
    if (totalMonths < 156) return 'senior';   // < 13yr
    return 'geriatric';
  }

  if (size === 'medium') {
    if (totalMonths < 6) return 'puppy';
    if (totalMonths < 12) return 'junior';
    if (totalMonths < 84) return 'adult';     // < 7yr
    if (totalMonths < 108) return 'mature';   // < 9yr
    if (totalMonths < 144) return 'senior';   // < 12yr
    return 'geriatric';
  }

  if (size === 'large') {
    if (totalMonths < 8) return 'puppy';
    if (totalMonths < 15) return 'junior';
    if (totalMonths < 72) return 'adult';     // < 6yr
    if (totalMonths < 96) return 'mature';    // < 8yr
    if (totalMonths < 120) return 'senior';   // < 10yr
    return 'geriatric';
  }

  // Giant
  if (totalMonths < 8) return 'puppy';
  if (totalMonths < 18) return 'junior';
  if (totalMonths < 60) return 'adult';     // < 5yr
  if (totalMonths < 84) return 'mature';    // < 7yr
  if (totalMonths < 108) return 'senior';   // < 9yr
  return 'geriatric';
}

/**
 * Returns a calorie multiplier for the life stage.
 * Puppy/kitten/junior/adult = 1.0 (puppy/kitten growth needs are
 * already handled by the ageMonths early-return in getMERFactor).
 */
export function getLifeStageCalorieMultiplier(lifeStage: LifeStage): number {
  switch (lifeStage) {
    case 'mature': return 0.95;
    case 'senior': return 0.90;
    case 'geriatric': return 0.80;
    default: return 1.0;
  }
}

/**
 * Returns a human-friendly life stage label.
 */
export function getLifeStageLabel(lifeStage: LifeStage, species: 'dog' | 'cat'): string {
  switch (lifeStage) {
    case 'puppy': return 'Puppy';
    case 'kitten': return 'Kitten';
    case 'junior': return species === 'dog' ? 'Junior Dog' : 'Junior Cat';
    case 'adult': return 'Adult';
    case 'mature': return 'Mature';
    case 'senior': return 'Senior';
    case 'geriatric': return 'Geriatric';
  }
}
