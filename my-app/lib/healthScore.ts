/**
 * Deterministic 1–10 health score for a scanned food, given a pet profile.
 *
 * This replaces the previous LLM-generated score. Same UX (single number),
 * defensible math. The LLM only extracts label data; this function turns
 * that into a score.
 *
 * Versioned so we can change weights later without breaking saved scans.
 */

import { toDryMatterBasis, defaultMoisturePct } from './aafcoMath';
import { hasMappedCondition } from './clinicalMapping';

export const HEALTH_SCORE_VERSION = 'pawtchi.healthScore.v2';

export type HealthScoreInput = {
  food: {
    food_type?: string | null;
    is_treat: boolean;
    is_allergy_trigger?: boolean;
    allergy_warnings?: string[];
    ingredients_of_concern?: string[];
    calories_per_serving: number;
    protein_pct?: number | null;
    fat_pct?: number | null;
    fibre_pct?: number | null;
    moisture_pct?: number | null;
    kcal_per_100g_as_fed?: number | null;
    confidence?: number; // Gemini extraction confidence 0–1
  };
  pet: {
    species: 'dog' | 'cat';
    age_months?: number | null;   // for life-stage protein floors
    daily_kcal_target?: number | null;
    allergies?: string[] | null;
    medical_conditions?: string[] | null;
    weight_kg?: number | null;
    target_weight_kg?: number | null;
  };
};

export type HealthScoreResult = {
  score: number; // 1–10 integer
  version: string;
  reasons: string[]; // Human-readable explanation of deductions
};

// AAFCO 2014 minimum protein floors, expressed in dry-matter %.
// Derivation: AAFCO specifies g/1000 kcal ME.
// At typical pet food energy density (~4000 kcal/kg DM):
//   45 g/1000kcal  → 45/4000*100 = 11.25% DM  → conservative floor = 18% DM (dog adult)
//   65 g/1000kcal  → 65/4000*100 = 16.25% DM  → conservative floor = 26% DM (cat adult)
//   56 g/1000kcal  → 56/4000*100 = 14% DM     → conservative floor = 22% DM (dog growth)
//   75 g/1000kcal  → 75/4000*100 = 18.75% DM  → conservative floor = 30% DM (cat growth)
// Conservative rounding gives whole numbers that are safe floors for most foods
// at varying energy densities. Foods at higher kcal/100g DM need more protein g/1000kcal
// to hit the same DM%, so rounding up is the safe direction.
const PROTEIN_DM_FLOOR: Record<string, number> = {
  dog_adult: 18,
  cat_adult: 26,
  dog_growth: 22,
  cat_growth: 30,
};

// Same AAFCO 2014 derivation: 13.8 g/1000kcal at 4000 kcal/kg DM = 3.45% DM → floor 5%
const FAT_DM_FLOOR = 5; // % as-fed; used for pancreatitis comparison

const FAT_PCT_PANCREATITIS_CAP = 15; // % as-fed; ACVIM 2021 consensus
const TREAT_OVERSIZE_FRACTION = 0.25; // If one serving is >25% of daily target, that's a lot

/**
 * Compute a 1–10 score from extraction data + pet profile.
 *
 * Deductions stack from a starting score of 10. Floor 1, ceiling 10.
 * Returns the score plus a `reasons[]` array of strings explaining each ding,
 * which the UI can show as a transparency tooltip.
 */
