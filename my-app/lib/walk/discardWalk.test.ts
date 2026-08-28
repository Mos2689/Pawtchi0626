jest.mock('../supabase', () => ({ supabase: {} }));
jest.mock('../analytics', () => ({ track: jest.fn() }));
jest.mock('../walkStorySync', () => ({ clearPendingWalkStory: jest.fn() }));
jest.mock('../../store/usePetContextStore', () => ({
  usePetContextStore: { getState: () => ({ invalidateContext: jest.fn() }) },
}));
jest.mock('./walkSync', () => ({ removeWalkFromSyncQueue: jest.fn() }));

import { planDiscard, type DiscardWalkInput } from './discardWalk';

const base: DiscardWalkInput = {
  walkSessionId: 'walk-1',
  petId: 'pet-1',
  ownerId: 'owner-1',
  walkDate: '2026-08-19',
  outcome: 'not_valid',
  matchedActivityId: null,
};

describe('planDiscard', () => {
  it('returns a claimed scheduled activity to pending and reverses its count', () => {
    expect(planDiscard({ ...base, outcome: 'matched', matchedActivityId: 'activity-1' }))
      .toEqual({
        deleteOwnActivity: false,
        revertActivityId: 'activity-1',
        decrementWalkCount: true,
      });
  });

  it('deletes an activity generated solely for an unmatched walk', () => {
    expect(planDiscard({ ...base, outcome: 'logged_new' })).toEqual({
      deleteOwnActivity: true,
      revertActivityId: null,
      decrementWalkCount: true,
    });
  });

  it.each(['not_valid', 'skipped_duplicate', 'queued'] as const)(
    'only removes the session for %s',
    outcome => {
      expect(planDiscard({ ...base, outcome })).toEqual({
        deleteOwnActivity: false,
        revertActivityId: null,
        decrementWalkCount: false,
      });
    },
  );
});
