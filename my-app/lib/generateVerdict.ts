/**
 * generateVerdict.ts
 *
 * Deterministic plain-English verdict generator for a food scan result.
 * No LLM — uses structured data already available in FoodAnalysis + ScanResult + pet profile.
 *
 * Produces a single paragraph that:
 *   - References pet by name throughout
 *   - Differentiates treat vs main meal
 *   - Addresses all confirmed clinical conditions
 *   - Weighs all nutrient signals and translates them into plain language
 *   - Provides a clear action recommendation
 *
 * PERMUTATIONS COVERED:
 *   Food type:  treat | meal
 *   Health score: 1–3 (poor) | 4–6 (fair) | 7–10 (good)
 *   Allergen: trigger | no trigger
 *   Clinical adjustments: none | obesity | pancreatitis | obesity+pancreatitis
 *   Goal: lose | maintain | gain
 *   Activity: sedentary | normal | active | highly_active
 *   Species: dog | cat
 *   Age: puppy/kitten | adult | senior
 *   Weight gap: underweight | healthy | overweight
 *   Nutrient signals: protein OK | protein low | fat OK | fat high | unknown
 *
 * Call this after analyzeFood() and computeHealthScore() have both run.
 * Always produces output — never null.
 */

import type { FoodAnalysis } from './foodVerdict';

export type ScanResultVerdict = {
  verdict: string;
  verdict_category: 'unsafe' | 'poor' | 'fair' | 'good' | 'excellent';
};

interface VerdictContext {
  scanResult: {
    food_name: string;
    food_type: string | null;
    is_treat: boolean;
    is_allergy_trigger: boolean;
    allergy_warnings: string[];
    ingredients_of_concern: string[];
    key_ingredients?: string[] | null;
    calories_per_serving: number;
    health_score: number;
    recommendation: string;
    confidence: number;
  };
  foodAnalysis: FoodAnalysis;
  pet: {
    name: string;
    species: 'dog' | 'cat';
    goal: 'lose' | 'maintain' | 'gain';
    activity_level: 'sedentary' | 'normal' | 'active' | 'highly_active';
    confirmed_condition_keys: string[];
    age_years: number | null;
    current_weight_kg: number;
    target_weight_kg: number | null;
    daily_kcal_target: number | null;
  };
  /** Optional weight & calorie context — makes the fallback verdict weight-aware */
  weight_context?: {
    calories_consumed_today: number;
    calories_remaining: number;
    cal_percent: number;
    weight_trend_direction: 'up' | 'down' | 'stable' | null;
    weight_gap_kg: number;
  };
}

/** Helper: get nutrient status for a key from foodAnalysis */
function nutrientStatus(analysis: FoodAnalysis, key: string): string {
  const n = analysis.nutrients.find(n => n.nutrient === key);
  return n?.status ?? 'unknown';
}

/** Helper: get nutrient value g/1000kcal from foodAnalysis */
function nutrientGPer1000(analysis: FoodAnalysis, key: string): number | null {
  const n = analysis.nutrients.find(n => n.nutrient === key);
  return n?.g_per_1000kcal ?? null;
}

/**
 * Resolve clean allergen ingredient names from allergy_warnings[].
 * allergy_warnings may contain raw Gemini text (e.g. "Contains Chicken, which is on Bruno's allergen list").
 * key_ingredients[] contains the clean ingredient list from the label.
 * We cross-reference them to extract only the actual ingredient name.
 */
