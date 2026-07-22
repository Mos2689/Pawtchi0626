import { dedupeActivities, type DedupableActivity } from './dedupeActivities';

const row = (over: Partial<DedupableActivity>): DedupableActivity => ({
  id: Math.random().toString(36).slice(2),
  title: 'Evening Hydration',
  scheduled_date: '2026-07-11',
  scheduled_time: '17:00:00',
  status: 'pending',
  is_ai_generated: true,
  ...over,
});

describe('dedupeActivities', () => {
  test('collapses two identical AI slots into one', () => {
    const { rows, removed } = dedupeActivities([
      row({ id: 'a' }),
      row({ id: 'b' }),
    ]);
    expect(removed).toBe(1);
    expect(rows).toHaveLength(1);
  });

  test('keeps the completed copy over the pending duplicate', () => {
    const { rows, removed } = dedupeActivities([
      row({ id: 'pending', status: 'pending' }),
      row({ id: 'done', status: 'completed' }),
    ]);
    expect(removed).toBe(1);
    expect(rows[0].id).toBe('done');
  });

  test('distinct slots (different time or title) are both kept', () => {
    const { rows, removed } = dedupeActivities([
      row({ id: 'a', scheduled_time: '17:00:00', title: 'Evening Hydration' }),
      row({ id: 'b', scheduled_time: '12:00:00', title: 'Midday Refresh' }),
      row({ id: 'c', scheduled_time: '17:00:00', title: 'Dinner' }),
    ]);
    expect(removed).toBe(0);
    expect(rows).toHaveLength(3);
  });

  test('manual logs are never collapsed, even at the same slot', () => {
    const { rows, removed } = dedupeActivities([
      row({ id: 'm1', is_ai_generated: false }),
      row({ id: 'm2', is_ai_generated: false }),
    ]);
    expect(removed).toBe(0);
    expect(rows).toHaveLength(2);
  });

  test('a manual log alongside an AI duplicate keeps the manual + one AI', () => {
    const { rows, removed } = dedupeActivities([
      row({ id: 'ai1', is_ai_generated: true }),
      row({ id: 'ai2', is_ai_generated: true }),
      row({ id: 'manual', is_ai_generated: false }),
    ]);
    expect(removed).toBe(1);
    expect(rows).toHaveLength(2);
    expect(rows.some(r => r.id === 'manual')).toBe(true);
  });

  test('empty input is a no-op', () => {
    expect(dedupeActivities([])).toEqual({ rows: [], removed: 0 });
  });
});
