import {
  ALWAYS_STAGES,
  STAGE_DONE_LABEL,
  STAGE_LABEL,
  stageState,
  visibleStages,
  type WeightSaveStage,
} from './weightSaveStages';

const ALL: WeightSaveStage[] = ['saving', 'recalculating', 'rebuilding'];

describe('stage copy', () => {
  it('names every stage in both tenses', () => {
    for (const stage of ALL) {
      expect(STAGE_LABEL[stage].trim().length).toBeGreaterThan(0);
      expect(STAGE_DONE_LABEL[stage].trim().length).toBeGreaterThan(0);
    }
  });

  it('explains the wait rather than just asking for patience', () => {
    // "Please wait" earns nothing; naming the work is what makes a slow step
    // feel purposeful instead of broken.
    for (const stage of ALL) {
      expect(STAGE_LABEL[stage].toLowerCase()).not.toMatch(/please|wait|loading/);
    }
  });
});

describe('visibleStages', () => {
  it('shows only the two stages that always run, before rebuilding starts', () => {
    // Listing `rebuilding` upfront would promise work that often never
    // happens — it only runs on a meaningful change.
    expect(visibleStages(null)).toEqual(ALWAYS_STAGES);
    expect(visibleStages('saving')).toEqual(ALWAYS_STAGES);
    expect(visibleStages('recalculating')).toEqual(ALWAYS_STAGES);
  });

  it('adds rebuilding exactly when it begins', () => {
    expect(visibleStages('rebuilding')).toEqual([
      'saving',
      'recalculating',
      'rebuilding',
    ]);
  });

  it('never omits a stage that has already run', () => {
    for (const current of ALL) {
      const shown = visibleStages(current);
      const at = ALL.indexOf(current);
      for (const earlier of ALL.slice(0, at + 1)) {
        expect(shown).toContain(earlier);
      }
    }
  });
});

describe('stageState', () => {
  it('is all pending before anything starts', () => {
    for (const stage of ALL) expect(stageState(stage, null)).toBe('pending');
  });

  it('marks earlier stages done and later ones pending', () => {
    expect(stageState('saving', 'recalculating')).toBe('done');
    expect(stageState('recalculating', 'recalculating')).toBe('active');
    expect(stageState('rebuilding', 'recalculating')).toBe('pending');
  });

  it('never reports two active stages at once', () => {
    for (const current of ALL) {
      const active = ALL.filter(s => stageState(s, current) === 'active');
      expect(active).toEqual([current]);
    }
  });

  it('has everything before the last stage done once it is running', () => {
    expect(stageState('saving', 'rebuilding')).toBe('done');
    expect(stageState('recalculating', 'rebuilding')).toBe('done');
    expect(stageState('rebuilding', 'rebuilding')).toBe('active');
  });
});
