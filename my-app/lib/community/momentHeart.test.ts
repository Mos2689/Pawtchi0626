import { withHeart } from './momentHeart';

const moments = [
  { id: 'a', heartedByMe: false, heartCount: 2 },
  { id: 'b', heartedByMe: true, heartCount: 1 },
];

describe('withHeart', () => {
  it('hearts one moment and counts it', () => {
    expect(withHeart(moments, 'a', true)[0]).toEqual({ id: 'a', heartedByMe: true, heartCount: 3 });
  });

  it('rolls back exactly — heart then un-heart returns the original numbers', () => {
    const tapped = withHeart(moments, 'a', true);
    expect(withHeart(tapped, 'a', false)[0]).toEqual(moments[0]);
  });

  it('leaves every other moment as the same object, so nothing else re-renders', () => {
    const next = withHeart(moments, 'a', true);
    expect(next[1]).toBe(moments[1]);
  });

  it('is a no-op when the heart is already in that state — a double rollback cannot double-count', () => {
    const next = withHeart(moments, 'b', true);
    expect(next[1]).toBe(moments[1]);
  });

  it('never counts below zero', () => {
    expect(withHeart([{ id: 'c', heartedByMe: true, heartCount: 0 }], 'c', false)[0].heartCount).toBe(0);
  });
});
