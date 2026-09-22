import {
  REPLAY_DRAW_MS,
  packReplayDurationMs,
  projectCommunityRoutes,
} from './communityRouteArtwork';

describe('community route artwork', () => {
  it('normalizes coordinates into a map-free canvas', () => {
    const [route] = projectCommunityRoutes([[{ lat: -33.87, lng: 151.20 }, { lat: -33.871, lng: 151.202 }]]);
    expect(route.points).toMatch(/^\d+\.\d,\d+\.\d \d+\.\d,\d+\.\d$/);
    expect(route.points).not.toContain('151.20');
    expect(route.points).not.toContain('-33.87');
  });

  it('keeps missing routes missing', () => {
    expect(projectCommunityRoutes([[]])).toEqual([]);
  });

  it('drops a point it cannot place rather than drawing it at zero', () => {
    const [route] = projectCommunityRoutes([[
      { lat: -33.87, lng: 151.20 },
      { lat: Number.NaN, lng: 151.201 },
      { lat: -33.871, lng: 151.202 },
    ]]);
    expect(route.points.split(' ')).toHaveLength(2);
  });

  it('measures each path so a replay knows how far the stroke travels', () => {
    const [route] = projectCommunityRoutes([[{ lat: -33.87, lng: 151.20 }, { lat: -33.871, lng: 151.202 }]]);
    expect(route.length).toBeGreaterThan(1);
  });

  it('gives a single-fix route a drawable length instead of zero', () => {
    const [route] = projectCommunityRoutes([[{ lat: -33.87, lng: 151.20 }]]);
    expect(route.length).toBe(1);
  });
});

describe('packReplayDurationMs', () => {
  it('has nothing to replay without routes', () => {
    expect(packReplayDurationMs(0)).toBe(0);
  });

  it('takes one draw for a lone walker', () => {
    expect(packReplayDurationMs(1)).toBe(REPLAY_DRAW_MS);
  });

  it('stays short enough to sit through for a whole pack', () => {
    expect(packReplayDurationMs(6)).toBeLessThanOrEqual(3000);
  });
});