export function computeHealthScore(input: HealthScoreInput): HealthScoreResult {
  const { food, pet } = input;
  const reasons: string[] = [];
  let score = 10;

  // --- Hard safety deductions ---
  if (food.is_allergy_trigger) {
    score -= 6;
    // Hard ceiling: allergen foods should never score above 3/10
    score = Math.min(score, 3);
    reasons.push(`Contains an ingredient ${pet.species === 'cat' ? 'your cat' : 'your dog'} is allergic to`);
  }

  const concernCount = food.ingredients_of_concern?.length ?? 0;
  if (concernCount > 0) {
    const ding = Math.min(3, concernCount);
    score -= ding;
    reasons.push(`${concernCount} ingredient(s) flagged as concerning for this pet`);
  }

  // --- Calorie context vs daily target ---
  if (pet.daily_kcal_target && pet.daily_kcal_target > 0) {
    const fraction = food.calories_per_serving / pet.daily_kcal_target;
    if (fraction > TREAT_OVERSIZE_FRACTION) {
      score -= 2;
      reasons.push(`A single serving is ${Math.round(fraction * 100)}% of the daily kcal target`);
    }
  }

  // Treats during weight loss: small extra ding
  const onWeightLoss =
    pet.target_weight_kg != null &&
    pet.weight_kg != null &&
    pet.target_weight_kg < pet.weight_kg - 0.5;
  if (food.is_treat && onWeightLoss) {
    score -= 1;
    reasons.push('Treats stack up fast during a weight-loss program');
  }

  // --- Calorie density vs weight-loss goal ---
  // High calorie density (>400 kcal/100g as-fed) makes portion control harder
  // during weight loss. Applies to meals only (treats already penalised above).
  if (
    !food.is_treat &&
    onWeightLoss &&
    food.kcal_per_100g_as_fed != null &&
    food.kcal_per_100g_as_fed > 400
  ) {
    score -= 1;
    reasons.push('High calorie density makes portion control harder during weight loss');
  }

  // --- Protein adequacy: life-stage-aware, DMB-corrected ---
  // Protein comparison must use dry-matter basis — comparing as-fed % against
  // DM floors incorrectly penalises wet foods. A wet food at 8% protein / 78%
  // moisture is 36.4% DMB (well above the 18% floor), but as-fed comparison
  // would call it deficient. We use the food's moisture when available and
  // fall back to the type-default, then compare DMB against the AAFCO DM floor.
  if (!food.is_treat && food.protein_pct != null) {
    const isGrowth = pet.age_months != null && pet.age_months < 12;
    const lifeStageKey =
      pet.species === 'cat'
        ? (isGrowth ? 'cat_growth' : 'cat_adult')
        : (isGrowth ? 'dog_growth' : 'dog_adult');
    const floor = PROTEIN_DM_FLOOR[lifeStageKey];

    const moisture = food.moisture_pct ?? defaultMoisturePct(food.food_type ?? 'kibble');
    const proteinDM = toDryMatterBasis(food.protein_pct, moisture);
    const gap = floor - proteinDM;

    if (gap > 3) {
      score -= 2;
      reasons.push(
        `Protein is well below the ${pet.species} ${isGrowth ? 'growth' : 'adult'} reference floor (~${floor}% DM)`,
      );
    } else if (gap > 0) {
      score -= 1;
      reasons.push(
        `Protein is slightly below the ${pet.species} ${isGrowth ? 'growth' : 'adult'} reference floor (~${floor}% DM)`,
      );
    }
  }

  // --- Pancreatitis fat cap ---
  // Note: fat_pct is as-fed, so we compare as-fed % against as-fed cap.
  // For precision (g/1000kcal vs adjusted target), see foodVerdict.ts.
  // Here we use the simplified ACVIM clinical cap of 15% as-fed.
  if (
    food.fat_pct != null &&
    hasMappedCondition(pet.medical_conditions, 'pancreatitis_history')
  ) {
    if (food.fat_pct > FAT_PCT_PANCREATITIS_CAP) {
      score -= 3;
      reasons.push(
        `Fat is ${food.fat_pct}% as-fed — high for a pet with a pancreatitis history`,
      );
    }
  }

  // --- Confidence cap: don't credibly award high scores on guesswork ---
  if (food.confidence != null && food.confidence < 0.5) {
    if (score > 6) {
      score = 6;
      reasons.push('Label was hard to read; score capped until you confirm or edit');
    }
  }

  // Clamp + round
  score = Math.max(1, Math.min(10, Math.round(score)));

  return {
    score,
    version: HEALTH_SCORE_VERSION,
    reasons,
  };
}