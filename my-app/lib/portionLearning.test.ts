import { pickSuggestionFromHistory, SUGGEST_THRESHOLD } from './portionLearning';

describe('pickSuggestionFromHistory', () => {
  test('returns null when history is too short', () => {
    expect(pickSuggestionFromHistory([0.75])).toBeNull();
  });

  test('returns null when the recent picks include 1×', () => {
    expect(pickSuggestionFromHistory([1, 1, 0.75])).toBeNull();
  });

  test('returns the off-1× value when the last N picks all match it', () => {
    expect(pickSuggestionFromHistory([1, 1, 0.75, 0.75], SUGGEST_THRESHOLD)).toBeCloseTo(0.75);
    expect(pickSuggestionFromHistory([1.25, 1.25])).toBeCloseTo(1.25);
  });

  test('returns null when the last N picks disagree', () => {
    expect(pickSuggestionFromHistory([0.75, 1.25])).toBeNull();
    expect(pickSuggestionFromHistory([0.75, 0.5])).toBeNull();
  });

  test('returns null when the picks include zero or invalid', () => {
    expect(pickSuggestionFromHistory([0, 0])).toBeNull();
    expect(pickSuggestionFromHistory([Number.NaN, Number.NaN])).toBeNull();
  });
});
