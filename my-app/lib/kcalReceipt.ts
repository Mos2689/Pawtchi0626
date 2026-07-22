// The kcal receipt — the daily-calorie math, itemized for humans.
//
// `calculateDailyKcal` is a chain of named, defensible factors (WSAVA resting
// energy, neuter/activity maintenance, breed metabolism, life stage, AAHA
// safety floors). This module re-walks that chain and returns it as labeled
// rows so the reveal screen can SHOW the reasoning instead of printing a bare
// number. Pure and deterministic — no fetches, no state.
//
// Parity contract: `totalKcal` is computed here independently and must equal
// `calculateDailyKcal` for the same inputs (locked by kcalReceipt.test.ts).
// The UI additionally guards against drift at runtime: if the receipt total
// doesn't match the stored plan kcal, the receipt is hidden — we never show
// math that contradicts the headline.

import {
  calculateRER,
  getMERFactor,
  pregnancyMultiplier,
  shouldBlockGrowthWeightLoss,
  Species,
  ActivityLevel,
  ReproductiveStatus,
} from './healthMath';

export interface KcalReceiptInput {
  species: Species;
  weightKg: number;
  targetWeightKg?: number | null;
  isNeutered: boolean;
  activityLevel: ActivityLevel;
  goal: 'lose' | 'maintain' | 'gain';
  ageMonths?: number;
  lifeStageMultiplier?: number;
  /** Owner-facing life-stage label, e.g. "Mature Adult" — used for row copy. */
  lifeStageLabel?: string | null;
  metabolicModifier?: number;
  /** Real breed name for the metabolism row; null/mixed hides it. */
  breedName?: string | null;
  bcs?: number | null;
  reproductiveStatus?: ReproductiveStatus;
  pregnancyWeeks?: number | null;
}

export interface KcalReceiptRow {
  id: string;
  /** MaterialIcons name. */
  icon: string;
  title: string;
  subtitle: string;
  /** Right-aligned effect: "771", "× 1.6", "− 6%", "✓", "= 255". */
  effect: string;
  /** One-sentence expandable explanation. */
  detail: string;
  kind: 'base' | 'factor' | 'safety';
  /** Rounded kcal after this row is applied. */
  runningKcal: number;
}

export interface KcalReceipt {
  rows: KcalReceiptRow[];
  totalKcal: number;
}

const ACTIVITY_WORD: Record<ActivityLevel, string> = {
  sedentary: 'low-key days',
  normal: 'steady mover',
  active: 'active routine',
  highly_active: 'working-level active',
};

const BASE_DETAIL =
  'Resting energy = 70 × weight^0.75 — the veterinary-standard equation. Everything else adjusts this baseline.';
const CORE_DETAIL =
  'Maintenance energy scales resting need by daily routine. Spay/neuter lowers energy burn; activity raises it (WSAVA feeding-guide factors).';
const BREED_DETAIL =
  'Some breeds genuinely burn more or fewer calories at the same size — this is tuned from breed references, not guessed.';
const LIFE_DETAIL =
  'Energy needs shift with age — growing pets need much more, mature and senior pets a little less.';
const SAFETY_DETAIL =
  'Every plan is floored at resting energy need (AAHA guideline). Pawtchi never prescribes below basal metabolism, no matter what the factors say.';

/** Mirrors getMERFactor's growth-phase early returns (which skip all modifiers). */
function growthFactor(species: Species, ageMonths: number | undefined): number | null {
  if (ageMonths === undefined || !Number.isFinite(ageMonths)) return null;
  if (species === 'dog') {
    if (ageMonths < 2) return 3.0;
    if (ageMonths < 4) return 2.5;
    if (ageMonths < 8) return 2.0;
    if (ageMonths < 12) return 1.5;
    return null;
  }
  if (ageMonths < 4) return 2.5;
  if (ageMonths < 8) return 2.0;
  if (ageMonths < 12) return 1.5;
  return null;
}

