import { recordingTrail } from './recordingTrail';

const A = { walkId: 'walk-a' };
const B = { walkId: 'walk-b' };

describe('recordingTrail', () => {
  it('follows the walk being recorded', () => {
    expect(recordingTrail(B, 'tracking', A)).toBe(B);
    expect(recordingTrail(B, 'starting', A)).toBe(B);
  });

  it('keeps the finished walk through its wrap-up, for the finish work', () => {
    expect(recordingTrail(null, 'saving', A)).toBe(A);
    expect(recordingTrail(null, 'summary', A)).toBe(A);
  });

  it('forgets the previous meetup the moment a new walk starts', () => {
    // summary → starting: marker not set yet. The old meetup must not stand in.
    expect(recordingTrail(null, 'starting', A)).toBeNull();
  });

  it('holds nothing at rest', () => {
    expect(recordingTrail(null, 'idle', A)).toBeNull();
  });
});
