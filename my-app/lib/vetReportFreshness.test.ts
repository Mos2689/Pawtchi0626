import { getReportFreshness } from './vetReportFreshness';

const NOW = new Date('2026-04-27T12:00:00Z');

describe('getReportFreshness', () => {
  test('report from 2 months ago → fresh, no banner', () => {
    const result = getReportFreshness('2026-02-27T00:00:00Z', NOW);
    expect(result.status).toBe('fresh');
    expect(result.message).toBeNull();
    expect(result.requiresReconfirm).toBe(false);
  });

  test('report from 8 months ago → aging, banner shown, no reconfirm required', () => {
    const result = getReportFreshness('2025-08-27T00:00:00Z', NOW);
    expect(result.status).toBe('aging');
    expect(result.message).toMatch(/months old/i);
    expect(result.requiresReconfirm).toBe(false);
  });

  test('report from 18 months ago → stale, reconfirm required', () => {
    const result = getReportFreshness('2024-10-27T00:00:00Z', NOW);
    expect(result.status).toBe('stale');
    expect(result.message).toMatch(/years old/i);
    expect(result.requiresReconfirm).toBe(true);
  });

  test('null report date → stale + reconfirm required', () => {
    const result = getReportFreshness(null, NOW);
    expect(result.status).toBe('stale');
    expect(result.requiresReconfirm).toBe(true);
  });

  test('unparseable date → stale', () => {
    const result = getReportFreshness('not-a-date', NOW);
    expect(result.status).toBe('stale');
  });

  test('boundary: exactly 6 months → fresh', () => {
    const sixMonths = new Date(NOW.getTime() - 6 * 30.44 * 24 * 60 * 60 * 1000);
    const result = getReportFreshness(sixMonths, NOW);
    expect(result.status).toBe('fresh');
  });

  test('boundary: just over 12 months → stale', () => {
    const past = new Date(NOW.getTime() - 13 * 30.44 * 24 * 60 * 60 * 1000);
    const result = getReportFreshness(past, NOW);
    expect(result.status).toBe('stale');
  });
});
