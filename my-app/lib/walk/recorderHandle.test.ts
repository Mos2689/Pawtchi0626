/**
 * The handle has one rule that fails invisibly: it must never pass through
 * null while a walk is still recording. The screen reading it unmounts the
 * camera when it sees null, so a momentary null is a camera that closes itself
 * — most likely on the tick somebody is pressing the shutter, because that is
 * the tick everything else is happening on.
 */

import {
  publishRecorderHandle,
  updateRecorderHandle,
  __readRecorderHandle,
  __subscribeRecorderHandle,
} from './recorderHandle';

const noop = () => {};
const base = {
  onCaptured: noop,
  context: { distanceLabel: null, elapsedLabel: null, placeLabel: null },
  captures: [],
};

describe('publishRecorderHandle', () => {
  it('publishes and tears down', () => {
    const stop = publishRecorderHandle({ ...base });
    expect(__readRecorderHandle()).not.toBeNull();
    stop();
    expect(__readRecorderHandle()).toBeNull();
  });

  it('a stale teardown cannot unpublish the recorder that replaced it', () => {
    const stopFirst = publishRecorderHandle({ ...base });
    publishRecorderHandle({ ...base, context: { ...base.context, placeLabel: 'Second' } });
    stopFirst();
    expect(__readRecorderHandle()?.context.placeLabel).toBe('Second');
  });
});

describe('updateRecorderHandle', () => {
  it('never lets the handle be null between two values', () => {
    const stop = publishRecorderHandle({ ...base });
    const seen: (string | null | undefined)[] = [];
    const unsubscribe = __subscribeRecorderHandle(() => {
      seen.push(__readRecorderHandle() === null ? null : __readRecorderHandle()?.context.elapsedLabel);
    });

    updateRecorderHandle({ context: { ...base.context, elapsedLabel: '00:01' } });
    updateRecorderHandle({ context: { ...base.context, elapsedLabel: '00:02' } });
    updateRecorderHandle({ context: { ...base.context, elapsedLabel: '00:03' } });

    expect(seen).toEqual(['00:01', '00:02', '00:03']);
    expect(seen).not.toContain(null);
    unsubscribe();
    stop();
  });

  it('changes the snapshot identity so a reader re-renders', () => {
    const stop = publishRecorderHandle({ ...base });
    const before = __readRecorderHandle();
    updateRecorderHandle({ context: { ...base.context, distanceLabel: '1.20 km' } });
    expect(__readRecorderHandle()).not.toBe(before);
    stop();
  });

  it('keeps fields it was not given', () => {
    const onCaptured = jest.fn();
    const stop = publishRecorderHandle({ ...base, onCaptured });
    updateRecorderHandle({ context: { ...base.context, placeLabel: 'The park' } });
    expect(__readRecorderHandle()?.onCaptured).toBe(onCaptured);
    stop();
  });

  it('is a no-op once the walk has ended', () => {
    const stop = publishRecorderHandle({ ...base });
    stop();
    updateRecorderHandle({ context: { ...base.context, placeLabel: 'Too late' } });
    // A photo taken after the walk ended has nowhere to go; resurrecting the
    // handle here would attach it to a walk that is already saved.
    expect(__readRecorderHandle()).toBeNull();
  });
});
