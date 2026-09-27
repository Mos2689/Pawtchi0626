import { beginLegSettle, legSettled, resetLegSettle, settleLeg } from './legSettle';

const flush = () => new Promise(resolve => setImmediate(resolve));

describe('legSettle', () => {
  afterEach(resetLegSettle);

  it('resolves at once when no leg was ever in flight (a memory opened from a list)', async () => {
    let done = false;
    void legSettled('w1').then(() => { done = true; });
    await flush();
    expect(done).toBe(true);
  });

  it('waits for an open leg until it settles', async () => {
    beginLegSettle('w1');
    let done = false;
    void legSettled('w1').then(() => { done = true; });
    await flush();
    expect(done).toBe(false);

    settleLeg('w1');
    await flush();
    expect(done).toBe(true);
  });

  it('keeps waiters on the same promise when begun twice', async () => {
    beginLegSettle('w1');
    const first = legSettled('w1');
    beginLegSettle('w1');
    expect(legSettled('w1')).toBe(first);
    settleLeg('w1');
    await expect(first).resolves.toBeUndefined();
  });

  it('is scoped per outing', async () => {
    beginLegSettle('w1');
    let other = false;
    void legSettled('w2').then(() => { other = true; });
    await flush();
    expect(other).toBe(true);
  });

  it('stays settled after settling, so a late memory does not wait', async () => {
    beginLegSettle('w1');
    settleLeg('w1');
    let done = false;
    void legSettled('w1').then(() => { done = true; });
    await flush();
    expect(done).toBe(true);
  });

  it('treats a settle with nothing open as settled', async () => {
    settleLeg('w1');
    await expect(legSettled('w1')).resolves.toBeUndefined();
  });
});
