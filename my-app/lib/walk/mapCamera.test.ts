import {
  cameraBounds,
  cameraFromBounds,
  fitCamera,
  fromViewportZoom,
  isOnScreen,
  projectPoint,
  toRegionZoom,
  type MapCamera,
} from './mapCamera';

const VIEW = { width: 390, height: 700 };

describe('fitCamera', () => {
  test('nothing to frame returns null rather than an arbitrary place', () => {
    expect(fitCamera([], VIEW)).toBeNull();
    expect(fitCamera([{ lat: NaN, lng: 12 }], VIEW)).toBeNull();
  });

  test('a single point centres on it at the point zoom', () => {
    const cam = fitCamera([{ lat: 15.55, lng: 73.76 }], { ...VIEW, pointZoom: 14 });
    expect(cam?.center.lat).toBeCloseTo(15.55, 5);
    expect(cam?.center.lng).toBeCloseTo(73.76, 5);
    expect(cam?.zoom).toBe(14);
  });

  test('repeated points collapse to the single-point case', () => {
    const p = { lat: 15.55, lng: 73.76 };
    expect(fitCamera([p, p, p], { ...VIEW, pointZoom: 15 })?.zoom).toBe(15);
  });

  test('centres between the extremes of a span', () => {
    const cam = fitCamera(
      [
        { lat: 15.5, lng: 73.7 },
        { lat: 15.6, lng: 73.8 },
      ],
      VIEW,
    )!;
    expect(cam.center.lng).toBeCloseTo(73.75, 4);
    expect(cam.center.lat).toBeGreaterThan(15.5);
    expect(cam.center.lat).toBeLessThan(15.6);
  });

  test('a wider span zooms out further', () => {
    const tight = fitCamera(
      [
        { lat: 15.55, lng: 73.76 },
        { lat: 15.56, lng: 73.77 },
      ],
      VIEW,
    )!;
    const wide = fitCamera(
      [
        { lat: 15.4, lng: 73.6 },
        { lat: 15.8, lng: 74.0 },
      ],
      VIEW,
    )!;
    expect(wide.zoom).toBeLessThan(tight.zoom);
  });

  test('respects the zoom clamps', () => {
    const world = fitCamera(
      [
        { lat: -60, lng: -170 },
        { lat: 60, lng: 170 },
      ],
      { ...VIEW, minZoom: 5, maxZoom: 17 },
    )!;
    expect(world.zoom).toBe(5);

    const pinpoint = fitCamera(
      [
        { lat: 15.55, lng: 73.76 },
        { lat: 15.550001, lng: 73.760001 },
      ],
      { ...VIEW, maxZoom: 16 },
    )!;
    expect(pinpoint.zoom).toBe(16);
  });

  test('padding tightens the fit', () => {
    const points = [
      { lat: 15.5, lng: 73.7 },
      { lat: 15.6, lng: 73.8 },
    ];
    const bare = fitCamera(points, VIEW)!;
    const padded = fitCamera(points, { ...VIEW, padding: 80 })!;
    expect(padded.zoom).toBeLessThan(bare.zoom);
  });
});

