/**
 * The storage budget.
 *
 * The tests that matter here are the refusals: that a capture with no uploaded
 * thumbnail is never evicted even when that leaves us over budget, and that
 * being within budget does no work at all. Everything else is arithmetic.
 */

import {
  KEEPSAKE_BYTE_BUDGET,
  planEviction,
  type StoredKeepsakeFile,
} from './keepsakeBudget';

const MB = 1024 * 1024;

function file(overrides: Partial<StoredKeepsakeFile> = {}): StoredKeepsakeFile {
  return {
    name: 'a.jpg',
    size: 10 * MB,
    capturedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('planEviction — within budget', () => {
  it('evicts nothing when the total fits', () => {
    const files = [file({ name: 'a.jpg' }), file({ name: 'b.jpg' })];
    expect(planEviction(files, 100 * MB)).toEqual({ evict: [], remainingBytes: 20 * MB });
  });

  it('evicts nothing at exactly the budget', () => {
    const files = [file({ size: 50 * MB }), file({ name: 'b.jpg', size: 50 * MB })];
    expect(planEviction(files, 100 * MB).evict).toEqual([]);
  });

  it('handles an empty store', () => {
    expect(planEviction([], 100 * MB)).toEqual({ evict: [], remainingBytes: 0 });
  });
});

describe('planEviction — over budget', () => {
  const older = file({ name: 'older.jpg', size: 40 * MB, capturedAt: 1_000 });
  const middle = file({ name: 'middle.jpg', size: 40 * MB, capturedAt: 2_000 });
  const newer = file({ name: 'newer.jpg', size: 40 * MB, capturedAt: 3_000 });

  it('deletes the oldest first', () => {
    const plan = planEviction([newer, older, middle], 100 * MB);
    expect(plan.evict).toEqual(['older.jpg']);
    expect(plan.remainingBytes).toBe(80 * MB);
  });

  it('stops as soon as it is back within budget', () => {
    const plan = planEviction([newer, older, middle], 50 * MB);
    expect(plan.evict).toEqual(['older.jpg', 'middle.jpg']);
    expect(plan.remainingBytes).toBe(40 * MB);
  });

  it('does not order by size — a huge recent capture outranks a small old one', () => {
    const smallOld = file({ name: 'small-old.jpg', size: 1 * MB, capturedAt: 1_000 });
    const hugeNew = file({ name: 'huge-new.jpg', size: 99 * MB, capturedAt: 9_000 });
    expect(planEviction([hugeNew, smallOld], 99 * MB).evict).toEqual(['small-old.jpg']);
  });
});

describe('planEviction — the files that are never evicted', () => {
  const noThumb = file({ name: 'no-thumb.jpg', size: 60 * MB, capturedAt: 1_000 });
  const hasThumb = file({ name: 'has-thumb.jpg', size: 60 * MB, capturedAt: 2_000 });

  it('skips a capture whose thumbnail has not uploaded, even though it is oldest', () => {
    const plan = planEviction([noThumb, hasThumb], 100 * MB, ['no-thumb.jpg']);
    expect(plan.evict).toEqual(['has-thumb.jpg']);
  });

  it('stays over budget rather than destroying the only copy of a photo', () => {
    // Both exempt, both needed, total double the budget. Losing a moment is
    // never the cheaper option.
    const plan = planEviction([noThumb, hasThumb], 50 * MB, [
      'no-thumb.jpg',
      'has-thumb.jpg',
    ]);
    expect(plan.evict).toEqual([]);
    expect(plan.remainingBytes).toBe(120 * MB);
  });
});

describe('planEviction — robustness', () => {
  it('treats a negative size as zero rather than crediting it', () => {
    const bogus = file({ name: 'bogus.jpg', size: -100 * MB, capturedAt: 1_000 });
    const real = file({ name: 'real.jpg', size: 50 * MB, capturedAt: 2_000 });
    expect(planEviction([bogus, real], 100 * MB).evict).toEqual([]);
  });

  it('defaults to the shipped budget', () => {
    const files = [file({ size: KEEPSAKE_BYTE_BUDGET + MB })];
    expect(planEviction(files).evict).toEqual(['a.jpg']);
  });
});
