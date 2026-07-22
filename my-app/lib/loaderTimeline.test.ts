import {
  evalMoment,
  seededRandom,
  MOMENT_COUNT,
  PAW_REST,
  PERSONALITY,
  FLAVOR_PARAMS,
  T_DISCOVERY,
  T_ASSEMBLY,
  CYCLE_MS,
  LoaderFlavor,
} from './loaderTimeline';

const SEEDS = [1, 7, 42, 90210, 123456];
const FLAVORS = Object.keys(FLAVOR_PARAMS) as LoaderFlavor[];

describe('seededRandom', () => {
  it('is deterministic and uniform in [0, 1)', () => {
    for (const s of SEEDS) {
      expect(seededRandom(s)).toBe(seededRandom(s));
    }
    for (let s = 0; s < 1000; s++) {
      const v = seededRandom(s);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('evalMoment determinism', () => {
  it('same inputs always produce the same pose', () => {
    for (const seed of SEEDS) {
      for (let i = 0; i < MOMENT_COUNT; i++) {
        for (const t of [0, 400, 1200, 4000, 9000, 31000]) {
          expect(evalMoment(t, i, seed, 'generic')).toEqual(evalMoment(t, i, seed, 'generic'));
        }
      }
    }
  });
});

describe('phase continuity (no visible seams)', () => {
  const EPS_T = 16; // one frame
  const TOL = 1.2; // unit-space distance an eye can't catch in one frame

  function gap(t: number, i: number, seed: number, flavor: LoaderFlavor) {
    const a = evalMoment(t - EPS_T, i, seed, flavor);
    const b = evalMoment(t + EPS_T, i, seed, flavor);
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  it('is continuous across birth → discovery', () => {
    for (const seed of SEEDS) {
      expect(gap(T_DISCOVERY, 0, seed, 'generic')).toBeLessThan(TOL);
    }
  });

  it('is continuous across discovery → assembly for every moment', () => {
    for (const seed of SEEDS) {
      for (let i = 0; i < MOMENT_COUNT; i++) {
        expect(gap(T_ASSEMBLY, i, seed, 'generic')).toBeLessThan(TOL);
      }
    }
  });

  it('is continuous across cycle boundaries (each cycle reseeds)', () => {
    for (const seed of SEEDS) {
      for (const flavor of FLAVORS) {
        for (let cycle = 1; cycle <= 4; cycle++) {
          for (let i = 0; i < MOMENT_COUNT; i++) {
            expect(gap(T_ASSEMBLY + cycle * CYCLE_MS, i, seed, flavor)).toBeLessThan(TOL);
          }
        }
      }
    }
  });
});

describe('the living system', () => {
  it('starts as a single moment — the others are invisible before discovery', () => {
    for (const seed of SEEDS) {
      const t = T_DISCOVERY - 100;
      expect(evalMoment(t, 0, seed, 'generic').opacity).toBeGreaterThan(0.5);
      for (let i = 1; i < MOMENT_COUNT; i++) {
        expect(evalMoment(t, i, seed, 'generic').opacity).toBe(0);
      }
    }
  });

  it('assembles the paw at hold midpoint (near rest, fully formed)', () => {
    for (const seed of SEEDS) {
      const t = T_ASSEMBLY + CYCLE_MS * 0.5; // mid-hold of cycle 0
      for (let i = 0; i < MOMENT_COUNT; i++) {
        const pose = evalMoment(t, i, seed, 'generic');
        const drift = PERSONALITY[i].driftAmp * 0.25 + 0.5;
        expect(Math.abs(pose.x - PAW_REST[i].x)).toBeLessThan(drift + 0.5);
        expect(Math.abs(pose.y - PAW_REST[i].y)).toBeLessThan(drift + 0.5);
        expect(pose.opacity).toBe(1);
        expect(pose.scaleX).toBeCloseTo(PAW_REST[i].sx, 1);
        expect(pose.scaleY).toBeCloseTo(PAW_REST[i].sy, 1);
      }
    }
  });

  it('no two moments ever share a trajectory (personality divergence)', () => {
    for (const seed of SEEDS) {
      for (const t of [800, 2000, 6000, 12000]) {
        const rel = Array.from({ length: MOMENT_COUNT }, (_, i) => {
          const p = evalMoment(t, i, seed, 'generic');
          return `${(p.x - PAW_REST[i].x).toFixed(3)},${(p.y - PAW_REST[i].y).toFixed(3)}`;
        });
        expect(new Set(rel).size).toBe(MOMENT_COUNT);
      }
    }
  });

  it('cycles differ from each other (seeded variation, never a looping GIF)', () => {
    for (const seed of SEEDS) {
      // Compare the same phase point of consecutive cycles during release,
      // where the seeded release vectors dominate.
      const phase = 0.9 * CYCLE_MS;
      const a = evalMoment(T_ASSEMBLY + phase, 1, seed, 'generic');
      const b = evalMoment(T_ASSEMBLY + CYCLE_MS + phase, 1, seed, 'generic');
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0.5);
    }
  });

  it('stays inside the frame and within sane scales for minutes of running', () => {
    for (const seed of SEEDS) {
      for (const flavor of FLAVORS) {
        for (let t = 0; t <= 60000; t += 641) {
          for (let i = 0; i < MOMENT_COUNT; i++) {
            const p = evalMoment(t, i, seed, flavor);
            expect(p.x).toBeGreaterThan(-10);
            expect(p.x).toBeLessThan(110);
            expect(p.y).toBeGreaterThan(-10);
            expect(p.y).toBeLessThan(110);
            expect(p.scaleX).toBeGreaterThan(0);
            expect(p.scaleX).toBeLessThanOrEqual(1.6);
            expect(p.scaleY).toBeGreaterThan(0);
            expect(p.scaleY).toBeLessThanOrEqual(1.6);
            expect(p.opacity).toBeGreaterThanOrEqual(0);
            expect(p.opacity).toBeLessThanOrEqual(1);
            expect(p.halo).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });

  it('flavors stay subtle — the assembled paw reads the same in every flavor', () => {
    // Entry directions may differ per flavor (photo sweeps, meal diffuses),
    // but the moment of clarity — the held paw — must stay unmistakably the
    // same shape, only inflected.
    for (const seed of SEEDS) {
      for (const flavor of FLAVORS) {
        for (let cycle = 0; cycle < 3; cycle++) {
          const t = T_ASSEMBLY + cycle * CYCLE_MS + 0.5 * CYCLE_MS; // mid-hold
          for (let i = 0; i < MOMENT_COUNT; i++) {
            const base = evalMoment(t, i, seed, 'generic');
            const fl = evalMoment(t, i, seed, flavor);
            expect(Math.hypot(base.x - fl.x, base.y - fl.y)).toBeLessThan(8);
          }
        }
      }
    }
  });
});
