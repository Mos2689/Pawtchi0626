import { ANNOUNCEMENTS, BODY_MAX, EYEBROW_MAX, TITLE_MAX } from './catalogue';
import { PERF_FLAGS } from '../perfFlags';

describe('announcement catalogue', () => {
  test('ids are unique', () => {
    const ids = ANNOUNCEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test.each(ANNOUNCEMENTS.map((a) => [a.id, a] as const))('%s fits the sheet and the copy spec', (_id, a) => {
    // The sheet holds a title and ONE line. Longer copy is what made the
    // first version feel crowded.
    expect(a.title.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(a.body.length).toBeLessThanOrEqual(BODY_MAX);
    if (a.eyebrow != null) expect(a.eyebrow.length).toBeLessThanOrEqual(EYEBROW_MAX);
    for (const text of [a.eyebrow ?? 'x', a.title, a.body, a.cta.label]) {
      expect(text).not.toMatch(/!/);
      expect(text.trim()).toBe(text);
      expect(text.length).toBeGreaterThan(0);
    }
  });

  test.each(ANNOUNCEMENTS.map((a) => [a.id, a] as const))('%s routes inside the app only', (_id, a) => {
    expect(a.cta.route.startsWith('/')).toBe(true);
    expect(a.cta.route).not.toMatch(/^\/\//);
    expect(a.cta.route).not.toMatch(/:\/\//);
  });

  test.each(ANNOUNCEMENTS.map((a) => [a.id, a] as const))('%s has sane caps and a real flag', (_id, a) => {
    expect(a.maxShows).toBeGreaterThan(0);
    expect(a.maxDismissals).toBeGreaterThan(0);
    expect(a.minHoursBetween).toBeGreaterThanOrEqual(0);
    if (a.gateFlag) expect(PERF_FLAGS[a.gateFlag]).toBeTruthy();
  });
});
