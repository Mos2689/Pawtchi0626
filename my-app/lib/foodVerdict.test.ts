import {
  analyzeFood,
  pickLifeStageProfile,
  resolveActiveAdjustments,
  type FoodVerdictInput,
} from './foodVerdict';

const healthyAdultDog: FoodVerdictInput['pet'] = {
  name: 'Bernard',
  species: 'dog',
  weight_kg: 25,
  target_weight_kg: 25,
  age_months: 36,
  activity_level: 'normal',
  is_neutered: true,
  goal: 'maintain',
};

const balancedKibble: FoodVerdictInput['food'] = {
  product_name: 'Test Kibble',
  food_type: 'kibble',
  kcal_per_100g_as_fed: 366,
  moisture_pct: 10,
  protein_pct: 26,
  fat_pct: 14,
  fiber_pct: 3,
  calcium_pct: 1.2,
  phosphorus_pct: 1.0,
};

describe('pickLifeStageProfile', () => {
  test('age_months < 12 → growth_and_reproduction', () => {
    expect(pickLifeStageProfile({ age_months: 6 })).toBe('growth_and_reproduction');
  });
  test('adult → adult_maintenance', () => {
    expect(pickLifeStageProfile({ age_months: 36 })).toBe('adult_maintenance');
  });
  test('null age defaults to adult', () => {
    expect(pickLifeStageProfile({ age_months: null })).toBe('adult_maintenance');
  });
});

describe('resolveActiveAdjustments', () => {
  test('weight-loss goal auto-applies obesity', () => {
    const out = resolveActiveAdjustments({ goal: 'lose' });
    expect(out).toContain('obesity');
  });

  test('confirmed pancreatitis_history is included', () => {
    const out = resolveActiveAdjustments({
      goal: 'maintain',
      confirmed_condition_keys: ['pancreatitis_history'],
    });
    expect(out).toContain('pancreatitis_history');
  });

  test('unknown / deferred condition keys are dropped', () => {
    const out = resolveActiveAdjustments({
      goal: 'maintain',
      confirmed_condition_keys: ['ckd_stage_2', 'made_up_condition'],
    });
    expect(out).not.toContain('ckd_stage_2');
    expect(out).not.toContain('made_up_condition');
  });
});

describe('analyzeFood — scenario 1: healthy adult dog, balanced kibble', () => {
  test('all checked nutrients meet baseline, no active adjustments', () => {
    const result = analyzeFood({
      food: balancedKibble,
      pet: healthyAdultDog,
      meal_grams: 100,
    });
    expect(result.active_clinical_adjustments).toEqual([]);
    expect(result.life_stage_evaluated).toBe('adult_maintenance');
    expect(result.summary.nutrients_below).toBe(0);
    expect(result.summary.nutrients_above).toBe(0);
    // Protein, fat, calcium, phosphorus should all meet baseline
    const meeting = result.nutrients.filter(n => n.status === 'meets_baseline');
    expect(meeting.length).toBeGreaterThanOrEqual(4);
  });

  test('Ca:P ratio is in range', () => {
    const result = analyzeFood({
      food: balancedKibble,
      pet: healthyAdultDog,
      meal_grams: 100,
    });
    expect(result.ca_phosphorus_ratio_status).toBe('in_range');
    expect(result.ca_phosphorus_ratio).toBeCloseTo(1.2, 2);
  });
});

describe('analyzeFood — scenario 2: pancreatitis dog, high-fat food', () => {
  test('fat is above_adjusted with pancreatitis rationale', () => {
    const fattyFood = { ...balancedKibble, fat_pct: 18 };
    const pancreasDog: FoodVerdictInput['pet'] = {
      ...healthyAdultDog,
      confirmed_condition_keys: ['pancreatitis_history'],
    };
    const result = analyzeFood({
      food: fattyFood,
      pet: pancreasDog,
      meal_grams: 100,
    });

    expect(result.active_clinical_adjustments).toContain('pancreatitis_history');
    const fat = result.nutrients.find(n => n.nutrient === 'crude_fat')!;
    expect(fat.adjustment_rationale).toBeTruthy();
    expect(fat.adjusted_target_max).toBe(30);
    expect(fat.status).toBe('above_adjusted');
  });

  test('without confirmed condition, same fat level meets baseline', () => {
    const fattyFood = { ...balancedKibble, fat_pct: 18 };
    const result = analyzeFood({
      food: fattyFood,
      pet: healthyAdultDog,
      meal_grams: 100,
    });
    const fat = result.nutrients.find(n => n.nutrient === 'crude_fat')!;
    expect(fat.status).toBe('meets_baseline');
  });
});

