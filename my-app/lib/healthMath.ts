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
  ageMonths?: number,
  lifeStageMultiplier: number = 1.0,
  metabolicModifier: number = 1.0,
): number {
  // Base multipliers
  let factor = 1.0;

  if (species === 'dog') {
    factor = isNeutered ? 1.6 : 1.8; // Baseline for adult maintenance

    // Puppies — gradual taper instead of cliff
    if (ageMonths !== undefined && ageMonths < 2) return 3.0;
    if (ageMonths !== undefined && ageMonths >= 2 && ageMonths < 4) return 2.5;
    if (ageMonths !== undefined && ageMonths >= 4 && ageMonths < 8) return 2.0;
    if (ageMonths !== undefined && ageMonths >= 8 && ageMonths < 12) return 1.5;

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
    // NOTE: For 'lose', calculateDailyKcal short-circuits and applies the factor
    // against RER(targetWeight) instead of RER(currentWeight). This branch only
    // runs if a caller invokes getMERFactor directly without target weight.
    if (goal === 'lose') factor = 1.0;
    if (goal === 'gain') factor *= 1.2;

  } else if (species === 'cat') {
    factor = isNeutered ? 1.2 : 1.4;

    // Kittens — gradual taper
    if (ageMonths !== undefined && ageMonths < 4) return 2.5;
    if (ageMonths !== undefined && ageMonths >= 4 && ageMonths < 8) return 2.0;
    if (ageMonths !== undefined && ageMonths >= 8 && ageMonths < 12) return 1.5;

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

  // Breed-intrinsic metabolic efficiency (Labs/Goldens are thrifty even when
  // active). Applied BEFORE life-stage so the senior reduction still nets the
  // same percentage drop regardless of breed.
  factor *= metabolicModifier;

  // Apply life stage multiplier (mature/senior/geriatric reduce calories).
  // Intentional stacking: this multiplies on top of activity-level adjustments
  // (e.g. sedentary × 0.8 × senior × 0.9 = 0.72 of baseline). An old, sedentary,
  // neutered dog really does need substantially less food — see senior/activity
  // stacking tests in kcalBreedScenarios.test.ts for the locked bounds.
  factor *= lifeStageMultiplier;

  return factor;
}

export type ReproductiveStatus = 'pregnant' | 'nursing' | 'neither' | null;

/**
 * Growing pets (ageMonths < 12) must not be calorie-restricted. Restriction
 * during growth causes stunted development and orthopedic disease. Callers
 * should check this and surface a banner instead of letting `goal='lose'`
 * silently pass through into adult weight-loss math.
 */
export function shouldBlockGrowthWeightLoss(
  ageMonths: number | undefined,
  goal: 'lose' | 'maintain' | 'gain',
): boolean {
  return goal === 'lose' && typeof ageMonths === 'number' && Number.isFinite(ageMonths) && ageMonths < 12;
}

/**
 * Returns the pregnancy multiplier over MAINTENANCE for a given gestation
 * week. Weeks 1-5 sit at maintenance; the ramp starts in the last third.
 *
 *   Dog:  weeks 1-5 → 1.00,  weeks 6-9 → linear 1.10 → 1.80
 *   Cat:  weeks 1-5 → 1.00,  weeks 6-9 → linear 1.00 → 1.60
 *
 * `null` week defaults to mid-gestation (week 6) so a user who skips the
 * question still gets a moderately-elevated plan rather than pure maintenance
 * or a dangerous overshoot.
 */
export function pregnancyMultiplier(
  species: Species,
  weeks: number | null | undefined,
): number {
  const w = typeof weeks === 'number' && Number.isFinite(weeks) ? Math.max(1, Math.min(9, weeks)) : 6;
  if (w <= 5) return 1.0;
  const ramp = (w - 5) / 4; // 0.25 → 1.0 over weeks 6..9
  if (species === 'dog') return 1.10 + ramp * (1.80 - 1.10);
  return 1.00 + ramp * (1.60 - 1.00);
}

export function calculateDailyKcal(
  weightKg: number,
  species: Species,
  isNeutered: boolean,
  activityLevel: ActivityLevel,
  goal: 'lose' | 'maintain' | 'gain' = 'maintain',
  ageMonths?: number,
  lifeStageMultiplier: number = 1.0,
  targetWeightKg?: number | null,
  metabolicModifier: number = 1.0,
  bcs?: number | null,
  daysSincePlanStart?: number | null,
  reproductiveStatus?: ReproductiveStatus,
  pregnancyWeeks?: number | null,
): number {
  // Growth-phase guard: puppies and kittens (< 12 months) must never be
  // calorie-restricted. If a caller passes goal='lose', we silently fall
  // through to maintenance math. The UI should also surface a banner via
  // `shouldBlockGrowthWeightLoss` so the owner understands why.
  if (shouldBlockGrowthWeightLoss(ageMonths, goal)) {
    goal = 'maintain';
  }

  // Pregnancy and lactation override every other calculation. NRC + WSAVA:
  //   - Pregnant: energy needs sit at maintenance through week 5, then ramp
  //     to ~1.5-1.8x maintenance for dogs and ~1.4-1.6x maintenance for cats
  //     across weeks 6-9. The multiplier is applied over MAINTENANCE MER,
  //     never over RER — pregnancy is an increase over normal feeding, not
  //     over basal metabolism.
  //   - Lactating: 2-3x maintenance baseline, ramping with litter size.
  // We surface a "please confirm with your vet" banner in the UI. Better to
  // slightly overshoot a healthy mom than to underfeed and risk litter failure.
  if (reproductiveStatus === 'pregnant' || reproductiveStatus === 'nursing') {
    const rer = calculateRER(weightKg);
    if (reproductiveStatus === 'pregnant') {
      // Pregnant queens/bitches are by definition intact. Maintenance factor
      // uses false for isNeutered; life-stage multiplier still applies so a
      // late-life pregnancy nets the modest senior reduction.
      const maintenanceFactor = getMERFactor(
        species, false, activityLevel, 'maintain', ageMonths, lifeStageMultiplier, metabolicModifier,
      );
      return Math.round(rer * maintenanceFactor * pregnancyMultiplier(species, pregnancyWeeks));
    }
    // Nursing: 3× RER is NRC's simplified average-litter multiplier. Litter-size
    // ramp is out of scope; the UI banner tells the owner to consult a vet.
    return Math.round(rer * 3.0);
  }

  // For weight loss, RER must be computed from target weight. Using current
  // weight inflates the daily target by the pet's excess mass and prevents
  // weight loss from happening.
  if (goal === 'lose' && targetWeightKg && targetWeightKg > 0) {
    const rer = calculateRER(targetWeightKg);
    const factor = species === 'cat' ? 0.8 : 1.0;
    let result = rer * factor * lifeStageMultiplier * metabolicModifier;

    // Cat weight-loss ramp. Cats are uniquely vulnerable to hepatic lipidosis
    // when they stop eating — a 48–72h fast during a stressful diet change can
    // be fatal. AAHA + WSAVA recommend a gradual transition. For the first 14
    // days on a new weight-loss plan, we floor the target at 95% of estimated
    // maintenance(current) so the cut isn't a step function on day 1.
    if (
      species === 'cat' &&
      typeof daysSincePlanStart === 'number' &&
      Number.isFinite(daysSincePlanStart) &&
      daysSincePlanStart >= 0 &&
      daysSincePlanStart < 14
    ) {
      const maintenanceFactor = getMERFactor(
        species, isNeutered, activityLevel, 'maintain', ageMonths, lifeStageMultiplier, metabolicModifier,
      );
      const rampFloor = calculateRER(weightKg) * maintenanceFactor * 0.95;
      result = Math.max(result, rampFloor);
    }

    // Safety floor: if the owner's BCS says the pet isn't actually overweight
    // (≤ 5/9) but a caller still forced lose mode, never prescribe below the
    // dog's/cat's RER at its CURRENT weight. Prevents the failure mode where
    // a breed chart trumps the BCS signal and starves a healthy-shaped pet.
    if (bcs != null && bcs <= 5) {
      result = Math.max(result, calculateRER(weightKg));
    }

    // AAHA absolute-minimum floor for all weight-loss plans: never below
    // RER(target). Multiplier stacking (senior × thrifty-breed) can otherwise
    // push a Labrador down to ~0.76 × RER, which is muscle-wasting territory.
    // Stacks with the BCS≤5 floor above; whichever is tighter wins.
    result = Math.max(result, calculateRER(targetWeightKg));

    return Math.round(result);
  }

  const rer = calculateRER(weightKg);
  const factor = getMERFactor(species, isNeutered, activityLevel, goal, ageMonths, lifeStageMultiplier, metabolicModifier);
  return Math.round(rer * factor);
}

/**
 * Adjusts the static daily calorie target based on today's activity and weight trends.
 * The base target (from onboarding/weight-log) is nudged ±5-10% to make each day feel
 * personalized rather than robotic.
 *
 * `weeklyDelta` is the rolling 7-day calorie balance (consumed − target × 7). When
 * non-trivial, it applies a soft correction stacked on top of the trend adjustment,
 * with the combined multiplier capped at ±10%. Vets advise against aggressive
 * day-to-day correction, so we never exceed that cap.
 *
 * Returns the adjusted target and a human-readable reason string (null if no adjustment).
 */
export function adjustDailyTarget(
  baseTarget: number,
  todayActivityMinutes: number,
  weightTrendDirection: 'up' | 'down' | 'stable' | null,
  goal: 'lose' | 'maintain' | 'gain',
  weeklyDelta: number | null = null,
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

  // Rolling 7-day balance correction. Threshold = ~half a day's target (avoids
  // chasing daily noise). Each ~3.5x-baseTarget surplus/deficit shifts ~3%.
  if (weeklyDelta !== null && Math.abs(weeklyDelta) >= baseTarget * 0.5) {
    const weeklyShift = -Math.max(-0.07, Math.min(0.07, weeklyDelta / (baseTarget * 33))); // surplus → negative shift
    multiplier += weeklyShift;
    const shiftKcal = Math.round(baseTarget * weeklyShift);
    if (shiftKcal !== 0) {
      const direction = weeklyDelta > 0 ? 'over' : 'under';
      reason = reason
        ? `${reason}; week ${direction} by ${Math.abs(Math.round(weeklyDelta))} kcal`
        : `Week ${direction} by ${Math.abs(Math.round(weeklyDelta))} kcal: ${shiftKcal > 0 ? '+' : ''}${shiftKcal} kcal`;
    }
  }

  // Hard cap at ±10% — never let cumulative adjustments push a single day too far.
  multiplier = Math.max(0.9, Math.min(1.1, multiplier));

  return {
    adjustedTarget: Math.round(baseTarget * multiplier),
    reason,
  };
}

/**
 * Derive a goal (lose/maintain/gain) by comparing current weight to target weight.
 *
 * BCS outranks the slider — but only inside a plausibility window around the
 * current weight. Small target movements near current weight are slider
 * nudges, and the owner's BCS is the better signal there:
 *   - BCS = 5  → 'maintain' for nudges within ±max(threshold, 5% of current).
 *     The window is deliberately tight: staged recovery/loss targets from the
 *     estimator sit ±12% away and MUST derive as gain/lose (an 8 kg adult
 *     Labrador scored "just right" still needs its recovery plan to feed).
 *   - BCS ≥ 6 → never 'gain' from a drag within ±20% of current.
 *   - BCS ≤ 4 → never 'lose' from a drag within ±20% of current.
 *
 * Beyond the window the target's direction wins — large gaps come from the
 * band-reconciled estimator or a deliberate owner decision, and the owner's
 * BCS is unreliable exactly when it contradicts the scale. The kcal safety
 * floors (never below RER) still bound whatever goal comes out of here.
 *
 * Without BCS, falls back to a symmetric threshold so trivial slider movements
 * don't change the goal.
 */
export function deriveGoal(
  currentWeightKg: number,
  targetWeightKg: number | null | undefined,
  bcs?: number | null,
  threshold: number = 0.5,
): 'lose' | 'maintain' | 'gain' {
  if (bcs != null) {
    const t = typeof targetWeightKg === 'number' ? targetWeightKg : currentWeightKg;
    const gap = Math.abs(t - currentWeightKg);
    if (bcs === 5) {
      if (gap <= Math.max(threshold, currentWeightKg * 0.05)) return 'maintain';
      // Larger gap → fall through; the target direction wins.
    } else if (gap <= currentWeightKg * 0.2) {
      if (bcs >= 6) {
        // Overweight: only 'lose' or 'maintain' inside the window.
        return t < currentWeightKg - threshold ? 'lose' : 'maintain';
      }
      if (bcs <= 4) {
        // Underweight: only 'gain' or 'maintain' inside the window.
        return t > currentWeightKg + threshold ? 'gain' : 'maintain';
      }
    }
    // Outside the window: fall through — the target direction wins.
  }
  if (!targetWeightKg) return 'maintain';
  const diff = targetWeightKg - currentWeightKg;
  if (diff < -threshold) return 'lose';   // target below current = lose
  if (diff > threshold) return 'gain';    // target above current = gain
  return 'maintain';
}
