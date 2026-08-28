import {
  UNPLACED_KEY,
  UNPLACED_LABEL,
  chunk,
  groupSummary,
  groupWalksByPlace,
  placeLabelOf,
  type GalleryWalkSource,
} from './walkGallery';

function walk(over: Partial<GalleryWalkSource> = {}): GalleryWalkSource {
  return {
    id: 'w1',
    started_at: '2026-08-10T09:00:00.000Z',
    distance_m: 2400,
    start_label: 'Arpora',
    end_label: null,
    farthest_label: null,
    ...over,
  };
}

describe('placeLabelOf', () => {
  it('names a walk by where it started', () => {
    expect(placeLabelOf(walk({ start_label: 'Arpora', end_label: 'Baga' }))).toBe('Arpora');
  });

  it('falls back to the farthest point before the end', () => {
    // A loop returns home, so its end label repeats the start and says nothing;
    // the farthest point is the part of that walk worth naming.
    expect(
      placeLabelOf(walk({ start_label: null, farthest_label: 'Baga', end_label: 'Arpora' })),
    ).toBe('Baga');
  });

  it('uses the end label only when nothing better exists', () => {
    expect(
      placeLabelOf(walk({ start_label: null, farthest_label: null, end_label: 'Candolim' })),
    ).toBe('Candolim');
  });

  it('treats blank labels as absent', () => {
    expect(
      placeLabelOf(walk({ start_label: '   ', farthest_label: '', end_label: null })),
    ).toBeNull();
  });
});

describe('groupWalksByPlace', () => {
  it('clubs walks that started in the same place', () => {
    const groups = groupWalksByPlace([
      walk({ id: 'a', start_label: 'Arpora' }),
      walk({ id: 'b', start_label: 'Baga' }),
      walk({ id: 'c', start_label: 'Arpora' }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.find(g => g.key === 'arpora')!.walks.map(w => w.id).sort()).toEqual(['a', 'c']);
  });

  it('matches places case- and whitespace-insensitively', () => {
    const groups = groupWalksByPlace([
      walk({ id: 'a', start_label: 'Arpora' }),
      walk({ id: 'b', start_label: '  arpora ' }),
    ]);
    expect(groups).toHaveLength(1);
    // The display label keeps the first walk's original casing.
    expect(groups[0].label).toBe('Arpora');
  });

  it('orders groups by their most recent walk', () => {
    const groups = groupWalksByPlace([
      walk({ id: 'old', start_label: 'Baga', started_at: '2026-08-01T09:00:00.000Z' }),
      walk({ id: 'new', start_label: 'Arpora', started_at: '2026-08-20T09:00:00.000Z' }),
    ]);
    expect(groups.map(g => g.label)).toEqual(['Arpora', 'Baga']);
  });

  it('orders walks inside a group newest first', () => {
    const groups = groupWalksByPlace([
      walk({ id: 'older', started_at: '2026-08-01T09:00:00.000Z' }),
      walk({ id: 'newer', started_at: '2026-08-20T09:00:00.000Z' }),
    ]);
    expect(groups[0].walks.map(w => w.id)).toEqual(['newer', 'older']);
  });

  it('keeps unlabelled walks rather than dropping them', () => {
    // Dropping them would make the grid disagree with the totals shown on the
    // same screen.
    const groups = groupWalksByPlace([
      walk({ id: 'a', start_label: null, end_label: null, farthest_label: null }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe(UNPLACED_KEY);
    expect(groups[0].label).toBe(UNPLACED_LABEL);
  });

  it('always sorts the unplaced bucket last, however recent', () => {
    const groups = groupWalksByPlace([
      walk({
        id: 'recent-unplaced',
        started_at: '2026-08-30T09:00:00.000Z',
        start_label: null,
        end_label: null,
        farthest_label: null,
      }),
      walk({ id: 'older-placed', started_at: '2026-08-01T09:00:00.000Z', start_label: 'Arpora' }),
    ]);
    expect(groups.map(g => g.key)).toEqual(['arpora', UNPLACED_KEY]);
  });

  it('sums distance per place', () => {
    const groups = groupWalksByPlace([
      walk({ id: 'a', distance_m: 2400 }),
      walk({ id: 'b', distance_m: 1600 }),
    ]);
    expect(groups[0].totalKm).toBeCloseTo(4);
  });

  it('survives junk distances without producing NaN', () => {
    const groups = groupWalksByPlace([
      walk({ id: 'a', distance_m: NaN }),
      walk({ id: 'b', distance_m: 1000 }),
    ]);
    expect(groups[0].totalKm).toBeCloseTo(1);
  });

  it('is deterministic', () => {
    const input = [
      walk({ id: 'a', start_label: 'Arpora' }),
      walk({ id: 'b', start_label: 'Baga' }),
    ];
    expect(groupWalksByPlace(input)).toEqual(groupWalksByPlace(input));
  });

  it('handles an empty archive', () => {
    expect(groupWalksByPlace([])).toEqual([]);
  });
});

describe('chunk', () => {
  it('splits into fixed-width rows with a ragged last row', () => {
    expect(chunk([1, 2, 3, 4, 5], 3)).toEqual([[1, 2, 3], [4, 5]]);
  });

  it('handles an exact fit and an empty list', () => {
    expect(chunk([1, 2, 3], 3)).toEqual([[1, 2, 3]]);
    expect(chunk([], 3)).toEqual([]);
  });

  it('does not hang on a zero or negative width', () => {
    expect(chunk([1, 2], 0)).toEqual([[1, 2]]);
    expect(chunk([], 0)).toEqual([]);
  });
});

describe('groupSummary', () => {
  it('reads naturally for one walk and for many', () => {
    const one = groupWalksByPlace([walk({ distance_m: 2400 })])[0];
    expect(groupSummary(one)).toBe('1 walk · 2.4 km');

    const many = groupWalksByPlace([
      walk({ id: 'a', distance_m: 2400 }),
      walk({ id: 'b', distance_m: 1600 }),
    ])[0];
    expect(groupSummary(many)).toBe('2 walks · 4.0 km');
  });

  it('omits a distance too small to be worth claiming', () => {
    const tiny = groupWalksByPlace([walk({ distance_m: 10 })])[0];
    expect(groupSummary(tiny)).toBe('1 walk');
  });
});