describe('analyzeFood — scenario 3: wet food DMB conversion', () => {
  test('wet food at 8%/78% moisture has higher DMB protein than label suggests', () => {
    const wetFood: FoodVerdictInput['food'] = {
      product_name: 'Test Wet Food',
      food_type: 'wet_food',
      kcal_per_100g_as_fed: 100,
      moisture_pct: 78,
      protein_pct: 8,
      fat_pct: 5,
      fiber_pct: 1,
      calcium_pct: 0.3,
      phosphorus_pct: 0.25,
    };

    const result = analyzeFood({
      food: wetFood,
      pet: healthyAdultDog,
      meal_grams: 200,
    });

    const protein = result.nutrients.find(n => n.nutrient === 'crude_protein')!;
    expect(protein.as_fed_pct).toBe(8);
    // DMB should be ~36% — far higher than the label-stated 8%
    expect(protein.dry_matter_pct).toBeGreaterThan(35);
    expect(protein.dry_matter_pct).toBeLessThan(38);
  });
});

describe('analyzeFood — scenario 4: missing moisture is estimated, note appears', () => {
  test('moisture estimated when label is silent, note surfaced', () => {
    const labelMissingMoisture: FoodVerdictInput['food'] = {
      ...balancedKibble,
      moisture_pct: null,
    };
    const result = analyzeFood({
      food: labelMissingMoisture,
      pet: healthyAdultDog,
      meal_grams: 100,
    });

    expect(result.moisture_was_estimated).toBe(true);
    expect(result.moisture_pct_used).toBe(10); // kibble default
    expect(result.notes.some(n => n.toLowerCase().includes('moisture'))).toBe(true);
  });

  test('missing protein_pct → unknown verdict for that nutrient', () => {
    const labelMissingProtein: FoodVerdictInput['food'] = {
      ...balancedKibble,
      protein_pct: null,
    };
    const result = analyzeFood({
      food: labelMissingProtein,
      pet: healthyAdultDog,
      meal_grams: 100,
    });

    const protein = result.nutrients.find(n => n.nutrient === 'crude_protein')!;
    expect(protein.status).toBe('unknown');
    expect(result.summary.nutrients_unknown).toBeGreaterThan(0);
  });
});

describe('analyzeFood — scenario 5: obesity auto-adjustment via weight-loss goal', () => {
  test('weight-loss goal tightens fat to 25 g/1000 kcal', () => {
    const overweightDog: FoodVerdictInput['pet'] = {
      ...healthyAdultDog,
      weight_kg: 32,
      target_weight_kg: 25,
      goal: 'lose',
    };
    const result = analyzeFood({
      food: balancedKibble,
      pet: overweightDog,
      meal_grams: 100,
    });

    expect(result.active_clinical_adjustments).toContain('obesity');
    const fat = result.nutrients.find(n => n.nutrient === 'crude_fat')!;
    expect(fat.adjusted_target_max).toBe(25);
    expect(fat.adjustment_rationale).toBeTruthy();
  });

  test('daily_kcal_target uses target weight (regression of weight-loss MER fix)', () => {
    const overweightDog: FoodVerdictInput['pet'] = {
      ...healthyAdultDog,
      weight_kg: 32,
      target_weight_kg: 25,
      goal: 'lose',
    };
    const result = analyzeFood({
      food: balancedKibble,
      pet: overweightDog,
      meal_grams: 100,
    });
    // RER(25) ≈ 783, RER(32) ≈ 953. Target should reflect 25kg path.
    expect(result.daily_kcal_target).toBeLessThan(900);
  });
});

describe('analyzeFood — meal kcal math', () => {
  test('100g of 366 kcal/100g food → 366 kcal meal', () => {
    const result = analyzeFood({
      food: balancedKibble,
      pet: healthyAdultDog,
      meal_grams: 100,
    });
    expect(result.meal_kcal).toBeCloseTo(366, 1);
  });

  test('meal_pct_of_daily computed correctly', () => {
    const result = analyzeFood({
      food: balancedKibble,
      pet: healthyAdultDog,
      meal_grams: 100,
    });
    expect(result.meal_pct_of_daily).not.toBeNull();
    expect(result.meal_pct_of_daily!).toBeGreaterThan(0);
    expect(result.meal_pct_of_daily!).toBeLessThan(100);
  });
});
