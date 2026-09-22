import {
  TILE_SIZE,
  TRAIL_TILE_ZOOM,
  heroTiles,
  osmTileUrl,
  worldPixel,
} from './communityMapTile';

const W = 343;
const H = 132;

describe('worldPixel', () => {
  test('null island sits at the centre of the world', () => {
    const span = TILE_SIZE * 2 ** TRAIL_TILE_ZOOM;
    const point = worldPixel(0, 0)!;
    expect(point.x).toBeCloseTo(span / 2);
    expect(point.y).toBeCloseTo(span / 2);
  });

  test('north is above south', () => {
    expect(worldPixel(51.5074, -0.1278)!.y).toBeLessThan(worldPixel(-33.8688, 151.2093)!.y);
  });

  test('a missing or unreadable coordinate yields nothing, never NaN', () => {
    expect(worldPixel(Number.NaN, 10)).toBeNull();
    expect(worldPixel(10, Number.NaN)).toBeNull();
    expect(worldPixel(Number.POSITIVE_INFINITY, 0)).toBeNull();
  });

  test('the poles clamp instead of running to infinity', () => {
    const point = worldPixel(90, 0)!;
    expect(Number.isFinite(point.y)).toBe(true);
    expect(point.y).toBeGreaterThanOrEqual(0);
  });

  test('longitude wraps rather than clamping — 181 is a real place', () => {
    expect(worldPixel(0, 181)!.x).toBeCloseTo(worldPixel(0, -179)!.x);
  });
});

describe('osmTileUrl', () => {
  test('carries no query string — a cache-buster would defeat the whole point', () => {
    expect(osmTileUrl(16, 1, 2)).toBe('https://tile.openstreetmap.org/16/1/2.png');
    expect(osmTileUrl(16, 1, 2)).not.toContain('?');
  });
});

/**
 * The regression these exist for: a single tile slid to centre the meeting
 * point leaves a blank band whenever the point sits near a tile edge, which is
 * most of the time. Coverage is the property that actually matters, so it is
 * asserted directly rather than inferred from tile counts.
 */
describe('heroTiles', () => {
  function covers(tiles: ReturnType<typeof heroTiles>, width: number, height: number): boolean {
    if (!tiles) return false;
    // Sample the hero on a fine grid; every sample must land on some tile.
    for (let sx = 0; sx <= width; sx += 7) {
      for (let sy = 0; sy <= height; sy += 7) {
        const hit = tiles.some(
          t => sx >= t.left && sx < t.left + t.size && sy >= t.top && sy < t.top + t.size,
        );
        if (!hit) return false;
      }
    }
    return true;
  }

  test('covers the hero corner to corner for a real place', () => {
    expect(covers(heroTiles(-33.8969, 151.2333, W, H), W, H)).toBe(true);
  });

  test('covers it even when the point sits hard against a tile edge', () => {
    // Walk a range of longitudes so some land near tile boundaries — the exact
    // case the single-tile version failed on.
    for (let i = 0; i < 40; i += 1) {
      const lng = -180 + i * 9.0001;
      expect(covers(heroTiles(-33.87, lng, W, H), W, H)).toBe(true);
    }
  });

  test('covers a tall hero that needs a second row of tiles', () => {
    expect(covers(heroTiles(51.5074, -0.1278, 343, 400), 343, 400)).toBe(true);
  });

  test('puts the meeting point in the middle of the hero', () => {
    const tiles = heroTiles(-33.8969, 151.2333, W, H)!;
    const point = worldPixel(-33.8969, 151.2333)!;
    // The tile containing the centre must place that world pixel at W/2, H/2.
    const centre = tiles.find(
      t => W / 2 >= t.left && W / 2 < t.left + t.size && H / 2 >= t.top && H / 2 < t.top + t.size,
    )!;
    expect(centre).toBeDefined();
    const [, tx, ty] = centre.key.split('/').map(Number);
    expect(tx * TILE_SIZE + (W / 2 - centre.left)).toBeCloseTo(point.x, 3);
    expect(ty * TILE_SIZE + (H / 2 - centre.top)).toBeCloseTo(point.y, 3);
  });

  test('every tile index stays inside the grid for its zoom', () => {
    const across = 2 ** TRAIL_TILE_ZOOM;
    for (const [lat, lng] of [[-85, -180], [85, 179.99], [0, 0], [-33.87, 151.2]]) {
      for (const tile of heroTiles(lat, lng, W, H) ?? []) {
        const [z, x, y] = tile.key.split('/').map(Number);
        expect(z).toBe(TRAIL_TILE_ZOOM);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(across);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThan(across);
      }
    }
  });

  test('a window straddling the antimeridian wraps instead of gapping', () => {
    expect(covers(heroTiles(0, 179.9999, W, H), W, H)).toBe(true);
    expect(covers(heroTiles(0, -179.9999, W, H), W, H)).toBe(true);
  });

  test('no tiles for an unreadable coordinate or an empty hero', () => {
    expect(heroTiles(Number.NaN, 0, W, H)).toBeNull();
    expect(heroTiles(0, 0, 0, H)).toBeNull();
    expect(heroTiles(0, 0, W, 0)).toBeNull();
  });

  test('tile keys are stable, so the image cache can do its job', () => {
    const a = heroTiles(-33.8969, 151.2333, W, H)!;
    const b = heroTiles(-33.8969, 151.2333, W, H)!;
    expect(a.map(t => t.url)).toEqual(b.map(t => t.url));
  });
});
