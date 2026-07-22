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
 * Returns a calorie multiplier for the life stage, species-aware.
 *
 * Dogs follow the classic pattern: energy needs decline through the mature/
 * senior/geriatric window as lean mass and activity drop.
 *
 * Cats are different. Older cats (~11+ years) show REDUCED fat and protein
 * digestibility and often lose lean body mass — unintended weight loss is the
 * dominant clinical problem in geriatric cats. A blanket 0.80× multiplier
 * pushes them the wrong direction. We keep mature/senior cats at 1.0× and
 * bump geriatric cats slightly ABOVE 1.0× to compensate for reduced
 * digestibility. Owners still tune with BCS + weight logs.
 *
 * The `species` argument is optional for backward compatibility with older
 * callers; when omitted, the dog schedule is applied.
 */
export function getLifeStageCalorieMultiplier(
  lifeStage: LifeStage,
  species: 'dog' | 'cat' = 'dog',
): number {
  if (species === 'cat') {
    switch (lifeStage) {
      case 'geriatric': return 1.05;
      // mature/senior/kitten/junior/adult → 1.0
      default: return 1.0;
    }
  }
  switch (lifeStage) {
    case 'mature': return 0.95;
    case 'senior': return 0.90;
    case 'geriatric': return 0.80;
    default: return 1.0;
  }
}

/**
 * Canonical age-in-months extractor for a Pet record.
 *
 * Different call sites have historically reconstructed `ageMonths` from
 * `age_years` ad-hoc, with subtle bugs:
 *   - `ageYears ? Math.round(ageYears * 12) : undefined` — treats 0 years as
 *     "unknown" instead of "0 months old", masking a young puppy.
 *   - `age_years` stored as a decimal (e.g. 0.25 = 3 months) but reconstructed
 *     inconsistently across stores.
 *
 * Centralising the logic prevents a puppy from silently inheriting the adult
 * MER multiplier (1.6×) when its growth multiplier (2.5–3.0×) is what it
 * actually needs. Underfeeding a growing puppy can cause hypoglycemia (toy
 * breeds) and stunted growth — clinically significant within days.
 *
 * Returns:
 *   - The `age_months` field if it's a finite non-negative number.
 *   - Otherwise `Math.round(age_years * 12)` if `age_years` is a finite
 *     non-negative number — **including 0**, which means "newborn".
 *   - `undefined` only when both inputs are missing/invalid.
 */
export function getAgeMonths(pet: {
  age_months?: number | null;
  age_years?: number | null;
}): number | undefined {
  const am = pet.age_months;
  if (typeof am === 'number' && Number.isFinite(am) && am >= 0) {
    return Math.round(am);
  }
  const ay = pet.age_years;
  if (typeof ay === 'number' && Number.isFinite(ay) && ay >= 0) {
    return Math.round(ay * 12);
  }
  return undefined;
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
