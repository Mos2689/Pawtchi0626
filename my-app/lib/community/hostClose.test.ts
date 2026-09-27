import { hostClosedMemoryHref, shouldFollowHostClose, shouldReplaceForMemory } from './hostClose';

describe('shouldFollowHostClose', () => {
  it('follows a completed walk on a member’s phone', () => {
    expect(shouldFollowHostClose({ state: 'completed' }, false)).toBe(true);
  });

  it('follows a cancelled walk too — the recording cannot carry on into it', () => {
    expect(shouldFollowHostClose({ state: 'cancelled' }, false)).toBe(true);
  });

  it('never follows on the host’s own phone', () => {
    expect(shouldFollowHostClose({ state: 'completed' }, true)).toBe(false);
  });

  it('does not guess when the host is not yet known', () => {
    expect(shouldFollowHostClose({ state: 'completed' }, null)).toBe(false);
  });

  it('ignores a walk that is still going', () => {
    expect(shouldFollowHostClose({ state: 'active' }, false)).toBe(false);
    expect(shouldFollowHostClose({ state: 'planned' }, false)).toBe(false);
  });

  it('does nothing without a row', () => {
    expect(shouldFollowHostClose(null, false)).toBe(false);
  });
});

describe('memory routing', () => {
  it('marks the arrival as a host close', () => {
    expect(hostClosedMemoryHref('w1')).toBe('/community/walk/w1/memory?finished=1&by=host');
  });

  it('replaces only this walk’s live map', () => {
    expect(shouldReplaceForMemory('/community/walk/w1/live', 'w1')).toBe(true);
    expect(shouldReplaceForMemory('/community/walk/w2/live', 'w1')).toBe(false);
    expect(shouldReplaceForMemory('/', 'w1')).toBe(false);
    expect(shouldReplaceForMemory(null, 'w1')).toBe(false);
  });
});
