import {
  completionReturnPath,
  forwardCompletionParams,
  isCompletionMode,
} from './completionMode';

describe('isCompletionMode', () => {
  test('only the exact flag counts', () => {
    expect(isCompletionMode({ mode: 'complete' })).toBe(true);
    expect(isCompletionMode({})).toBe(false);
    expect(isCompletionMode({ mode: 'onboarding' })).toBe(false);
    expect(isCompletionMode({ mode: 'Complete' })).toBe(false);
  });
});

describe('forwardCompletionParams', () => {
  test('carries the mode and the originating feature down the chain', () => {
    expect(forwardCompletionParams({ mode: 'complete', feature: 'meal_logging' })).toEqual({
      mode: 'complete',
      feature: 'meal_logging',
    });
  });

  test('carries the mode alone when no feature was named', () => {
    expect(forwardCompletionParams({ mode: 'complete' })).toEqual({ mode: 'complete' });
  });

  test('adds nothing during normal onboarding', () => {
    // Spread into every push, so it has to be inert on the signup path.
    expect(forwardCompletionParams({})).toEqual({});
    expect(forwardCompletionParams({ feature: 'meal_logging' })).toEqual({});
  });

  test('survives being forwarded through the whole chain', () => {
    // body-basics → energy → allergies → body-check → goal → reveal. Dropping
    // the param at any hop silently routes the owner to Home instead of back
    // to the feature that asked, which is invisible until someone reports it.
    let params = { mode: 'complete', feature: 'health_insights' };
    for (let hop = 0; hop < 5; hop++) {
      params = forwardCompletionParams(params) as typeof params;
    }
    expect(isCompletionMode(params)).toBe(true);
    expect(params.feature).toBe('health_insights');
  });
});

describe('completionReturnPath', () => {
  test('returns to the feature that asked', () => {
    expect(completionReturnPath('meal_logging')).toBe('/(tabs)/meal');
    expect(completionReturnPath('activity_plan')).toBe('/(tabs)/activity');
    expect(completionReturnPath('health_insights')).toBe('/(tabs)/health');
    expect(completionReturnPath('weight_plan')).toBe('/(tabs)/health');
    expect(completionReturnPath('calorie_target')).toBe('/(tabs)/health');
  });

  test('an unknown or missing feature still lands somewhere real', () => {
    expect(completionReturnPath(undefined)).toBe('/(tabs)/health');
    expect(completionReturnPath('something_new')).toBe('/(tabs)/health');
  });
});