describe('fitCamera — per-edge padding', () => {
  const ROUTE = [
    { lat: 15.5445, lng: 73.7625 },
    { lat: 15.5465, lng: 73.7655 },
  ];
  const CARD = { width: 330, height: 210 };

  test('a number still pads every edge equally — the existing callers', () => {
    // Regression guard: Home and the walk summary both pass a plain number, and
    // this must keep meaning exactly what it always did.
    const uniform = fitCamera(ROUTE, { ...CARD, padding: 40 });
    const explicit = fitCamera(ROUTE, {
      ...CARD,
      padding: { top: 40, right: 40, bottom: 40, left: 40 },
    });
    expect(uniform).toEqual(explicit);
  });

  test('symmetric padding leaves the content centred in the view', () => {
    const cam = fitCamera(ROUTE, { ...CARD, padding: 40 })!;
    const mid = { lat: (ROUTE[0].lat + ROUTE[1].lat) / 2, lng: (ROUTE[0].lng + ROUTE[1].lng) / 2 };
    const at = projectPoint(mid, cam, CARD.width, CARD.height);
    expect(at.x).toBeCloseTo(CARD.width / 2, 0);
    expect(at.y).toBeCloseTo(CARD.height / 2, 0);
  });

  test('extra top padding pushes the content DOWN, clearing room above it', () => {
    // The whole point: a photo card hangs above its coordinate, so the route
    // has to sit lower in the frame.
    const cam = fitCamera(ROUTE, { ...CARD, padding: { top: 80, bottom: 12, left: 12, right: 12 } })!;
    const mid = { lat: (ROUTE[0].lat + ROUTE[1].lat) / 2, lng: (ROUTE[0].lng + ROUTE[1].lng) / 2 };
    const at = projectPoint(mid, cam, CARD.width, CARD.height);
    expect(at.y).toBeGreaterThan(CARD.height / 2);
  });

  test('every framed point clears the reserved top inset', () => {
    // The property that actually prevents the clipping, asserted directly.
    const pad = { top: 80, bottom: 12, left: 12, right: 12 };
    const cam = fitCamera(ROUTE, { ...CARD, padding: pad, maxZoom: 22 })!;
    for (const p of ROUTE) {
      const at = projectPoint(p, cam, CARD.width, CARD.height);
      expect(at.y).toBeGreaterThanOrEqual(pad.top - 0.5);
      expect(at.y).toBeLessThanOrEqual(CARD.height - pad.bottom + 0.5);
      expect(at.x).toBeGreaterThanOrEqual(pad.left - 0.5);
      expect(at.x).toBeLessThanOrEqual(CARD.width - pad.right + 0.5);
    }
  });

  test('asymmetric padding recentres a single point too', () => {
    const cam = fitCamera([{ lat: 15.55, lng: 73.76 }], {
      ...CARD,
      padding: { top: 80, bottom: 12 },
      pointZoom: 16,
    })!;
    const at = projectPoint({ lat: 15.55, lng: 73.76 }, cam, CARD.width, CARD.height);
    expect(at.y).toBeGreaterThan(CARD.height / 2);
    expect(cam.zoom).toBe(16);
  });

  test('padding larger than the view degrades instead of exploding', () => {
    const cam = fitCamera(ROUTE, { ...CARD, padding: { top: 400, bottom: 400 } });
    expect(cam).not.toBeNull();
    expect(Number.isFinite(cam!.zoom)).toBe(true);
    expect(Number.isFinite(cam!.center.lat)).toBe(true);
  });
});

describe('projectPoint', () => {
  const camera: MapCamera = { center: { lat: 15.55, lng: 73.76 }, zoom: 14 };

  test('the camera centre lands at the centre of the view', () => {
    const p = projectPoint(camera.center, camera, VIEW.width, VIEW.height);
    expect(p.x).toBeCloseTo(VIEW.width / 2, 6);
    expect(p.y).toBeCloseTo(VIEW.height / 2, 6);
  });

  test('east is right and north is up', () => {
    const east = projectPoint({ lat: 15.55, lng: 73.8 }, camera, VIEW.width, VIEW.height);
    const north = projectPoint({ lat: 15.6, lng: 73.76 }, camera, VIEW.width, VIEW.height);
    expect(east.x).toBeGreaterThan(VIEW.width / 2);
    expect(north.y).toBeLessThan(VIEW.height / 2);
  });

  test('one zoom step doubles the offset', () => {
    const near = projectPoint({ lat: 15.55, lng: 73.8 }, camera, VIEW.width, VIEW.height);
    const zoomed = projectPoint(
      { lat: 15.55, lng: 73.8 },
      { ...camera, zoom: 15 },
      VIEW.width,
      VIEW.height,
    );
    const dNear = near.x - VIEW.width / 2;
    const dZoom = zoomed.x - VIEW.width / 2;
    expect(dZoom / dNear).toBeCloseTo(2, 4);
  });

  test('a fitted span lands inside the view it was fitted to', () => {
    const points = [
      { lat: 15.5, lng: 73.7 },
      { lat: 15.6, lng: 73.8 },
      { lat: 15.55, lng: 73.74 },
    ];
    const cam = fitCamera(points, { ...VIEW, padding: 40 })!;
    for (const p of points) {
      const s = projectPoint(p, cam, VIEW.width, VIEW.height);
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(VIEW.width);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(VIEW.height);
    }
  });

  test('extreme latitudes clamp instead of running to infinity', () => {
    const p = projectPoint({ lat: 89.9, lng: 0 }, camera, VIEW.width, VIEW.height);
    expect(Number.isFinite(p.y)).toBe(true);
  });
});

describe('isOnScreen', () => {
  test('reports containment, with an optional margin', () => {
    expect(isOnScreen({ x: 10, y: 10 }, 390, 700)).toBe(true);
    expect(isOnScreen({ x: -10, y: 10 }, 390, 700)).toBe(false);
    expect(isOnScreen({ x: -10, y: 10 }, 390, 700, 20)).toBe(true);
  });
});

