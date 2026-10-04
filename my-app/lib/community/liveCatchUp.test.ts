import { catchUpDue, type CatchUpTracker } from './liveCatchUp';

describe('catch-up requests', () => {
  it('asks at once, then after 10, 20, 40 and 60 s, then gives up', () => {
    let tracker: CatchUpTracker = {};
    const askedAt: number[] = [];
    for (let now = 0; now <= 400_000; now += 1_000) {
      const step = catchUpDue(tracker, ['ana'], now);
      tracker = step.tracker;
      if (step.want) askedAt.push(now);
    }
    expect(askedAt).toEqual([0, 10_000, 30_000, 70_000, 130_000]);
  });

  it('forgets a walker once caught up, and asks afresh if they fall behind again', () => {
    let { tracker } = catchUpDue({}, ['ana'], 0);
    tracker = catchUpDue(tracker, [], 1_000).tracker;
    expect(tracker).toEqual({});
    expect(catchUpDue(tracker, ['ana'], 2_000).want).toBe('ana');
  });

  it('asks everyone at once when several are behind', () => {
    expect(catchUpDue({}, ['ana', 'ben'], 0).want).toBe('all');
    expect(catchUpDue({}, [], 0).want).toBeNull();
  });
});
