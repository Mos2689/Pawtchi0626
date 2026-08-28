import {
  PARTICLE_COUNT,
  RIBBON_STROKE,
  RIBBON_VIEWBOX,
  easeInOutCubic,
  easeOutBack,
  easeOutQuart,
  makeFurDust,
  ribbonLength,
  ribbonPathD,
  smoothstep,
} from './tailWhipTimeline';

describe('ribbon geometry', () => {
  it('builds a single-subpath cubic path string', () => {
    const d = ribbonPathD();
    expect(d.startsWith('M ')).toBe(true);
    expect((d.match(/M /g) || []).length).toBe(1);
    expect((d.match(/C /g) || []).length).toBe(3);
  });

  it('has a positive, deterministic length that spans more than the screen height', () => {
    const a = ribbonLength();
    const b = ribbonLength();
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(RIBBON_VIEWBOX.h); // a real sweep, not a stub
    expect(a).toBeLessThan(RIBBON_VIEWBOX.h * 4);
  });

  it('sane viewbox + stroke', () => {
    expect(RIBBON_VIEWBOX.w).toBeGreaterThan(0);
    expect(RIBBON_VIEWBOX.h).toBeGreaterThan(RIBBON_VIEWBOX.w); // portrait
    expect(RIBBON_STROKE).toBeGreaterThan(0);
  });
});

describe('easings', () => {
  const curves = [easeOutQuart, easeInOutCubic, easeOutBack, smoothstep];
  it('hit 0 at 0 and 1 at 1, and clamp out-of-range input', () => {
    for (const f of curves) {
      expect(f(0)).toBeCloseTo(0, 9);
      expect(f(1)).toBeCloseTo(1, 9);
      expect(f(-5)).toBeCloseTo(f(0), 9);
      expect(f(5)).toBeCloseTo(f(1), 9);
    }
  });
  it('easeOutBack overshoots past 1; the others stay within [0,1]', () => {
    let peak = 0;
    for (let i = 0; i <= 100; i++) {
      const p = i / 100;
      peak = Math.max(peak, easeOutBack(p));
      expect(smoothstep(p)).toBeGreaterThanOrEqual(0);
      expect(smoothstep(p)).toBeLessThanOrEqual(1);
      expect(easeOutQuart(p)).toBeLessThanOrEqual(1);
    }
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.15);
  });
});

describe('fur dust', () => {
  const W = 390;
  const H = 844;
  it('is deterministic per seed and varies across seeds', () => {
    expect(makeFurDust(42, W, H)).toEqual(makeFurDust(42, W, H));
    expect(makeFurDust(42, W, H)).not.toEqual(makeFurDust(43, W, H));
  });
  it('respects the spec bounds and drifts up-right', () => {
    const specs = makeFurDust(7, W, H);
    expect(specs).toHaveLength(PARTICLE_COUNT);
    for (const s of specs) {
      expect(s.size).toBeGreaterThanOrEqual(1);
      expect(s.size).toBeLessThanOrEqual(3);
      expect(s.opacity).toBeGreaterThanOrEqual(0.2);
      expect(s.opacity).toBeLessThanOrEqual(0.5);
      expect(s.delay).toBeGreaterThanOrEqual(0);
      expect(s.delay).toBeLessThanOrEqual(90);
      expect(s.dx).toBeGreaterThan(0);
      expect(s.dy).toBeLessThan(0);
    }
  });
});