describe('cameraBounds / cameraFromBounds', () => {
  const camera: MapCamera = { center: { lat: 15.55, lng: 73.76 }, zoom: 14.2 };

  test('the bounds are exactly the corners the projector puts on screen', () => {
    const { ne, sw } = cameraBounds(camera, VIEW.width, VIEW.height);
    const topRight = projectPoint(ne, camera, VIEW.width, VIEW.height);
    const bottomLeft = projectPoint(sw, camera, VIEW.width, VIEW.height);

    expect(topRight.x).toBeCloseTo(VIEW.width, 6);
    expect(topRight.y).toBeCloseTo(0, 6);
    expect(bottomLeft.x).toBeCloseTo(0, 6);
    expect(bottomLeft.y).toBeCloseTo(VIEW.height, 6);
  });

  test('north is the larger latitude even though it is the smaller mercator y', () => {
    const { ne, sw } = cameraBounds(camera, VIEW.width, VIEW.height);
    expect(ne.lat).toBeGreaterThan(sw.lat);
    expect(ne.lng).toBeGreaterThan(sw.lng);
  });

  // The round trip is what makes the Android path safe: we hand MapLibre bounds
  // and read bounds back, so neither direction has to know what MapLibre means
  // by "zoom level".
  test('a camera survives a round trip through bounds', () => {
    const { ne, sw } = cameraBounds(camera, VIEW.width, VIEW.height);
    const back = cameraFromBounds(ne, sw, VIEW.width)!;
    expect(back.center.lat).toBeCloseTo(camera.center.lat, 8);
    expect(back.center.lng).toBeCloseTo(camera.center.lng, 8);
    expect(back.zoom).toBeCloseTo(camera.zoom, 8);
  });

  test('a viewport crossing the antimeridian keeps a real longitude', () => {
    const wrapped = cameraFromBounds({ lat: 1, lng: -179 }, { lat: -1, lng: 179 }, 390)!;
    expect(wrapped.center.lng).toBeCloseTo(180, 6);
    expect(Number.isFinite(wrapped.zoom)).toBe(true);
  });

  test('a degenerate rectangle returns null rather than an infinite zoom', () => {
    expect(cameraFromBounds({ lat: 1, lng: 10 }, { lat: -1, lng: 10 }, 390)).toBeNull();
    expect(cameraFromBounds({ lat: 1, lng: 11 }, { lat: -1, lng: 10 }, 0)).toBeNull();
  });
});

describe('toRegionZoom / fromViewportZoom', () => {
  // The bug this pair exists to kill: passing a Web Mercator zoom straight to
  // MapKit rendered the map ~1.5x closer than the projector assumed on a phone.
  test('a 256px-wide view is the one place the two conventions agree', () => {
    const camera: MapCamera = { center: { lat: 0, lng: 0 }, zoom: 14 };
    expect(toRegionZoom(camera, 256, 256)).toBeCloseTo(14, 8);
  });

  test('a wider view needs a lower region zoom to show the same ground', () => {
    const camera: MapCamera = { center: { lat: 0, lng: 0 }, zoom: 14 };
    // 512 px is one doubling past 256, so exactly one zoom level.
    expect(toRegionZoom(camera, 512, 4096)).toBeCloseTo(13, 8);
  });

  test('a short view binds on height instead of width', () => {
    // A wide, short card at the equator: 210px of height is the limiting axis,
    // so the region has to open up further than the width alone would ask.
    const camera: MapCamera = { center: { lat: 0, lng: 0 }, zoom: 14 };
    const wide = toRegionZoom(camera, 340, 210);
    expect(wide).toBeCloseTo(14 + Math.log2(256 / 210), 8);
  });

  test('latitude shrinks the vertical extent, never the horizontal', () => {
    const equator: MapCamera = { center: { lat: 0, lng: 0 }, zoom: 14 };
    const far: MapCamera = { center: { lat: 60, lng: 0 }, zoom: 14 };
    // At 60° a degree of latitude is twice as many pixels, so the height binds
    // sooner and the region has to be wider still.
    expect(toRegionZoom(far, 340, 210)).toBeGreaterThan(toRegionZoom(equator, 340, 210));
  });

  test('a reported viewport zoom converts back to the projector convention', () => {
    // A map reporting "the width shows 360/2^z degrees" on a 390px view.
    expect(fromViewportZoom(14, 390)).toBeCloseTo(14 + Math.log2(390 / 256), 8);
    expect(fromViewportZoom(14, 256)).toBeCloseTo(14, 8);
  });

  test('the read-back scale is exactly what the projector would draw', () => {
    // Round trip through the quantity a map actually reports: the true visible
    // longitude span. This is the guarantee that a panned map and our pins end
    // up agreeing, whatever the SDK did with our requested framing.
    const camera: MapCamera = { center: { lat: 15.55, lng: 73.76 }, zoom: 14.2 };
    const { ne, sw } = cameraBounds(camera, VIEW.width, VIEW.height);
    const reported = Math.log2(360 / (ne.lng - sw.lng));
    expect(fromViewportZoom(reported, VIEW.width)).toBeCloseTo(camera.zoom, 8);
  });
});