function fmtX(f: number): string {
  return `× ${Math.round(f * 100) / 100}`;
}

function fmtPct(mult: number): string {
  const pct = Math.round((mult - 1) * 100);
  return pct >= 0 ? `+ ${pct}%` : `− ${Math.abs(pct)}%`;
}

function baseRow(kg: number, running: number, forGoalWeight: boolean): KcalReceiptRow {
  return {
    id: 'base',
    icon: 'monitor-weight',
    title: forGoalWeight ? `Basal need at goal weight ${kg.toFixed(1)} kg` : `Basal need at ${kg.toFixed(1)} kg`,
    subtitle: forGoalWeight
      ? 'loss plans feed the goal body, not the extra weight'
      : 'the energy it takes just to rest',
    effect: `${Math.round(running)}`,
    detail: forGoalWeight
      ? 'Feeding the goal body is how safe weight change works — the excess weight doesn’t get a food budget. Resting energy = 70 × goal weight^0.75.'
      : BASE_DETAIL,
    kind: 'base',
    runningKcal: Math.round(running),
  };
}

function passedSafetyRow(running: number): KcalReceiptRow {
  return {
    id: 'safety',
    icon: 'health-and-safety',
    title: 'Safety check',
    subtitle: 'never below basal need',
    effect: '✓',
    detail: SAFETY_DETAIL,
    kind: 'safety',
    runningKcal: Math.round(running),
  };
}

