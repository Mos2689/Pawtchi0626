import { deriveKcalReceipt, KcalReceiptInput } from './kcalReceipt';
import { calculateDailyKcal } from './healthMath';

// Parity contract: the receipt's independently-computed total must equal
// calculateDailyKcal for the same inputs (daysSincePlanStart = 0, matching how
// goal.tsx computes the stored plan). If these drift, the reveal screen would
// show math that contradicts the headline number.
function expectParity(input: KcalReceiptInput) {
  const receipt = deriveKcalReceipt(input)!;
  expect(receipt).not.toBeNull();
  const expected = calculateDailyKcal(
    input.weightKg,
    input.species,
    input.isNeutered,
    input.activityLevel,
    input.goal,
    input.ageMonths,
    input.lifeStageMultiplier ?? 1.0,
    input.targetWeightKg,
    input.metabolicModifier ?? 1.0,
    input.bcs,
    0,
    input.reproductiveStatus,
    input.pregnancyWeeks,
  );
  expect(receipt.totalKcal).toBe(expected);
  // The last row's running value is the total — rows tell the whole story.
  expect(receipt.rows[receipt.rows.length - 1].runningKcal).toBe(receipt.totalKcal);
  return receipt;
}

describe('deriveKcalReceipt — parity with calculateDailyKcal', () => {
  test('neutered adult dog, maintenance → base + core + safety-passed', () => {
    const r = expectParity({
      species: 'dog', weightKg: 30, isNeutered: true, activityLevel: 'normal',
      goal: 'maintain', ageMonths: 60,
    });
    expect(r.rows.map((row) => row.id)).toEqual(['base', 'core', 'safety']);
    expect(r.rows[1].effect).toBe('× 1.6');
    expect(r.rows[2].effect).toBe('✓');
  });

  test('mature thrifty breed, maintenance → breed and life-stage rows appear', () => {
    const r = expectParity({
      species: 'dog', weightKg: 32, isNeutered: true, activityLevel: 'normal',
      goal: 'maintain', ageMonths: 84, lifeStageMultiplier: 0.94,
      metabolicModifier: 0.95, breedName: 'German Shepherd', lifeStageLabel: 'Mature Adult',
    });
    expect(r.rows.map((row) => row.id)).toEqual(['base', 'core', 'breed', 'life-stage', 'safety']);
    expect(r.rows[2].title).toBe('German Shepherd metabolism');
    expect(r.rows[2].effect).toBe('− 5%');
    expect(r.rows[3].title).toBe('Mature Adult life stage');
  });

  test('senior thrifty dog, weight loss → AAHA floor binds and shows as a safety row', () => {
    // RER(34) × 0.85 × 0.9 = 0.765 × RER(34) → floored back up to RER(34).
    const r = expectParity({
      species: 'dog', weightKg: 40, targetWeightKg: 34, isNeutered: true,
      activityLevel: 'normal', goal: 'lose', ageMonths: 108,
      lifeStageMultiplier: 0.85, metabolicModifier: 0.9, bcs: 7,
    });
    const ids = r.rows.map((row) => row.id);
    expect(ids).toContain('aaha-floor');
    expect(ids).not.toContain('safety'); // binding floor replaces the passed row
    expect(r.rows[0].title).toContain('goal weight 34.0 kg');
  });

  test('cat weight loss on day 0 → gentle-start ramp floor binds', () => {
    const r = expectParity({
      species: 'cat', weightKg: 6, targetWeightKg: 5.2, isNeutered: true,
      activityLevel: 'sedentary', goal: 'lose', ageMonths: 48, bcs: 8,
    });
    const ids = r.rows.map((row) => row.id);
    expect(ids).toContain('cat-loss');
    expect(ids).toContain('cat-ramp');
  });

  test('underweight-scored pet forced into lose → body-shape floor binds', () => {
    const r = expectParity({
      species: 'dog', weightKg: 20, targetWeightKg: 17, isNeutered: true,
      activityLevel: 'normal', goal: 'lose', ageMonths: 48, bcs: 4,
    });
    expect(r.rows.map((row) => row.id)).toContain('bcs-floor');
  });

  test('5-month puppy → growth allowance row, modifiers correctly skipped', () => {
    const r = expectParity({
      species: 'dog', weightKg: 8, isNeutered: false, activityLevel: 'normal',
      goal: 'maintain', ageMonths: 5,
      // These must be IGNORED — getMERFactor early-returns for growth phases.
      lifeStageMultiplier: 0.9, metabolicModifier: 0.9,
    });
    expect(r.rows.map((row) => row.id)).toEqual(['base', 'growth', 'safety']);
    expect(r.rows[1].effect).toBe('× 2');
  });

  test('puppy with goal=lose → growth guard converts to maintenance (no loss rows)', () => {
    const r = expectParity({
      species: 'dog', weightKg: 8, targetWeightKg: 7, isNeutered: false,
      activityLevel: 'normal', goal: 'lose', ageMonths: 6,
    });
    expect(r.rows.map((row) => row.id)).toEqual(['base', 'growth', 'safety']);
  });

  test('pregnant dog, week 8 → maintenance + pregnancy ramp rows', () => {
    const r = expectParity({
      species: 'dog', weightKg: 25, isNeutered: false, activityLevel: 'normal',
      goal: 'maintain', ageMonths: 48, reproductiveStatus: 'pregnant', pregnancyWeeks: 8,
    });
    expect(r.rows.map((row) => row.id)).toEqual(['base', 'maintenance', 'pregnancy']);
    expect(r.rows[2].title).toBe('Pregnancy · week 8');
  });

  test('nursing cat → 3× RER row', () => {
    const r = expectParity({
      species: 'cat', weightKg: 4, isNeutered: false, activityLevel: 'normal',
      goal: 'maintain', ageMonths: 36, reproductiveStatus: 'nursing',
    });
    expect(r.rows.map((row) => row.id)).toEqual(['base', 'nursing']);
    expect(r.rows[1].effect).toBe('× 3');
  });

  test('degenerate weight → null (screen hides the receipt)', () => {
    expect(deriveKcalReceipt({
      species: 'dog', weightKg: 0, isNeutered: true, activityLevel: 'normal', goal: 'maintain',
    })).toBeNull();
    expect(deriveKcalReceipt({
      species: 'dog', weightKg: NaN, isNeutered: true, activityLevel: 'normal', goal: 'maintain',
    })).toBeNull();
  });

  test('fuzz: parity holds across a grid of realistic inputs', () => {
    const weights = [2.5, 4, 8, 15, 24.5, 40, 62];
    const activities: KcalReceiptInput['activityLevel'][] = ['sedentary', 'normal', 'active', 'highly_active'];
    const goals: KcalReceiptInput['goal'][] = ['lose', 'maintain', 'gain'];
    for (const species of ['dog', 'cat'] as const) {
      for (const weightKg of weights) {
        for (const activityLevel of activities) {
          for (const goal of goals) {
            for (const lifeStageMultiplier of [1.0, 0.94, 0.85]) {
              expectParity({
                species, weightKg, activityLevel, goal, lifeStageMultiplier,
                isNeutered: weightKg > 8,
                targetWeightKg: goal === 'lose' ? weightKg * 0.88 : null,
                ageMonths: 60,
                metabolicModifier: weightKg > 20 ? 0.95 : 1.0,
                bcs: goal === 'lose' ? 7 : 5,
              });
            }
          }
        }
      }
    }
  });
});
