import {
  HOME_MARKS,
  createHomeTrace,
  formatHomeTrace,
  type HomeTraceEntry,
} from './homeTrace';

/** A clock we drive by hand, so the assertions are about ordering, not timing. */
function fakeClock(start = 1_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('createHomeTrace', () => {
  it('measures every mark from the first one', () => {
    const clock = fakeClock();
    const trace = createHomeTrace(clock.now);

    trace.mark('mount');
    clock.advance(120);
    trace.mark('map_camera');
    clock.advance(300);
    trace.mark('map_ready');

    expect(trace.entries()).toEqual<HomeTraceEntry[]>([
      { mark: 'mount', atMs: 0 },
      { mark: 'map_camera', atMs: 120 },
      { mark: 'map_ready', atMs: 420 },
    ]);
  });

  it('keeps the first occurrence — re-renders must not overwrite the moment', () => {
    const clock = fakeClock();
    const trace = createHomeTrace(clock.now);

    trace.mark('mount');
    clock.advance(50);
    trace.mark('walks_cached');
    clock.advance(500);
    trace.mark('walks_cached');

    expect(trace.entries()).toEqual([
      { mark: 'mount', atMs: 0 },
      { mark: 'walks_cached', atMs: 50 },
    ]);
  });

  it('takes its origin from whichever mark lands first', () => {
    const clock = fakeClock();
    const trace = createHomeTrace(clock.now);

    // No `mount` — a trace armed late must still read forwards, never negative.
    trace.mark('map_ready');
    clock.advance(80);
    trace.mark('weather_resolved');

    expect(trace.entries()).toEqual([
      { mark: 'map_ready', atMs: 0 },
      { mark: 'weather_resolved', atMs: 80 },
    ]);
  });

  it('reset starts a new run rather than appending to the old one', () => {
    const clock = fakeClock();
    const trace = createHomeTrace(clock.now);

    trace.mark('mount');
    clock.advance(200);
    trace.reset();

    trace.mark('mount');
    clock.advance(40);
    trace.mark('map_ready');

    expect(trace.entries()).toEqual([
      { mark: 'mount', atMs: 0 },
      { mark: 'map_ready', atMs: 40 },
    ]);
  });
});

describe('formatHomeTrace', () => {
  it('reports in declared order, not arrival order, so two runs line up', () => {
    const out = formatHomeTrace([
      { mark: 'walks_resolved', atMs: 900 },
      { mark: 'mount', atMs: 0 },
      { mark: 'map_ready', atMs: 400 },
    ]);

    const lines = out.split('\n').slice(1);
    const order = lines
      .map(l => l.trim().split(/\s+/)[0])
      .filter(m => (HOME_MARKS as readonly string[]).includes(m));

    expect(order).toEqual([...HOME_MARKS]);
    expect(out).toContain('mount');
    expect(out).toMatch(/map_ready\s+400 ms/);
  });

  it('shows a mark that never arrived rather than hiding the row', () => {
    const out = formatHomeTrace([{ mark: 'mount', atMs: 0 }]);
    expect(out).toMatch(/weather_resolved\s+—/);
  });

  it('says so when nothing was recorded', () => {
    expect(formatHomeTrace([])).toBe('[homeTrace] nothing recorded');
  });
});