export function deriveKcalReceipt(input: KcalReceiptInput): KcalReceipt | null {
  const {
    species, weightKg, targetWeightKg, isNeutered, activityLevel,
    ageMonths, lifeStageLabel, breedName, bcs, reproductiveStatus, pregnancyWeeks,
  } = input;
  const lifeStageMultiplier = input.lifeStageMultiplier ?? 1.0;
  const metabolicModifier = input.metabolicModifier ?? 1.0;

  if (!Number.isFinite(weightKg) || weightKg <= 0) return null;

  // Growth guard mirrors calculateDailyKcal: growing pets are never restricted.
  let goal = input.goal;
  if (shouldBlockGrowthWeightLoss(ageMonths, goal)) goal = 'maintain';

  const rows: KcalReceiptRow[] = [];

  // ── Pregnancy / nursing override every other calculation. ──
  if (reproductiveStatus === 'nursing') {
    const rer = calculateRER(weightKg);
    const running = rer * 3.0;
    rows.push(baseRow(weightKg, rer, false));
    rows.push({
      id: 'nursing',
      icon: 'favorite',
      title: 'Nursing mother',
      subtitle: 'milk production is enormous work',
      effect: fmtX(3.0),
      detail: 'NRC average-litter multiplier: nursing takes roughly three times resting energy. Confirm details with your vet — litter size matters.',
      kind: 'factor',
      runningKcal: Math.round(running),
    });
    const totalKcal = Math.round(running);
    rows[rows.length - 1].runningKcal = totalKcal;
    return { rows, totalKcal };
  }

  if (reproductiveStatus === 'pregnant') {
    const rer = calculateRER(weightKg);
    const maintenanceFactor = getMERFactor(
      species, false, activityLevel, 'maintain', ageMonths, lifeStageMultiplier, metabolicModifier,
    );
    const mult = pregnancyMultiplier(species, pregnancyWeeks);
    rows.push(baseRow(weightKg, rer, false));
    rows.push({
      id: 'maintenance',
      icon: 'directions-walk',
      title: 'Maintenance for her routine',
      subtitle: 'daily energy before the pregnancy ramp',
      effect: fmtX(maintenanceFactor),
      detail: CORE_DETAIL,
      kind: 'factor',
      runningKcal: Math.round(rer * maintenanceFactor),
    });
    const running = rer * maintenanceFactor * mult;
    rows.push({
      id: 'pregnancy',
      icon: 'favorite',
      title: pregnancyWeeks != null ? `Pregnancy · week ${pregnancyWeeks}` : 'Pregnancy · mid-gestation',
      subtitle: 'energy ramps through late gestation',
      effect: fmtX(mult),
      detail: 'Needs sit at maintenance through week 5, then ramp in the final third (NRC/WSAVA). Please confirm feeding with your vet — pregnancy nutrition is individual.',
      kind: 'factor',
      runningKcal: Math.round(running),
    });
    const totalKcal = Math.round(running);
    rows[rows.length - 1].runningKcal = totalKcal;
    return { rows, totalKcal };
  }

  // ── Weight-loss path: basal need is computed from the GOAL body. ──
  if (goal === 'lose' && targetWeightKg && targetWeightKg > 0) {
    const rerTarget = calculateRER(targetWeightKg);
    rows.push(baseRow(targetWeightKg, rerTarget, true));

    // Mirrors calculateDailyKcal's expression order exactly:
    // rer × catFactor × lifeStageMultiplier × metabolicModifier.
    let running = rerTarget;
    if (species === 'cat') {
      running *= 0.8;
      rows.push({
        id: 'cat-loss',
        icon: 'directions-walk',
        title: 'Gentle deficit for cats',
        subtitle: 'cats lose weight slowly, on purpose',
        effect: fmtX(0.8),
        detail: 'Cats must never crash-diet — rapid cuts risk hepatic lipidosis. The deficit is deliberately mild.',
        kind: 'factor',
        runningKcal: Math.round(running),
      });
    }
    if (lifeStageMultiplier !== 1.0) {
      running *= lifeStageMultiplier;
      rows.push({
        id: 'life-stage',
        icon: 'schedule',
        title: lifeStageLabel ? `${lifeStageLabel} life stage` : 'Life stage',
        subtitle: lifeStageMultiplier < 1 ? 'energy needs ease down at this age' : 'extra energy for this stage',
        effect: fmtPct(lifeStageMultiplier),
        detail: LIFE_DETAIL,
        kind: 'factor',
        runningKcal: Math.round(running),
      });
    }
    if (metabolicModifier !== 1.0) {
      running *= metabolicModifier;
      rows.push({
        id: 'breed',
        icon: 'pets',
        title: breedName ? `${breedName} metabolism` : 'Breed metabolism',
        subtitle: metabolicModifier < 1 ? 'a thrifty breed — burns a little less' : 'runs a little hotter than average',
        effect: fmtPct(metabolicModifier),
        detail: BREED_DETAIL,
        kind: 'factor',
        runningKcal: Math.round(running),
      });
    }

    // Floors, in calculateDailyKcal's order. Day 0 of the plan
    // (daysSincePlanStart = 0), matching how goal.tsx computes the number.
    let flooredByRamp = false;
    if (species === 'cat') {
      const maintenanceFactor = getMERFactor(
        species, isNeutered, activityLevel, 'maintain', ageMonths, lifeStageMultiplier, metabolicModifier,
      );
      const rampFloor = calculateRER(weightKg) * maintenanceFactor * 0.95;
      if (rampFloor > running) {
        running = rampFloor;
        flooredByRamp = true;
        rows.push({
          id: 'cat-ramp',
          icon: 'health-and-safety',
          title: 'Gentle-start ramp',
          subtitle: 'first 14 days ease in from maintenance',
          effect: `= ${Math.round(running)}`,
          detail: 'Cats who cut calories too fast risk hepatic lipidosis. For the first two weeks the plan stays within 5% of maintenance, then steps down.',
          kind: 'safety',
          runningKcal: Math.round(running),
        });
      }
    }
    let flooredByBcs = false;
    if (bcs != null && bcs <= 5) {
      const bcsFloor = calculateRER(weightKg);
      if (bcsFloor > running) {
        running = bcsFloor;
        flooredByBcs = true;
        rows.push({
          id: 'bcs-floor',
          icon: 'health-and-safety',
          title: 'Body-shape floor',
          subtitle: 'their shape says no deep deficit',
          effect: `= ${Math.round(running)}`,
          detail: 'The body-condition score says this pet isn’t carrying excess fat, so the plan never drops below resting need at the current weight.',
          kind: 'safety',
          runningKcal: Math.round(running),
        });
      }
    }
    let flooredByRer = false;
    if (rerTarget > running) {
      running = rerTarget;
      flooredByRer = true;
      rows.push({
        id: 'aaha-floor',
        icon: 'health-and-safety',
        title: 'Safety floor',
        subtitle: 'raised back to basal need',
        effect: `= ${Math.round(running)}`,
        detail: SAFETY_DETAIL,
        kind: 'safety',
        runningKcal: Math.round(running),
      });
    }
    if (!flooredByRamp && !flooredByBcs && !flooredByRer) {
      rows.push(passedSafetyRow(running));
    }

    const totalKcal = Math.round(running);
    rows[rows.length - 1].runningKcal = totalKcal;
    return { rows, totalKcal };
  }

  // ── Maintenance / gain (including growth phases). ──
  const rer = calculateRER(weightKg);
  const growth = growthFactor(species, ageMonths);

  if (growth != null) {
    const running = rer * growth;
    rows.push(baseRow(weightKg, rer, false));
    rows.push({
      id: 'growth',
      icon: 'child-care',
      title: species === 'cat' ? 'Growing kitten' : 'Growing puppy',
      subtitle: 'full growth-energy allowance',
      effect: fmtX(growth),
      detail: 'Growing pets need 1.5–3× resting energy depending on age. Pawtchi never restricts calories before 12 months — growth comes first.',
      kind: 'factor',
      runningKcal: Math.round(running),
    });
    rows.push(passedSafetyRow(running));
    const totalKcal = Math.round(running);
    rows[rows.length - 1].runningKcal = totalKcal;
    return { rows, totalKcal };
  }

  // Decomposition of getMERFactor: core (neuter/activity/goal) × breed × life
  // stage — the same order the factor multiplies internally.
  const coreFactor = getMERFactor(species, isNeutered, activityLevel, goal, ageMonths, 1.0, 1.0);
  let running = rer * coreFactor;
  rows.push(baseRow(weightKg, rer, false));
  rows.push({
    id: 'core',
    icon: 'directions-walk',
    title: `${isNeutered ? 'Neutered' : 'Intact'} · ${ACTIVITY_WORD[activityLevel]}`,
    subtitle: goal === 'gain' ? 'includes a healthy-gain boost' : 'maintenance factor for the daily routine',
    effect: fmtX(coreFactor),
    detail: CORE_DETAIL,
    kind: 'factor',
    runningKcal: Math.round(running),
  });
  if (metabolicModifier !== 1.0) {
    running *= metabolicModifier;
    rows.push({
      id: 'breed',
      icon: 'pets',
      title: breedName ? `${breedName} metabolism` : 'Breed metabolism',
      subtitle: metabolicModifier < 1 ? 'a thrifty breed — burns a little less' : 'runs a little hotter than average',
      effect: fmtPct(metabolicModifier),
      detail: BREED_DETAIL,
      kind: 'factor',
      runningKcal: Math.round(running),
    });
  }
  if (lifeStageMultiplier !== 1.0) {
    running *= lifeStageMultiplier;
    rows.push({
      id: 'life-stage',
      icon: 'schedule',
      title: lifeStageLabel ? `${lifeStageLabel} life stage` : 'Life stage',
      subtitle: lifeStageMultiplier < 1 ? 'energy needs ease down at this age' : 'extra energy for this stage',
      effect: fmtPct(lifeStageMultiplier),
      detail: LIFE_DETAIL,
      kind: 'factor',
      runningKcal: Math.round(running),
    });
  }
  rows.push(passedSafetyRow(running));

  const totalKcal = Math.round(running);
  rows[rows.length - 1].runningKcal = totalKcal;
  return { rows, totalKcal };
}
