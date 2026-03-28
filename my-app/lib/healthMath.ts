// RER = 70 * (body weight in kg)^0.75
// MER = RER * Factor

export type Species = 'dog' | 'cat';
export type ActivityLevel = 'sedentary' | 'normal' | 'active' | 'highly_active';

export function calculateRER(weightKg: number): number {
  return 70 * Math.pow(weightKg, 0.75);
}

export function getMERFactor(
  species: Species,
  isNeutered: boolean,
  activityLevel: ActivityLevel,
  goal: 'lose' | 'maintain' | 'gain' = 'maintain',
  ageMonths?: number
): number {
  // Base multipliers
  let factor = 1.0;

  if (species === 'dog') {
    factor = isNeutered ? 1.6 : 1.8; // Baseline for adult maintenance
    
    // Puppies
    if (ageMonths && ageMonths < 4) return 3.0;
    if (ageMonths && ageMonths >= 4 && ageMonths < 12) return 2.0;

    // Activity adjustments
    switch (activityLevel) {
      case 'sedentary':
        factor *= 0.8;
        break;
      case 'active':
        factor = isNeutered ? 2.0 : 2.5; 
        break;
      case 'highly_active':
        factor = isNeutered ? 3.0 : 4.0; // Working dogs
        break;
      case 'normal':
      default:
        break;
    }

    // Goal adjustments (Weight loss/gain)
    if (goal === 'lose') factor = 1.0; // Restrict calories for weight loss
    if (goal === 'gain') factor *= 1.2;

  } else if (species === 'cat') {
    factor = isNeutered ? 1.2 : 1.4;

    // Kittens
    if (ageMonths && ageMonths < 12) return 2.5;

    // Activity adjustments
    switch (activityLevel) {
      case 'sedentary':
        factor = 1.0; // Prone to obesity
        break;
      case 'active':
      case 'highly_active':
        factor = 1.6;
        break;
      case 'normal':
      default:
        break;
    }

    // Goal adjustments
    if (goal === 'lose') factor = 0.8; 
    if (goal === 'gain') factor *= 1.2;
  }

  return factor;
}

export function calculateDailyKcal(
  weightKg: number,
  species: Species,
  isNeutered: boolean,
  activityLevel: ActivityLevel,
  goal: 'lose' | 'maintain' | 'gain' = 'maintain',
  ageMonths?: number
): number {
  const rer = calculateRER(weightKg);
  const factor = getMERFactor(species, isNeutered, activityLevel, goal, ageMonths);
  return Math.round(rer * factor);
}

/**
 * Adjusts the static daily calorie target based on today's activity and weight trends.
 * The base target (from onboarding/weight-log) is nudged ±5-10% to make each day feel
 * personalized rather than robotic.
 *
 * Returns the adjusted target and a human-readable reason string (null if no adjustment).
 */
export function adjustDailyTarget(
  baseTarget: number,
  todayActivityMinutes: number,
  weightTrendDirection: 'up' | 'down' | 'stable' | null,
  goal: 'lose' | 'maintain' | 'gain',
): { adjustedTarget: number; reason: string | null } {
  if (baseTarget <= 0) return { adjustedTarget: 0, reason: null };

  let multiplier = 1.0;
  let reason: string | null = null;

  // Weight trend adjustments (only for lose/gain goals — maintain stays neutral)
  // No exercise-based bonuses — MER already accounts for activity level,
  // and vets advise against rewarding exercise with more food.
  if (weightTrendDirection === 'up' && goal === 'lose') {
    multiplier -= 0.05;
    const reduction = Math.round(baseTarget * 0.05);
    reason = `Trending up: -${reduction} kcal`;
  } else if (weightTrendDirection === 'down' && goal === 'lose') {
    multiplier += 0.03;
    const reward = Math.round(baseTarget * 0.03);
    reason = `Great progress: +${reward} kcal`;
  } else if (weightTrendDirection === 'up' && goal === 'gain') {
    multiplier += 0.03;
    const reward = Math.round(baseTarget * 0.03);
    reason = `Gaining well: +${reward} kcal`;
  } else if (weightTrendDirection === 'down' && goal === 'gain') {
    multiplier += 0.05;
    const boost = Math.round(baseTarget * 0.05);
    reason = `Weight dipping: +${boost} kcal`;
  }

  return {
    adjustedTarget: Math.round(baseTarget * multiplier),
    reason,
  };
}

/**
 * Derive a goal (lose/maintain/gain) by comparing current weight to target weight.
 * Threshold of 0.5kg prevents trivial slider movements from changing the goal.
 */
export function deriveGoal(
  currentWeightKg: number,
  targetWeightKg: number | null | undefined,
  threshold: number = 0.5
): 'lose' | 'maintain' | 'gain' {
  if (!targetWeightKg) return 'maintain';
  const diff = targetWeightKg - currentWeightKg;
  if (diff < -threshold) return 'lose';   // target below current = lose
  if (diff > threshold) return 'gain';    // target above current = gain
  return 'maintain';
}
