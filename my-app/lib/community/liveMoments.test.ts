import { liveMomentCount, momentPinsFrom } from './liveMoments';
import type { LiveCapture } from '../walk/recorderHandle';

const capture = (over: Partial<LiveCapture> = {}): LiveCapture => ({
  id: 1,
  uri: 'file:///one.jpg',
  lat: -33.89,
  lng: 151.23,
  shared: true,
  ...over,
});

describe('momentPinsFrom', () => {
  it('pins a shared, located photo', () => {
    expect(momentPinsFrom([capture()])).toEqual([
      { id: '1', lat: -33.89, lng: 151.23, uri: 'file:///one.jpg' },
    ]);
  });

  it('never pins a personal photo', () => {
    // The consent was read at shutter time. Putting a Personal photo on the
    // pack's map publishes it in the only sense the photographer cares about.
    expect(momentPinsFrom([capture({ shared: false })])).toEqual([]);
  });

  it('does not place a photo whose fix never landed', () => {
    expect(momentPinsFrom([capture({ lat: null, lng: null })])).toEqual([]);
    expect(momentPinsFrom([capture({ lat: -33.89, lng: null })])).toEqual([]);
    expect(momentPinsFrom([capture({ lat: null, lng: 151.23 })])).toEqual([]);
  });

  it('rejects NaN, which a null check would let through', () => {
    expect(momentPinsFrom([capture({ lat: NaN })])).toEqual([]);
    expect(momentPinsFrom([capture({ lng: NaN })])).toEqual([]);
  });

  it('keeps capture order', () => {
    const pins = momentPinsFrom([capture({ id: 1 }), capture({ id: 2 }), capture({ id: 3 })]);
    expect(pins.map(pin => pin.id)).toEqual(['1', '2', '3']);
  });

  it('keeps the located ones when only some have a fix', () => {
    const pins = momentPinsFrom([
      capture({ id: 1, lat: null, lng: null }),
      capture({ id: 2 }),
    ]);
    expect(pins.map(pin => pin.id)).toEqual(['2']);
  });

  it('is empty for an empty walk', () => {
    expect(momentPinsFrom([])).toEqual([]);
  });
});

describe('liveMomentCount', () => {
  it('counts this phone’s photos before anything is uploaded', () => {
    // The bug in one line: during a walk `published` is zero by construction.
    expect(liveMomentCount(0, [capture({ id: 1 }), capture({ id: 2 })])).toBe(2);
  });

  it('adds them to whatever is already published', () => {
    expect(liveMomentCount(3, [capture()])).toBe(4);
  });

  it('counts a photo that has no fix', () => {
    // It happened. We simply cannot say where, which is a question about the
    // map and not about the count.
    expect(liveMomentCount(0, [capture({ lat: null, lng: null })])).toBe(1);
  });

  it('ignores personal photos', () => {
    expect(liveMomentCount(0, [capture({ shared: false })])).toBe(0);
  });

  it('never goes negative on a bad published count', () => {
    expect(liveMomentCount(-5, [])).toBe(0);
  });
});
