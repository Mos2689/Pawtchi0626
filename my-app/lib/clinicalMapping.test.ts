import { mapMedicalConditionsToAdjustmentKeys, hasMappedCondition } from './clinicalMapping';

describe('mapMedicalConditionsToAdjustmentKeys', () => {
  test('matches pancreatitis variants to pancreatitis_history', () => {
    expect(mapMedicalConditionsToAdjustmentKeys(['Pancreatitis'])).toContain('pancreatitis_history');
    expect(mapMedicalConditionsToAdjustmentKeys(['pancreatitis history'])).toContain('pancreatitis_history');
    expect(mapMedicalConditionsToAdjustmentKeys(['Acute Pancreatitis Episode 2024'])).toContain(
      'pancreatitis_history',
    );
  });

  test('does NOT map deferred conditions like CKD', () => {
    expect(mapMedicalConditionsToAdjustmentKeys(['Stage 2 CKD'])).toEqual([]);
    expect(mapMedicalConditionsToAdjustmentKeys(['Diabetes mellitus'])).toEqual([]);
  });

  test('handles null / empty', () => {
    expect(mapMedicalConditionsToAdjustmentKeys(null)).toEqual([]);
    expect(mapMedicalConditionsToAdjustmentKeys(undefined)).toEqual([]);
    expect(mapMedicalConditionsToAdjustmentKeys([])).toEqual([]);
  });

  test('deduplicates when multiple conditions map to the same key', () => {
    const out = mapMedicalConditionsToAdjustmentKeys([
      'Pancreatitis',
      'Pancreatitis history',
      'Acute pancreatitis 2023',
    ]);
    expect(out.filter(k => k === 'pancreatitis_history').length).toBe(1);
  });
});

describe('hasMappedCondition', () => {
  test('true when a freeform condition matches the key', () => {
    expect(hasMappedCondition(['Pancreatitis history'], 'pancreatitis_history')).toBe(true);
  });

  test('false when no match', () => {
    expect(hasMappedCondition(['Arthritis'], 'pancreatitis_history')).toBe(false);
  });
});