function cleanAllergenNames(
  warnings: string[],
  keyIngredients: string[],
): string[] {
  const cleaned = new Set<string>();
  for (const warning of warnings) {
    // Strip trailing explanations:
    // "Contains Chicken, which is on Bruno's allergen list" → "Contains Chicken"
    const stripped = warning
      .replace(/,\s*which[^,]*(is on|may be|are on)[^,]*/gi, '')
      .trim();
    // Strip leading "Contains " prefix
    const ingredient = stripped.replace(/^contains\s+/i, '').trim();
    if (ingredient && ingredient.length > 1 && ingredient.length < 50) {
      cleaned.add(ingredient);
    }
  }
  // Fallback: cross-match key_ingredients against pet allergies
  if (cleaned.size === 0 && keyIngredients.length > 0) {
    const petAllergiesLower =
      (ctx.pet as { allergies?: string[] })?.allergies?.map(a =>
        a.toLowerCase()
      ) ?? [];
    for (const ing of keyIngredients) {
      if (
        petAllergiesLower.some(al => ing.toLowerCase().includes(al))
      ) {
        cleaned.add(ing);
      }
    }
  }
  return Array.from(cleaned);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctx: any = null; // resolved at call site

export function generateVerdict(ctx: VerdictContext): ScanResultVerdict {
  const { scanResult, foodAnalysis, pet, weight_context: wCtx } = ctx;
  const {
    name,
    species,
    goal,
    activity_level,
    confirmed_condition_keys,
    age_years,
    current_weight_kg,
    target_weight_kg,
  } = pet;

  const isTreat = scanResult.is_treat;
  const score = scanResult.health_score;
  const isAllergyTrigger = scanResult.is_allergy_trigger;
  const allergyWarnings = scanResult.allergy_warnings ?? [];
  const caloriesPerServing = scanResult.calories_per_serving;
  const dailyKcalTarget = pet.daily_kcal_target ?? 0;

  // --- Nutrient signals ---
  const proteinStatus = nutrientStatus(foodAnalysis, 'crude_protein');
  const fatStatus = nutrientStatus(foodAnalysis, 'crude_fat');
  const proteinGPer1000 = nutrientGPer1000(foodAnalysis, 'crude_protein');
  const fatGPer1000 = nutrientGPer1000(foodAnalysis, 'crude_fat');
  const hasHighProtein =
    proteinStatus === 'meets_baseline' ||
    proteinStatus === 'meets_adjusted';
  const hasLowProtein =
    proteinStatus === 'below_baseline' ||
    proteinStatus === 'below_adjusted';
  const hasHighFat =
    fatStatus === 'above_baseline' || fatStatus === 'above_adjusted';
  const hasAdjusted = foodAnalysis.active_clinical_adjustments.length > 0;

  // --- Pet context flags ---
  const isSenior = (age_years ?? 0) >= 8;
  const isPuppy = (age_years ?? 0) <= 1;
  const hasObesity =
    confirmed_condition_keys.includes('obesity') || goal === 'lose';
  const hasPancreatitis = confirmed_condition_keys.includes(
    'pancreatitis_history',
  );

  const isOverweight =
    target_weight_kg != null &&
    target_weight_kg < current_weight_kg - 0.5;
  const isUnderweight =
    target_weight_kg != null &&
    target_weight_kg > current_weight_kg + 0.5;

  // --- Resolve clean allergen names ---
  const keyIngredients =
    scanResult.key_ingredients ?? scanResult.ingredients_of_concern ?? [];
  const allergenNames = cleanAllergenNames(allergyWarnings, keyIngredients);

  // --- Calorie context ---
  const kcalFraction =
    dailyKcalTarget > 0
      ? Math.round((caloriesPerServing / dailyKcalTarget) * 100)
      : null;

  // --- Weight budget context (from weight_context if provided) ---
  const budgetConsumedToday = wCtx?.calories_consumed_today ?? 0;
  const budgetRemaining = wCtx?.calories_remaining ?? null;
  const weightGapKg = wCtx?.weight_gap_kg ?? (isOverweight || isUnderweight
    ? Math.abs(current_weight_kg - (target_weight_kg ?? current_weight_kg))
    : 0);
  const weightTrendDir = wCtx?.weight_trend_direction ?? null;

  // --- Activity level ---
  const activityLabel: Record<string, string> = {
    sedentary: 'low-energy',
    normal: 'moderately active',
    active: 'active',
    highly_active: 'highly active',
  };
  const activityDesc = activityLabel[activity_level] ?? 'active';

  // ============================================================
  // BRANCH 1: ALLERGEN TRIGGER — always unsafe
  // ============================================================
  if (isAllergyTrigger && allergenNames.length > 0) {
    const ingredientList =
      allergenNames.length > 1
        ? allergenNames.slice(0, 2).join(' and ')
        : allergenNames[0];

    if (isTreat) {
      return {
        verdict:
          `${name} shouldn't have this — ${ingredientList} is on ${name}'s allergen list.` +
          ` Pick a treat that avoids this ingredient.`,
        verdict_category: 'unsafe',
      };
    }

    return {
      verdict:
        `This food isn't right for ${name}. It contains ${ingredientList},` +
        ` which ${name} is allergic to. Look for a food that doesn't include this ingredient.`,
      verdict_category: 'unsafe',
    };
  }

  // ============================================================
  // BRANCH 2: TREAT PATH
  // ============================================================
  if (isTreat) {
    if (score >= 8) {
      const goalHint =
        goal === 'lose'
          ? ` Keep it occasional — ${name}'s on a weight-loss program.`
          : goal === 'gain'
          ? ` Great for adding calories toward ${name}'s target weight.`
          : ` Treat it as a reward, not a meal.`;
      return {
        verdict: `${name} can have this treat — good pick.${goalHint}`,
        verdict_category: 'excellent',
      };
    }

    if (score >= 5) {
      const concern =
        hasHighFat
          ? `it adds up quickly — ${name} is ${activityDesc}`
          : hasLowProtein
          ? `the protein is modest for ${species === 'cat' ? 'a cat' : 'a dog'}`
          : `it's an average option for ${name}`;
      const tip =
        goal === 'lose'
          ? ` Keep portions small and account for the calories.`
          : ` Factor it into ${name}'s daily target of ${
              dailyKcalTarget > 0
                ? `${dailyKcalTarget} kcal`
                : 'their daily target'
            }.`;
      return {
        verdict: `${name} can have this treat occasionally. ${concern}.${tip}`,
        verdict_category: 'fair',
      };
    }

    // Poor treat
    const concern =
      hasHighFat
        ? `It's fatty, and those calories add up fast during a weight-loss program.`
        : hasLowProtein
        ? `It doesn't offer much protein for ${name}'s nutrition needs.`
        : `The nutritional balance isn't ideal for ${name}.`;
    return {
      verdict: `This treat isn't a great choice for ${name}. ${concern} A simpler, leaner option would be better.`,
      verdict_category: 'poor',
    };
  }

  // ============================================================
  // BRANCH 3: MAIN MEAL PATH
  // ============================================================

  // --- EXCELLENT / GOOD (score 7–10) ---
  if (score >= 7) {
    const proteinDesc = hasHighProtein
      ? `High protein at ${proteinGPer1000} g per 1000 kcal`
      : hasLowProtein
      ? `Protein is a little low — ${name} may need more from another meal`
      : `Good protein levels`;

    const goalContext =
      goal === 'lose'
        ? isOverweight
          ? ` — fits ${name}'s weight-loss target well.`
          : ` — aligns with ${name}'s weight management goal.`
        : goal === 'gain'
        ? isUnderweight
          ? ` — supports ${name}'s healthy weight gain.`
          : ` — good for ${name}'s active lifestyle.`
        : ` — supports ${name}'s healthy weight maintenance.`;

    const conditionHint =
      hasObesity && hasHighFat
        ? ` Fat is slightly elevated for a weight-loss program but still within range.`
        : hasPancreatitis && hasHighFat
        ? ` Fat is within ${name}'s adjusted range for pancreatitis management.`
        : '';

    const portionHint =
      kcalFraction && kcalFraction > 30
        ? ` Each serving is about ${kcalFraction}% of ${name}'s daily target.`
        : '';

    // Weight budget hint — connects food to weight journey
    const weightBudgetHint =
      isOverweight && weightGapKg > 0
        ? ` ${name} is ${weightGapKg.toFixed(1)} kg above target${weightTrendDir === 'down' ? ' — trending in the right direction' : weightTrendDir === 'up' ? ' and trending up, so portion control matters' : ''}.`
        : isUnderweight && weightGapKg > 0
        ? ` ${name} is ${weightGapKg.toFixed(1)} kg below target — this helps build toward a healthy weight.`
        : '';

    const ageHint = isSenior
      ? ` Easy-to-digest protein makes this a solid option for ${name} at this stage.`
      : isPuppy
      ? ` Adequate protein supports ${name}'s growth at this life stage.`
      : '';

    return {
      verdict: `Good pick for ${name}.${proteinDesc}${goalContext}${conditionHint}${portionHint}${weightBudgetHint}${ageHint}`.trim(),
      verdict_category: score >= 9 ? 'excellent' : 'good',
    };
  }

  // --- FAIR (score 4–6) ---
  if (score >= 4) {
    const concern =
      hasHighFat && hasAdjusted
        ? `Fat is above the adjusted target for ${name}'s weight management`
        : hasHighFat
        ? `Fat is on the higher side for ${name}`
        : hasLowProtein
        ? `Protein is below ideal levels for ${name}`
        : `Not the most balanced option for ${name}`;

    const tip =
      hasHighFat && hasAdjusted
        ? ` Smaller portions help, and mix in a leaner food at ${name}'s next meal.`
        : hasHighFat
        ? ` Keep portions in check — especially as ${name} is ${activityDesc}.`
        : hasLowProtein
        ? ` Stack it with a protein-rich food at ${name}'s next meal.`
        : ` A mixed meal plan works best — pair it with other foods to balance the day.`;

    return {
      verdict: `${concern} for ${name}.${tip}`.trim(),
      verdict_category: 'fair',
    };
  }

  // --- POOR (score 1–3, no allergen trigger) ---
  {
    const concern =
      hasLowProtein
        ? `Protein is well below what ${name} needs to maintain muscle and overall health`
        : hasHighFat && hasAdjusted
        ? `Fat is significantly above ${name}'s adjusted target`
        : hasHighFat
        ? `Too high in fat for ${name}'s needs as an ${activityDesc} ${species === 'cat' ? 'cat' : 'dog'}`
        : `Not a good fit for ${name}'s nutritional needs`;

    const suggestion =
      hasLowProtein
        ? `Look for a higher-protein food — check the label for at least ${
            species === 'cat' ? '26%' : '18%'
          } protein.`
        : hasHighFat
        ? `A lower-fat food would be better for regular meals.`
        : `Consider a higher-quality food for ${name}'s daily diet.`;

    return {
      verdict: `${concern}. ${suggestion}`.trim(),
      verdict_category: 'poor',
    };
  }
}
